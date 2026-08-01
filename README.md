# Pi config — data engineering setup

Personal `~/.pi/agent/` configuration for data engineering work (Python, SQL, GCP).

## Directory layout

```
~/.pi/agent/
├── AGENTS.md                        # Global instructions (loaded every session)
├── APPEND_SYSTEM.md                 # Appended to pi's default system prompt
├── README.md                        # This file
├── settings.json                    # Provider, model, subagent overrides
├── agents/
│   └── oracle-deep.md               # standalone oracle-deep agent definition
├── bin/
│   └── check-envelope               # Validate the latest subagent output contract
├── extensions/
│   ├── bash-guard/                  # Confirmation on destructive commands
│   ├── pi-project-brief/            # .pi/BRIEF.md — orientation note, injected once
│   ├── pi-bq-cost-sentinel/         # /bq-cost — BQ query cost gate
│   ├── pi-check-config/             # /check-config — config consistency check
│   ├── pi-diff-review/              # /diff-review — review commits and PRs
│   ├── pi-lint-gate/                # ruff/mypy after .py edits
│   ├── pi-session-journal/          # auto-names sessions, writes journal.md
│   └── powerline-footer/            # Status footer
├── skills/
│   ├── agent-io/SKILL.md
│   ├── python-engineering/SKILL.md
│   ├── sql-engineering/SKILL.md
│   ├── bigquery-engineering/SKILL.md
│   ├── bigquery-ops/SKILL.md
│   ├── spark-engineering/SKILL.md
│   ├── code-review/SKILL.md
│   ├── data-quality/SKILL.md
│   ├── gcp-engineering/SKILL.md
│   ├── dataeng-architecture/SKILL.md
│   ├── gcp-dataeng-architecture/SKILL.md
│   ├── dbt-engineering/SKILL.md
│   ├── airflow-engineering/SKILL.md
│   ├── iac-terraform/SKILL.md
│   ├── git-collaboration/SKILL.md
│   ├── technical-writing/SKILL.md
│   ├── diagnose/SKILL.md
│   ├── tdd/SKILL.md
│   ├── grill-me/SKILL.md
│   └── improve-codebase-architecture/SKILL.md
├── prompts/
│   ├── bq-triage.md                 # /bq-triage
│   ├── debug.md                     # /debug
│   ├── docstrings.md                # /docstrings
│   ├── handoff.md                   # /handoff
│   └── new-dag.md                   # /new-dag
└── claude/                          # in .piignore — never loaded by pi
    └── strategic-forge/             # master of the Claude.ai skill
        ├── SKILL.md
        ├── PROJECT_INSTRUCTIONS.md
        └── templates/               # the four bundle templates
```

`claude/` holds design-time assets for Claude.ai, not runtime config for pi. It is the
master copy: edit here, then re-upload to Claude.ai. Never the other way round.

`tools/` is reserved by pi. Put local executable scripts in `bin/`. Each project
that uses subagents must add `.pi-subagents/` to its own `.gitignore`; it contains
runtime artifacts, not source.

## How the pieces fit

Pi is intentionally minimal: 4 native tools (`read`, `write`, `edit`, `bash`), no MCP. Sub-agents are provided by the `pi-subagents` extension (Nicobailon). `settings.json.packages` currently pulls `npm:pi-subagents@latest` — **not pinned to a version**. The installed package is `0.39.0` (`npm ls pi-subagents --depth=0 --prefix ~/.pi/agent/npm`). An unpinned upstream update can break a session without warning; pin it in `settings.json` if that risk becomes real, and confirm the installed version from pi's `npm/` package store before changing the pin — the override schema has moved before (e.g. across v0.21) and may move again.

| Layer | What it is | Cost | When to use |
|---|---|---|---|
| **AGENTS.md** | Always-loaded global rules | In every context | Things true for every session |
| **APPEND_SYSTEM.md** | Appended to pi's system prompt | In every context | Behavioural defaults, terse framing |
| **Skills** | Loaded on description match or `/skill:name` | Zero until loaded | Domain-focused rules (SQL, Airflow, etc.) |
| **Prompt templates** | Manual via `/<name>` | Zero until invoked | Repeatable workflows |
| **Subagents** | Isolated pi runs via pi-subagents extension | Separate token budget | Context isolation, parallel review, cheap recon |

