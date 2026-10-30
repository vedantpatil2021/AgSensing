"""Cloud Run functions that move every finished file from Cloud Storage to OSC with Globus, then empty the bucket.

on_finalize      Eventarc trigger on the bucket's "object finalized" event: starts a Globus transfer.
check_transfers  HTTP, called by Cloud Scheduler every 10 minutes: deletes files Globus has copied, retries failures.

Deploy (from v2.0/app/backend/pipeline):

    gcloud functions deploy on-finalize --gen2 --runtime python312 --region us-central1 --entry-point on_finalize \
        --trigger-bucket $GCS_BUCKET --env-vars-file env.yaml
    gcloud functions deploy check-transfers --gen2 --runtime python312 --region us-central1 --entry-point check_transfers \
        --trigger-http --no-allow-unauthenticated --env-vars-file env.yaml
    gcloud scheduler jobs create http check-transfers --schedule "*/10 * * * *" --uri <check-transfers URL> \
        --oidc-service-account-email <service account>
"""
import os

import functions_framework
import globus_sdk
import psycopg
from google.cloud import storage
from psycopg.rows import dict_row

BUCKET = os.environ["GCS_BUCKET"]
GCS_COLLECTION = os.environ["GLOBUS_GCS_COLLECTION"]        # Globus collection over the bucket
GCS_ROOT = os.environ.get("GLOBUS_GCS_ROOT", f"/{BUCKET}/")  # how the collection names the bucket's top folder
OSC_COLLECTION = os.environ["GLOBUS_OSC_COLLECTION"]
OSC_ROOT = os.environ["OSC_ROOT"].rstrip("/") + "/"          # e.g. /fs/ess/PAS1234/yield-studio/
MAX_ATTEMPTS = 3


def transfer_client():
    auth = globus_sdk.ConfidentialAppAuthClient(os.environ["GLOBUS_CLIENT_ID"], os.environ["GLOBUS_CLIENT_SECRET"])
    authorizer = globus_sdk.ClientCredentialsAuthorizer(auth, globus_sdk.TransferClient.scopes.all)
    return globus_sdk.TransferClient(authorizer=authorizer)


def db():
    return psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row, autocommit=True)


def osc_path(gcs_path):
    return OSC_ROOT + gcs_path.removeprefix("staging/")


def submit(tc, gcs_path):
    data = globus_sdk.TransferData(source_endpoint=GCS_COLLECTION, destination_endpoint=OSC_COLLECTION,
                                   label=f"yield-studio {gcs_path[-60:]}", verify_checksum=True, sync_level="checksum")
    data.add_item(GCS_ROOT + gcs_path, osc_path(gcs_path))
    return tc.submit_transfer(data)["task_id"]


@functions_framework.cloud_event
def on_finalize(event):
    name = event.data["name"]
    if not name.startswith("staging/") or name.endswith("/"):
        return
    task = submit(transfer_client(), name)
    with db() as conn:   # GEE exports have no row yet: they belong to the lab (owner null)
        conn.execute("insert into files (name, kind, bytes, gcs_path, status, globus_task, attempts) "
                     "values (%s, 'export', %s, %s, 'transferring', %s, 1) on conflict (gcs_path) do update set "
                     "status = 'transferring', globus_task = excluded.globus_task, bytes = excluded.bytes, "
                     "attempts = files.attempts + 1, updated_at = now()",
                     (name.rsplit("/", 1)[-1], int(event.data.get("size", 0)), name, task))


@functions_framework.http
def check_transfers(request):
    tc, bucket = transfer_client(), storage.Client().bucket(BUCKET)
    done = 0
    with db() as conn:
        for row in conn.execute("select id, gcs_path, globus_task, attempts from files where status = 'transferring'").fetchall():
            status = tc.get_task(row["globus_task"])["status"]
            if status == "SUCCEEDED":   # safely at OSC: only now is the bucket copy removed
                bucket.blob(row["gcs_path"]).delete()
                conn.execute("update files set status = 'at_osc', osc_path = %s, error = null, updated_at = now() where id = %s",
                             (osc_path(row["gcs_path"]), row["id"]))
                done += 1
            elif status == "FAILED" and row["attempts"] < MAX_ATTEMPTS:
                conn.execute("update files set globus_task = %s, attempts = attempts + 1, updated_at = now() where id = %s",
                             (submit(tc, row["gcs_path"]), row["id"]))
            elif status == "FAILED":
                conn.execute("update files set status = 'failed', error = 'Globus transfer failed 3 times', updated_at = now() "
                             "where id = %s", (row["id"],))
    return {"moved": done}
