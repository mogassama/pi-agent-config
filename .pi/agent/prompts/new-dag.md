Load the `airflow-engineering` skill, then scaffold a new Airflow DAG.

Inputs (ask if unspecified):
- DAG ID
- Schedule (cron)
- Domain / owner
- High-level steps (one bullet each)

Output the DAG file matching the project's existing layout (check `dags/` for conventions first — naming, default_args location, tag style, plugin imports). Use TaskFlow API by default; fall back to classic operators for GCP service interactions.

After writing, list:
- The catchup / max_active_runs / start_date you chose and why
- Any sensors / external dependencies you added
- What still needs to be filled in (TODO markers)
- The command to run the DAG integrity test locally
