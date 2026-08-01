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
│   ├── python-engineering/SKILL.md
│   ├── sql-engineering/SKILL.md
│   ├── bigquery-engineering/SKILL.md
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

## How the pieces fit

Pi is intentionally minimal: 4 native tools (`read`, `write`, `edit`, `bash`), no MCP. Sub-agents are provided by the `pi-subagents` extension (Nicobailon). `settings.json.packages` currently pulls `npm:pi-subagents@latest` — **not pinned to a version**. Installed today: `0.38.0` (`npm ls pi-subagents`). An unpinned upstream update can break a session without warning; pin it in `settings.json` if that risk becomes real, and confirm the installed version with `npm ls pi-subagents` before changing the pin — the override schema has moved before (e.g. across v0.21) and may move again.

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

Fallback semantics on the pinned version (0.25.0): pi-subagents only moves to
the next candidate when the failure message matches its retryable list — rate
limit, quota, auth, unknown/unavailable model, overload, network, 5xx. A failure
outside that list stops the run on the primary model. The error-class filter was
removed upstream in a later version; re-read `src/runs/shared/model-fallback.ts`
before changing the pin. `claude-bridge/*` draws on the Max subscription via the `pi-claude-bridge`
extension (Claude Code through the Agent SDK, see `## Extensions`); `anthropic/*` is
metered API billing — it is the last resort, and the only paid rung.

`oracle-deep` also exists as a standalone definition in `agents/oracle-deep.md`
(own model pin `anthropic/claude-opus-5`, no fallback, `systemPromptMode: replace`).
Its `skills` list is missing `bigquery-ops`, present in the `settings.json` version below —
two sources of truth for the same agent; reconcile before relying on either in isolation.

Scout calibration: called 50-200x per session — never upgrade its model, never give it skills.

All builtins run `inheritSkills: false`. A skill absent from an agent's array does not
exist for that agent. What the array injects is name + description + path, not the body —
the body is read on demand, so a loadout entry costs one description line at startup.
Loadout criteria per agent live in `AGENTS.md`, section "Skills available (global)".

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
threshold today: none.
`bigquery-engineering` was 446 lines and is now split into
`bigquery-engineering` (152, conventions applied at write time) and
`bigquery-ops` (325, reference consulted on demand).

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
