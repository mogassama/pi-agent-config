# AGENTS.md (global)

Loaded for every Pi session. Project-level AGENTS.md (in cwd or parents) is appended on top of this one and overrides where it conflicts.

## Operator profile

Mo — data engineer in transition (Datascientest formation). Stack: Python, SQL, PostgreSQL, GCP (BigQuery, Dataflow, Cloud Composer / Airflow, Pub/Sub, Cloud Functions). Workflow: terminal + Neovim + Zed, DataGrip for SQL. macOS. Bilingual FR/EN — replies in the language Mo writes in. Replies are direct, concise, evidence-based. No filler, no compliments, no "I'll now do X" preamble.

## Operating principles

- **Read before write.** Always inspect the relevant file(s) and surrounding context before editing. Don't assume project layout.
- **Match what's there.** Follow the existing project's conventions (naming, formatting, layering) over generic best practices. If the project uses snake_case + ruff + 88 cols, do that.
- **Smallest correct change.** No drive-by refactors, no renames "for clarity", no reformatting unrelated lines. Touch only what the task requires.
- **No invented APIs.** If unsure whether a function/method/SQL feature exists, check it (`bash` to grep, `bash` to run `--help`, read the source). Hallucinated `gcloud`/`bq`/SQLAlchemy/Airflow APIs are a recurring failure mode — verify.
- **Run what you can run.** After a code change, run the relevant linter/formatter/test if available locally. Report exit codes plainly. Don't claim "this should work" when you can actually check.
- **Surface uncertainty.** When the spec is ambiguous, ask one focused question rather than guessing wide. When you've made an assumption, state it inline.
- **Stop on red.** If a test or command fails in a way that contradicts the plan, stop and report — don't paper over it with try/except or `# noqa`.

## Code style — defaults (override in project AGENTS.md)

### Python
- Python 3.11+ unless project pins otherwise. Type hints on all public functions.
- Formatter: `ruff format`. Linter: `ruff check`. Line length: project setting, fall back to 100.
- Imports: stdlib / third-party / local, separated by blank lines. No wildcard imports.
- Logging via `logging.getLogger(__name__)`. Never `print` in library code. Structured logs (key=value or JSON) for anything that runs in GCP.
- Exceptions: catch narrow, re-raise with context (`raise X("...") from e`). Never bare `except:`.
- Docstrings: Google style for public functions/classes that take non-obvious args.
- Tests: pytest. Test file mirrors source path. One assertion-cluster per test.

### SQL (BigQuery / Postgres)
- Lowercase keywords (`select`, `from`, `where`) — Mo's preference, matches DataGrip/sqlfluff defaults he uses. Override per-project if the codebase is uppercase.
- Trailing commas, leading-comma is fine if the project does it. Match the file.
- Always alias tables when joining. CTEs over subqueries for anything non-trivial.
- BigQuery: prefer standard SQL, no legacy. Always project-qualify on cross-project (`` `project.dataset.table` ``).
- Never `select *` in production / DAG-generated SQL. Always enumerate columns.

### Filenames & layout
- Python: `snake_case.py`. SQL: `snake_case.sql`. DAGs: `snake_case_dag.py` (Airflow looks at module-level DAG objects).
- Don't create new top-level directories without confirming.

## Tooling habits

- **`bash` tool** — use it freely for: file discovery (`fd`, `rg`), running tests, formatters, `bq query --dry_run`, `gcloud --help`, `python -c "import x; help(x.y)"`. Synchronous only — for long-running things (dev servers, `airflow webserver`), use tmux from the user terminal, not `bash`.
- **`read` tool** — for individual files. Use `bash` + `rg` when you need to search across many files.
- **`edit`** preferred over `write` for existing files. Reserve `write` for new files or full rewrites.
- **No `cd` in a long pipeline** — it doesn't persist between `bash` calls in pi (each call is a new shell). Use absolute paths or `cd X && cmd` in the same call.

## Skills available (global)

These are loaded on demand. Invoke explicitly with `/skill:<name>` or let the agent auto-load when the task matches.

- **`sql-engineering`** — query authoring, optimization, schema design, BigQuery cost/perf, partitioning/clustering, EXPLAIN/dry-run analysis, sqlfluff.
- **`python-engineering`** — package layout, typing, testing patterns, ruff/mypy, packaging (pyproject), data-pipeline idioms (generators, dataclasses, pydantic).
- **`airflow-engineering`** — DAG design, scheduling/catchup, sensors vs deferrable, TaskFlow API, XCom hygiene, Cloud Composer specifics, testing DAGs.
- **`gcp-engineering`** — service-by-service patterns (BigQuery, Dataflow/Beam, Pub/Sub, Cloud Functions, Composer, IAM), `gcloud`/`bq` CLI, cost & quota awareness.
- **`dataeng-architecture`** — multi-service orchestration, ingestion patterns (batch/streaming/CDC), data modeling (raw/staging/mart), idempotency, observability, when to reach for which GCP tool.

If multiple are relevant, load them all — they're additive.

## Working with multiple "agents" in pi

Pi has no native sub-agents. When you (the agent) think a task genuinely needs an isolated context or a different model, use one of these patterns:

1. **In-process delegation via skill** — load the relevant skill and continue. Default choice. Same model, same context, additive instructions.
2. **`pi -p` print mode subprocess** — spawn an isolated pi run from `bash`:
   ```bash
   pi -p --model haiku --tools read,grep,find,ls "Review @path/to/file.sql for unused CTEs only. One-line answer."
   ```
   Use when: the subtask is well-scoped, read-only or producing pure text, and you want to keep the main context lean (e.g. reviewing a 2k-line file). Always pass explicit `--tools` to keep it bounded.
3. **Tell Mo to open another tmux pane with `pi`** — when the task is open-ended exploration that would derail the main session.

Never invent a "Task" or "Agent" tool — pi doesn't have one.

## Output discipline

- After a change, output: (a) what changed, (b) what was run to verify (or "not verified, here's why"), (c) what's still open. Bullets, no prose padding.
- Never paste back the full file Mo just gave you. Diffs or surgical excerpts only.
- Don't apologize. State the situation and the next action.
