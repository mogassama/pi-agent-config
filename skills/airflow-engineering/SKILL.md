---
name: airflow-engineering
description: Expert Airflow/Composer orchestration. Focus on TaskFlow API, deferrable operators, Dataset scheduling, and Loguru integration. Trigger on dags/ folder, DAG design, or scheduling issues.
---

# Airflow Engineering (2026 Edition)

## Execution Rules

- **Language:** DAG IDs, task IDs, and logs MUST be in **English**.
- **Modernity:** Use TaskFlow API (`@dag`, `@task`) for Python logic.
- **Tooling:** Use `uv pip compile` to manage Composer `requirements.txt`.

## Modern DAG Template (Python 3.13+)

```python
from __future__ import annotations
from datetime import datetime, timedelta
from airflow.decorators import dag, task
from loguru import logger
import sys

# Setup Loguru for Airflow UI compatibility
logger.remove()
logger.add(sys.stdout, format="{level} | {message}", level="INFO")

@dag(
    dag_id="stg_billing_pipeline",
    schedule="0 6 * * *",           # Explicit Cron
    start_date=datetime(2026, 1, 1),
    catchup=False,                  # Safe default
    max_active_runs=1,
    tags=["domain:billing", "priority:high"],
    default_args={
        "retries": 3,
        "retry_delay": timedelta(minutes=5),
    }
)
def billing_pipeline():
    @task
    def process_data() -> str:
        logger.info("Starting English-logged process...")
        return "gs://bucket/data.parquet"

    process_data()

dag_obj = billing_pipeline()
```

## Deferrable & Async Patterns (Resource Saving)

- **Mandatory Deferrable:** For any task waiting > 15min (Sensors, BigQuery jobs), use `deferrable=True`.
- **Sensors:** Use BigQueryTablePartitionSensor in deferrable mode to wait for data without consuming a worker slot.
- **Triggerers:** Ensure your Composer environment has "Triggerer" nodes enabled to handle async tasks.

## XCom & Data Handoff

- **Pointers Only:** XCom is for URIs/Metadata only. Never store DataFrames or large JSON.
- **Object Storage:** Use GCSHook or BigQueryHook to move data; pass the uri between tasks.
- **AIP-58 (2026):** Use Airflow Object Storage for seamless GCS integration: `path = ObjectStoragePath("gs://bucket/key")`.

## Data-Aware Scheduling (Datasets)

Instead of time-based scheduling, use Datasets to trigger DAGs when a table is updated:

```python
from airflow.datasets import Dataset
raw_data = Dataset("gs://bucket/raw_files")

@dag(schedule=[raw_data], ...)
def downstream_dag():
    ...
```

## Loguru in Airflow

- Use `logger.contextualize(dag_id=dag_id, task_id=task_id)` to inject context.
- All log messages must be in English for global observability.
- Use `@logger.catch` inside tasks to capture full tracebacks in the Airflow UI.

## Cloud Composer 3 Best Practices

- **Environment Variables:** Set via gcloud composer or Terraform, never hardcoded.
- **Workload Identity:** Use GCP Service Accounts tied to Kubernetes namespaces (no JSON keys).
- **Resource Management:** Set cpu and memory at the task level for heavy Python processing to avoid crashing the worker.

## Review Checklist

- [ ] English Only: DAG/Task IDs and logs.
- [ ] Catchup: Set to False.
- [ ] Deferrable: Used for sensors and long-running GCP jobs.
- [ ] Idempotency: Re-running a task for the same logical_date overwrites/upserts properly.
- [ ] Loguru: Correctly imported and configured.
- [ ] Requirements: Managed via uv.

