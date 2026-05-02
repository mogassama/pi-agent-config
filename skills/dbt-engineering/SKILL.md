---
name: "dbt-engineering"
description: "Expert dbt-bigquery authoring, modeling, and testing. Focus on Medallion architecture and performance."
---

# dbt Engineering (2026 Power Edition)

## Execution Rules

- **Language:** Descriptions, metadata, and Jinja comments MUST be in **English**.
- **Environment:** Always managed via `uv` (`uv run dbt ...`).
- **Architecture:** Strict Medallion (Staging → Intermediate → Marts).

## 1. Project Structure & Naming

- **Staging (`stg_`)**: 1:1 with source. `view` materialization. Light cleaning only.
- **Intermediate (`int_`)**: `ephemeral` or `view`. Complex joins/logic before marts.
- **Marts (`fct_`, `dim_`)**: `table` or `incremental`. Business-ready.
- **Snapshots**: Capture SCD Type 2 history for mutable sources.

## 2. BigQuery Incremental (Cost-Optimized)

Mandatory pattern for large tables:

```sql
{{ config(
    materialized='incremental',
    incremental_strategy='merge',
    unique_key='id',
    partition_by={'field': 'created_at', 'data_type': 'timestamp'},
    cluster_by=['user_id'],
    incremental_predicates=["DBT_INTERNAL_DEST.created_at >= timestamp_sub(current_timestamp(), interval 7 day)"]
) }}

select * from {{ ref('stg_data') }}
{% if is_incremental() %}
    where created_at > (select max(created_at) from {{ this }})
{% endif %}
```

**Note:** `incremental_predicates` limits the scan on the destination table during the merge.

## 3. Testing (Double Layer)

### Data Tests (Quality)

- **Generic:** `unique`, `not_null`, `relationships` in `schema.yml`.
- **Packages:** Use dbt_utils for `at_least_one` and dbt_expectations for range/regex checks.

### Unit Tests (Logic - dbt 1.8+)

Used to validate SQL logic with static inputs (no BQ scan cost):

```yaml
unit_tests:
  - name: test_order_totals
    model: fct_orders
    given:
      - input: ref('stg_orders')
        rows: [{id: 1, price: 10, tax: 2}]
    expect:
      rows: [{id: 1, total: 12}]
```

## 4. Sources & Freshness

- **Strict ref:** Never use `FROM project.dataset.table`. Use `{{ source() }}`.
- **Freshness:** Define `warn_after` and `error_after`. Run `dbt source freshness` in CI.

## 5. Macros & Jinja

- **Dry Rule:** Use macros only for patterns repeated 3+ times.
- **English:** All macro documentation in English.
- **Package First:** Check dbt-utils before writing a custom macro.

## 6. Operational (Composer/CI)

- **Slim CI:** Use `dbt build --state --defer`.
- **State management:** Store `manifest.json` in GCS to allow state-aware runs.
- **Logging:** Use Loguru via a wrapper if running dbt within a Python script.

## Review Checklist (The "dbt Veto")

- [ ] No `select *` in Marts/Intermediate.
- [ ] `ref()`/`source()` used everywhere.
- [ ] Incremental models have `partition_by` and source filters.
- [ ] Unit Tests present for complex business logic.
- [ ] Descriptions in `schema.yml` are present and in English.
- [ ] Packages are pinned in `packages.yml`.

