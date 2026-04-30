---
name: code-review
description: >-
    Use when reviewing existing code for issues — bugs, security risks, performance problems, anti-patterns, missing tests, or maintainability concerns. Multi-language: Python, SQL (BigQuery / Postgres), Airflow DAGs, Terraform, shell. Data-engineering-aware: catches partition-filter omissions, idempotency violations, IAM over-permissioning, cost traps. Trigger when asked to "review", "audit", "check", "find issues in", or "evaluate" a file or pull request. Do NOT trigger for writing new code or refactoring — those use the language-specific skills (python-engineering, sql-engineering, etc.).
---

# Code Review

## When this skill is active

You are evaluating existing code, not writing new code. Mode: skeptical reader, not collaborator. Your job is to find what's wrong, not to validate.

For language-specific authoring guidance, defer to the relevant skill (`python-engineering`, `sql-engineering`, `airflow-engineering`, `gcp-engineering`). This skill governs **how** to review; those govern **what's correct**.

## Principles

1. **Severity-ranked, not exhaustive.** A list of 50 nits is worse than 3 well-prioritized findings. The operator decides what to fix.
2. **Concrete over vague.** "Could be more efficient" is useless. "Line 42: `select *` on a non-partitioned 200GB table — replace with explicit columns and add `WHERE event_date = ...`" is useful.
3. **Cite line numbers always.** Every finding maps to `file:line` or `file:line-range`.
4. **Run tools first, then read.** Linters, type checkers, and dry-runs catch the boring stuff for free. Don't waste cognitive effort on what `ruff` would flag.
5. **No personal taste.** If the project's conventions are consistent, don't impose your own. A finding is a finding only if it violates the loaded skill's rules, the project's `AGENTS.md`, or universal correctness/security/performance criteria.
6. **Don't paraphrase the code back.** The author has the file open. Point to what's wrong, not what's there.

## Severity scale

| Level | Meaning | Examples |
|---|---|---|
| **high** | Bug, security flaw, data corruption risk, prod cost trap, silent failure | SQL injection, missing partition filter on 1TB table, `except: pass`, race condition, secret in code |
| **medium** | Anti-pattern, missing test, maintainability concern, deprecated API | No type hints on public function, `print` in library code, `BigQueryExecuteQueryOperator` (deprecated), magic number, untested error path |
| **low** | Style nit, naming, comment quality, minor inefficiency | Inconsistent quoting, unclear variable name, missing docstring on private helper |

If a category produces zero findings, **do not list it**. Silence on a category means clean.

## Process

### 1. Identify scope and load supporting skills

Determine the file type(s) being reviewed and load the relevant authoring skill(s) for their checklists:

- `.py` → `python-engineering`
- `.sql` → `sql-engineering`
- Airflow DAG file (decorator `@dag` or `dag = DAG(...)`) → `airflow-engineering` + `python-engineering`
- Code touching `google.cloud.*`, `bq`, `gcloud`, `google_*` Terraform → `gcp-engineering`
- dbt model under `models/` → `sql-engineering` + `dataeng-architecture`
- Multi-service architecture or design doc → `dataeng-architecture`

Multiple loads are fine — they're additive.

### 2. Run available tooling, capture output

Before reading the code yourself, run:

- **Python:** `ruff check {file}` then `mypy {file}` (if `mypy` config detected in pyproject.toml or mypy.ini)
- **SQL:** `sqlfluff lint --dialect <bigquery|postgres> {file}` (detect from project's `.sqlfluff` or context)
- **Terraform:** `terraform fmt -check -diff {file}` and `terraform validate` if init'd
- **Shell:** `shellcheck {file}`
- **Airflow DAG:** at minimum `python -c "import ast; ast.parse(open('{file}').read())"` to catch parse errors. If Airflow is installed locally, `python {file}` to catch DAG-build errors.
- **BigQuery SQL specifically:** `bq query --use_legacy_sql=false --dry_run < {file}` to surface bytes-processed and obvious errors (only if `bq` CLI is configured for the right project).

Capture output verbatim. Tool not installed → note "tool unavailable" and continue.

### 3. Walk the loaded skill's review checklist

Each authoring skill has a `## Review checklist` section. Apply it methodically. Don't add criteria that aren't there — and don't skip ones that are.

### 4. Universal checks (apply to every language)

These run regardless of which skill is loaded:

**Security**
- Hardcoded secrets, API keys, tokens, passwords (use Secret Manager / env vars)
- SQL/shell injection from user input (string concat into query/command)
- Permissive IAM (`roles/owner`, `roles/editor` on workload accounts; `0.0.0.0/0` in security groups)
- Service account JSON keys committed or referenced from local paths
- Disabled SSL/TLS verification (`verify=False`, `--insecure`)

**Data correctness**
- Implicit type coercion silently dropping data (e.g. `int(x)` on potentially-null x)
- Date/timezone handling (naive vs aware datetime, partition boundary off-by-one)
- Off-by-one in pagination, batching, slicing
- Operations that aren't idempotent in pipelines (re-runnable safely?)
- Floating-point comparison without tolerance, money in float

**Failure modes**
- Bare `except:` or `except Exception:` outside top-level entry points
- Unbounded retries / infinite loops
- Missing timeouts on network calls, sensors, queries
- Resource leaks (file handles, DB connections, subscribers not closed)
- No dead-letter / error path for async/event-driven code

**Cost & performance** (especially GCP)
- Full table scans (no partition/cluster filter on partitioned tables)
- `SELECT *` on wide tables in production code
- N+1 query patterns
- Unbounded result sets loaded into memory
- Polling sensors in `mode="poke"` instead of deferrable
- Cross-region data transfers
- Cloud Function with `min_instances` set high without need

**Maintainability**
- Functions > ~50 lines doing multiple things
- Nesting depth > 3
- Magic numbers / strings without explanation
- Dead code, unused imports (linter should catch — flag if it didn't)
- Misleading names (function called `get_*` that mutates, etc.)

### 5. Output structure

```markdown
## Review: {file_path}

**Tooling output:**
[verbatim from step 2, fenced. Note "skipped: tool unavailable" if applicable.]

**Findings:**

| Severity | Location | Issue | Suggested fix |
|----------|----------|-------|---------------|
| high     | foo.py:42 | Concise statement of the problem | Concrete change |
| medium   | foo.py:78-91 | ... | ... |
| low      | foo.py:103 | ... | ... |

**Summary:** N high, M medium, K low.
**Most important:** [one sentence — which finding to fix first and why]
**Verdict:** [mergeable as-is | mergeable after high+medium fixes | needs rework]
```

If structural rewrite is needed (not just patches), say so up front, skip the table, and propose the rewrite direction. Don't bury a "by the way you should restructure this" under 20 line-level nits.

If file is clean: one line — `"No issues found beyond what tooling reported (see above)."`

## Anti-patterns in your own review

- **Listing every nit you can think of** to look thorough. Quality over quantity.
- **"Consider…" / "Maybe…" / "You might want to…"** — vague. Either it's an issue or it isn't.
- **Suggesting changes that introduce new dependencies** without flagging the trade-off.
- **Reviewing code you couldn't run** without saying so.
- **Praising code.** This is review, not encouragement. Silence = passes.
- **Mixing review and design discussion.** If you want to challenge the approach, do that separately, before line-level review.

## TODO

- Project-specific checklists once Mo has stable conventions
- Patterns for reviewing dbt models specifically (tests, refs, materialization choices)
- Patterns for reviewing Terraform GCP modules
