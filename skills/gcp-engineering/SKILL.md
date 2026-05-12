---
name: gcp-engineering
description: Load for GCP infrastructure tasks — IAM, Cloud Run, Cloud Functions, Pub/Sub, Cloud Composer, GCS, Secret Manager. For BigQuery, load bigquery-engineering instead. Auto-load on gcloud CLI usage, GCP service configuration, IAM policy work, or any task involving GCP resource management.
---

# GCP Engineering

## Non-negotiable defaults

- **No service account JSON keys.** Ever. Local dev uses ADC. Production uses workload identity or impersonation.
- **Region:** `europe-west1` (Paris) by default. Never cross-region unless explicitly required.
- **Labels on every resource:** `env`, `team`, `cost_center` minimum.
- **Project ID:** Never hardcoded. Always `os.environ["GOOGLE_CLOUD_PROJECT"]` or injected via function argument.
- **Language:** Resource descriptions, labels, log messages in English.

## Identity & Access

```bash
# Local dev — ADC with impersonation
gcloud auth application-default login
gcloud auth application-default login --impersonate-service-account=SA_EMAIL@PROJECT.iam.gserviceaccount.com

# Verify active identity
gcloud auth list
gcloud config get-value account
```

**IAM least privilege — common roles:**

| Task | Role |
|---|---|
| Run BQ jobs | `roles/bigquery.jobUser` |
| Read BQ data | `roles/bigquery.dataViewer` |
| Write BQ data | `roles/bigquery.dataEditor` |
| Read GCS | `roles/storage.objectViewer` |
| Write GCS | `roles/storage.objectCreator` |
| Read secrets | `roles/secretmanager.secretAccessor` |
| Invoke Cloud Run | `roles/run.invoker` |

Never grant `roles/owner` or `roles/editor`. Flag immediately in review.

**Debug IAM permission failures:**

```bash
# Policy Troubleshooter (replaces the non-existent `gcloud iam explain`)
gcloud policy-troubleshooter iam troubleshoot \
  --principal-email=user@example.com \
  --permission=bigquery.tables.getData \
  --resource=//bigquery.googleapis.com/projects/PROJECT/datasets/DATASET/tables/TABLE
```

## Secret Manager

```python
from google.cloud import secretmanager

def get_secret(project_id: str, secret_id: str, version: str = "latest") -> str:
    client = secretmanager.SecretManagerServiceClient()
    name = f"projects/{project_id}/secrets/{secret_id}/versions/{version}"
    response = client.access_secret_version(request={"name": name})
    return response.payload.data.decode("utf-8")
```

- Never log secret values — log only `secret_id` and `version`.
- Access secrets at startup, not inline in hot paths.
- Rotate via `gcloud secrets versions add SECRET_ID --data-file=-`.

## Cloud Run — containerization with uv

**Multi-stage Dockerfile (lean image):**

```dockerfile
# Build stage
FROM python:3.12-slim AS builder
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv export --frozen --no-dev -o requirements.txt \
    && pip install --no-cache-dir -r requirements.txt --target /app/deps

# Runtime stage
FROM python:3.12-slim
WORKDIR /app
COPY --from=builder /app/deps /app/deps
COPY src/ ./src/
ENV PYTHONPATH=/app/deps
CMD ["python", "-m", "src.main"]
```

- **Cloud Run Jobs:** ETL pipelines, migrations, batch Python scripts.
- **Cloud Functions Gen 2:** Simple event triggers only (GCS finalize, Pub/Sub push). No business logic.
- Always use Artifact Registry — never Container Registry (deprecated).

```bash
# Build and push
gcloud builds submit --tag europe-west1-docker.pkg.dev/PROJECT/REPO/IMAGE:TAG

# Deploy Cloud Run Job
gcloud run jobs create JOB_NAME \
  --image=europe-west1-docker.pkg.dev/PROJECT/REPO/IMAGE:TAG \
  --region=europe-west1 \
  --service-account=SA_EMAIL \
  --set-env-vars=GOOGLE_CLOUD_PROJECT=PROJECT
```

## Pub/Sub

```bash
# Create topic + subscription with dead-letter
gcloud pubsub topics create my-topic
gcloud pubsub topics create my-topic-deadletter

gcloud pubsub subscriptions create my-sub \
  --topic=my-topic \
  --dead-letter-topic=my-topic-deadletter \
  --max-delivery-attempts=5 \
  --ack-deadline=60
```

- Dead-letter topic mandatory on every production subscription.
- BigQuery subscription for zero-code ingestion when schema is stable.
- Monitor `subscription/oldest_unacked_message_age` — alert if >5 min in production.

## Cloud Storage

```bash
# gcloud storage replaces gsutil (gsutil deprecated since 2024)
gcloud storage cp file.parquet gs://bucket/path/
gcloud storage rsync --recursive ./dags gs://composer-bucket/dags/
gcloud storage ls --long gs://bucket/path/

# Lifecycle rule (JSON)
gcloud storage buckets update gs://bucket \
  --lifecycle-file=lifecycle.json
```

`lifecycle.json` template:
```json
{
  "lifecycle": {
    "rule": [
      {
        "action": {"type": "SetStorageClass", "storageClass": "COLDLINE"},
        "condition": {"age": 90}
      },
      {
        "action": {"type": "Delete"},
        "condition": {"age": 365}
      }
    ]
  }
}
```

- Lifecycle rules mandatory on all buckets. No unbounded retention.
- Keep GCS bucket and BQ dataset in the same region to avoid egress costs.

## Cloud Composer

- Composer 2 is stable GA. Composer 3 is available in select regions — verify region support before targeting it.
- Deploy DAGs via `gcloud storage rsync`:
  ```bash
  gcloud storage rsync --recursive ./dags gs://COMPOSER_BUCKET/dags/
  ```
- Composer infra changes via `gcloud composer environments update` only — never manual console edits.
- DAG authoring rules in `airflow-engineering` skill — not here.

## Review checklist

- [ ] No service account JSON keys in code, config, or environment variables
- [ ] All resources have `env`, `team`, `cost_center` labels
- [ ] Project ID injected via env var or function argument — never hardcoded
- [ ] IAM roles are least-privilege — no `roles/owner` or `roles/editor`
- [ ] Dead-letter topic configured on all Pub/Sub production subscriptions
- [ ] GCS lifecycle rule present on all buckets
- [ ] `gsutil` commands replaced with `gcloud storage`
- [ ] Docker images use multi-stage build with uv export
- [ ] Artifact Registry used — not Container Registry
- [ ] Secrets via Secret Manager — not env vars with raw values
