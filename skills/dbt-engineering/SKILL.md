---
name: dbt-engineering
description: Load for dbt authoring, modeling, testing, and operations on BigQuery. Covers Medallion architecture, incremental patterns, unit tests, macros, Composer CI integration. Auto-load on .sql dbt models, schema.yml, dbt_project.yml, or any dbt command task.
---

# dbt Engineering

## Conventions

- **SQL keywords:** lowercase (`select`, `from`, `where`, `join`) — dbt convention, distinct from raw BigQuery SQL (uppercase).
- **Identifiers:** `snake_case` for models, columns, sources, macros.
- **Language:** Descriptions, schema.yml metadata, macro documentation, Jinja comments in English.
- **Runtime:** `uv run dbt <command>` — never bare `dbt` outside a uv-managed project.

## Project structure

```
models/
├── staging/          # stg_ prefix — 1:1 with source, view materialization
├── intermediate/     # int_ prefix — joins and logic, view materialization
└── marts/
    ├── core/         # fct_ and dim_ — table or incremental
    └── <domain>/
snapshots/            # SCD Type 2 on mutable sources
macros/               # DRY patterns used 3+ times
tests/                # singular SQL tests (business rules)
seeds/                # static reference data only
```

## dbt_project.yml — canonical defaults

```yaml
name: '<project>'
version: '1.0.0'
config-version: 2

models:
  <project>:
    staging:
      +materialized: view
      +schema: staging
    intermediate:
      +materialized: view
      +schema: intermediate
    marts:
      +materialized: table
      +schema: marts

snapshots:
  <project>:
    +target_schema: snapshots
    +strategy: timestamp
    +updated_at: updated_at
```

## Naming conventions

| Prefix | Layer | Materialization | Rule |
|---|---|---|---|
| `stg_` | Staging | `view` | 1:1 with source. Light cleaning, type casting, renaming only. |
| `int_` | Intermediate | `view` | Joins, logic assembly before marts. No business metrics. |
| `fct_` | Mart — facts | `table` or `incremental` | Events, transactions. Immutable grain. |
| `dim_` | Mart — dimensions | `table` | Entities. SCD Type 2 via snapshots if history needed. |

**On intermediate ephemeral:** Avoid `ephemeral` on intermediate models in BigQuery. Ephemeral models are inlined into downstream queries — on complex graphs this produces unmaintainable mega-queries that are hard to debug and impossible to profile. Use `view` instead; BQ optimizes view chains well.

## BigQuery incremental — canonical pattern

```sql
{{ config(
    materialized='incremental',
    incremental_strategy='merge',
    unique_key='id',
    partition_by={'field': 'created_at', 'data_type': 'timestamp'},
    cluster_by=['user_id'],
    on_schema_change='append_new_columns',
    incremental_predicates=[
        "DBT_INTERNAL_DEST.created_at >= timestamp_sub(current_timestamp(), interval 7 day)"
    ]
) }}

select
    id,
    user_id,
    created_at,
    amount_eur,
    status
from {{ ref('stg_orders') }}
{% if is_incremental() %}
where created_at > (select max(created_at) from {{ this }})
{% endif %}
```

Rules:
- Never `select *` in marts or intermediate — enumerate columns explicitly.
- `unique_key` mandatory on every incremental model.
- `partition_by` mandatory on incremental models over 1 GB expected size.
- `incremental_predicates` limits destination table scan during MERGE — always set on partitioned targets.
- `on_schema_change`: use `append_new_columns` by default. Use `fail` on models where schema stability is critical. Never `ignore`.
- No `full_refresh` in production runs — requires explicit operator decision and downstream impact assessment.

## Sources & freshness

```yaml
sources:
  - name: raw_orders
    database: my_project
    schema: raw
    freshness:
      warn_after: {count: 6, period: hour}
      error_after: {count: 24, period: hour}
    loaded_at_field: _ingested_at
    tables:
      - name: orders
        description: "Raw orders from the e-commerce platform."
```

- Never `FROM project.dataset.table` directly — always `{{ source() }}` or `{{ ref() }}`.
- Run `dbt source freshness` as the first CI step before any build.

## Testing — two layers

### Generic tests (schema.yml)

```yaml
models:
  - name: fct_orders
    columns:
      - name: order_id
        tests:
          - unique
          - not_null
      - name: customer_id
        tests:
          - not_null
          - relationships:
              to: ref('dim_customers')
              field: customer_id
      - name: status
        tests:
          - accepted_values:
              values: ['pending', 'shipped', 'delivered', 'cancelled']
      - name: amount_eur
        tests:
          - dbt_utils.expression_is_true:
              expression: "> 0"
```

### Unit tests (dbt 1.8+ — logic validation, zero BQ cost)

```yaml
unit_tests:
  - name: test_order_total_calculation
    model: fct_orders
    given:
      - input: ref('stg_orders')
        rows:
          - {order_id: 1, price_eur: 10.00, tax_eur: 2.00}
          - {order_id: 2, price_eur: 0.00, tax_eur: 0.00}
    expect:
      rows:
        - {order_id: 1, total_eur: 12.00}
        - {order_id: 2, total_eur: 0.00}
```

Write unit tests for any model with non-trivial SQL logic (conditionals, window functions, calculations). Skip for pure renaming/casting staging models.

### Singular tests (business rules)

```sql
-- tests/assert_no_negative_net_revenue.sql
select order_id
from {{ ref('fct_orders') }}
where net_revenue_eur < 0
  and status != 'refunded'
```

## Macros

- Write a macro only when the pattern appears 3+ times across models.
- Check `dbt_utils` and `dbt_expectations` before writing custom macros.
- Document every macro with a Jinja docstring in English.

```sql
{% macro cents_to_euros(column_name) %}
    ({{ column_name }} / 100.0)
{% endmacro %}
```

## packages.yml — standard stack

```yaml
packages:
  - package: dbt-labs/dbt_utils
    version: [">=1.0.0", "<2.0.0"]
  - package: calogica/dbt_expectations
    version: [">=0.10.0", "<1.0.0"]
```

Pin version ranges. Run `dbt deps` after any change. Commit `package-lock.yml`.

## Slim CI (Composer / GitHub Actions)

```bash
# Retrieve previous manifest from GCS
gcloud storage cp gs://BUCKET/dbt/manifest.json ./manifest.json

# Build only changed models and their downstream dependencies
uv run dbt build \
  --select state:modified+ \
  --defer \
  --state ./manifest.json

# Upload new manifest after successful run
gcloud storage cp ./target/manifest.json gs://BUCKET/dbt/manifest.json
```

- Store `manifest.json` in GCS — enables state-aware runs across environments.
- `--defer` resolves upstream refs from the production manifest, not a full rebuild.
- `dbt source freshness` runs before `dbt build` in every CI pipeline.

## Review checklist

- [ ] No `select *` in staging, intermediate, or marts — enumerate columns
- [ ] Every `ref()` and `source()` used — no raw `project.dataset.table`
- [ ] Incremental models have `unique_key`, `partition_by`, `incremental_predicates`, `on_schema_change`
- [ ] `not_null` + `unique` on primary key of every model
- [ ] Unit tests present for models with non-trivial logic
- [ ] `source_freshness` configured on every source
- [ ] Macro justified by 3+ repetitions — not written speculatively
- [ ] Packages pinned in `packages.yml` and `package-lock.yml` committed
- [ ] No `full_refresh` in production DAG — explicit override only
- [ ] Descriptions in `schema.yml` present and in English
