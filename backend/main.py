"""Yield Studio backend: checks Supabase logins and hands out Cloud Storage upload links.

Settings come from the environment (see .env.example). Run from v2.0/app/backend:

    uvicorn main:app --reload --port 8000
"""
import os
import re
import uuid
from datetime import timedelta
from pathlib import Path

import jwt
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

for line in (Path(__file__).parent / ".env").read_text().splitlines() if (Path(__file__).parent / ".env").exists() else []:
    if "=" in line and not line.lstrip().startswith("#"):
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())

ALLOWED_DOMAINS = {"osu.edu", "buckeyemail.osu.edu"}
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET")          # legacy HS256 projects; newer ones use the JWKS below
DATABASE_URL = os.environ.get("DATABASE_URL")
BUCKET = os.environ.get("GCS_BUCKET")
FRONTEND = os.environ.get("FRONTEND_ORIGIN", "http://localhost:5173")

app = FastAPI(title="Yield Studio API")
app.add_middleware(CORSMiddleware, allow_origins=[FRONTEND], allow_methods=["*"], allow_headers=["*"])
bearer = HTTPBearer(auto_error=False)
jwks = jwt.PyJWKClient(f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json") if SUPABASE_URL and not JWT_SECRET else None


def osu_email(email: str) -> bool:
    return email.lower().rsplit("@", 1)[-1] in ALLOWED_DOMAINS and email.count("@") == 1


class User(BaseModel):
    id: str
    email: str


def current_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> User:
    """The signed-in user, from the Supabase access token the website sends."""
    if creds is None:
        raise HTTPException(401, "Sign in first")
    token = creds.credentials
    try:
        if JWT_SECRET:
            claims = jwt.decode(token, JWT_SECRET, algorithms=["HS256"], audience="authenticated")
        elif jwks:
            key = jwks.get_signing_key_from_jwt(token)
            claims = jwt.decode(token, key, algorithms=["ES256", "RS256"], audience="authenticated")
        else:
            raise HTTPException(500, "Set SUPABASE_URL or SUPABASE_JWT_SECRET")
    except jwt.PyJWTError:
        raise HTTPException(401, "Session expired, sign in again")
    email = claims.get("email") or ""
    if not osu_email(email):
        raise HTTPException(403, "Only @osu.edu and @buckeyemail.osu.edu addresses can use Yield Studio")
    return User(id=claims["sub"], email=email.lower())


def db():
    if not DATABASE_URL:
        raise HTTPException(503, "Set DATABASE_URL to the Supabase Postgres connection string")
    import psycopg
    from psycopg.rows import dict_row
    return psycopg.connect(DATABASE_URL, row_factory=dict_row, autocommit=True)


@app.get("/health")
def health():
    return {"ok": True, "auth": bool(JWT_SECRET or jwks), "database": bool(DATABASE_URL), "storage": bool(BUCKET)}


@app.get("/me")
def me(user: User = Depends(current_user)):
    return user


@app.get("/files")
def files(user: User = Depends(current_user)):
    with db() as conn:
        return conn.execute("select id, name, kind, bytes, status, osc_path, error, created_at, updated_at from files "
                            "where owner = %s order by created_at desc", (user.id,)).fetchall()


class Upload(BaseModel):
    name: str
    bytes: int
    content_type: str = "application/octet-stream"


@app.post("/files/upload")
def upload(body: Upload, user: User = Depends(current_user)):
    """A 15-minute signed PUT link into the staging folder. The bucket event takes it to OSC from there."""
    if not BUCKET:
        raise HTTPException(503, "Set GCS_BUCKET")
    from google.cloud import storage
    file_id = str(uuid.uuid4())
    name = re.sub(r"[^\w.\-]+", "_", body.name)[:120] or "file"
    path = f"staging/{user.id}/{file_id}/{name}"
    url = storage.Client().bucket(BUCKET).blob(path).generate_signed_url(
        version="v4", expiration=timedelta(minutes=15), method="PUT", content_type=body.content_type)
    with db() as conn:
        conn.execute("insert into files (id, owner, name, kind, bytes, gcs_path) values (%s, %s, %s, 'upload', %s, %s)",
                     (file_id, user.id, body.name, body.bytes, path))
    return {"id": file_id, "url": url, "content_type": body.content_type}


@app.get("/jobs")
def jobs(user: User = Depends(current_user)):
    with db() as conn:
        return conn.execute("select id, kind, status, progress, result, error, created_at, updated_at from jobs "
                            "where owner = %s order by created_at desc", (user.id,)).fetchall()
