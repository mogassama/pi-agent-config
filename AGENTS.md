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
- Docstrings: Google style for public functions/classes that take non-obvious args.
- Tests: pytest. Test file mirrors source path. One assertion-cluster per test.
- Exceptions: catch narrow, re-raise with context (`raise X("...") from e`). Never bare `except:`.
- Modules ≤ ~200 lignes. Scinder au-delà.
- `pathlib` sur `os.path` — sans exception.
- Générateurs pour les opérations sur gros volumes en mémoire.

### Logging
- Loguru exclusivement. Niveaux : `INFO` / `WARNING` / `ERROR`.
- Logs structurés avec contexte métier (`run_id`, `source`, entité traitée).
- Jamais `print()` dans du code library ou pipeline. Autorisé uniquement dans les scripts CLI one-shot.

### Architecture du code
- **Séparation pure/impure.** Les fonctions de transformation sont pures et testables sans mock. Les side-effects (écriture BQ, appels réseau, GCS) sont isolés dans des modules dédiés.
- **Configuration par injection.** `def run(project_id: str, dataset: str)` — jamais `import config`. Le code ne doit pas dépendre d'état global pour être testable et lisible par les agents.
- **Idempotence.** Toute opération sur le stockage doit pouvoir tourner deux fois sans effet de bord. `WRITE_TRUNCATE` sur la partition cible, `MERGE` avec clé unique pour les upserts.
- **Fail-Fast.** Lever une exception explicite au premier état inattendu. Pas de retour silencieux.

### SQL (BigQuery / Postgres)
- Mots-clés SQL en **MAJUSCULES** (`SELECT`, `FROM`, `WHERE`, `JOIN`, etc.).
- Colonnes et tables en `snake_case`.
- Trailing commas. CTEs (`WITH`) sur toute requête non-triviale — jamais de sous-requêtes imbriquées.
- BigQuery : SQL standard uniquement, pas de legacy. Toujours qualifier en cross-project (`` `project.dataset.table` ``).
- Jamais `SELECT *` en production ou dans du SQL généré par un DAG. Toujours énumérer les colonnes.
- Always alias tables when joining.

### Secrets
- Jamais commité, même temporairement.
- `.env` dans `.gitignore`. `.env.example` avec valeurs factices.
- Dev local : ADC (`gcloud auth application-default login`), jamais de JSON de clé de service account.
- Production : Secret Manager + service account + impersonation.

### Git
- Conventional Commits : `feat / fix / refactor / docs / chore / test` avec scope obligatoire.
- Staging ciblé uniquement : `git add <fichiers_specifiques>`, jamais `git add .`.
- Pre-commit hooks sur tout nouveau projet : `ruff`, `detect-secrets`, `end-of-file-fixer`, `trailing-whitespace`, `check-added-large-files` (`--maxkb=500`).

### Filenames & layout
- Python: `snake_case.py`. SQL: `snake_case.sql`. DAGs: `snake_case_dag.py`.
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
- **`dbt-engineering`** — materializations BigQuery, incremental patterns, tests, macros, snapshots, Composer integration, review checklist.
- **`code-review`** — structured review checklist, severity classification, multi-angle review patterns.
- **`data-quality`** — dbt test generation, pipeline assertions, schema drift detection, volumetry checks, quarantine patterns.
- **`iac-terraform`** — HCL authoring, GCP resource patterns (BQ, GCS, IAM, Cloud Run), remote backend, lifecycle rules, plan review.
- **`git-collaboration`** — conventional commits, trunk-based branching, commit workflow, security scan, dotfiles extension drift check.
- **`technical-writing`** — README, ADR, runbook, Mermaid diagrams, inline comment standards.
- **`graphify`** — codebase knowledge graph, community detection, dependency mapping, cross-document analysis.

If multiple are relevant, load them all — they're additive.

## Workflow pi — Gestion du contexte

