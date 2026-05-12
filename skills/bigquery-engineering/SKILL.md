---
name: bigquery-engineering
description: Load for BigQuery SQL authoring, schema design, cost optimization, access control, and bq CLI operations. Covers partitioning, clustering, MERGE, dedup, STRUCT/ARRAY, authorized views, row access policies, INFORMATION_SCHEMA, BI Engine, and slots vs on-demand billing. Auto-load on BigQuery schema tasks, BQ cost/performance issues, dry-run analysis, or any task involving BigQuery tables, datasets, or the bq CLI.
---

# BigQuery Engineering

## Non-negotiables

- **Never legacy SQL.** Always `--use_legacy_sql=false` / `useLegacySql: false`.
- **Dry-run before any non-trivial query.** Report estimated bytes before executing.
- **Region:** `europe-west1` (Paris) by default. Dataset and GCS bucket must be in the same region — cross-region queries incur egress costs.
- **Project-qualify all cross-project references:** `` `project.dataset.table` ``.
- **Never `SELECT *`** in production SQL or DAG-generated queries. Always enumerate columns explicitly.

## Cost-first approach

1. **Dry-run first.**
   ```bash
   bq query --dry_run --use_legacy_sql=false "$(cat query.sql)"
   ```
   Report estimated bytes scanned before any review approval.

2. **Partition filter check.** Every query on a partitioned table must filter on the partition column directly. Flag and rewrite if missing.

3. **Clustering filter check.** `WHERE` filters should respect the clustering column order for maximum pruning.

Cost threshold: flag any query scanning >1 TB that returns <10K rows — mandatory review before running in production.

## SQL patterns

### Partition filters — the right way

```sql
-- DATE partition column
WHERE partition_date = '2026-01-15'
WHERE partition_date BETWEEN '2026-01-01' AND '2026-01-31'

-- TIMESTAMP partition column — use _PARTITIONTIME
WHERE _PARTITIONTIME = TIMESTAMP('2026-01-15')

-- Ingestion-time partitioned tables — use _PARTITIONDATE
WHERE _PARTITIONDATE = '2026-01-15'
```

Never `WHERE DATE(timestamp_col) = '...'` — wrapping a partition column in a function bypasses partition pruning entirely.

### Deduplication

```sql
-- Canonical pattern — no subquery
QUALIFY ROW_NUMBER() OVER (PARTITION BY id ORDER BY updated_at DESC) = 1
```

### Idempotent upserts (MERGE)

```sql
MERGE `project.dataset.target` AS T
USING `project.dataset.source` AS S
  ON T.id = S.id
WHEN MATCHED THEN
  UPDATE SET
    T.col_a = S.col_a,
    T.updated_at = S.updated_at
WHEN NOT MATCHED THEN
  INSERT (id, col_a, updated_at)
  VALUES (S.id, S.col_a, S.updated_at)
```

Always prefer MERGE over blind INSERT. Never WRITE_APPEND without a dedup strategy.

### JSON handling

```sql
-- Native JSON type for semi-structured columns
SELECT
  JSON_VALUE(payload, 'lax $.user_id') AS user_id,
  JSON_QUERY(payload, 'lax $.metadata') AS metadata
FROM `project.dataset.events`
```

Use the native `JSON` column type — not `STRING` with embedded JSON content.

### Aggregation performance

- Propose a Materialized View when the same aggregation runs repeatedly on a large table.
- Suggest `SEARCH INDEX` on large text columns for substring/needle queries.

### STRUCT / ARRAY + UNNEST

```sql
-- Flatten a repeated STRUCT field
SELECT
  o.order_id,
  item.product_id,
  item.quantity
FROM `project.dataset.orders` AS o
CROSS JOIN UNNEST(o.items) AS item

-- Flatten with offset (row position)
SELECT
  o.order_id,
  item,
  pos
FROM `project.dataset.orders` AS o
CROSS JOIN UNNEST(o.items) WITH OFFSET AS pos

-- Build an ARRAY inline
SELECT
  user_id,
  ARRAY_AGG(STRUCT(event_type, occurred_at) ORDER BY occurred_at) AS event_history
FROM `project.dataset.events`
GROUP BY user_id
```

