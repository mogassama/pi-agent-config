---
name: bigquery-ops
description: >-
  Load when the question is about operating a warehouse rather than writing a
  query against it — who is allowed to read what (authorized views, authorized
  datasets, row access policies, policy tags), what a job cost and why (job
  history forensics, slot reservations versus on-demand, BI Engine), and
  table, dataset and job administration from the command line. Intent-scoped:
  it answers "who can see this", "why did this cost that", "what state is this
  table in". Not for authoring or optimising query text — see
  bigquery-engineering.
---

# BigQuery Ops

Access, cost forensics and administration. For the conventions that apply
while writing a query, see the bigquery-engineering skill.

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

## Anti-patterns — never do these

- Row-level security enforced via `WHERE` in application code instead of Row Access Policies
- Granting `roles/bigquery.dataEditor` when `roles/bigquery.dataViewer` suffices
- Granting direct table access where an authorized view would do
- Reading `INFORMATION_SCHEMA.JOBS_BY_PROJECT` without a partition filter on `creation_time`
- Buying slots to fix a query that has no partition filter

## Review delta

*Everything above is authoring guidance, injected for both worker and reviewer.
This section is injected for the reviewer only. It replaces the former
`## Review checklist`.*

**Floor.** For a diff under ~10 lines, report only HIGH findings.

**Do not report what the tooling already reports.** `pi-bq-cost-sentinel`
dry-runs every `bq query` and blocks past 1 TB; `bash-guard` gates destructive
`bq` calls. Report a gate's *result*, never the absence of the step.

**This skill is loaded for administration, not for authoring.** Query
conventions are weighed in `bigquery-engineering`, generic SQL hygiene in
`sql-engineering`. If the reviewed change is a query, you are in the wrong
skill — say so rather than weighing it here.

### Severity assignment

Definitions live in `code-review`.

| Breach | Severity |
|:--|:--|
| PII column with no Policy Tag | **HIGH** |
| Direct table access granted where an authorized view or dataset applies | **HIGH** |
| Schema change applied with no `bq show` of the current state beforehand | **HIGH** |
| Row access policy not tested with the target principal's real identity | MEDIUM |
| Cost attributed by guessing from table size instead of a job id | MEDIUM |
| Slot wait blamed on a query with no reservation assignment checked | MEDIUM |
| Staging dataset with no default table expiration | LOW |

### Traps a diff does not show

- **A row access policy tested as the owner.** The owner bypasses it. The test
  passes and the policy has never been exercised.
- **An authorized view whose underlying dataset grant was never removed.** Both
  paths work; the direct one is the hole, and nothing surfaces it.
- **A Policy Tag applied to a column that has been renamed downstream.** The tag
  follows the column, not the data. A copy under another name is untagged.
- **A schema change that is additive in BigQuery and breaking for consumers.**
  Adding a required column, or widening a type a reader parses strictly, fails
  outside the warehouse where nothing here can see it.
- **An expiration set on the dataset after tables already exist.** Defaults
  apply to new tables only. The existing ones live forever.

### Verdict

`blocked` requires at least one HIGH at `certain` or `probable`. A HIGH at
`possible` downgrades to `needs_rework` and must be named in `top_priority`.
With no finding above LOW, `approved`.
