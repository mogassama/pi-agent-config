Load the `airflow-engineering` skill, then scaffold a new Airflow DAG.

**Inputs — ask if unspecified:**

- `dag_id` — snake_case, matches the pipeline domain and layer (e.g. `stg_billing_pipeline`)
- `schedule` — cron expression or Dataset trigger
- `domain` / `owner` — used for tags and default_args
- High-level steps — one bullet each, becomes one `@task` or operator per step

**Before writing anything:**

Check `dags/` for existing conventions:
- Naming pattern (prefix, suffix)
- `default_args` location (module-level dict vs inline)
- Tag style (`domain:X`, `layer:X`, or freeform)
- Which GCP operators are already imported (reuse, don't introduce new imports for services already used)

**Operator selection:**

- `@task` (TaskFlow) — for Python logic, data transformation, branching
- `BigQueryInsertJobOperator` — for SQL execution on BigQuery
- `BigQueryTablePartitionSensor(deferrable=True)` — for waiting on BQ partitions
- `CloudRunExecuteJobOperator` — for triggering Cloud Run Jobs
- `GCSObjectExistenceSensor(deferrable=True)` — for waiting on GCS files
- Never invent a GCP operator not already used in the project — verify with `rg "Operator" dags/` first

**Tags format:** `["domain:<domain>", "layer:<layer>", "priority:<high|normal|low>"]`

**After writing, list:**

- `catchup` / `max_active_runs` / `start_date` — values chosen and one-line justification for each
- Sensors or external dependencies added and why
- `# TODO` markers left in the file — one line per marker explaining what needs filling
- DAG integrity test command:
  ```bash
  uv run python -c "from airflow.models import DagBag; b = DagBag('dags/', include_examples=False); print(b.import_errors or 'OK')"
  ```
