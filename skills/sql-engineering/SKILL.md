---
name: sql-engineering
description: Load for SQL authoring, optimization, schema design, or query review. Covers generic SQL conventions and PostgreSQL specifics (indexes, upserts, EXPLAIN). For BigQuery-specific patterns (partitioning, clustering, MERGE, dedup, cost), load bigquery-engineering instead. Auto-load on .sql files or PostgreSQL-specific tasks.
---

# SQL Engineering

## Conventions

- **Keywords:** UPPERCASE (`SELECT`, `FROM`, `WHERE`, `JOIN`, `WITH`, etc.).
- **Identifiers:** `snake_case` for columns, tables, datasets, CTEs.
- **dbt exception:** dbt models use lowercase keywords — see `dbt-engineering` skill.
- Trailing commas. CTEs (`WITH`) over subqueries for anything non-trivial.
- Always alias tables in JOINs.
- Column names and SQL comments in English.
- BigQuery SQL: see `bigquery-engineering` skill.

## Schema design

- **Never `SELECT *`** in production SQL or DAG-generated queries. Always enumerate columns explicitly.

## PostgreSQL specifics

- Upsert: `INSERT ... ON CONFLICT (...) DO UPDATE SET ...` — never manual SELECT then INSERT.
- Index selection: B-tree for equality/range, GIN for JSONB/arrays/full-text, GiST for geo/range types.
- Partial indexes for filtered queries on large tables: `CREATE INDEX ON events (user_id) WHERE status = 'active'`.
- Always analyze with `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)` — never bare `EXPLAIN`.
- Connection pooling: PgBouncer or SQLAlchemy pool, never a new connection per query.

## Review checklist

- [ ] No `SELECT *` anywhere in the query
- [ ] JOINs have explicit `ON` clause with selective predicate
- [ ] PostgreSQL upsert uses `ON CONFLICT` — never manual SELECT+INSERT
- [ ] `EXPLAIN (ANALYZE, BUFFERS)` run before merging any new query on large tables

## Tooling

`sqlfluff` for SQL linting — configure `dialect` to match the target database. For BigQuery dialect config, see `bigquery-engineering` skill.

Run before any review: `sqlfluff lint --dialect <dialect> <file.sql>`.
Auto-fix: `sqlfluff fix <file.sql>` — review the diff before committing.

## Anti-patterns — never do these

- `SELECT *` in production or pipeline SQL
- JOIN without explicit `ON` clause
