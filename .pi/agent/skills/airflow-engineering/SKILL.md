---
name: airflow-engineering
description: Use when designing, writing, or debugging Apache Airflow DAGs — particularly on Google Cloud Composer. Covers DAG structure, scheduling and catchup semantics, TaskFlow API vs classic operators, deferrable operators and sensors, XCom hygiene, idempotency, testing DAGs, and Composer-specific operational concerns. Trigger on any work involving dags/, .py files in an Airflow project, or scheduling questions.
---

# Airflow Engineering

## When this skill is active

You are working on an Airflow DAG, an Airflow plugin, or operational concerns of an Airflow / Cloud Composer deployment. Default version: Airflow 2.7+ (TaskFlow API available, deferrable operators stable).

## DAG anatomy — defaults

```python
from __future__ import annotations

from datetime import datetime, timedelta
from airflow.decorators import dag, task

DEFAULT_ARGS = {
    "owner": "data-eng",
    "retries": 2,
    "retry_delay": timedelta(minutes=5),
    "retry_exponential_backoff": True,
    "max_retry_delay": timedelta(minutes=30),
}

@dag(
    dag_id="example_pipeline",
    schedule="0 6 * * *",          # explicit cron, not preset strings
    start_date=datetime(2026, 1, 1),
    catchup=False,                  # default False unless backfill is intended
    max_active_runs=1,              # most pipelines aren't safe to run in parallel
    default_args=DEFAULT_ARGS,
    tags=["domain:billing", "tier:critical"],
    doc_md=__doc__,
)
def example_pipeline():
    ...

dag = example_pipeline()
```

**Hard rules:**
- **`catchup=False`** unless you've explicitly decided you want backfill on first deploy. Default-True bites everyone exactly once.
- **`max_active_runs=1`** unless the pipeline is provably stateless.
- **`start_date` is a fixed past date**, never `datetime.now()` (it would shift on every parse).
- **`schedule` as cron string**, not the deprecated `schedule_interval` and not preset names like `@daily` (cron is unambiguous across timezone changes).
- **Module-level DAG object exposed** (`dag = example_pipeline()`) — Airflow's parser looks for it.

## TaskFlow vs classic operators

- **TaskFlow (`@task`)** for Python-native logic. Cleaner, handles XCom serialization, easier to test.
- **Classic operators** (`BigQueryInsertJobOperator`, `DataflowStartFlexTemplateOperator`, etc.) for service interactions — they handle retry, timeout, and async patterns better.
- **Mixing is fine.** `@task`-produced values can be passed into operator args.

## Sensors and waits

- **Default to deferrable mode** (`mode="reschedule"` for classic, `deferrable=True` for newer ones). A poking sensor on `mode="poke"` holds a worker slot — fatal at scale.
- **Don't use a sensor when an external trigger could push.** Pub/Sub → Cloud Function → trigger DAG via REST is often cleaner than a 6-hour sensor.
- **`timeout` is mandatory.** A sensor without timeout will run forever and clog the pool.

## XCom hygiene

- XCom is for *pointers and small values* (a path, an ID, a count). Not for dataframes, not for large JSON, not for files.
- For Composer specifically, XCom backend is the metadata DB by default — a 10MB XCom slows the whole scheduler.
- For real data handoff: write to GCS (or BQ) in task A, pass the URI in XCom, read in task B.

## Idempotency

Every task must be safe to re-run. Patterns:

- **Date-partitioned writes** keyed on `{{ ds }}` or `{{ logical_date }}`. Re-running overwrites the partition.
- **`MERGE` / upsert** rather than `INSERT` for non-partitioned destinations.
- **Lock files in GCS** (`gs://.../_SUCCESS`) at the end of write tasks — downstream checks for that, not for individual files.

## Testing DAGs

- **DAG integrity test** (CI must run): import every DAG file, assert no parse errors, assert `dag.test()` works on a single date for the cheap tasks. Pattern:
  ```python
  import pytest
  from airflow.models import DagBag
  
  @pytest.fixture(scope="session")
  def dagbag():
      return DagBag(dag_folder="dags/", include_examples=False)
  
  def test_no_import_errors(dagbag):
      assert not dagbag.import_errors, dagbag.import_errors
  ```
- **Unit-test the Python tasks** (factor logic out of `@task` into pure functions, test those).
- **Don't assume Airflow's runtime in tests** — `Variable.get`, `Connection.get_connection_from_secrets` need mocking.

## Cloud Composer specifics

- **Composer 2 / 3** is what's current. Composer 1 is EOL.
- **Environment variables** via `gcloud composer environments update --update-env-variables` — these survive image upgrades, unlike `os.environ` set at runtime.
- **PyPI packages** added via `gcloud composer environments update --update-pypi-packages-from-file requirements.txt`. Triggers env rebuild — slow (~20min). Pin versions.
- **GCS DAG bucket sync** has a delay (~minutes). Don't expect instant pickup.
- **Worker pods can be killed and rescheduled** at any time — every task must tolerate restart. This is just the idempotency rule again.
- **Look at `airflow_monitoring` DAG** that Composer ships — disable it if not used (eats slots).

## Common operators (GCP)

- `BigQueryInsertJobOperator` (preferred over the deprecated `BigQueryExecuteQueryOperator`)
- `BigQueryCheckOperator`, `BigQueryValueCheckOperator` — for data-quality gates
- `GCSToBigQueryOperator`, `BigQueryToGCSOperator`
- `DataflowStartFlexTemplateOperator` (template-based; cleaner than launching jobs ad-hoc)
- `PubSubPullSensor` — deferrable variant exists, prefer that
- `CloudFunctionInvokeFunctionOperator` for orchestrating Cloud Functions

Verify the operator and its args against the installed `apache-airflow-providers-google` version (`pip show apache-airflow-providers-google`) before writing — the API has churned.

## Review checklist

- [ ] `catchup=False` unless backfill intended
- [ ] `max_active_runs` set
- [ ] `start_date` is a fixed past date
- [ ] All sensors are deferrable / `mode="reschedule"` and have a `timeout`
- [ ] XCom payloads are pointers, not data
- [ ] Tasks are idempotent (re-runnable on the same `logical_date`)
- [ ] Retries configured at default_args level, with backoff
- [ ] DAG has tags and `doc_md`

## TODO

- Project-specific naming conventions for DAG IDs (domain prefix? team prefix?)
- Composer environment-variable conventions
- Patterns for cross-DAG dependencies (Datasets vs ExternalTaskSensor vs TriggerDagRun)
