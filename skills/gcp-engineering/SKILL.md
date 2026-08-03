---
name: gcp-engineering
description: >-
  Load for operating GCP imperatively — identity and access (IAM roles, service
  accounts, ADC, impersonation), runtime configuration and deployment of compute
  and messaging services (Cloud Run, Cloud Functions, Dataflow, Dataproc,
  Pub/Sub, Composer environments, GCS), secrets, quotas. Intent-scoped:
  operations the operator runs by hand, now. Resources declared in a state file
  belong to iac-terraform; warehouse queries, cost and access belong to the
  bigquery-* skills; Spark engine semantics belong to spark-engineering.
  Auto-load on gcloud usage, credential and impersonation problems, service
  account and role questions.

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

Never grant a basic role. `roles/owner` and `roles/editor` carry write and
destroy; `roles/viewer` carries read across every service in the project,
including data. Flag all three in review — the first two block.

This is the canonical statement. `iac-terraform` points here rather than
restating it: IAM is a GCP subject, not a Terraform one.

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

## Dataflow / Apache Beam

- **Flex Templates for production.** Classic templates are legacy — new pipelines are Flex.
- **Batch vs streaming is decided upfront.** Switching later means rewriting windowing and state handling. It is not a runtime flag.
- **Windowing:** fixed for periodic aggregation, sliding for moving averages, session for user-activity grouping.
- **Watermarks and late data are the part that bites.** `withAllowedLateness` and trigger configuration are deliberate choices — never left implicit.
- **Streaming Engine** on streaming jobs: moves shuffle and state off the workers.
- **Every autoscaled service declares its ceiling.** No ceiling means no bill
  ceiling. Dataflow: `--max-workers` — `--num-workers` is a floor, autoscaling
  does the rest. Cloud Run: `--max-instances`. Cloud Functions:
  `--max-instances`. The default on each is high enough to be indistinguishable
  from unbounded during an incident.
- **`DirectRunner` does not validate a pipeline.** It misses serialization and fusion behaviour. A staging run on sampled data is the only real validation.
- **Stop streaming jobs with `drain`, not `cancel`.** Drain finishes in-flight windows; cancel drops them. Cancel only when data loss is acceptable.
- Workers pinned to the same region as sources and sinks — cross-region worker traffic is billed.

```bash
# Run a Flex Template job
gcloud dataflow flex-template run JOB_NAME \
  --template-file-gcs-location=gs://BUCKET/templates/TEMPLATE.json \
  --region=europe-west1 \
  --service-account-email=SA_EMAIL \
  --max-workers=10 \
  --parameters=input=INPUT,output=OUTPUT

# Stop a streaming job cleanly
gcloud dataflow jobs drain JOB_ID --region=europe-west1
```

> Machine type families and Runner v2 defaults move between SDK releases. Check the
> current Dataflow docs before pinning a machine type — do not pin one from memory.


## Dataproc — Spark on GCP

Engine-level Spark rules live in `spark-engineering`. This section is submission,
sizing and wiring only.

- **Serverless (Batches) is the default.** No cluster to size, patch, or forget to
  delete. Reach for a cluster only when you need a specific init action, a long-lived
  interactive session, or a component Serverless doesn't ship.
- **Never a long-running cluster for batch work.** If a cluster is genuinely required,
  it is ephemeral: `--max-idle` and `--max-age` are mandatory at creation. A forgotten
  Dataproc cluster is the most expensive idle resource on GCP.
- **Pin the runtime version.** `--version=2.2` and not the floating default — a runtime
  bump silently changes the Spark, Python and Scala versions under your job.
- **Serverless requires a subnet with Private Google Access enabled.** This is the
  single most common first-run failure, and the error message does not say so plainly.
- **Configure a Persistent History Server.** Without a PHS, the Spark UI disappears the
  moment the batch ends and post-mortem debugging is impossible. Set it up once, per
  project, and point every batch at it.
- **Region-pin everything.** Batch region, GCS staging bucket and BigQuery dataset in
  the same region — cross-region is billed and slow.
- **Dedicated service account per workload**, with `roles/dataproc.worker` plus only the
  data access it actually needs. Never the default Compute Engine SA.
- **Spark properties go through `--properties`.** Anything set in code with
  `spark.conf.set` after session creation is ignored for startup-only settings — the
  same trap as in a notebook, see `spark-engineering`.
- **BigQuery I/O uses the spark-bigquery-connector, not the BQ Python client.** Indirect
  write (via GCS) is the default and needs `temporaryGcsBucket`; DIRECT write skips the
  staging hop but has its own constraints. Read the connector docs before choosing.

```bash
# Submit a PySpark batch (Serverless)
gcloud dataproc batches submit pyspark gs://BUCKET/jobs/pipeline.py \
  --region=europe-west1 \
  --version=2.2 \
  --subnet=SUBNET_WITH_PGA \
  --service-account=SA_EMAIL \
  --deps-bucket=gs://BUCKET \
  --history-server-cluster=projects/PROJECT/regions/europe-west1/clusters/PHS \
  --properties=spark.sql.shuffle.partitions=64,spark.dynamicAllocation.maxExecutors=20 \
  -- --input=INPUT --output=OUTPUT

# Inspect a batch
gcloud dataproc batches describe BATCH_ID --region=europe-west1
gcloud dataproc batches list --region=europe-west1 --filter="state=FAILED"

# Ephemeral cluster, if genuinely unavoidable
gcloud dataproc clusters create NAME \
  --region=europe-west1 \
  --max-idle=30m \
  --max-age=4h \
  --enable-component-gateway
```

