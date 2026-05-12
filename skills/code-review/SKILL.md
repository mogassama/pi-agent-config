---
name: code-review
description: Load for auditing existing code — Python, SQL, Terraform, GCP configs. Produces structured findings with severity, line references, and verdict. Auto-load on review requests, PR analysis, or "check this" tasks over existing files.
---

# Code Review

## Mindset

Hostile auditor. Goal: find reasons to reject. Silence = clean.

- Every finding cites a line number or range.
- Prioritize impact over style. Style nits that ruff/sqlfluff can auto-fix are not findings.
- No "Consider..." or "Maybe...". Definitive statements only.
- Do not paraphrase the code. Do not refactor outside the scope of the reviewed diff.
- Do not praise. Report findings and verdict.

## Step 1 — Automated pre-check

Run before manual review. Report verbatim output or "unavailable + reason".

```bash
# Python
uv run ruff check {file}
uv run mypy {file}

# SQL
sqlfluff lint --dialect bigquery {file}

# BigQuery dry-run (correct invocation)
bq query --dry_run --use_legacy_sql=false "$(cat {file})"
```

## Step 2 — Severity matrix

| Level | Criteria | Examples |
|---|---|---|
| **HIGH** | Data loss, security breach, cost explosion, or correctness failure | Hardcoded secret, missing BQ partition filter on a >1TB table, `except: pass`, SQL injection via f-string, non-idempotent write |
| **MEDIUM** | Silent failure risk, maintainability debt, or policy violation | `print()` or `logging` instead of Loguru, missing type hints on public functions, `WRITE_APPEND` without dedup, `SELECT *` |
| **LOW** | Naming, structure, or minor clarity issues ruff/sqlfluff cannot auto-fix | Missing docstring on non-obvious public function, CTE that should be extracted |

## Step 3 — Checklists by domain

### Security & identity

Rules: see gcp-engineering skill. Severity assignment:

- Hardcoded secrets, tokens, passwords, or `service-account.json` references → **HIGH**
- `roles/owner` or `roles/editor` granted → **HIGH**
- f-string interpolation in SQL queries → **HIGH**
- `os.system()` or `subprocess.call()` with unsanitized input → **HIGH**
- ADC not used in GCP code → **MEDIUM**

### Data engineering & costs

Rules: see sql-engineering skill. Severity assignment:

- `SELECT *` in production or pipeline SQL → **MEDIUM**
- Partitioned table queried without partition filter → **HIGH**
- `WHERE DATE(timestamp_col)` on a partition column → **HIGH**
- `WRITE_APPEND` without dedup strategy → **HIGH**
- Large dataset loaded into a list instead of streamed via generator → **MEDIUM**
- `download_as_bytes()` on large GCS object → **MEDIUM**
- Missing `MERGE` unique key → **HIGH**

### Python engineering

Rules: see python-engineering skill. Severity assignment:

- `print()` or `logging.getLogger` anywhere in library/pipeline code → **MEDIUM**
- Missing type hints on any public function or method → **MEDIUM**
- Bare `except:` or `except Exception: pass` → **HIGH**
- No `logger.catch` or explicit exception handling on entry point → **MEDIUM**
- Mutable default argument → **MEDIUM**
- `os.path` instead of `pathlib` → **LOW**
- `import *` → **MEDIUM**
- Global config object imported across modules → **MEDIUM**

### Terraform / IaC

Rules: see iac-terraform skill. Severity assignment:

- Hardcoded project IDs or credentials in `.tf` files → **HIGH**
- Missing `lifecycle { prevent_destroy = true }` on stateful resources (BQ datasets, GCS buckets) → **MEDIUM**
- Overly broad IAM bindings (`allUsers`, `allAuthenticatedUsers`) → **HIGH**
- No remote backend configured → **MEDIUM**
- Resources not tagged/labeled for cost attribution → **LOW**

### GCP configs

Rules: see gcp-engineering skill. Severity assignment:

- Pub/Sub subscription without dead-letter topic → **MEDIUM**
- Cloud Function with no max-instances limit → **MEDIUM**
- BigQuery dataset with no expiration on staging tables → **LOW**

## Step 4 — Output format

```markdown
## Review: {file_path}

**Tooling output:**
> [Verbatim ruff/mypy/sqlfluff/bq dry-run output, or "unavailable: {reason}"]

**Findings:**

| Sev | Location | Issue | Fix |
|:---|:---|:---|:---|
| HIGH | L42 | Hardcoded API key in plain string | Move to Secret Manager + pydantic-settings |
| MEDIUM | L87 | `logging.getLogger` used | Replace with `from loguru import logger` |

**Verdict:** Mergeable | Needs Rework | Blocked

**Top priority:** [Single most critical fix before anything else]
```

**Verdict definitions:**
- **Mergeable** — no HIGH findings, MEDIUM findings documented and accepted
- **Needs Rework** — one or more MEDIUM findings that must be resolved
- **Blocked** — any HIGH finding present

## Scope rules

- Review only what is in the diff or the file passed. Do not refactor unrelated code.
- If a finding is outside scope, note it as "Out of scope — recommend follow-up" rather than blocking.
- Do not upgrade syntax versions (e.g. forcing `type` keyword on 3.10 code) — flag missing type hints instead.