- `CROSS JOIN UNNEST` is a lateral join — rows with empty arrays are dropped. Use `LEFT JOIN UNNEST` to preserve parent rows with no array elements.
- Never `UNNEST` in a `WHERE` subquery on a large table — it prevents partition pruning.

## Schema design

- **Partitioning:** Mandatory on tables >1 GB. Prefer `DATE` or `TIMESTAMP` column. Ingestion-time partitioning (`_PARTITIONTIME`) only when no natural date column exists.
- **Clustering:** Up to 4 columns, ordered by selectivity (highest cardinality first). Always pair with partitioning on large tables.
- **BigLake:** Use for querying GCS files (Parquet/Avro) without ingestion when data doesn't need BQ-native storage.
- **Policy Tags:** Propose for any PII column — column-level security. For row-level, see Row Access Policies below.

## Access control

### Authorized views

An authorized view allows one dataset to query another's tables without exposing the underlying data to the view's callers.

```bash
# Grant a view in reporting_dataset authorization to read source_dataset
bq update \
  --add_authorized_view=project:reporting_dataset.my_view \
  project:source_dataset
```

```sql
-- Secure view pattern: expose a column/row subset of the source
CREATE OR REPLACE VIEW `project.reporting_dataset.customer_summary` AS
SELECT
  customer_id,
  country,
  total_orders
FROM `project.source_dataset.orders`
```

Use authorized views when multiple teams need different projections of the same source table or when you need column-masking without Policy Tags.

### Authorized datasets

An authorized dataset grants all views and tables in dataset A the right to read dataset B — covering current and future views automatically.

```bash
# Grant dataset A (e.g., reporting) access to read dataset B (e.g., raw)
bq update \
  --add_authorized_dataset=project:reporting \
  project:raw
```

Prefer authorized datasets over per-view authorization when an entire reporting layer is built on a single source dataset.

### Row access policies

Row access policies filter rows returned per principal, transparently and without query rewrites.

```sql
-- Create a policy: group team-eu only sees rows where region = 'EU'
CREATE ROW ACCESS POLICY eu_filter
ON `project.dataset.sales`
GRANT TO ('group:team-eu@company.com')
FILTER USING (region = 'EU');

-- Drop a policy
DROP ROW ACCESS POLICY eu_filter ON `project.dataset.sales`;

-- List policies on a table
SELECT * FROM `project.dataset`.INFORMATION_SCHEMA.ROW_ACCESS_POLICIES
WHERE table_name = 'sales';
```

Caveats:
- Row access policies do not apply to wildcard tables or `TABLE_DATE_RANGE`.
- They are invisible to `EXPLAIN` — always test with the target principal's actual identity.
- Policy Tags (column-level) and row access policies are complementary; use both when needed.
- A principal with no matching policy sees **all rows**. To restrict everyone else, add an explicit `allAuthenticatedUsers` policy with `FILTER USING (FALSE)`.

## INFORMATION_SCHEMA patterns

```sql
-- Tables in a dataset (size, row count, creation time)
SELECT
  table_name,
  table_type,
  creation_time,
  row_count,
  size_bytes
FROM `project.dataset`.INFORMATION_SCHEMA.TABLES

-- Columns and types
SELECT
  table_name,
  column_name,
  data_type,
  is_nullable
FROM `project.dataset`.INFORMATION_SCHEMA.COLUMNS
WHERE table_name = 'my_table'
ORDER BY ordinal_position

-- Recent partitions and their row counts
SELECT
  partition_id,
  total_rows,
  total_logical_bytes,
  last_modified_time
FROM `project.dataset.my_table`.INFORMATION_SCHEMA.PARTITIONS
ORDER BY partition_id DESC
LIMIT 10

-- Row access policies on a table
SELECT *
FROM `project.dataset`.INFORMATION_SCHEMA.ROW_ACCESS_POLICIES
WHERE table_name = 'my_table'
```

