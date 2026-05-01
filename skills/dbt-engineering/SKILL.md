---
name: dbt-engineering
description: Use for dbt (data build tool) work — model authoring, project structure, tests, sources, snapshots, macros, packages, and BigQuery-specific concerns. Covers staging/intermediate/mart layering, ref/source semantics, materialization choices (view/table/incremental/ephemeral), test patterns (generic + singular), incremental strategies on BigQuery, and operational concerns (CI, scheduling via Composer, state-aware runs). Trigger on any task involving .sql files under `models/`, `dbt_project.yml`, `schema.yml`, `sources.yml`, dbt CLI commands, or dbt-related design decisions.
---

# dbt Engineering

## When this skill is active

You are designing, writing, reviewing, or operating a dbt project. Default adapter: **dbt-bigquery** (Mo's stack). Secondary: **dbt-postgres** for local exercises.

For SQL authoring patterns that aren't dbt-specific (style, BQ partitioning/clustering), defer to the `sql-engineering` skill — load it alongside this one. For multi-service orchestration questions ("dbt vs Dataflow vs raw SQL DAG"), defer to `dataeng-architecture`.

## If Mo is in formation/exploration mode

dbt is mostly a wrapper around `SELECT` statements with three superpowers: dependency resolution via `ref()`, environment-aware compilation (dev/prod), and built-in testing. Everything else is sugar. If a pattern feels overengineered for your current need, it probably is — start simple, refactor when the pain is real.

Recommended learning path:
1. dbt Fundamentals course (free, official)
2. Build one project end-to-end with 3-5 models on Postgres or BQ free tier
3. Add tests, then sources, then a macro
4. Only then look at packages, snapshots, exposures, semantic layer

## Project layout

The standard dbt project structure, with annotations on what matters:

```
my_dbt_project/
├── dbt_project.yml         # project config, model paths, materializations by folder
├── profiles.yml            # connection config (lives in ~/.dbt/ in dev, env vars in prod)
├── packages.yml            # dbt-utils, dbt-expectations, dbt-bigquery-utils, etc.
├── models/
│   ├── staging/            # 1:1 with sources, light cleaning, materialized as views
│   │   ├── stripe/
│   │   │   ├── _stripe__sources.yml
│   │   │   ├── _stripe__models.yml
│   │   │   └── stg_stripe__charges.sql
│   ├── intermediate/       # joining, fan-outs, business logic stepping stones (ephemeral or view)
│   │   └── int_payments_pivoted.sql
│   └── marts/              # business-grade tables (table or incremental)
│       ├── finance/
│       │   ├── _finance__models.yml
│       │   ├── fct_orders.sql
│       │   └── dim_customers.sql
├── tests/                  # singular tests (raw SQL files that fail if rows return)
├── macros/                 # reusable Jinja/SQL functions
├── snapshots/              # SCD type 2 captures of mutable source tables
├── seeds/                  # CSV files version-controlled (small reference data only)
└── analyses/               # ad-hoc SQL not part of the pipeline (compiled but not run)
```

**Hard rule:** `models/staging/` mirrors source structure (one folder per source system). `models/marts/` mirrors business domains (finance/, marketing/, product/). Don't mix.

## Naming conventions

- **Sources** — `source('source_system', 'table_name')`. Never reference raw tables directly outside of staging.
- **Staging models** — `stg_<source>__<entity>.sql` (double underscore separates source from entity). E.g. `stg_stripe__charges.sql`.
- **Intermediate models** — `int_<verb>_<entity>.sql`. E.g. `int_payments_pivoted.sql`. These are stepping stones, not consumed by BI.
- **Mart models** — `fct_<plural>.sql` for facts (events, transactions), `dim_<plural>.sql` for dimensions (customers, products). E.g. `fct_orders.sql`, `dim_customers.sql`.
- **Tests** — singular test files: `assert_<what_should_be_true>.sql`. E.g. `assert_no_negative_amounts.sql`.

## Materializations

The choice that bites everyone. Defaults by layer:

| Layer | Default materialization | Why |
|---|---|---|
| Staging | `view` | Cheap, always fresh, no storage cost |
| Intermediate | `ephemeral` (CTE) or `view` | Used by 1-2 downstream models; ephemeral if simple, view if reused |
| Mart | `table` | Stable, queryable, predictable performance |
| Mart (large/event) | `incremental` | Only process new/changed rows |

**When to deviate:**
- Staging on a huge raw table that's queried frequently → consider `table` with daily refresh
- Intermediate referenced by 5+ models → promote to `view` (ephemeral inlines into every parent, exploding compile)
- Mart that's small (<1M rows) → keep `table`, incremental adds complexity
- Mart that's append-only and large → `incremental` with `unique_key` and `merge` strategy

## Incremental on BigQuery

The most common dbt-on-BQ pitfall. The pattern:

```sql
{{ config(
    materialized='incremental',
    unique_key='order_id',
    on_schema_change='append_new_columns',
    partition_by={'field': 'order_date', 'data_type': 'date'},
    cluster_by=['customer_id'],
    incremental_strategy='merge'
) }}

select
    order_id,
    customer_id,
    order_date,
    amount,
    updated_at
from {{ ref('stg_stripe__charges') }}

{% if is_incremental() %}
    -- crucial: filter on the source partition, not just on updated_at
    -- otherwise BQ scans the full source table on every incremental run
    where order_date >= date_sub(current_date(), interval 7 day)
      and updated_at > (select max(updated_at) from {{ this }})
{% endif %}
```

**Hard rules for incremental on BQ:**

1. **Always partition the destination** (`partition_by` in config). Without partitioning, `merge` rewrites the entire table.
2. **The `is_incremental()` block must filter on the source partition column**, not just on `updated_at`. Otherwise you scan the full source table each run.
3. **`incremental_strategy='merge'`** is the default and right answer 90% of the time. `insert_overwrite` is for partition-replace patterns where uniqueness isn't a thing.
4. **`on_schema_change='append_new_columns'`** is usually what you want. The default `'ignore'` silently drops new columns from upstream and you find out 3 weeks later.
5. **Test the full refresh path** with `dbt run --full-refresh -s your_model`. If it can't full-refresh in reasonable time/cost, the incremental logic is hiding a problem.

## Tests

Two flavors:

**Generic tests** in `schema.yml`:
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
          - relationships:
              to: ref('dim_customers')
              field: customer_id
      - name: status
        tests:
          - accepted_values:
              values: ['pending', 'paid', 'cancelled', 'refunded']
```

The 4 above (`unique`, `not_null`, `relationships`, `accepted_values`) are dbt builtin. For more, use `dbt-utils` and `dbt-expectations` packages.

**Singular tests** in `tests/`:
```sql
-- tests/assert_orders_amounts_positive.sql
-- A test passes if the query returns zero rows.
select order_id, amount
from {{ ref('fct_orders') }}
where amount < 0
```

**When to write singular tests:** business invariants that aren't column-level (cross-row, cross-table, complex conditions). When in doubt, prefer generic — they're easier to maintain.

**Severity:** add `severity: warn` to non-blocking tests:
```yaml
tests:
  - relationships:
      to: ref('dim_customers')
      field: customer_id
      severity: warn  # log but don't fail the run
```

Use sparingly. A warning that fires every run is worse than a test that doesn't exist.

## Sources

Always declare sources in `_<system>__sources.yml`:

```yaml
sources:
  - name: stripe
    database: my-gcp-project
    schema: raw_stripe
    loader: fivetran
    loaded_at_field: _fivetran_synced
    freshness:
      warn_after: {count: 12, period: hour}
      error_after: {count: 24, period: hour}
    tables:
      - name: charges
        description: "Stripe charge events, one row per charge"
        columns:
          - name: id
            tests: [unique, not_null]
```

**Why bother with `loaded_at_field` + `freshness`:** `dbt source freshness` becomes a first-class data quality check you can run in CI. Without it, stale data goes unnoticed until someone complains.

## Macros

Only write a macro when:
- You repeat the same SQL pattern in 3+ models
- You need conditional compilation (different SQL per environment)
- You wrap a complex Jinja control flow that would clutter a model

Don't write macros for:
- Adding a column with a constant value (just write the SQL)
- "Future-proofing" something that has 1 use case
- Wrapping a single SQL function for "readability"

Example of a worthwhile macro:
```sql
-- macros/cents_to_currency.sql
{% macro cents_to_currency(column_name, currency_column='currency') %}
    case
        when {{ currency_column }} = 'JPY' then {{ column_name }}  -- no decimals
        else {{ column_name }} / 100.0
    end
{% endmacro %}
```

Used as `{{ cents_to_currency('amount_cents') }}` in models.

## Snapshots (SCD Type 2)

For mutable source tables you want a history of:

```sql
{% snapshot customers_snapshot %}
    {{ config(
        target_database='my-gcp-project',
        target_schema='snapshots',
        unique_key='customer_id',
        strategy='timestamp',
        updated_at='updated_at',
    ) }}

    select * from {{ source('crm', 'customers') }}
{% endsnapshot %}
```

**Strategies:**
- `timestamp` — when source has reliable `updated_at`. Preferred.
- `check` — dbt diffs all columns. Slower, use when no timestamp available.

**Run snapshots on a schedule** (typically nightly). They go in their own dbt run, separate from `dbt run` for models, because you can't replay them — once a row's history is captured wrong, it's wrong.

## Packages

Pin in `packages.yml`:

```yaml
packages:
  - package: dbt-labs/dbt_utils
    version: [">=1.1.0", "<2.0.0"]
  - package: calogica/dbt_expectations
    version: [">=0.10.0", "<0.11.0"]
  - package: dbt-labs/dbt_bigquery_utils
    version: ["~=0.4.0"]
```

Run `dbt deps` after changing this file. Lock to minor versions, not to exact patches — bug fixes are usually safe.

**Worth installing for any BQ project:**
- `dbt_utils` — generic tests (e.g. `dbt_utils.unique_combination_of_columns`), surrogate key generation, date spines
- `dbt_expectations` — Great-Expectations-style tests (range checks, regex, statistical)

## Operational concerns

**Profile management for BQ:**
- Local dev: `~/.dbt/profiles.yml` with OAuth (`gcloud auth application-default login`)
- CI/prod: env vars + service account JSON, never committed

**Running on Cloud Composer:**
- Use `BashOperator` or `KubernetesPodOperator` to invoke `dbt run`
- Pin the dbt-bigquery version in `requirements.txt` of the Composer env
- Don't use the dbt Cloud connector unless you're paying for dbt Cloud
- For deferred state-aware runs (`--state` + `--defer`), the manifest must be uploaded somewhere reachable (GCS bucket typically)

**CI patterns:**
- On PR: `dbt build -s state:modified+ --defer --state ./prod-manifest` (only run changed models + their downstream)
- Slim CI saves >90% of compile time on large projects

**Scheduling pattern (Composer):**
```python
# Daily DAG
dbt_run = BashOperator(
    task_id="dbt_run_marts",
    bash_command="cd /opt/dbt && dbt run --target prod -s marts",
)
dbt_test = BashOperator(
    task_id="dbt_test_marts",
    bash_command="cd /opt/dbt && dbt test --target prod -s marts",
)
dbt_run >> dbt_test
```

For full coverage: `dbt run` then `dbt test` as separate tasks (failure of test shouldn't roll back the run, you need to investigate). Some teams use `dbt build` (run+test interleaved) but it's harder to debug failures.

## Anti-patterns to refuse

- **`select *` in marts.** Staging is the only layer where `select *` is sometimes acceptable (1:1 with source).
- **Models that don't use `ref()` or `source()`.** Hardcoded table names break dependency resolution.
- **Logic in views consumed by BI.** BI tools re-query the view on every dashboard load. Materialize as table.
- **Tests at the source layer that should be at the staging layer.** Source tests should validate "raw data shape", not business rules.
- **`materialized='table'` with no `partition_by` on a multi-GB table.** Full table rewrites get expensive fast.
- **Snapshots on tables with no reliable `updated_at`** without thinking through the alternative. `strategy='check'` on a 100-column table is pathologically slow.
- **Custom Jinja macros for things dbt-utils already does.** Check the package first.

## Common dbt-bigquery quirks

- **`partition_by` `data_type`** must be specified explicitly (`date`, `timestamp`, `int64`). Default is `date`, often wrong for `timestamp` columns.
- **`cluster_by`** accepts up to 4 columns. Order matters (left-to-right prefix).
- **Project-qualified refs** in cross-project setups: configure `database` in `dbt_project.yml` per-folder.
- **Costs on incremental models:** check `--dry-run` cost via `dbt compile` then `bq query --dry_run` on the compiled SQL. Always.
- **`dbt seed` is for small reference data**, not for ETL. Don't put 1M-row CSVs in `seeds/`.

## Review checklist (when reviewing a dbt project or PR)

- [ ] Models use `ref()` and `source()`, no hardcoded table names
- [ ] Staging models are `view`, marts are `table` or `incremental`
- [ ] Incremental models filter on source partition in `is_incremental()` block
- [ ] Incremental models have `partition_by` configured on destination
- [ ] Every mart model has at least one `unique` test on its primary key
- [ ] Sources have `loaded_at_field` and `freshness` configured
- [ ] No `select *` outside staging
- [ ] Packages are pinned to minor versions
- [ ] Models follow naming convention (stg_/int_/fct_/dim_)
- [ ] Documentation strings (`description:`) on all mart models and their columns
- [ ] No singular test that should be a generic test (or vice versa)
- [ ] CI runs `dbt build` with slim mode (`state:modified+ --defer`)

## TODO (flesh out as Mo accumulates dbt experience)

- Mo's project-specific naming (e.g. domain prefix in marts: `fin_fct_orders`?)
- Patterns for cross-database refs if Mo's project spans multiple GCP projects
- dbt semantic layer / metrics — only if Mo adopts it (not yet stable in 1.x)
- Migration patterns from raw SQL DAGs to dbt models
- exposures.yml for downstream BI dependencies