## Subagents

Configured in `settings.json` under `subagents.agentOverrides`:

| Agent | Provider/Model | Fallback (in order) | Thinking | Skills |
|---|---|---|---|---|
| `planner` | `openai-codex/gpt-5.6-sol` | `openai-codex/gpt-5.6-terra`, `claude-bridge/claude-sonnet-5` | high | dataeng-architecture, gcp-dataeng-architecture, python-engineering, airflow-engineering, dbt-engineering, iac-terraform, tdd |
| `worker` | `openai-codex/gpt-5.6-sol` | `openai-codex/gpt-5.6-terra`, `claude-bridge/claude-sonnet-5` | high | python-engineering, airflow-engineering, dbt-engineering, data-quality, iac-terraform, sql-engineering, gcp-engineering, bigquery-engineering, tdd, spark-engineering, diagnose, technical-writing |
| `reviewer` | `claude-bridge/claude-sonnet-5` | `anthropic/claude-sonnet-5` | high | code-review, python-engineering, sql-engineering, bigquery-engineering, data-quality, iac-terraform, technical-writing, airflow-engineering, spark-engineering, gcp-engineering, dbt-engineering, tdd |
| `oracle` | `google/gemini-3.1-pro-preview` | — | high | dataeng-architecture, gcp-dataeng-architecture, improve-codebase-architecture, gcp-engineering, iac-terraform, bigquery-engineering, bigquery-ops |
| `oracle-deep` | `claude-bridge/claude-opus-5` | `anthropic/claude-opus-5` | high | same as `oracle` |
| `scout` | `google/gemini-3.5-flash` | `openai-codex/gpt-5.6-luna` | off | — |

Fallback semantics in the installed version (0.39.0): pi-subagents only moves to
the next candidate when the failure message matches its retryable list — rate
limit, quota, auth, unknown/unavailable model, overload, network, 5xx. A failure
outside that list stops the run on the primary model. Re-read
`src/runs/shared/model-fallback.ts` after any unpinned upgrade.
`claude-bridge/*` draws on the Max subscription via the `pi-claude-bridge`
extension (Claude Code through the Agent SDK, see `## Extensions`); `anthropic/*` is
metered API billing — it is the last resort, and the only paid rung.

`oracle-deep` also exists as a standalone definition in `agents/oracle-deep.md`
(own model pin `anthropic/claude-opus-5`, no fallback, `systemPromptMode: replace`).
Its `skills` list is missing `bigquery-ops`, present in the `settings.json` version below —
two sources of truth for the same agent; reconcile before relying on either in isolation.

Scout is a context-construction agent, not disposable cheap recon. The bundled
`scout.md` writes `context.md`, and `worker.md` declares `defaultReads: context.md`; a
weak scout handoff therefore degrades worker output silently. Keep its high call volume
(50-200x per session) in the cost calculation, but evaluate its model on downstream
handoff quality rather than enforcing "never upgrade" as an invariant. It still receives
no skills.

### Skill loading before delegation

All builtins run `inheritSkills: false`. A skill absent from an agent's array is not
available to that agent. A loadout entry injects only the skill's name, description, and
path; it does **not** make the child read the body spontaneously. Before delegation, the
orchestrator must load every required domain skill. For agents with
`inheritProjectContext: true`, the loaded body reaches the child through inherited parent
context. Measured behavior: a reviewer launched without this step returned a generic
format and ignored the review rules; the same task after orchestrator-side loading used
the complete format and rules.

Asking a child to list its skills is not a valid diagnostic: the descriptions already
appear in its system prompt and do not prove that the bodies were loaded. Loadout criteria
per agent live in `AGENTS.md`, section "Skills available (global)".

### Turn and tool budgets

Never pass `turnBudget` or a strict `toolBudget` to a mutation-capable child (`worker`,
fix worker, reviewer with edit authority, or any custom writer). Assistant turns and tool
calls do not measure whether an implementation slice is complete, validated, or safe to
hand off. Hard caps are appropriate only for explicitly read-only scouts, reviewers, and
validators. This is also the policy documented by pi-subagents.

