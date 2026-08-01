---
name: code-review
description: >-
  Load for auditing existing code — Python, SQL, Terraform, GCP configs.
  Produces structured findings with severity, confidence, line references,
  and verdict. Auto-load on review requests, PR analysis, or "check this"
  tasks over existing files.
---

# Code Review

## Mindset

Hostile auditor. Goal: find reasons to reject. Silence = clean.

- Every finding cites a line number or range.
- Every finding carries a confidence level (see Step 3b). Confidence is not hedging — state the finding definitively, then label how verifiable it is.
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

Anything confirmed by this step is `certain` confidence by definition.

## Step 2 — Context map (unfamiliar code only)

If the file or module is unfamiliar, map it before reviewing. Skip if the
scope is already clear.

Go up a layer of abstraction. Using the project's domain vocabulary, produce:

- A map of all modules that call or are called by this file
- The role this module plays in the broader pipeline or system
- Any non-obvious invariants or contracts visible from callers

One paragraph max. This is orientation, not documentation.

## Step 3a — Severity matrix

Severity answers: **how bad if real?**

| Level | Criteria | Examples |
|---|---|---|
| **HIGH** | Data loss, security breach, cost explosion, or correctness failure | Hardcoded secret, missing BQ partition filter on a >1TB table, `except: pass`, SQL injection via f-string, non-idempotent write |
| **MEDIUM** | Silent failure risk, maintainability debt, or policy violation | `print()` in library code, missing type hints on public functions, `WRITE_APPEND` without dedup, `SELECT *` |
| **LOW** | Naming, structure, or minor clarity issues ruff/sqlfluff cannot auto-fix | Missing docstring on non-obvious public function, CTE that should be extracted |

## Step 3b — Confidence axis

Confidence answers: **how sure is it real?** Orthogonal to severity. Assign both.

| Level | Criteria |
|---|---|
| **certain** | Confirmed by Step 1 tooling output, or unambiguous from the reviewed lines alone |
| **probable** | Strong inference from the code, but depends on context not visible in scope (caller behaviour, table size, runtime config) |
| **possible** | Depends on an assumption about the environment that cannot be verified from the diff |

Rules:

- A `possible` finding must state the assumption it rests on, in the Fix column.
- Do not report `LOW` + `possible`. That combination is noise — drop it.
- Never inflate confidence to strengthen a case. An honest `possible` on a real risk is more useful than a false `certain`.

## Step 4 — Checklists by domain

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

Confidence note: table-size-dependent findings (partition filter, `SELECT *` cost) are `certain` only if the dry-run in Step 1 confirms the scan volume. Otherwise `probable`.

### Python engineering

Rules: see python-engineering skill. Severity assignment:

- `print()` anywhere in library/pipeline code → **MEDIUM**
- Logging library inconsistent with the project bundle's choice → **MEDIUM**
- Missing type hints on any public function or method → **MEDIUM**
- Bare `except:` or `except Exception: pass` → **HIGH**
- No explicit exception handling on entry point → **MEDIUM**
- Mutable default argument → **MEDIUM**
- `os.path` instead of `pathlib` → **LOW**
- `import *` → **MEDIUM**
- Global config object imported across modules → **MEDIUM**

Logging: enforce the logging library declared in the project bundle. Do not
assume a default. If the bundle is silent on logging, do not raise a finding.

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

## Step 5 — Human-readable output

```markdown
## Review: {file_path}

**Tooling output:**
> [Verbatim ruff/mypy/sqlfluff/bq dry-run output, or "unavailable: {reason}"]

**Findings:**

| Sev | Conf | Location | Issue | Fix |
|:---|:---|:---|:---|:---|
| HIGH | certain | L42 | Hardcoded API key in plain string | Move to Secret Manager + pydantic-settings |
| HIGH | probable | L103-L118 | MERGE without unique key — duplicate rows on retry | Add `ON t.event_id = s.event_id`. Assumes `event_id` is unique upstream. |
| MEDIUM | certain | L87 | `print()` in pipeline module | Replace with the project's logger |

**Verdict:** Mergeable | Needs Rework | Blocked

**Top priority:** [Single most critical fix before anything else]
```

**Verdict definitions:**

| Verdict | Condition |
|---|---|
| **Blocked** | At least one HIGH finding at `certain` or `probable` confidence |
| **Needs Rework** | No blocking HIGH, but one or more MEDIUM findings; or a HIGH at `possible` confidence |
| **Mergeable** | No HIGH; MEDIUM findings documented and accepted |

A HIGH finding at `possible` confidence does **not** block. It downgrades to
Needs Rework and must be named explicitly in Top priority as an assumption
requiring verification. This prevents unverifiable inference from producing
false blockers.

## Step 6 — Machine-readable envelope

When running as a subagent, the response ends with this envelope. Fenced
`json`, nothing after the closing fence. This overrides any other final-response
shape.

```json
{
  "agent": "reviewer",
  "status": "success",
  "summary": "Two HIGH findings in the MERGE path; hardcoded credential at L42.",
  "verdict": "blocked",
  "findings": [
    {
      "severity": "HIGH",
      "confidence": "certain",
      "location": "src/load.py:L42",
      "issue": "Hardcoded API key in plain string",
      "fix": "Move to Secret Manager + pydantic-settings"
    }
  ],
  "files_reviewed": ["src/load.py"],
  "tooling": { "ruff": "clean", "mypy": "2 errors", "bq_dry_run": "unavailable: no credentials" },
  "out_of_scope": [],
  "open_risks": ["Is event_id guaranteed unique upstream?"]
}
```

`severity` and `confidence` use the vocabularies of Steps 3a/3b — no second
vocabulary. `verdict` is one of `mergeable`, `needs_rework`, `blocked`.

The envelope is a projection of the Step 5 table, never a second review. Same
findings, same count, same severities. If they disagree, the envelope is wrong.

Emit it even when there are no findings: `"findings": []`, `"verdict": "mergeable"`.

## Scope rules

- Review only what is in the diff or the file passed. Do not refactor unrelated code.
- If a finding is outside scope, put it in `out_of_scope` rather than blocking.
- Do not upgrade syntax versions (e.g. forcing `type` keyword on 3.10 code) — flag missing type hints instead.
