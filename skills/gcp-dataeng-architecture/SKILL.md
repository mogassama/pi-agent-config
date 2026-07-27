---
name: gcp-dataeng-architecture
description: Load when the platform is GCP and the question is which service to use for a data job — service selection, ingestion pipeline shape, BigQuery-centric modeling, point-in-time recovery, and cost escalation thresholds. Complements dataeng-architecture (platform-agnostic decision layer) and gcp-engineering (CLI, IAM, deployment how-to). Auto-load on GCP service comparisons or GCP pipeline design.
---

# Data Engineering Architecture — GCP

Load `dataeng-architecture` first: the V.L.R. framework, sizing rules, layering,
idempotency and delivery format live there and are not repeated here. This skill only
maps those decisions onto GCP services.

## Service selection (2026)

| Job | Default | Escalate to... | Avoid when... |
|:---|:---|:---|:---|
| Simple ingestion | Pub/Sub → BQ Subscription | Dataflow | Transformation needed in-flight |
| Scheduled batch | Cloud Run Jobs + Cloud Scheduler | Composer + Airflow | Single task, no dependencies |
| Multi-step orchestration | Composer (Airflow 2.x GA) | — | Few tasks → Cloud Run Jobs |
| Complex ETL (non-SQL logic) | Cloud Run (Python/uv) | Dataflow (Beam) | Pure SQL transformations → stay in BQ |
| Heavy SQL transforms | BigQuery SQL | Cloud Run | Non-SQL procedural logic required |
| CDC | Datastream → BQ | Custom connector | Source isn't SQL (MongoDB, etc.) |
| ML serving | Cloud Run + FastAPI (low volume) | Vertex AI Endpoint | High-concurrency, managed autoscaling needed |

**On Composer/Airflow versions:** Composer 2 with Airflow 2.x is stable GA. Airflow 3 and
Composer 3 are in preview as of mid-2026 — verify regional availability before targeting.
Do not use preview features in production without explicit operator decision.

**On BQ stored procedures:** use for simple, self-contained SQL transformations. Avoid for
complex ETL — hard to test, version and debug. Prefer Cloud Run Python for anything
requiring branching logic, external calls, or unit tests.

## Ingestion patterns

| Pattern | Pipeline | When | Trade-off |
|:---|:---|:---|:---|
| **1 — Serverless (default)** | `Source → Pub/Sub → BQ Subscription → BQ Raw → BQ SQL Transform` | No in-flight transformation needed; source pushes events; cost sensitivity high | No transformation before BQ write; schema must be stable |
| **2 — High-scale streaming** | `Source → Pub/Sub → Dataflow (Python/Beam) → BQ (Storage Write API)` | Windowing, sessionization, complex enrichment, or multi-source join before landing | Higher operational complexity; Dataflow cost per worker-hour |
| **3 — Scheduled batch** | `GCS / API → Cloud Run Job → BQ (WRITE_TRUNCATE / MERGE) → dbt transform` | T+1 batch; source doesn't push; transformation is significant | Requires orchestration (Cloud Scheduler or Composer) |

## Layer implementation on GCP

| Layer | GCP implementation |
|---|---|
| **RAW** | BigLake if data stays in GCS, otherwise BQ table partitioned by `_PARTITIONTIME` |
| **STAGING** | `WRITE_TRUNCATE` on the target partition, or `MERGE` on the business key |
| **MART** | Materialized Views for performance-critical dashboards |

Schema evolution via Pydantic models at the ingestion edge — never BQ auto-detect outside
exploration.

## Idempotency on BigQuery

- **Partition overwrite:** `WRITE_TRUNCATE` scoped to the target partition.
- **Upsert:** `MERGE INTO target USING source ON key WHEN MATCHED THEN UPDATE WHEN NOT
  MATCHED THEN INSERT`, always carrying `source_timestamp`.
- **Airflow tasks:** each task restartable from its own checkpoint.

## Point-in-time recovery

BQ table snapshots for 7-day recovery:

```sql
CREATE SNAPSHOT TABLE project.dataset.table_snapshot
CLONE project.dataset.table
FOR SYSTEM_TIME AS OF TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 HOUR)
OPTIONS (expiration_timestamp = TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL 7 DAY));
```

Snapshots incur storage cost for the delta between snapshot and current table. Not free —
size the retention window accordingly.

## Observability on GCP

- **Pub/Sub alert:** `oldest_unacked_message_age > 5 min` → Cloud Monitoring alert.
- **Cloud Run Job failure:** alert on non-zero exit code via job execution metrics.
- **BQ slot usage:** monitor `INFORMATION_SCHEMA.JOBS_BY_PROJECT` for runaway queries.

```sql
-- Top 10 most expensive queries last 24h
SELECT
  job_id,
  user_email,
  total_bytes_processed,
  ROUND(total_bytes_processed / POW(10, 12) * 6.25, 4) AS estimated_cost_usd,
  query
FROM `region-europe-west1`.INFORMATION_SCHEMA.JOBS_BY_PROJECT
WHERE creation_time > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
  AND job_type = 'QUERY'
ORDER BY total_bytes_processed DESC
LIMIT 10
```

## Cost escalation thresholds

| Signal | Action |
|---|---|
| Single query >1 TB scan | Dry-run mandatory, review before production |
| Daily BQ spend >2x baseline | Investigate `JOBS_BY_PROJECT`, identify offender |
| Dataflow cost >Cloud Run equivalent | Re-evaluate if Dataflow is justified |
| Cross-region egress detected | Realign GCS bucket and BQ dataset to same region |

## Anti-patterns — GCP-specific

- **Cloud Functions for heavy ETL** — 9 min timeout, memory limits. Use Cloud Run Jobs.
- **Cross-region storage/compute** — egress accumulates silently. The operator's default
  region is `europe-west1`; keep GCS buckets and BQ datasets aligned with it.
- **BQ schema auto-detect in production** — use Pydantic at the edge.
- **No resource labels** — `env`, `team`, `cost_center` on every resource. Use BQ Billing
  Export to track by label.
- **No dead-letter topic** on a production Pub/Sub subscription.