- Lancer `/compact` à ~50% du contexte ou après chaque tâche du backlog. Ne pas attendre l'auto-compact.
- Après `/compact`, relire uniquement `INSTRUCTIONS.md` pour retrouver l'état du backlog — les autres fichiers du bundle sont déjà en cache, ne pas les réinjecter manuellement.
- Ordre d'injection pour maximiser les cache hits (stable → dynamique) :
  1. `CONVENTIONS.md` — jamais modifié en cours de session
  2. `ARCHITECTURE.md` — stable après scaffolding
  3. `DESIGN.md` — stable sauf décisions en cours de route
  4. `INSTRUCTIONS.md` — backlog vivant
- Ne jamais faire précéder un fichier du bundle d'un timestamp, session ID ou toute valeur variable : invalide le cache à chaque appel.

## Delegation with pi-subagents

This section governs delegation to subagents (extension `pi-subagents`). It supersedes the older "Working with multiple 'agents' in pi" section when the extension is installed and configured.

### Available subagents

- **`scout`** — codebase recon, file discovery, data flow tracing. Cheap (Haiku), read-only. Ne jamais upgrader son modèle — 50-200 appels/session, représente 60-80% de la facture si mal configuré.
- **`planner`** — produces implementation plans from existing context. Reads and plans, never edits. Granularité cible : une étape qu'un Worker peut exécuter en une passe.
- **`worker`** — implements approved plans. Edits files, runs validation, escalates ambiguity.
- **`reviewer`** — code review against task/plan/tests/edge cases/simplicity.
- **`oracle`** — second opinion before risky decisions. Challenges assumptions, never edits. 1-3 appels/session maximum — réserver aux arbitrages d'architecture réels.

### When to delegate

**Delegate to `reviewer` when:**
- Reviewing code over 50 lines
- Reviewing pull requests or diffs
- Multi-angle review needed (run in parallel with different focus areas)

**Delegate to `scout` when:**
- "How does X work in this codebase?" before any code change
- Finding all usages of a function/class/pattern
- Understanding cross-file data flow

**Delegate to `planner` when:**
- Multi-file implementation
- Changes touching 3+ services (e.g. DAG + transform + table schema)
- Refactors with non-trivial impact
- Always followed by orchestrator review of the plan, then `worker` for execution

**Delegate to `worker` when:**
- After `planner` produced a plan the orchestrator approved
- Mechanical implementation of a clear spec
- Bulk operations (rename across files, apply same change to N files)

**Delegate to `oracle` when:**
- Architectural fork in the road ("Dataflow vs BigQuery for this?")
- Before destructive operations (schema migrations, data deletions, IAM changes)
- When the cost of being wrong is high

### Handle inline (do NOT delegate)

- Conversational answers, explanations, decisions
- Single-line edits, typos, format fixes
- Reading a file to answer a quick question
- Coordinating between subagent results — the orchestrator's job
- The decision to delegate itself

### Never delegate

- Sensitive operations: secret rotation, prod credentials, IAM grants on production projects, `terraform apply` on prod
- Anything touching production data without explicit operator confirmation
- Decisions where the user has not yet been consulted on a fork in the road

### Parallel delegation

Use `/parallel` for:
- Reviewing one diff from multiple angles (correctness + tests + perf + cost)
- Auditing multiple unrelated parts of a codebase

Hard limit: never run more than 4 parallel subagents at once.

### Decision rule of thumb

Delegate if the task requires:
- More than 20% of remaining context window, OR
- More than 10 minutes of focused agent work, OR
- A model/skill combination different from the orchestrator's current one

### Default invocation patterns

For a new feature implementation:
```
1. scout  → understand existing structure
2. planner → produce plan
3. (operator validates plan)
4. worker  → implement
5. reviewer → verify
```

For a risky decision:
```
1. oracle  → analyze and recommend
2. (operator validates direction)
3. worker  → execute
```

For a bug investigation:
```
1. scout   → find the relevant code
2. oracle  → propose ranked hypotheses
3. (operator picks one)
4. worker  → investigate and fix
```

### What stays in the orchestrator

- All operator-facing communication
- All decision points
- Final synthesis of subagent outputs
- Skill loading for inline work that doesn't warrant delegation
- The conversation history and journal

## Output discipline

- After a change, output: (a) what changed, (b) what was run to verify (or "not verified, here's why"), (c) what's still open. Bullets, no prose padding.
- Never paste back the full file Mo just gave you. Diffs or surgical excerpts only.
- Don't apologize. State the situation and the next action.
