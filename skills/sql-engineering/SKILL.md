---
name: sql-engineering
description: Expert SQL authoring & optimization (BigQuery & Postgres). Focus on cost-efficiency, performance (partitioning/clustering), and modern syntax. Trigger on .sql files, schema design, or BQ performance tasks.
---

# SQL Engineering (2026 Edition)

## Execution Rules
- **Language:** Column names and SQL comments must be in **English**.
- **Dialect:** Default to BigQuery Standard SQL.
- **Formatting:** Lowercase keywords, trailing commas, CTEs for readability.

## BigQuery: The "Cost-First" Approach
Before executing any query, provide:
1. **Dry-Run Estimate:** "Estimated cost: X MB/GB".
2. **Partition Check:** Ensure `WHERE` clauses target partitioning columns (e.g., `_PARTITIONDATE`).
3. **Clustering Check:** Ensure `WHERE` filters follow the order of clustered columns.

### High-Performance Patterns
- **Deduplication:** Always use `QUALIFY ROW_NUMBER() OVER(PARTITION BY id ORDER BY ts DESC) = 1`. Avoid subqueries for this.
- **JSON Handling:** Use the native `JSON` type for semi-structured data. Use `JSON_VALUE` or `JSON_QUERY` with `lax` keyword for robustness.
- **Search Optimization:** Suggest `SEARCH INDEX` on large text columns for needle-in-haystack queries.
- **Materialized Views:** Propose a Materialized View if the same aggregation is run frequently on a large table.

## Schema Design (BigQuery 2026)
- **Partitioning:** Mandatory for tables > 1GB. Prefer `DATE` or `TIMESTAMP` columns.
- **Clustering:** Add up to 4 columns (ordered by selectivity). Essential for cost reduction.
- **BigLake:** Use for data sitting in GCS (Parquet/Avro) to query without ingestion.
- **Policy Tags:** Suggest for PII data (column-level security).

## Postgres Specifics
- **Index:** Check for GIST/GIN indexes on JSONB/Geo columns.
- **Upsert:** Use `INSERT ... ON CONFLICT (...) DO UPDATE`.
- **Explain:** Always analyze with `EXPLAIN (ANALYZE, BUFFERS)`.

## Review Checklist (The "Veto")
- [ ] **No `SELECT *`:** Only explicit columns.
- [ ] **Full Scan Alert:** Flag any query on a partitioned table missing a filter on the partition key.
- [ ] **Cross-Join Alert:** Flag joins without an `ON` clause or with non-selective predicates.
- [ ] **Legacy Alert:** Flag old-school `EXTRACT(DAY FROM ...)`; suggest `DATE_TRUNC`.
- [ ] **Loguru/English:** Ensure SQL logic aligns with English-only naming from `python-engineering`.

## Tooling Integration
- **Linting:** Use `sqlfluff lint --dialect bigquery`.
- **Pre-commit:** SQL files must pass `sqlfluff fix` before being considered for review.
