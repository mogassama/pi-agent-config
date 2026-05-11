---
name: data-quality
description: Load for data quality tasks — dbt test generation, pipeline assertions, schema drift detection, freshness checks, and quarantine patterns. Auto-load when creating dbt models, ingestion pipelines, or validating BigQuery tables.
---

# Data Quality

## Principles

- **Shift Left.** Quality starts at ingestion. Test at the staging layer before data reaches marts.
- **Zero Trust.** Every production table needs at minimum: uniqueness + not-null on primary key + row count assertion.
- **Fail loud.** A silent bad number is worse than a failed pipeline. Raise, don't swallow.

## dbt — test generation

For every new model, generate a `schema.yml` block. Minimum viable tests:

```yaml
models:
  - name: stg_orders
    columns:
      - name: order_id
        tests:
          - unique
          - not_null
      - name: customer_id
        tests:
          - not_null
          - relationships:
              to: ref('stg_customers')
              field: customer_id
      - name: status
        tests:
          - accepted_values:
              values: ['pending', 'shipped', 'delivered', 'cancelled']
      - name: amount_eur
        tests:
          - not_null
          - dbt_utils.expression_is_true:
              expression: "> 0"
```

### Source freshness

Configure on every source that feeds a production model:

```yaml
sources:
  - name: raw_orders
    freshness:
      warn_after: {count: 6, period: hour}
      error_after: {count: 24, period: hour}
    loaded_at_field: _ingested_at
    tables:
      - name: orders
```

Run `dbt source freshness` as the first step of any orchestrated pipeline.

### Singular tests (business rules)

Create SQL tests in `tests/` for rules that generic tests cannot express:

```sql
-- tests/assert_no_negative_revenue.sql
-- Fails if any row has negative revenue after refund application
SELECT order_id
FROM {{ ref('fct_orders') }}
WHERE net_revenue_eur < 0
  AND status != 'refunded'
```

A singular test fails if it returns any rows. Keep them scoped — one business rule per file.

## Python pipeline — inline assertions

Assert before writing. Never write first and check later.

```python
from loguru import logger

def validate_batch(df: list[dict], source: str) -> None:
    if not df:
        raise ValueError(f"Empty batch from {source} — aborting write")

    row_count = len(df)
    null_ids = [r for r in df if r.get("id") is None]
    if null_ids:
        raise ValueError(
            f"{len(null_ids)} rows with null id in {source} — aborting"
        )

    logger.info("batch_validated", source=source, row_count=row_count)
```

Pattern: validate → log → write. Never write → validate after.

## Volumetry assertions

Flag unexpected row count changes between runs. Implement as a post-load check:

```python
def assert_volume(
    client: bigquery.Client,
    table: str,
    expected_min: int,
    expected_max: int,
) -> None:
    query = f"SELECT COUNT(*) as n FROM `{table}`"  # noqa: S608
    result = client.query(query).result()
    n = next(result).n
    if not (expected_min <= n <= expected_max):
        raise ValueError(
            f"Volume check failed for {table}: got {n}, "
            f"expected [{expected_min}, {expected_max}]"
        )
```

Trigger: if current run row count < 50% of previous run row count → hard stop.

## Schema drift detection

Before writing to an existing BQ table, validate schema compatibility:

```python
def assert_schema_compatible(
    client: bigquery.Client,
    table_ref: str,
    expected_fields: list[str],
) -> None:
    table = client.get_table(table_ref)
    actual_fields = {f.name for f in table.schema}
    missing = set(expected_fields) - actual_fields
    if missing:
        raise ValueError(f"Schema drift in {table_ref}: missing fields {missing}")
```

Never silently drop or rename columns in a downstream table without an explicit migration step.

## BigQuery schema design for quality

- `INT64` for counts, IDs, integer amounts. `FLOAT64` only when fractional precision is required. `NUMERIC` or `BIGNUMERIC` for financial amounts — never `FLOAT64` for money.
- `TIMESTAMP` for event times (timezone-aware). `DATE` for partition columns and calendar dates.
- `STRING` for IDs that may contain leading zeros or non-numeric chars (e.g. postal codes). Never cast to `INT64` unless you own the source.
- Nullable vs required: primary keys and partition columns are always `REQUIRED`. Optional foreign keys are `NULLABLE`.

## Quarantine pattern

Invalid rows that fail validation should not block the pipeline — route them to a quarantine table:

```python
def split_valid_invalid(
    rows: list[dict],
    validate_fn: Callable[[dict], bool],
) -> tuple[list[dict], list[dict]]:
    valid, invalid = [], []
    for row in rows:
        (valid if validate_fn(row) else invalid).append(row)
    return valid, invalid

# Write invalid rows to `dataset.quarantine_<source>_<date>`
# Alert on any non-empty quarantine table
```

Quarantine tables: same schema as target + `_quarantine_reason: STRING` column + `_quarantined_at: TIMESTAMP`.

## Review checklist

- [ ] Every new dbt model has `unique` + `not_null` on primary key
- [ ] Every source has `source_freshness` configured
- [ ] Every singular test has a clear failure comment explaining the business rule
- [ ] Python ingestion validates before writing — not after
- [ ] Volume check present on any table used downstream
- [ ] `FLOAT64` not used for financial amounts
- [ ] Schema drift check present on writes to existing tables
- [ ] Quarantine table defined for invalid rows — not silent drop