Budget precedence is explicit call value, then agent default, then global config. A global
`turnBudget` is therefore not a safety net against a lower call-level limit. In a measured
run, a worker stopped after 8 turns (soft limit 5 plus grace 1) even though global config
specified 20/2.

### Subagent output contract

`reviewer`, `planner`, and `oracle` end their human-readable response with a fenced JSON
envelope. The contract is defined in `APPEND_SYSTEM.md` and the `agent-io` skill; load
`agent-io` in the orchestrator before delegation so it reaches the child context.

`worker` is exempt: its bundled `worker.md` final-response template overrode all three
tested delivery mechanisms (`APPEND_SYSTEM.md`, a loaded skill body, and task text). Its
native output remains parsable: `Implemented` / `Changed files` / `Validation` /
`Open risks/questions` / `Recommended next step`. `scout` is also exempt and keeps its
native context report. Validate the latest artifact with:

```bash
~/.pi/agent/bin/check-envelope [role]
```

## Extensions

| Extension | Role |
|---|---|
| `bash-guard/` | Three levels. TOKEN: `git commit`, `gh pr merge|create` — needs a single-use `~/.pi/.allow-commit`, consumed on use, never an always-allow. HIGH: mandatory confirmation. MEDIUM: confirmation + session always-allow. |
| `pi-bq-cost-sentinel/` | Dry-runs every `bq query` issued through the `bash` tool, subagents included. <1 GB passes, 1 GB–1 TB warns, >1 TB blocks. `/bq-cost` remains for manual review of a `.sql` file. |
| `pi-lint-gate/` | `ruff` after every `.py` edit, appended to the tool result the agent reads next. `mypy` once per turn on the files touched that turn. |
| `pi-check-config/` | `/check-config` — Tier 1 blocking + Tier 2 report over skills, `AGENTS.md`, `settings.json`, `README.md`. YAML-parses every frontmatter. |
| `pi-diff-review/` | `/diff-review` — review commits and PRs |
| `pi-project-brief/` | `/brief` — writes `.pi/BRIEF.md`, a ≤40-line orientation note with no variable value in it, injected once per session. Staleness is a git diff, not a model call. Subagents follow `inheritProjectContext`; `scout` is denied. |
| `pi-session-journal/` | Names each session (`{branch} — {first_msg}`) and appends a closing entry to `journal.md` on shutdown. |
| `pi-claude-bridge` | Model provider extension — routes `claude-bridge/*` models through Claude Code via the Agent SDK, adds an `AskClaude` tool (npm) |
| `powerline-footer/` | Status footer (npm) |
| `@tmustier/pi-raw-paste` | Raw paste handling (npm) |

Git hooks (not pi extensions): `git-hooks/commit-msg` enforces Conventional Commits at the git
level, so the format holds for commits made outside the agent.

## Skills — load triggers

Skills are registered at startup (descriptions in system prompt). Bodies load on demand.

| Skill | Auto-load triggers |
|---|---|
| `agent-io` | Before delegating to planner, reviewer, or oracle; supplies the subagent output envelope contract |
| `python-engineering` | `.py` files, `pyproject.toml`, test writing, package structure |
| `sql-engineering` | Engine-agnostic SQL craft + PostgreSQL dialect (`ON CONFLICT`, indexes, `EXPLAIN ANALYZE`) |
| `bigquery-engineering` | Writing/optimising a BigQuery query — partition and cluster filters, MERGE, dedup, UNNEST, dry-run |
| `bigquery-ops` | Who can read what, why a job cost that, table/dataset/job administration, `bq` CLI |
| `spark-engineering` | `SparkSession`, DataFrame transforms, `.parquet` I/O, executor/shuffle tuning, slow/skewed/OOMing Spark jobs |
| `code-review` | Review requests, PR analysis, "check this" tasks |
| `data-quality` | Can this produced dataset be trusted — volumetry, drift, freshness, quarantine |
| `gcp-engineering` | `gcloud`, IAM, ADC and impersonation, service configuration and deployment |
| `dataeng-architecture` | Architecture questions, sizing, pipeline design — platform-agnostic decision layer |
| `gcp-dataeng-architecture` | GCP service selection, ingestion patterns, BQ recovery and cost thresholds |
| `dbt-engineering` | Files under a dbt project — `{{ ref() }}` / `{{ config() }}`, `schema.yml`, `dbt_project.yml`, dbt commands |
| `airflow-engineering` | `dags/` folder, DAG design, scheduling, Composer |
| `iac-terraform` | `.tf` files, terraform commands, GCP infrastructure provisioning |
| `git-collaboration` | Git workflow, commit, push, config repo consistency check |
| `technical-writing` | README, ADR, runbook, API docs, inline comments |
| `diagnose` | Cause unknown — "it failed since…", "it worked yesterday", intermittent errors |
| `tdd` | Test-first development, red-green-refactor, integration tests |
| `grill-me` | Stress-testing a plan or design — "grill me", "challenge mon approche" |
| `improve-codebase-architecture` | Refactoring, hidden coupling, "ball of mud", making a codebase testable |

