# Pi config — data engineering setup

Personal `~/.pi/agent/` configuration for data engineering work (Python, SQL, GCP).

## Directory layout

```
~/.pi/agent/
├── AGENTS.md                        # Global instructions (loaded every session)
├── APPEND_SYSTEM.md                 # Appended to pi's default system prompt
├── README.md                        # This file
├── settings.json                    # Provider, model, subagent overrides
├── extensions/
│   ├── bash-guard/                  # Confirmation on destructive commands
│   └── graphify-context.ts          # Injects GRAPH_REPORT.md at session start
├── skills/
│   ├── python-engineering/SKILL.md
│   ├── sql-engineering/SKILL.md
│   ├── code-review/SKILL.md
│   ├── data-quality/SKILL.md
│   ├── gcp-engineering/SKILL.md
│   ├── dataeng-architecture/SKILL.md
│   ├── dbt-engineering/SKILL.md
│   ├── airflow-engineering/SKILL.md
│   ├── iac-terraform/SKILL.md
│   ├── git-collaboration/SKILL.md
│   ├── technical-writing/SKILL.md
│   └── graphify/SKILL.md
└── prompts/
    ├── bq-triage.md                 # /bq-triage
    ├── debug.md                     # /debug
    ├── docstrings.md                # /docstrings
    ├── handoff.md                   # /handoff
    ├── new-dag.md                   # /new-dag
    ├── review.md                    # /review
    ├── review-sql.md                # /review-sql
    └── subagent-review.md           # /subagent-review
```

## How the pieces fit

Pi is intentionally minimal: 4 native tools (`read`, `write`, `edit`, `bash`), no MCP. Sub-agents are provided by the `pi-subagents` extension (v0.21.1, Nicobailon).

| Layer | What it is | Cost | When to use |
|---|---|---|---|
| **AGENTS.md** | Always-loaded global rules | In every context | Things true for every session |
| **APPEND_SYSTEM.md** | Appended to pi's system prompt | In every context | Behavioural defaults, terse framing |
| **Skills** | Loaded on description match or `/skill:name` | Zero until loaded | Domain-focused rules (SQL, Airflow, etc.) |
| **Prompt templates** | Manual via `/<name>` | Zero until invoked | Repeatable workflows |
| **Subagents** | Isolated pi runs via pi-subagents extension | Separate token budget | Context isolation, parallel review, cheap recon |

## Subagents

Configured in `settings.json` under `subagents.agentOverrides`:

| Agent | Model | Thinking | Skills |
|---|---|---|---|
| `planner` | claude-sonnet-4-6 | high | dataeng-architecture, gcp-engineering, dbt-engineering |
| `worker` | claude-sonnet-4-6 | medium | python-engineering, airflow-engineering, dbt-engineering |
| `reviewer` | claude-sonnet-4-6 | medium | code-review, python-engineering, sql-engineering, airflow-engineering, dbt-engineering |
| `oracle` | claude-sonnet-4-6 | high | dataeng-architecture |
| `scout` | claude-haiku-4-5 | — | — |

Scout calibration: called 50-200x per session — never upgrade its model.

## Extensions

| Extension | Role |
|---|---|
| `bash-guard/` | Interactive confirmation on destructive commands (`rm -rf`, `bq rm`, `DROP TABLE`, `DELETE` without WHERE, `gsutil rm -r`) |
| `graphify-context.ts` | Injects `graphify-out/GRAPH_REPORT.md` into session context at startup if present |

## Skills — load triggers

Skills are registered at startup (descriptions in system prompt). Bodies load on demand.

| Skill | Auto-load triggers |
|---|---|
| `python-engineering` | `.py` files, `pyproject.toml`, test writing, package structure |
| `sql-engineering` | `.sql` files, schema design, BQ cost/performance |
| `code-review` | Review requests, PR analysis, "check this" tasks |
| `data-quality` | dbt model creation, ingestion pipelines, BQ table validation |
| `gcp-engineering` | `gcloud`/`bq` CLI, IAM, GCP service configuration |
| `dataeng-architecture` | Architecture questions, service comparisons, pipeline design |
| `dbt-engineering` | `.sql` dbt models, `schema.yml`, `dbt_project.yml`, dbt commands |
| `airflow-engineering` | `dags/` folder, DAG design, scheduling, Composer |
| `iac-terraform` | `.tf` files, terraform commands, GCP infrastructure provisioning |
| `git-collaboration` | Git workflow, commit, push, dotfiles drift check |
| `technical-writing` | README, ADR, runbook, API docs, inline comments |
| `graphify` | Codebase analysis, knowledge graph, dependency mapping |

Skills > ~300 lines risk slowing context load. Current heaviest: `dbt-engineering`. Review if it grows further.

## Prompt templates

| Template | When to invoke |
|---|---|
| `/bq-triage` | Dry-run + cost analysis + rewrite of a BQ query |
| `/debug` | Structured 6-step debug workflow |
| `/docstrings` | Add Google-style docstrings to a file |
| `/handoff` | Produce a model-switch brief before `/compact` |
| `/new-dag` | Scaffold a new Airflow DAG |
| `/review` | Full code review via `code-review` skill |
| `/review-sql` | SQL-focused review + sqlfluff lint |
| `/subagent-review` | Isolated review via `pi -p` subprocess (Haiku, read-only) |

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
