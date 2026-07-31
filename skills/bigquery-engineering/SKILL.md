---
name: bigquery-engineering
description: >-
  Load when writing or optimising a query that will run on BigQuery — partition
  and cluster filters, MERGE, deduplication, UNNEST, native JSON, numeric typing
  for money, dry-run before execution. Recognise the dialect by backtick-quoted
  three-part `project.dataset.table` references, QUALIFY, or _PARTITIONTIME.
  These are conventions applied at write time, to every query. Administration,
  access and cost forensics are not here — see bigquery-ops. Files compiled by a
  transformation framework belong to the skill that owns that framework.
---

# BigQuery Engineering

Query-authoring conventions. For access, cost forensics and `bq`
administration, see the bigquery-ops skill.

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
SELECT o.order_id, item.product_id, item.quantity
FROM `project.dataset.orders` AS o
CROSS JOIN UNNEST(o.items) AS item
```

- `CROSS JOIN UNNEST` is a lateral join — parent rows with an empty array are
  dropped. Use `LEFT JOIN UNNEST` to keep them.
- `WITH OFFSET AS pos` when array position matters.
- `ARRAY_AGG(STRUCT(...) ORDER BY ...)` to build nested output.
- Never `UNNEST` inside a `WHERE` subquery on a large table — it prevents
  partition pruning.

## Schema design

- **Partitioning:** Mandatory on tables >1 GB. Prefer `DATE` or `TIMESTAMP` column. Ingestion-time partitioning (`_PARTITIONTIME`) only when no natural date column exists.
- **Clustering:** Up to 4 columns, ordered by selectivity (highest cardinality first). Always pair with partitioning on large tables.
- **BigLake:** Use for querying GCS files (Parquet/Avro) without ingestion when data doesn't need BQ-native storage.
- **Policy Tags:** Propose for any PII column — column-level security. For row-level, see Row Access Policies below.

## Tooling

`sqlfluff` with `dialect = bigquery`. Full `.sqlfluff` config in the
bigquery-ops skill.

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
- `STRING` column type for JSON payloads — use native `JSON` type
