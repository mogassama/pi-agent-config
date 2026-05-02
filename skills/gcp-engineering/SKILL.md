---
name: "gcp-engineering"
description: "GCP Infrastructure & Service management (CLI, IAM, BQ, Cloud Run, Storage)."
---

# GCP Engineering (2026 Power User)

## Execution Rules
- **Security:** NEVER download or reference Service Account JSON keys. Use `--impersonate-service-account`.
- **Language:** Resource descriptions, labels, and logs MUST be in **English**.
- **Region:** Default to `europe-west1` (Paris) to minimize latency and egress.
- **Environment:** Use `uv` for all local Python scripts interacting with SDKs.

## 1. Identity & Access (The "Zero-Key" Rule)
- **Local Dev:** `gcloud auth application-default login --impersonate-service-account=[SA_EMAIL]`
- **IAM:** Apply Least Privilege. Use `roles/bigquery.jobUser` (run) + `roles/bigquery.dataViewer` (read).
- **Audit:** Use `gcloud iam explain` to debug permission issues.

## 2. BigQuery (FinOps Edition)
- **Dry-Run:** Mandatory before any non-trivial query: `bq query --use_legacy_sql=false --dry_run "..."`.
- **BigLake:** Prefer BigLake tables for GCS data (Parquet/Avro) to avoid ingestion costs.
- **Performance:** 
  - Mandatory Partitioning (`--time_partitioning_field`).
  - Mandatory Clustering (up to 4 columns).
- **Modern SQL:** Use `SEARCH INDEX` for logs and `JSON` type for dynamic payloads.

## 3. Serverless Compute: Cloud Run (Default)
- **Cloud Run Jobs:** Use for ETL tasks, migrations, and `uv`-based Python scripts.
- **Cloud Functions (Gen 2):** Use ONLY for simple, event-driven triggers (GCS Finalize, Pub/Sub).
- **Containerization:** Always use **Artifact Registry**. Use `uv lock --build-bundle` (concept 2026) for lean images.

## 4. Pub/Sub & Event-Driven
- **Ingestion:** Use BigQuery Subscriptions for zero-code ingestion.
- **Reliability:** Mandatory **Dead Letter Topics** for all production subscriptions.
- **Observability:** Monitor `subscription/oldest_unacked_message_age`.

## 5. Cloud Composer 3 (Serverless)
- **Scaling:** Rely on Composer 3 auto-scaling.
- **Management:** Use `gcloud composer environments` only for infra. Use `airflow-engineering` for DAGs.
- **Storage:** Use `gsutil rsync` for DAG deployments.

## 6. Storage & Egress
- **Lifecycle:** Set TTL or "Move to Coldline" rules on all GCS buckets.
- **Egress:** Avoid cross-region moves. Keep GCS and BQ in `europe-west1`.

## Review Checklist (GCP Veto)
- [ ] **No Service Account Keys** found in code or config.
- [ ] **Labels** present (`env`, `team`, `cost_center`).
- [ ] **Project ID** is never hardcoded (use `GOOGLE_CLOUD_PROJECT` env var).
- [ ] **Dry-run** cost is acceptable for the business value.
- [ ] **English** used for all metadata.
- [ ] **Loguru** integration confirmed for Cloud Run/Functions.