Skill bodies are read on demand, not injected at startup — the ~300 line threshold is a
*read cost*, paid by whichever agent opens the file, not a per-session tax. Over the
threshold today: `bigquery-ops` (325 lines).
`bigquery-engineering` was 446 lines and is now split into
`bigquery-engineering` (149, conventions applied at write time) and
`bigquery-ops` (325, reference consulted on demand).

Do not remove concrete skill examples merely to reduce line count. A schema reduced to a
pointer to another document was not followed in measured runs; the same schema shown as a
JSON block was followed.

Orchestrator-only skills (`git-collaboration`, `grill-me`) are invoked with `/skill:<name>` from the main session and are intentionally absent from every sub-agent loadout in `settings.json`.

## Prompt templates

| Template | When to invoke |
|---|---|
| `/bq-triage` | Dry-run + cost analysis + rewrite of a BQ query |
| `/debug` | Explicit trigger for the `diagnose` skill loop |
| `/docstrings` | Add Google-style docstrings to a file |
| `/handoff` | Produce a model-switch brief before `/compact` |
| `/new-dag` | Scaffold a new Airflow DAG |

## Daily usage

```bash
pi                                          # interactive, all global config loaded
pi "review @dags/billing_dag.py"           # interactive with initial prompt
pi -c                                       # continue last session in this dir
pi -r                                       # browse and resume sessions
pi -p "..."                                 # one-shot, prints and exits
pi --model sonnet:high "..."               # override model + thinking level
pi --tools read,grep,find,ls "..."         # read-only mode
pi /skill:sql-engineering                   # force-load a skill
pi /bq-triage                              # invoke a prompt template
```

In-session:
- `/skill:<name>` — force-load a skill the agent didn't auto-pick
- `/<template>` — expand a prompt template
- `/reload` — pick up config changes without restart
- `/compact` — summarize older context to free up window
- `/agents` — inspect subagent config
- `/tree` — branch off any prior message

## Adding a skill

```bash
mkdir -p ~/.pi/agent/skills/<name>
cat > ~/.pi/agent/skills/<name>/SKILL.md <<'EOF'
---
name: <name>
description: One precise sentence on when to auto-load this skill. Vague descriptions trigger badly. Max 1024 chars.
---

# <Name>

## When this skill is active
...

## Rules
...

## Anti-patterns
...
EOF
```

Then `/reload` in any open pi session. Verify in the startup banner.

Rules:
- `name`: lowercase, a-z + digits + hyphens, ≤64 chars, matches parent directory name
- `description`: the only field pi uses for auto-loading — make it specific
- Body > ~300 lines: consider splitting

## Maintenance

```bash
# List all loaded skills and prompts
pi -p "list every loaded skill and prompt template by name"

# Check skill frontmatter
head -10 ~/.pi/agent/skills/<name>/SKILL.md

# Verify no import errors
pi --no-session "test"
```

**When to update a skill:** when the agent does something wrong that a rule would have prevented. Append to the relevant `## Anti-patterns` section. Don't add speculative rules.

**When to add a prompt:** when you've typed the same setup more than 3 times in a session.

**When to split a skill:** when the body exceeds ~300 lines and covers two distinct concerns.