## Cost monitoring — INFORMATION_SCHEMA.JOBS_BY_PROJECT

```sql
-- Top 20 costliest queries in the last 7 days (on-demand pricing)
SELECT
  user_email,
  job_id,
  SUBSTR(query, 0, 200)                                      AS query_snippet,
  ROUND(total_bytes_billed / POW(1024, 4) * 6.25, 4)        AS estimated_cost_usd,
  total_bytes_billed,
  total_slot_ms,
  creation_time
FROM `region-europe-west1`.INFORMATION_SCHEMA.JOBS_BY_PROJECT
WHERE
  creation_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
  AND job_type = 'QUERY'
  AND state = 'DONE'
  AND error_result IS NULL
ORDER BY total_bytes_billed DESC
LIMIT 20

-- Daily slot consumption (useful for reservation sizing)
SELECT
  DATE(creation_time)        AS job_date,
  SUM(total_slot_ms) / 1000  AS total_slot_seconds,
  COUNT(*)                   AS job_count
FROM `region-europe-west1`.INFORMATION_SCHEMA.JOBS_BY_PROJECT
WHERE
  creation_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
  AND job_type = 'QUERY'
GROUP BY job_date
ORDER BY job_date DESC

-- Jobs that touched a specific table (lineage approximation)
SELECT
  job_id,
  user_email,
  SUBSTR(query, 0, 200) AS query_snippet,
  creation_time
FROM `region-europe-west1`.INFORMATION_SCHEMA.JOBS_BY_PROJECT,
  UNNEST(referenced_tables) AS t
WHERE
  t.dataset_id = 'my_dataset'
  AND t.table_id = 'my_table'
  AND creation_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
```

Required role: `roles/bigquery.resourceViewer` or `roles/bigquery.admin`. For org-wide visibility use `INFORMATION_SCHEMA.JOBS` (requires org-level permission).

## Slots vs on-demand billing

| | On-demand | Slots (reservations) |
|---|---|---|
| Billing unit | Bytes scanned ($6.25/TB) | Slot-hours (committed or autoscale) |
| Best for | Ad-hoc queries, dev | Predictable high-volume workloads |
| Cost predictability | Low | High (commitments) / Medium (autoscale) |
| Concurrency | Service-level queuing | Bounded by slot count |
| Setup | None | Reservation + assignment required |

**When to recommend slots:**
- Monthly on-demand bill consistently >$3K.
- Predictable daily job schedule with known peak concurrency.
- SLA requirements — slots give guaranteed capacity; on-demand can queue under load.

**Autoscale reservations** (recommended over flat commitments for most teams):

```bash
# Create an autoscale reservation (0 → max_slots on demand)
gcloud bigquery reservations create my-reservation \
  --location=europe-west1 \
  --autoscale-max-slots=500

# Assign a project to the reservation
gcloud bigquery reservations assignments create \
  --reservation=my-reservation \
  --assignee=projects/MY_PROJECT \
  --job-type=QUERY \
  --location=europe-west1
```

## BI Engine

BI Engine is an in-memory analysis service that accelerates SQL queries from Looker Studio, Looker, and compatible BI tools — no query rewrites required.

**When to use:**
- Dashboards with high concurrency hitting the same tables or aggregations.
- Sub-second latency requirement on hot datasets ≤ reserved capacity size.
- Not suitable for ad-hoc exploratory queries or full-DWH scans.

```bash
# Reserve BI Engine capacity (per region, per project)
gcloud bigquery bi-engine reservations create \
  --project=MY_PROJECT \
  --location=europe-west1 \
  --size=10   # GiB of in-memory capacity
```

SQL behavior with BI Engine active:
- Compatible queries are automatically accelerated (transparent to the caller).
- `EXPLAIN` plan shows `BI_ENGINE_MODE: FULL` or `PARTIAL` when active.
- Verify via `INFORMATION_SCHEMA.BI_ENGINE_STATISTICS` in job metadata.

