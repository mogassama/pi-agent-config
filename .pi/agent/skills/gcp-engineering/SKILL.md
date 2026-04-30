---
name: gcp-engineering
description: Use for Google Cloud Platform service work — gcloud and bq CLI usage, IAM, BigQuery jobs and table management, Dataflow / Apache Beam pipelines, Pub/Sub topics and subscriptions, Cloud Functions deployment, Cloud Composer environment ops, and cost / quota awareness. Trigger on any task involving gcloud, bq, terraform for GCP, or the google-cloud Python SDKs.
---

# GCP Engineering

## When this skill is active

You are interacting with Google Cloud — via `gcloud`, `bq`, `gsutil`, the `google-cloud-*` Python SDKs, or designing infrastructure for GCP. **Verify command syntax against `--help` before running anything destructive** — flags drift.

## Universal habits

- **Project context first.** Every command must be unambiguous about which project. Either `gcloud config set project <id>` once per session and confirm with `gcloud config get project`, or pass `--project=<id>` on every command.
- **Authentication.** `gcloud auth application-default login` for SDK code (sets ADC). `gcloud auth login` for CLI itself. They're separate.
- **Service accounts > user creds** for anything running unattended. Locally, `gcloud auth application-default login` impersonating a service account is the cleanest dev pattern: `gcloud auth application-default login --impersonate-service-account=<sa>@<project>.iam.gserviceaccount.com`.
- **Region/zone matters.** BigQuery datasets are regional/multi-regional and can't be moved. Cross-region transfers cost money. Pick `EU` or `europe-west1` once and stick to it (Mo is in Paris).
- **Dry-run before destructive ops.** `bq query --dry_run`, `gcloud ... --dry-run` where supported, `terraform plan` always.

## BigQuery (CLI)

- `bq query --use_legacy_sql=false --dry_run "SELECT ..."` — cost preview
- `bq show --format=prettyjson <project>:<dataset>.<table>` — full schema + partitioning + clustering metadata
- `bq ls --max_results=1000 <project>:<dataset>` — table listing
- `bq cp -f <src> <dst>` — table copy (cheap, metadata operation when same region)
- `bq extract --destination_format=NEWLINE_DELIMITED_JSON <table> 'gs://.../.json'` — export
- `bq mk --table --time_partitioning_field=event_date --clustering_fields=user_id,country <dataset>.<table> <schema.json>` — create with proper partitioning

**Cost discipline:** the on-demand pricing model bills on bytes scanned, not bytes returned. A `LIMIT 10` on a non-partitioned 1TB table still scans 1TB.

## Dataflow / Apache Beam

- **Use Flex Templates** for production pipelines. Classic templates are legacy.
- **Streaming vs batch:** decide upfront. Switching later means rewriting windowing.
- **Windowing:** fixed for periodic aggregation, sliding for moving averages, session for user-activity grouping.
- **Watermark + late-data handling** is the part that bites — `withAllowedLateness` and triggers must be set deliberately.
- **Worker sizing:** start with `n1-standard-2` and `--num_workers=3 --max_num_workers=10`. Autoscale if needed.
- **Local testing:** `DirectRunner` for unit tests, but it doesn't catch all serialization issues. A staging Dataflow run with sampled data is the only real validation.

## Pub/Sub

- **Topic + subscription separation.** Topics are publisher-side, subscriptions are consumer-side. One topic, many subscriptions = fan-out.
- **Pull vs push.** Pull (with the client lib) for backend services. Push (HTTP endpoint) for Cloud Functions / Run.
- **Ack deadline:** default 10s. Long-running consumers must extend it (`modify_ack_deadline`) or use `streaming_pull` which handles it.
- **Dead-letter topics** are mandatory for production subscriptions. Without one, poison messages loop forever.
- **Ordering keys** if order matters within a partition. Costs throughput.
- **Message size limit: 10MB.** For larger payloads, write to GCS and publish the URI.

## Cloud Functions

- **Gen 2** is the current runtime. Gen 1 is in maintenance.
- **Trigger types:** HTTP (synchronous), Pub/Sub (event), GCS (event), Eventarc (everything else).
- **Cold starts:** keep imports lazy if only some code paths need them. Use `min_instances=1` for latency-sensitive functions (costs money).
- **Timeout:** HTTP gen 2 caps at 60min, event gen 2 at 9min. Anything longer needs Cloud Run jobs or Dataflow.
- **Secrets:** Secret Manager + Cloud Function secret env-var integration. Never bake secrets into code or env vars set at deploy time.

## Cloud Composer

See `airflow-engineering` skill for DAG-level patterns. Composer-level ops:

- `gcloud composer environments list --locations=europe-west1`
- `gcloud composer environments describe <env> --location=...` — full config
- `gcloud composer environments storage dags import --environment=<env> --location=... --source=<dag.py>` — push a DAG (or just `gsutil cp` to the bucket)
- `gcloud composer environments run <env> --location=... -- dags list` — run an Airflow CLI command in the env

## IAM — least privilege

- **Predefined roles** before custom. `roles/bigquery.dataViewer`, `roles/bigquery.jobUser` (split intentionally — viewing data ≠ running jobs that bill).
- **Service account per workload.** A pipeline's SA should not be reusable for another pipeline.
- **Workload Identity** for GKE / Cloud Run / Composer — never download service-account JSON keys.
- **`gcloud projects get-iam-policy <project> --format=json`** to audit. `policy-troubleshooter` for "why can't this principal do X".

## Cost & quota awareness

- **BigQuery slots** vs on-demand. On-demand is fine until it isn't (predictable bills via reservations).
- **Cloud Storage class** matters. Standard for hot, Nearline for ~monthly, Coldline for ~quarterly, Archive for compliance. Lifecycle rules to auto-tier.
- **Egress is the silent killer.** Cross-region or out-of-GCP egress is expensive — design to keep data in-region.
- **`gcloud beta billing budgets`** + budget alerts on every project. Mo should have one set up.

## Review checklist (any GCP-touching code)

- [ ] No hardcoded project IDs (env var or config)
- [ ] No hardcoded credentials (ADC / Workload Identity / Secret Manager)
- [ ] Region is explicit, not relying on defaults
- [ ] Dead-letter / error handling for any async/event-driven path
- [ ] Cost-bounded (LIMIT on dev queries, partition filters in prod, sane Dataflow worker caps)
- [ ] IAM scoped to the workload, not the human

## TODO

- Mo's preferred GCP project naming/structure
- Terraform vs gcloud for what
- Common gcloud one-liners Mo runs often → alias / `pi` prompt template
