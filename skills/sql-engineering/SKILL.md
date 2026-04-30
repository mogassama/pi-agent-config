---
name: sql-engineering
description: Use when authoring, reviewing, or optimizing SQL — especially BigQuery and PostgreSQL. Covers query writing style, performance tuning (partitioning, clustering, join order, predicate pushdown), schema design, dry-run cost estimation, EXPLAIN plan reading, and sqlfluff linting. Trigger on any task involving .sql files, BigQuery queries, schema migrations, or SQL performance investigation.
---

# SQL Engineering

## When this skill is active

You are reviewing, writing, or optimizing SQL. Default dialect: BigQuery Standard SQL. Secondary: PostgreSQL 14+.

## Style (defaults — match the project if it differs)

- Lowercase keywords. Trailing commas. One column per line in `select` lists with 3+ columns.
- Always alias tables in joins (`t1`, `t2` are fine for short queries; meaningful aliases for long ones).
- CTEs over nested subqueries. Name them after what they contain (`active_users`, not `cte1`).
- Never `select *` in code that ships. Enumerate columns.
- Project-qualify on cross-project BigQuery (`` `proj.dataset.table` ``).

## BigQuery — performance & cost

Before writing or accepting a non-trivial BigQuery query:

1. **Dry-run it.** `bq query --use_legacy_sql=false --dry_run "SELECT ..."` returns bytes processed without running. Report the estimate.
2. **Check partitioning.** If the source table is partitioned (usually on a `_PARTITIONTIME` or date column), the `WHERE` clause must filter on it, otherwise full scan. Confirm with `bq show --format=prettyjson <table> | grep -A2 partitioning`.
3. **Clustering.** Filtering or aggregating on cluster keys is much cheaper. Order of cluster keys matters (left-to-right prefix).
4. **Avoid:** `SELECT *`, untyped `STRUCT`/`ARRAY` flattening on huge tables, cross-joins without filters, `ORDER BY` in subqueries (BQ optimizer handles it).
5. **Prefer:** approximate aggregations (`APPROX_COUNT_DISTINCT`, `APPROX_QUANTILES`) when exactness isn't required, `QUALIFY` over self-joins for window-filter patterns.

## Schema design (BigQuery)

- Partition by ingestion date (`_PARTITIONDATE`) or a business date column. Pick one and document it.
- Cluster on the columns most often used in `WHERE`/`GROUP BY` (max 4, ordered by selectivity).
- Use `STRUCT` for tightly-coupled fields (address, geo). Use `ARRAY<STRUCT>` for one-to-many you query together.
- Avoid premature denormalization on raw layer; do it in mart layer.

## Postgres specifics

- `EXPLAIN (ANALYZE, BUFFERS)` for real plans. Just `EXPLAIN` for guessed plans.
- Index hygiene: `pg_stat_user_indexes` to find unused indexes; `pg_stat_statements` for slow queries.
- `ON CONFLICT DO UPDATE` for upserts. Avoid SELECT-then-INSERT race conditions.

## Tooling

- `sqlfluff lint --dialect bigquery file.sql` (or `postgres`). Use the project's `.sqlfluff` if present.
- For ad-hoc query work, Mo uses DataGrip — formatting suggestions should match DataGrip defaults.

## Review checklist

When asked to review SQL:
- [ ] No `SELECT *` in non-exploratory code
- [ ] Partition/cluster keys used in `WHERE` (BigQuery)
- [ ] Joins have explicit `ON`, not implicit cross-join
- [ ] Window functions don't shadow table columns
- [ ] Date/timezone handling explicit (`TIMESTAMP` vs `DATETIME` in BQ — they differ)
- [ ] No string-concat into `WHERE` (injection risk in app code)

## TODO (flesh out as patterns emerge)

- Project-specific naming conventions for staging/mart layers
- dbt-specific patterns if Mo adopts dbt
- Common BQ → Postgres translation gotchas Mo hits
