---
name: airflow-engineering
description: Load for Airflow DAG authoring, scheduling, operator selection, testing, and Cloud Composer operations. Auto-load on dags/ folder tasks, DAG design questions, scheduling issues, Composer environment management, or Airflow operator selection.
---

# Airflow Engineering

## Conventions

- DAG IDs, task IDs, variable names, log messages: English only.
- Use TaskFlow API (`@dag`, `@task`) for all Python logic — no classic operators for custom Python.
- DAGs are configuration, not logic. Zero business logic in DAG files. Logic lives in external modules.
- XComs carry pointers (URIs, IDs, metadata) — never DataFrames, query results, or large JSON.
- Idempotent by design: re-running any task for the same `logical_date` must produce the same result.

## Composer version baseline

Composer 2 with Airflow 2.x is stable GA. Python version is fixed by the Composer image — as of mid-2026, supported versions are 3.11 and 3.12 depending on the image channel. Do not assume 3.13 is available. Check with:

```bash
gcloud composer environments describe ENV_NAME \
  --location=europe-west1 \
  --format="value(config.softwareConfig.imageVersion)"
```

Composer 3 is available in select regions in preview — verify before targeting in production.

## DAG template (canonical)

```python
from __future__ import annotations

from datetime import datetime, timedelta

from airflow.decorators import dag, task
from loguru import logger
import sys

# Loguru → stdout so logs appear in Airflow task logs
# Note: Loguru does not integrate with Airflow's native logging handler.
# This workaround routes to stdout which Airflow captures.
# For structured GCP Cloud Logging, use serialize=True.
logger.remove()
logger.add(sys.stdout, format="{level} | {name} | {message}", level="INFO")


@dag(
    dag_id="stg_billing_pipeline",
    schedule="0 6 * * *",
    start_date=datetime(2026, 1, 1),
    catchup=False,
    max_active_runs=1,
    tags=["domain:billing", "layer:staging", "priority:high"],
    default_args={
        "retries": 3,
        "retry_delay": timedelta(minutes=5),
        "retry_exponential_backoff": True,
    },
)
def billing_pipeline() -> None:
    @task
    def extract() -> str:
        logger.info("Extracting data", source="billing_api")
        return "gs://bucket/raw/billing/2026-01-15.parquet"

    @task
    def transform(gcs_uri: str) -> str:
        with logger.contextualize(gcs_uri=gcs_uri):
            logger.info("Transforming data")
            # Call external module — no logic here
            from src.billing import transform_billing
            output_uri = transform_billing(gcs_uri)
            return output_uri

    transform(extract())


dag_obj = billing_pipeline()
```

## Loguru in Airflow — honest integration

Airflow uses its own logging system (Python `logging` module routed to task log files and the UI). Loguru does **not** integrate natively with Airflow's log handler.

Workaround — route Loguru to stdout, which Airflow captures:

```python
logger.remove()
logger.add(sys.stdout, format="{level} | {name} | {message}", level="INFO")
```

Limitations:
- Logs appear in task stdout, not in Airflow's structured log handler.
- `@logger.catch` works but tracebacks go to stdout, not the Airflow exception mechanism.
- For full Airflow UI integration, use Python's `logging.getLogger(__name__)` in operators — Loguru only in external modules called from tasks.

Recommendation: use Loguru in the business logic modules (`src/`), use standard `logging` in the DAG file itself if Airflow UI log visibility matters.

## Operator selection

| Need | Operator | Notes |
|---|---|---|
| Run BigQuery SQL | `BigQueryInsertJobOperator` | Use `job_id` for idempotency |
| Wait for BQ partition | `BigQueryTablePartitionSensor` | Use `deferrable=True` |
| Wait for GCS file | `GCSObjectExistenceSensor` | Use `deferrable=True` |
| Run Python logic | `@task` (TaskFlow) | Import logic from `src/` |
| Trigger Cloud Run Job | `CloudRunExecuteJobOperator` | Preferred over Cloud Functions for heavy tasks |
| Pub/Sub publish | `PubSubPublishMessageOperator` | Pass message content via XCom pointer |