Caveats:
- BI Engine does not accelerate DML (`INSERT`, `UPDATE`, `MERGE`).
- Queries referencing a non-accelerated table fall back to standard BQ execution.
- Size the reservation to the hottest dataset, not the entire warehouse.

## bq CLI

### Table and schema management

```bash
# Dry-run before any non-trivial query
bq query --use_legacy_sql=false --dry_run "$(cat query.sql)"

# Create partitioned + clustered table
bq mk \
  --table \
  --time_partitioning_field=event_date \
  --time_partitioning_type=DAY \
  --clustering_fields=country,product_id \
  --schema=schema.json \
  project:dataset.table

# Show full table metadata (schema, partitioning, clustering, row count)
bq show --format=prettyjson project:dataset.table

# Show dataset metadata (access entries, default expiration, region)
bq show --format=prettyjson project:dataset

# List tables in a dataset
bq ls --format=prettyjson project:dataset

# List datasets in a project
bq ls --project_id=PROJECT

# Copy a table (cross-region requires Data Transfer Service)
bq cp project:dataset.source_table project:dataset.dest_table

# Load from GCS
bq load \
  --source_format=PARQUET \
  --autodetect \
  project:dataset.table \
  gs://bucket/path/*.parquet

# Extract to GCS
bq extract \
  --destination_format=PARQUET \
  project:dataset.table \
  gs://bucket/path/export-*.parquet
```

### Job history

```bash
# List recent jobs (last 50 by default, all users)
bq ls --jobs --all --project_id=PROJECT --max_results=50

# Show full details of a specific job
bq show --job --format=prettyjson --project_id=PROJECT JOB_ID

# Quick error detail from a failed job
bq show --job --format=prettyjson --project_id=PROJECT JOB_ID \
  | python3 -c "import sys,json; j=json.load(sys.stdin); print(j.get('status',{}).get('errorResult',{}))"

# Cancel a running job
bq cancel --project_id=PROJECT JOB_ID
```

## Tooling

`.sqlfluff` config for BigQuery:

```ini
[sqlfluff]
dialect = bigquery
templater = raw
max_line_length = 100

[sqlfluff:rules:capitalisation.keywords]
capitalisation_policy = upper

[sqlfluff:rules:capitalisation.identifiers]
capitalisation_policy = lower
```

Run before any review: `sqlfluff lint --dialect bigquery <file.sql>`.  
Auto-fix: `sqlfluff fix <file.sql>` — review the diff before committing.

## Review checklist

- [ ] No `SELECT *` anywhere in the query
- [ ] Partitioned table → partition filter present and not wrapped in a function
- [ ] Clustering columns respected in `WHERE` order
- [ ] JOINs have explicit `ON` clause with selective predicate
- [ ] No `WHERE DATE(timestamp_col)` — rewrite to direct column filter
- [ ] Cross-project references fully qualified (`` `project.dataset.table` ``)
- [ ] MERGE has explicit unique key — no blind `WRITE_APPEND`
- [ ] Query >1 TB scan flagged for review before production run
- [ ] Dry-run cost reported and accepted before any new query is approved
- [ ] Row access policies tested with target principal's actual identity
- [ ] Authorized view / authorized dataset used instead of granting direct table access
- [ ] Policy Tags applied to all PII columns
- [ ] `bq show` reviewed before schema changes (confirm current state)
- [ ] `UNNEST` on a large table does not block partition pruning

## Anti-patterns — never do these

- `WHERE DATE(timestamp_col) = '...'` on a partitioned column — kills partition pruning
- `SELECT *` in production or pipeline SQL
- Blind `WRITE_APPEND` without a dedup strategy
- Subquery dedup instead of `QUALIFY ROW_NUMBER()`
- JOIN without explicit `ON` clause
- Cross-project query without fully qualified table reference
- Running a multi-TB scan without dry-run first
- `UNNEST` in a `WHERE` subquery on a large partitioned table — prevents pruning
- Row-level security enforced via `WHERE` in application code instead of Row Access Policies
- `STRING` column type for JSON payloads — use native `JSON` type
- Granting `roles/bigquery.dataEditor` when `roles/bigquery.dataViewer` suffices
