---
name: data-quality
description: >-
  Load when the question is whether a produced dataset can be trusted —
  volumetry assertions, schema drift, freshness, null and uniqueness
  guarantees, quarantine of invalid rows. Intent-scoped, not file-scoped. It
  answers "how do I know this output is correct", not how to write the
  transformation that produced it. Auto-load on "did we lose rows", "is this
  table complete", drift or freshness checks, and validation-before-write
  design.
---

# Data Quality

## Principles

- **Shift Left.** Quality starts at ingestion. Test at the staging layer before data reaches marts.
- **Zero Trust.** Every production table needs at minimum: uniqueness + not-null on primary key + row count assertion.
- **Fail loud.** A silent bad number is worse than a failed pipeline. Raise, don't swallow.

For dbt-specific test YAML and source freshness config, see dbt-engineering skill.

## Python pipeline — inline assertions

Assert before writing. Never write first and check later.

```python
def validate_batch(df: list[dict], source: str) -> None:
    if not df:
        raise ValueError(f"Empty batch from {source} — aborting write")

    null_ids = [r for r in df if r.get("id") is None]
    if null_ids:
        raise ValueError(
            f"{len(null_ids)} rows with null id in {source} — aborting"
        )
```

Pattern: validate → write. Never write → validate after. Log the outcome with
the project's logger — see python-engineering for the two configurations.

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

## Review delta

*Everything above is authoring guidance, injected for both worker and reviewer.
This section is injected for the reviewer only. It replaces the former
`## Review checklist`.*

**Floor.** For a diff under ~10 lines, report only HIGH findings. A test added
to an already-covered model does not warrant a coverage review.

### Severity assignment

Definitions live in `code-review`. dbt test syntax is weighed in
`dbt-engineering`.

| Breach | Severity |
|:--|:--|
| Invalid rows dropped silently instead of quarantined | **HIGH** |
| `FLOAT64` used for a financial amount | **HIGH** |
| Validation performed after the write instead of before | **HIGH** |
| No `unique` + `not_null` on a model's primary key | MEDIUM |
| No volume check on a table consumed downstream | MEDIUM |
| No schema drift check on a write to an existing table | MEDIUM |
| Source with no `source_freshness` configured | MEDIUM |
| Singular test with no comment stating the business rule it enforces | LOW |

### Traps a diff does not show

- **A quarantine table nobody reads.** The rows are captured, the pipeline is
  green, and the data is still missing downstream. Check that something
  consumes or alerts on the quarantine, not just that it exists.
- **A volume assertion with a threshold copied from another table.** It passes
  forever and detects nothing. The bound must come from this table's history.
- **A `not_null` test on a column that is never null because it defaults.** The
  test is green and the default is the bug.
- **Freshness configured against the load timestamp rather than the event
  timestamp.** A stalled source keeps looking fresh as long as an empty load
  runs on schedule.

### Verdict

`blocked` requires at least one HIGH at `certain` or `probable`. A HIGH at
`possible` downgrades to `needs_rework` and must be named in `top_priority`.
With no finding above LOW, `approved`.