> Serverless runtime versions and their bundled Spark/Python versions change on GCP's
> schedule. Check the current runtime release notes before pinning — do not pin a
> version from memory.


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

## Cost & quota awareness

- **BigQuery cost model is not here.** Slots vs on-demand, bytes-scanned billing and `INFORMATION_SCHEMA` cost monitoring live in `bigquery-engineering`. Not duplicated.
- **Egress is the silent killer.** Cross-region and out-of-GCP egress is billed. Keeping buckets, datasets and workers in `europe-west1` is a cost decision, not only a latency one.
- **Storage class drives GCS cost:** Standard for hot, Nearline for ~monthly access, Coldline for ~quarterly, Archive for compliance retention. Lifecycle rules do the tiering — see Cloud Storage above.
- **Budget alert on every project.** Not optional, including sandbox projects.
- **Quotas fail late and loudly.** The ones that actually bite: regional CPU quota and in-use external IPs when Dataflow autoscales, concurrent Cloud Run job executions, Pub/Sub subscriber throughput. Check before scaling, not after the job dies.

```bash
gcloud billing budgets list --billing-account=BILLING_ACCOUNT_ID
gcloud compute regions describe europe-west1 \
  --format="table(quotas.metric,quotas.limit,quotas.usage)"
```

## Review delta

*Everything above is authoring guidance, injected for both worker and reviewer.
This section is injected for the reviewer only. It replaces the former
`## Review checklist` — the unweighted checkbox list and the `code-review`
severity block were two parallel lists for the same domain.*

**Floor.** For a diff under ~10 lines, report only HIGH findings. A single
resource added to an existing, already-conformant module does not warrant a
full posture review.

**Do not report what the tooling already reports.** `bash-guard` gates
destructive `gcloud` and `gsutil` calls; `pi-bq-cost-sentinel` dry-runs every
`bq query` passed through `bash`, subagents included, and blocks past 1 TB.

### Severity assignment

Definitions live in `code-review`. Confidence is orthogonal: a HIGH at
`possible` does not block.

| Breach | Severity |
|:--|:--|
| Service account JSON key in code, config, or an environment variable | **HIGH** |
| Hardcoded secret, token or password | **HIGH** |
| `roles/owner` or `roles/editor` granted | **HIGH** |
| `roles/viewer` granted on a production project | MEDIUM |
| IAM binding to `allUsers` or `allAuthenticatedUsers` | **HIGH** |
| Secret read from a raw env var instead of Secret Manager | **HIGH** |
| Project ID hardcoded instead of injected | MEDIUM |
| ADC not used in GCP client code | MEDIUM |
| Pub/Sub production subscription with no dead-letter topic | MEDIUM |
| Autoscaled service with no declared ceiling — Dataflow, Cloud Run, Cloud Functions | MEDIUM |
| Streaming pipeline stopped with `cancel` where `drain` was possible | MEDIUM |
| GCS bucket with no lifecycle rule | MEDIUM |
| Container Registry used instead of Artifact Registry | MEDIUM |
| `gsutil` where `gcloud storage` applies | LOW |
| Docker image without multi-stage build and uv export | LOW |
| Missing `env`, `team` or `cost_center` label | LOW |
| No budget alert on the project | LOW |

**Dataproc** — a cluster with no `--max-idle` and no `--max-age` is **MEDIUM**:
it bills until someone notices. Unpinned runtime version, absent PHS, or a
subnet without Private Google Access are each LOW on their own and MEDIUM
together, since the combination makes an incident undiagnosable.

Not weighed here — see the owning skill: f-string interpolation in SQL
(`sql-engineering`), `os.system()`/`subprocess` with unsanitized input
(`python-engineering`), Terraform resource lifecycle (`iac-terraform`),
BigQuery table expiry and cost formulas (`bigquery-ops`).

### Traps a diff does not show

- **A dead-letter topic that exists but has no subscriber.** The configuration
  passes review and the messages accumulate until the retention window drops
  them. Check that something consumes the DLQ, not just that it is declared.
- **`--max-workers` set on the template, absent from the launch.** Dataflow
  takes the runtime value. Reading the pipeline file alone proves nothing.
- **A least-privilege role granted at project scope.** `roles/bigquery.dataEditor`
  is narrow as a role and broad as a binding. Read the scope, not the role name.
- **Lifecycle rules that never match.** A rule keyed on a prefix no writer uses
  is inert. The bucket looks configured and grows forever.

### Verdict

`blocked` requires at least one HIGH at `certain` or `probable`. A HIGH at
`possible` downgrades to `needs_rework` and must be named in `top_priority`.
With no finding above LOW, `approved`.
