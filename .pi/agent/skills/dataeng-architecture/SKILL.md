---
name: dataeng-architecture
description: Use for system-level data engineering decisions — choosing between GCP services, designing multi-service pipelines (ingestion, transformation, serving), data modeling layer separation (raw / staging / mart / semantic), idempotency and replayability patterns, observability strategy, and "which tool for this job" questions. Trigger on architecture diagrams, pipeline design discussions, refactor proposals spanning multiple services, or any "how should I structure this" question.
---

# Data Engineering Architecture

## When this skill is active

You are answering "how should this be built" rather than "write this code". Trade-offs over recipes. Always present options with their downsides — there is no objectively correct architecture, only one that matches constraints (cost, latency, team size, evolvability).

## The decision triad

For any new pipeline, surface these three answers explicitly before writing code:

1. **Latency requirement.** Real-time (sub-second), near-real-time (seconds-to-minutes), batch (hourly+). This is the single biggest driver of tool choice.
2. **Volume + velocity.** Rows per day, peak rows per second, average row size. Determines whether streaming infrastructure pays for itself.
3. **Replayability requirement.** Can you re-process the last 30 days from source? If no, you need durable raw storage before any transformation.

## "Which GCP tool" cheat sheet

| Job | Default | Reach for instead when |
|---|---|---|
| Scheduled batch transform | Composer + BigQuery SQL | SQL alone is too limited → Dataflow batch |
| Streaming transform | Dataflow streaming | Volume is low + logic is simple → Cloud Function on Pub/Sub |
| Event-driven small task | Cloud Function (gen 2) | >9min runtime or >2GB RAM → Cloud Run job |
| File-arrival trigger | GCS notification → Pub/Sub → CF | Multi-file batches → GCS notif → Composer DAG |
| Ad-hoc analytics | BigQuery directly | Iterating on transform logic → dbt on BQ |
| API ingestion (polling) | Composer DAG with `PythonOperator` | High frequency / many endpoints → Dataflow source |
| CDC from operational DB | Datastream → BQ | Custom logic needed → Debezium → Pub/Sub → Dataflow |

## Data modeling layers

Standard medallion-ish split. Names vary; what matters is the separation of concerns:

- **`raw_*`** — landing zone. Schema-on-read, append-only, partitioned by ingest date. Never modified, only added to. Cheap storage class, possibly with TTL.
- **`staging_*` / `stg_*`** — typed, deduped, lightly cleaned. One staging table per source table. Idempotent rebuild from raw.
- **`mart_*` / `dim_*` + `fact_*`** — business-modeled, denormalized for query patterns, owned by data team.
- **`semantic_*` / `metrics_*`** (optional) — pre-aggregated, exposed to BI tools. Can be materialized views or scheduled tables.

**Rule:** consumers (dashboards, ML pipelines) read from mart/semantic only. They never touch raw/staging. Enforce with IAM if possible.

## Ingestion patterns

### Batch file drop
```
External system → GCS bucket → Pub/Sub notification → Cloud Function (validates, moves to processed/) 
                                                    → triggers Composer DAG (loads to BQ raw, then transforms)
```
Why this and not "Composer polls GCS": no waste poll cycles, immediate processing, retry semantics from Pub/Sub.

### Streaming
```
Source → Pub/Sub → Dataflow (windowed aggregation) → BQ streaming insert
                ↘ Dataflow → GCS (raw archive, hourly windowed file)
```
Always archive raw to GCS in parallel with the hot path. Lets you replay from raw if downstream logic changes.

### CDC (operational → analytical)
```
Postgres / MySQL → Datastream → BQ (managed) 
                 → or → Debezium → Pub/Sub → Dataflow → BQ (custom)
```
Datastream first if it covers your source. Custom only when you need transformation in flight.

## Idempotency — the hard rule

Every transformation must be safe to re-run on the same logical date and produce the same output. Patterns:

- **`MERGE` keyed on natural key + date partition.** Re-running overwrites the partition's worth of rows.
- **`CREATE OR REPLACE TABLE ... PARTITION BY ...`** — full rebuild, only viable for small tables.
- **Write-temp-then-swap.** Write to `_staging`, validate, atomic `bq cp -f` to prod.
- **Avoid:** `INSERT ... SELECT` without dedup. Always pair with a uniqueness check.

A non-idempotent task is a 3am page waiting to happen. If you can't make it idempotent, document it loudly and add a `_run_once` lock.

## Observability — the three things you need

1. **Pipeline freshness** — when did each table last update? Surface as a dashboard. BigQuery's `INFORMATION_SCHEMA.TABLES.last_modified_time` is free.
2. **Data quality gates** — row counts, null rates, business invariants (`revenue >= 0`). Run as DAG tasks that fail loudly. dbt tests, Great Expectations, or hand-rolled `BigQueryCheckOperator` tasks.
3. **Cost telemetry** — per-pipeline GCP cost, exported via billing export to BQ, surfaced per DAG. Without this, cost regressions are invisible until the bill arrives.

## Anti-patterns Mo should refuse

- **Dataflow for what BigQuery SQL can do.** SQL is cheaper, faster, observable. Reach for Beam only when SQL truly can't express it.
- **One mega-DAG.** A 200-task DAG is unmaintainable. Split by domain or stage; use Datasets / TriggerDagRun for dependencies.
- **Hand-rolled retries on top of Airflow retries.** Pick one layer.
- **Putting business logic in `BigQueryInsertJobOperator` SQL strings.** Logic belongs in `.sql` files (or dbt models) under version control, referenced by path.
- **No raw archive for streaming pipelines.** When you need to replay, you'll have nothing.
- **Cross-region without thinking.** Egress + latency. Pin everything to one region (probably `europe-west1` for Mo).

## When asked to design something

Output structure:
1. **Constraints recap** — what you took as given (latency, volume, ownership, cost).
2. **Two options** — minimum. Each with its main strength and main weakness. Don't propose a third just to fill space.
3. **Recommendation** — one of the two, with the deciding factor.
4. **Concrete next step** — what file to create, what to spike, what to verify.

Don't deliver a 30-box diagram on the first turn. Walk through one option to viability before adding sophistication.

## TODO

- Mo's existing project topology (once known)
- Patterns adopted at his specific company / association
- dbt vs raw SQL DAGs decision (defer until Mo picks)
