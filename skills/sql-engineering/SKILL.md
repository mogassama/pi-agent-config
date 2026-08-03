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

## Review delta

*Everything above is authoring guidance, injected for both worker and reviewer.
This section is injected for the reviewer only. It replaces the two former
`### Review checklist` blocks.*

**Floor.** For a diff under ~10 lines, report only HIGH findings.

**Do not report what the tooling already reports.** `sqlfluff` with the correct
dialect covers formatting, keyword casing and layout. A finding it would raise
is a duplicate.

**Dialect first.** Before weighing anything, confirm which engine the file
targets using the recognition markers in Block 1. A PostgreSQL rule applied to
a BigQuery file — or the reverse — is itself a MEDIUM finding, and it
invalidates everything else you were about to report.

### Severity assignment — every dialect

Definitions live in `code-review`.

| Breach | Severity |
|:--|:--|
| Value interpolated into SQL by f-string or string concatenation | **HIGH** |
| `SELECT *` in production or pipeline SQL | MEDIUM |
| JOIN with no explicit `ON`, or with a non-selective predicate | MEDIUM |
| PostgreSQL rules applied to a BigQuery file, or the reverse | MEDIUM |
| Query not linted with the correct dialect before review | LOW |

### Severity assignment — PostgreSQL

| Breach | Severity |
|:--|:--|
| Upsert written as manual `SELECT` then `INSERT` instead of `ON CONFLICT` | MEDIUM |
| Index type mismatched to the predicate shape — B-tree, GIN, GiST | MEDIUM |
| No `EXPLAIN (ANALYZE, BUFFERS)` on a new query against a large table | LOW |

### BigQuery

Not weighed here. Query conventions live in `bigquery-engineering`; access,
cost and administration in `bigquery-ops`. A partition-filter rule
half-remembered in this file would be worse than no rule.

### Traps a diff does not show

- **A `WHERE` clause that is selective in staging and not in production.**
  Predicate selectivity depends on the data, not the text. Say so in
  `open_risks` rather than asserting a performance finding as `certain`.
- **`ON CONFLICT DO NOTHING` where `DO UPDATE` was meant.** Both are idempotent;
  only one converges. Silent, and invisible until the values diverge.
- **An index added in a migration but the query still not using it.** The diff
  shows the index; only `EXPLAIN` shows whether the planner picks it.

### Verdict

`blocked` requires at least one HIGH at `certain` or `probable`. A HIGH at
`possible` downgrades to `needs_rework` and must be named in `top_priority`.
With no finding above LOW, `approved`.
