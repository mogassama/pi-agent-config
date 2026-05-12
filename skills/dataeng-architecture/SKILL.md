---
name: dataeng-architecture
description: Load for system-level data engineering decisions — service selection, pipeline design, data modeling, idempotency, scalability, and observability on GCP. Auto-load on architecture questions, service comparisons, pipeline design, or "which tool for this?" decisions.
---

# Data Engineering Architecture (GCP)

## Philosophy

- **SQL-First.** If BigQuery can do it in SQL, do it there. Avoid Dataflow/Spark unless the logic requires procedural code, multi-source joins in-flight, or streaming windowing.
- **Lean Pipeline.** Fewer moving parts = fewer failure modes. Native GCP managed services before custom code.
- **Two options, one verdict.** Never propose a single solution silently. Always present Option A (simple/cheap) and Option B (robust/scalable) with explicit trade-offs, then recommend one with justification.

## Decision framework — V.L.R.

Before proposing any tool or architecture:

1. **Volume/Velocity** — MBs or TBs? Batch or stream? Growth rate?
2. **Latency** — Real-time (<1 min)? Near-real-time (1-15 min)? T+1 batch?
3. **Replayability** — Can we replay from raw? Can tasks restart safely mid-pipeline?

These three answers determine the right tool. Document them before recommending anything.

## GCP service selection (2026)

| Job | Default | Escalate to... | Avoid when... |
|:---|:---|:---|:---|
| Simple ingestion | Pub/Sub → BQ Subscription | Dataflow | Transformation needed in-flight |
| Scheduled batch | Cloud Run Jobs + Cloud Scheduler | Composer + Airflow | Single task, no dependencies |
| Multi-step orchestration | Composer (Airflow 2.x GA) | — | Few tasks → Cloud Run Jobs |
| Complex ETL (non-SQL logic) | Cloud Run (Python/uv) | Dataflow (Beam) | Pure SQL transformations → stay in BQ |
| Heavy SQL transforms | BigQuery SQL | Cloud Run | Non-SQL procedural logic required |
| CDC | Datastream → BQ | Custom connector | Source isn't SQL (MongoDB, etc.) |
| ML serving | Cloud Run + FastAPI (low volume) | Vertex AI Endpoint | High-concurrency, managed autoscaling needed |

**On Composer/Airflow versions:** Composer 2 with Airflow 2.x is stable GA. Airflow 3 and Composer 3 are in preview as of mid-2026 — verify regional availability before targeting. Do not use preview features in production without explicit operator decision.

**On BQ Stored Procedures:** Use for simple, self-contained SQL transformations. Avoid for complex ETL — stored procs are hard to test, version, and debug. Prefer Cloud Run Python for anything requiring branching logic, external calls, or unit tests.

## Data modeling — layered architecture

| Layer | Characteristics | Implementation |
|---|---|---|
| **RAW** | Append-only, no transformation, source fidelity | BigLake if data stays in GCS, partitioned by `_PARTITIONTIME` |
| **STAGING** | Deduped, type-cast, renamed, cleaned | Idempotent — WRITE_TRUNCATE or MERGE. One source per model. |
| **MART** | Business logic, denormalized, aggregated | Materialized Views for performance-critical dashboards |

- Column-level and row-level security enforced in BigQuery — never delegated to the BI tool.
- Schema evolution via Pydantic models at the ingestion edge — never hardcoded schema in pipeline code.

## Ingestion patterns

| Pattern | Pipeline | When | Trade-off |
|:---|:---|:---|:---|
| **1 — Serverless (default)** | `Source → Pub/Sub → BQ Subscription → BQ Raw → BQ SQL Transform` | No in-flight transformation needed; source pushes events; cost sensitivity high | No transformation before BQ write; schema must be stable |
| **2 — High-scale streaming** | `Source → Pub/Sub → Dataflow (Python/Beam) → BQ (Storage Write API)` | Windowing, sessionization, complex enrichment, or multi-source join before landing | Higher operational complexity; Dataflow cost per worker-hour |
| **3 — Scheduled batch** | `GCS / API → Cloud Run Job → BQ (WRITE_TRUNCATE / MERGE) → dbt transform` | T+1 batch; source doesn't push; transformation is significant | Requires orchestration (Cloud Scheduler or Composer) |

## Idempotency — non-negotiable

Every pipeline task must be safe to run twice without manual cleanup.

- **Partition overwrite:** `WRITE_TRUNCATE` on the target partition. Rerunning replaces, not appends.
- **Upserts:** `MERGE INTO target USING source ON key WHEN MATCHED THEN UPDATE WHEN NOT MATCHED THEN INSERT`. Always include `source_timestamp` to handle late-arriving data.
- **Late data:** Define a lookback window (e.g. reprocess last 3 days) rather than relying on event-time exactness.
- **DAG tasks:** Every Airflow task must be restartable from its own checkpoint. No task should depend on side-effects of a previous failed run.

## Point-in-time recovery

BQ Table Snapshots for 7-day recovery:

```sql
CREATE SNAPSHOT TABLE project.dataset.table_snapshot
CLONE project.dataset.table
FOR SYSTEM_TIME AS OF TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 HOUR)
OPTIONS (expiration_timestamp = TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL 7 DAY));
```

Note: snapshots incur storage costs for the delta between snapshot and current table. Not free — size the retention window accordingly.

## Observability

Every production pipeline needs:

- **Structured logs** with `run_id`, `source`, `rows_processed`, `duration_ms` at minimum.
- **Row count assertion** post-load (see `data-quality` skill).
- **Pub/Sub alert:** `oldest_unacked_message_age > 5 min` → Cloud Monitoring alert.
- **Cloud Run Job failure:** alert on non-zero exit code via Cloud Monitoring job execution metrics.
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

## Anti-patterns

- **Cloud Functions for heavy ETL** — timeout (9 min max), memory limits. Use Cloud Run Jobs.
- **Hardcoded schema in pipeline code** — use Pydantic at the edge, BQ schema auto-detect only for exploration.
- **Cross-region storage/compute** — egress costs accumulate silently. Keep everything in `europe-west1`.
- **No resource labels** — `env`, `team`, `cost_center` on every resource. Use BQ Billing Export to track by label.
- **Stored procedures for complex logic** — untestable, unversionable. Use Cloud Run Python.
- **Single pipeline task doing too much** — split at natural checkpoints for restartability.
- **No dead-letter on Pub/Sub subscriptions** — silent message loss in production.

## Delivery format (mandatory)

Every architecture recommendation must follow this structure:

1. **Constraints:** Latency target, volume, budget envelope, team size.
2. **Option A (Simple/Cheap):** Native GCP services, SQL-centric, minimal ops.
3. **Option B (Robust/Scalable):** More services, Python-centric, higher ops cost.
4. **Verdict:** One choice with explicit "why" — not "it depends".
