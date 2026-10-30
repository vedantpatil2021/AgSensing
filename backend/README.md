# Yield Studio backend

| Path | What it is |
|---|---|
| `main.py` | FastAPI: checks the Supabase login on every call (OSU addresses only), lists files and jobs, hands out Cloud Storage upload links. |
| `supabase/schema.sql` | Database: OSU-only guard on sign-up, `profiles`, `files`, `jobs`, row level security. |
| `pipeline/main.py` | Cloud Run functions: bucket event → Globus transfer to OSC → delete from the bucket once Globus reports success. |

## Run locally

```bash
cd v2.0/app/backend
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt
cp .env.example .env            # fill it in
PYTHONDONTWRITEBYTECODE=1 .venv/bin/uvicorn main:app --reload --port 8000
```

`GET /health` shows which parts are configured. Every other route needs `Authorization: Bearer <Supabase access token>`;
the website sends it for you (`api()` in `frontend/src/lib/auth.tsx`).

## Supabase setup (once)

1. Create a project at supabase.com (free plan is enough).
2. **SQL Editor** → paste and run `supabase/schema.sql`.
3. **Authentication → Sign In / Providers → Email**: on. Set *Email OTP length* to 6 (it must match `VITE_OTP_LENGTH`)
   and *Email OTP expiration* to 600 seconds. Turn every other provider off.
4. **Authentication → Emails → Templates**: in both **Magic Link** and **Confirm signup**, replace the link with the code,
   for example `<h2>Your Yield Studio code</h2><p>{{ .Token }}</p><p>It expires in 10 minutes.</p>`.
   Without `{{ .Token }}` Supabase emails a link instead of a code.
5. **Authentication → Emails → SMTP Settings**: add a real SMTP sender (OSU's, or a free plan such as Resend or Brevo).
   Supabase's built-in sender only mails the project's own team members and a few messages an hour.
6. **Authentication → URL Configuration**: Site URL = where the website runs (`http://localhost:5173` for now).
7. **Project Settings → API**: copy the URL and the anon (publishable) key into `frontend/.env.local`, and the URL into
   `backend/.env`. **Project Settings → Database → Connection string** goes into `DATABASE_URL`.

Sessions: the browser keeps the session and refreshes it (Supabase default: 1-hour access token, long-lived refresh
token). To force people to sign in again after a while, set **Authentication → Sessions** (time-box or inactivity
timeout; these need a paid plan) or shorten the JWT expiry.

## Who can sign in

Only `name@osu.edu` and `name@buckeyemail.osu.edu`, checked in three places:
the sign-in form, the database trigger in `schema.sql` (so the Supabase API itself refuses other addresses),
and `current_user()` in `main.py` (so the API refuses any token without one).

## File pipeline (Phase 4)

See the docstring in `pipeline/main.py` for deploy commands and `pipeline/env.example.yaml` for its settings.
It needs a staging bucket in a free-tier region, a Globus collection over that bucket (Google Cloud Storage connector,
which needs a Globus subscription), OSC's Globus collection and a Globus service app with access to both.
Not tested yet: it needs those accounts.
