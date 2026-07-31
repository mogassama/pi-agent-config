---
name: sql-engineering
description: >-
  Load for SQL craft that holds whatever the engine — naming, CTE structure,
  join discipline, explicit column lists, linting — and for the PostgreSQL
  dialect specifically: ON CONFLICT upserts, index selection, EXPLAIN ANALYZE,
  connection pooling. Recognise PostgreSQL by unqualified `schema.table`
  references and ON CONFLICT. When a file instead shows backtick-quoted
  three-part names or QUALIFY, the engine is elsewhere — load
  bigquery-engineering. When it shows `{{ ref() }}`, load dbt-engineering.
---

# SQL Engineering

Three blocks. The common ground applies everywhere. Each dialect block opens
with how to recognise it, because a `.sql` file gives away nothing by its name.

---

## Block 1 — Common ground (every dialect)

### Conventions

- **Keywords:** UPPERCASE (`SELECT`, `FROM`, `WHERE`, `JOIN`, `WITH`).
- **Identifiers:** `snake_case` for columns, tables, schemas, CTEs.
- Trailing commas. CTEs (`WITH`) over subqueries for anything non-trivial.
- Always alias tables in JOINs.
- Column names and SQL comments in English.

### Non-negotiables

- **Never `SELECT *`** in production SQL or generated queries. Enumerate columns.
- JOINs always have an explicit `ON` clause with a selective predicate.
- Never build SQL by f-string interpolation of user input — parameterise.

### Tooling

`sqlfluff` for linting — `dialect` must match the target engine.

```bash
sqlfluff lint --dialect <dialect> <file.sql>
sqlfluff fix <file.sql>   # review the diff before committing
```

### Review checklist

- [ ] No `SELECT *` anywhere in the query
- [ ] JOINs have explicit `ON` clause with selective predicate
- [ ] Query linted with the correct dialect before review

---

## Block 2 — PostgreSQL

**Recognise it by:** two-part `schema.table` references with no backticks,
`ON CONFLICT`, `RETURNING`, `SERIAL` / `GENERATED ... AS IDENTITY`, `::` casts,
`ILIKE`, `EXPLAIN (ANALYZE, BUFFERS)`.

### Rules

- **Upsert:** `INSERT ... ON CONFLICT (...) DO UPDATE SET ...` — never a manual
  SELECT-then-INSERT. It is not atomic and races under concurrency.
- **Index selection:** B-tree for equality and range, GIN for JSONB / arrays /
  full-text, GiST for geometry and range types.
- **Partial indexes** for filtered queries on large tables:
  `CREATE INDEX ON events (user_id) WHERE status = 'active'`.
- **Always** analyse with `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)` — a bare
  `EXPLAIN` shows the plan the planner guessed, not the one it ran.
- **Connection pooling:** PgBouncer or a SQLAlchemy pool. Never a new connection
  per query.
- `RETURNING` instead of a follow-up SELECT after an INSERT or UPDATE.

### Review checklist

- [ ] Upsert uses `ON CONFLICT` — never manual SELECT+INSERT
- [ ] `EXPLAIN (ANALYZE, BUFFERS)` run before merging any new query on a large table
- [ ] Index type matches the predicate shape (B-tree / GIN / GiST)
- [ ] `sqlfluff --dialect postgres`

---

## Block 3 — BigQuery

**Recognise it by:** backtick-quoted three-part `` `project.dataset.table` ``
references, `QUALIFY`, `_PARTITIONTIME` / `_PARTITIONDATE`, `STRUCT` / `ARRAY`
with `UNNEST`, `MERGE`.

This block is a pointer, not a summary. The conventions live in
**bigquery-engineering**; access, cost and administration live in
**bigquery-ops**. Do not reimplement either here — a partition-filter rule
half-remembered in this file is worse than no rule.

The one thing worth knowing before switching skills: BigQuery has no indexes.
Every PostgreSQL instinct about index selection is inapplicable; the equivalent
lever is partitioning and clustering.

---

## Anti-patterns — never do these

- `SELECT *` in production or pipeline SQL
- JOIN without an explicit `ON` clause
- f-string interpolation of values into SQL
- PostgreSQL rules applied to a BigQuery file, or the reverse — check the
  recognition markers first
