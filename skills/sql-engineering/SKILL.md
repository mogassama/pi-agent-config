---
name: sql-engineering
description: Load for SQL authoring, optimization, schema design, or query review. Covers BigQuery Standard SQL (cost, partitioning, clustering, MERGE, dedup) and PostgreSQL (indexes, upserts, EXPLAIN). Auto-load on .sql files, schema tasks, BQ cost/performance issues, or dry-run analysis.
---

# SQL Engineering

## Conventions

- **Keywords:** UPPERCASE (`SELECT`, `FROM`, `WHERE`, `JOIN`, `WITH`, etc.).
- **Identifiers:** `snake_case` for columns, tables, datasets, CTEs.
- **dbt exception:** dbt models use lowercase keywords — see `dbt-engineering` skill.
- Trailing commas. CTEs (`WITH`) over subqueries for anything non-trivial.
- Always alias tables in JOINs.
- Column names and SQL comments in English.
- Default dialect: BigQuery Standard SQL. Never legacy SQL.

## BigQuery — cost-first approach

Before writing or reviewing any query:

1. **Dry-run first.** `bq query --dry_run --use_legacy_sql=false '<query>'` — report estimated bytes scanned.
2. **Partition filter check.** Every query on a partitioned table must filter on the partition column directly. Flag and rewrite if missing.
3. **Clustering filter check.** WHERE filters should respect the clustering column order for maximum pruning.

Cost threshold: flag any query scanning >1 TB that returns <10K rows — mandatory review before running in production.

## BigQuery — SQL patterns

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

### Aggregation performance

- Propose a Materialized View when the same aggregation runs repeatedly on a large table.
- Suggest `SEARCH INDEX` on large text columns for substring/needle queries.

## Schema design

- **Partitioning:** Mandatory on tables >1 GB. Prefer `DATE` or `TIMESTAMP` column. Ingestion-time partitioning (`_PARTITIONTIME`) only when no natural date column exists.
- **Clustering:** Up to 4 columns, ordered by selectivity (highest cardinality first). Always pair with partitioning on large tables.
- **Never `SELECT *`** in production SQL or DAG-generated queries. Always enumerate columns explicitly.
- Always project-qualify cross-project references: `` `project.dataset.table` ``.
- **BigLake:** Use for querying GCS files (Parquet/Avro) without ingestion when data doesn't need BQ-native storage.
- **Policy Tags:** Propose for any PII column — column-level security, not row-level.

## PostgreSQL specifics

- Upsert: `INSERT ... ON CONFLICT (...) DO UPDATE SET ...` — never manual SELECT then INSERT.
- Index selection: B-tree for equality/range, GIN for JSONB/arrays/full-text, GiST for geo/range types.
- Partial indexes for filtered queries on large tables: `CREATE INDEX ON events (user_id) WHERE status = 'active'`.
- Always analyze with `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)` — never bare `EXPLAIN`.
- Connection pooling: PgBouncer or SQLAlchemy pool, never a new connection per query.

## Review checklist

- [ ] No `SELECT *` anywhere in the query
- [ ] Partitioned table → partition filter present and not wrapped in a function
- [ ] Clustering columns respected in WHERE order
- [ ] JOINs have explicit `ON` clause with selective predicate
- [ ] No `WHERE DATE(timestamp_col)` — rewrite to direct column filter
- [ ] Cross-project references fully qualified
- [ ] MERGE has explicit unique key — no blind WRITE_APPEND
- [ ] Query >1 TB scan flagged for review before production run
- [ ] Dry-run cost reported before any new query is approved

## Tooling

`.sqlfluff` config at project root (or `pyproject.toml` section):

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

- `WHERE DATE(timestamp_col) = '...'` on a partitioned column — kills partition pruning
- `SELECT *` in production or pipeline SQL
- Blind `WRITE_APPEND` without dedup strategy
- Subquery dedup instead of `QUALIFY ROW_NUMBER()`
- JOIN without explicit `ON` clause
- Cross-project query without fully qualified table reference
- Running a multi-TB scan without dry-run first
