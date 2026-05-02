---
name: "dataeng-architecture"
description: "System-level decisions for GCP data stacks. Choosing services, pipeline design, and scalability."
---

# Data Engineering Architecture (GCP 2026)

## Core Philosophy: "The Lean Pipeline"
- **SQL-First:** If BigQuery can do it, do it in BigQuery. Avoid Dataflow/Spark unless complex procedural logic or multi-source joins in-flight are required.
- **English Documentation:** All architecture ADRs (Architecture Decision Records) and diagrams must be in **English**.
- **Python Synergy:** Any custom code (Cloud Run, Functions) MUST follow `python-engineering` rules (uv, Loguru).

## The Decision Triad (V.L.R)
Before proposing a tool, define:
1. **Volume/Velocity:** MBs or TBs? Batch or Stream?
2. **Latency:** Real-time (Pub/Sub) vs. T+1 (Batch).
3. **Replayability:** Can we restart from Raw? Use **BQ Table Snapshots** for 7-day point-in-time recovery without extra storage costs.

## GCP Tooling 2026 (The "Fast-Path")

| Job | Default (2026) | Avoid if... |
| :--- | :--- | :--- |
| **Simple Ingestion** | Pub/Sub BQ Subscription | Transformation is needed in-flight → Dataflow. |
| **Scheduled Batch** | Composer (Airflow 3) | Just one or two tasks → Cloud Run Jobs + Cloud Scheduler. |
| **Complex ETL** | BQ SQL (Stored Procs) | Non-SQL logic needed → Cloud Run (Python/uv). |
| **CDC** | Datastream → BQ | Source isn't SQL (e.g. Mongo) → Custom Connector. |
| **ML Serving** | Vertex AI Endpoint | Low volume → Cloud Run + FastAPI. |

## Data Modeling (Medallion 2.0)
- **RAW:** Append-only. Use **BigLake** if data stays in GCS. Partitioned by `_PARTITIONTIME`.
- **STAGING:** Deduped, casted, cleaned. Idempotent (overwrite or merge).
- **MART:** Business logic. Denormalized. Use **Materialized Views** for performance-critical dashboards.
- **Access Control:** Enforce Column-level security and Row-level security in BQ, not in the BI tool.

## Ingestion Patterns

### 1. The "Serverless Standard" (Low Cost)
`Source -> Pub/Sub -> BQ Subscription -> BQ (Raw) -> BQ SQL (Transform)`
*Why:* No code to maintain, auto-scales to zero.

### 2. The "High-Scale" (Beam)
`Source -> Pub/Sub -> Dataflow (Python/uv) -> BQ (Streaming Inserts)`
*Why:* Required for windowing, sessionization, or complex enrichment before BQ.

## Idempotency Rules (Non-Negotiable)
- **Strict Partition Overwrite:** `CREATE OR REPLACE TABLE... PARTITION BY...` for small/medium daily batches.
- **Merge Logic:** `MERGE INTO... WHEN MATCHED THEN UPDATE`. Always use a `source_timestamp` to handle late-arriving data.
- **Fail-Safe:** Every DAG task must be re-runnable without manual cleanup.

## 2026 Anti-Patterns (Mo's "Veto")
- **Cloud Functions for heavy lifting:** Use **Cloud Run Jobs** instead (better RAM/CPU/Timeout).
- **Hardcoding Schema:** Use **BQ Schema Evolution** or Pydantic models at the edge.
- **Ignoring Egress Costs:** Keep Compute and Storage in the same region (default: `europe-west1`).
- **No Cost Tracking:** Propose **Labeling** (`env:prod`, `team:data`) for all resources to track costs in BQ Billing Export.

## Delivery Format
1. **The Constraints:** (Latency, Budget, Volume).
2. **Option A (Simple/Cheap):** Native GCP services, SQL-centric.
3. **Option B (Robust/Scale):** Dataflow/Composer, Python-centric.
4. **The Verdict:** One choice with a "Why".