**Deferrable operators:** mandatory for any task that waits >15 min. Deferrable tasks release the worker slot while waiting — critical for Composer cost control. Requires Triggerer nodes enabled in the Composer environment.

```python
BigQueryTablePartitionSensor(
    task_id="wait_for_partition",
    project_id="{{ var.value.gcp_project }}",
    dataset_id="raw",
    table_id="orders",
    partition_id="{{ ds_nodash }}",
    deferrable=True,
    timeout=3600,
)
```

## Scheduling patterns

### Time-based (cron)
```python
schedule="0 6 * * *"  # Daily at 06:00 UTC
```

### Data-aware (Dataset triggers)
```python
from airflow.datasets import Dataset

raw_orders = Dataset("gs://bucket/raw/orders/")

@dag(schedule=[raw_orders], ...)
def transform_orders() -> None:
    ...
```

Use Dataset scheduling when the downstream DAG should trigger on data availability, not on a fixed clock. Decouples pipelines cleanly.

## XCom rules

- XComs carry: GCS URIs, BQ table references, row counts, status strings. Nothing else.
- Never pass DataFrames, query results, or payloads >48 KB through XCom.
- Use `AIP-58` Object Storage path for seamless GCS reference:
  ```python
  from airflow.io.path import ObjectStoragePath
  path = ObjectStoragePath("gs://bucket/raw/orders/2026-01-15.parquet")
  ```

## Connections & secrets

Never hardcode credentials in DAG files.

```python
# Use Airflow connections
from airflow.hooks.base import BaseHook
conn = BaseHook.get_connection("my_gcp_conn")

# Or Airflow Variables for non-sensitive config
from airflow import models
project_id = models.Variable.get("gcp_project_id")
```

Secrets backend: configure Composer to use Secret Manager as the secrets backend — secrets never stored in Airflow metadata DB.

## Dependencies (Composer)

```bash
# Correct workflow for Composer PyPI packages
# 1. Maintain requirements.in with unpinned deps
# 2. Compile to requirements.txt
uv pip compile requirements.in -o requirements.txt

# 3. Update Composer environment
gcloud composer environments update ENV_NAME \
  --location=europe-west1 \
  --update-pypi-packages-from-file=requirements.txt
```

## Testing DAGs

```python
# tests/test_billing_dag.py
from airflow.models import DagBag

def test_dag_loads_without_errors():
    dag_bag = DagBag(dag_folder="dags/", include_examples=False)
    assert "stg_billing_pipeline" in dag_bag.dags
    assert len(dag_bag.import_errors) == 0

def test_dag_structure():
    dag_bag = DagBag(dag_folder="dags/", include_examples=False)
    dag = dag_bag.get_dag("stg_billing_pipeline")
    assert dag.catchup is False
    assert dag.max_active_runs == 1
    task_ids = [t.task_id for t in dag.tasks]
    assert "extract" in task_ids
    assert "transform" in task_ids
```

Run with `uv run pytest tests/` — no Airflow server needed for DAGBag tests.

## Idempotency checklist

Every task must answer yes to: "If I run this twice for the same `logical_date`, is the output identical?"

- BQ writes: `WRITE_TRUNCATE` on partition or `MERGE` with unique key — never blind `WRITE_APPEND`.
- GCS writes: deterministic output path including `logical_date` — overwrite is safe.
- API calls: idempotency key if the API supports it.
- Use `logical_date` (Airflow 2.2+), not the deprecated `execution_date`.

## Review checklist

- [ ] DAG ID and task IDs in English, snake_case
- [ ] `catchup=False` unless explicitly required with justification
- [ ] `max_active_runs=1` on pipelines with shared resources
- [ ] No business logic in DAG file — external modules only
- [ ] XComs carry pointers only — no DataFrames or large payloads
- [ ] Sensors use `deferrable=True` for waits >15 min
- [ ] Triggerer enabled in Composer environment
- [ ] Connections via Airflow Connection objects or Secret Manager — no hardcoded credentials
- [ ] `logical_date` used, not `execution_date`
- [ ] BQ writes idempotent — WRITE_TRUNCATE or MERGE, never blind WRITE_APPEND
- [ ] DAGBag test present and passes
- [ ] PyPI deps managed via `uv pip compile` + `gcloud composer environments update`
