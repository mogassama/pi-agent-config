# Pi config — data engineering setup

Personal `~/.pi/agent/` configuration for data engineering work (Python, SQL, GCP).

## Directory layout

```
~/.pi/agent/
├── AGENTS.md              # Global instructions (loaded every session)
├── APPEND_SYSTEM.md       # Appended to pi's default system prompt
├── README.md              # This file
├── skills/
│   ├── sql-engineering/SKILL.md
│   ├── python-engineering/SKILL.md
│   ├── airflow-engineering/SKILL.md
│   ├── gcp-engineering/SKILL.md
│   └── dataeng-architecture/SKILL.md
└── prompts/
    ├── review-sql.md          # /review-sql
    ├── new-dag.md             # /new-dag
    ├── bq-triage.md           # /bq-triage
    └── subagent-review.md     # /subagent-review
```

## How the pieces fit (and the honest limits)

Pi is intentionally minimal: 4 native tools (`read`, `write`, `edit`, `bash`), no MCP, **no native sub-agents**, no plan mode. The "subagent" concept from OpenCode / Claude Code does not exist as such in pi.

This config simulates a similar workflow in three layers, in order of weight:

| Layer | What it is | Cost | When to use |
|---|---|---|---|
| **AGENTS.md** | Always-loaded global rules | High (in every context) | Things true for every session |
| **Skills** | Auto-loaded on description match, or `/skill:name` | Zero until loaded | Domain-focused instruction sets (SQL, Airflow, etc.) |
| **Prompt templates** | Manual via `/name` | Zero until invoked | Repeatable workflows you trigger |
| **`pi -p` subprocess** | Spawn isolated pi from `bash` | Separate run + cost | True context isolation or different model |

**Key thing to internalize:** a skill does *not* spawn a separate model run. It injects instructions into the current agent's context. Same model, same conversation. If you genuinely need an isolated context or a different model (e.g. cheap Haiku for a code review while the main session runs Sonnet), use the `pi -p` pattern (see `prompts/subagent-review.md` for the canonical form).

## What's loaded when

Pi reads at startup:
- `~/.pi/agent/AGENTS.md` (always)
- `~/.pi/agent/APPEND_SYSTEM.md` (always, appended to default system prompt)
- Any `AGENTS.md` walking up from `cwd` to `/` (always)
- `./AGENTS.md` in current dir (always)
- All skills are *registered* (descriptions go into the system prompt) but their bodies are loaded on demand.
- Prompt templates appear in `/` autocomplete; bodies expand only when invoked.

Project-level overrides go in `<project>/.pi/`:
- `<project>/.pi/SYSTEM.md` — replace global system prompt entirely
- `<project>/.pi/APPEND_SYSTEM.md` — append after global
- `<project>/AGENTS.md` — project-specific rules (concatenated, project wins on conflict)
- `<project>/.pi/skills/` — project-only skills
- `<project>/.pi/prompts/` — project-only templates

## Daily usage

```bash
pi                                    # interactive, all global config loaded
pi "review @dags/billing_dag.py"     # interactive with initial prompt
pi -c                                 # continue last session in this dir
pi -r                                 # browse and resume sessions
pi -p "..."                           # one-shot, prints and exits
pi --model sonnet:high "..."         # override model + thinking
pi --tools read,grep,find,ls "..."   # read-only mode (planning / review)
pi /skill:sql-engineering             # force-load a skill at startup
pi /review-sql                        # invoke a prompt template
```

In-session:
- `/skill:<name>` to force-load a skill the agent didn't pick up
- `/<template-name>` to expand a prompt template
- `/reload` after editing this config — picks up changes without restart
- `/tree` to branch off any prior message

## Extending

### Add a new skill

```bash
mkdir -p ~/.pi/agent/skills/<new-skill>
cat > ~/.pi/agent/skills/<new-skill>/SKILL.md <<'EOF'
---
name: <new-skill>
description: One sentence on when the agent should auto-load this. Be specific — vague descriptions trigger badly. Max 1024 chars.
---

# <New Skill>

## When this skill is active
...

## Rules / patterns
...
EOF
```

Then `/reload` in any open pi session (or restart) and verify in the startup banner that pi sees it.

`name` must be lowercase a-z + digits + hyphens, ≤64 chars, and **match the parent directory name**. `description` is the only field pi uses for auto-loading — invest in it.

### Add a new prompt template

```bash
cat > ~/.pi/agent/prompts/<name>.md <<'EOF'
Body of the prompt. Use {{var}} for placeholders Mo fills at invocation.
EOF
```

`/<name>` in interactive mode will expand it.

### Add a project-specific override

In any project root:
```bash
mkdir -p .pi
cat > AGENTS.md <<'EOF'
## Project conventions
- Python 3.12, ruff line length 120, ...
- BigQuery dataset prefix: `bil_` for billing domain, ...
EOF
```

Project AGENTS.md is concatenated *after* the global one — same key, project wins.

## Iteration plan

The skills here are **stubs** — solid scaffolding, not exhaustive content. Expected evolution:

1. **Use the config for 1-2 weeks** on real data engineering work.
2. **When the agent does something dumb** (suggests a deprecated operator, misses a partition filter, picks the wrong service), the *fix* lives in the relevant skill — append a rule to its `## Review checklist` or `## Anti-patterns`.
3. **When you find yourself re-typing the same prompt** more than 3x, promote it to a template under `prompts/`.
4. **When a skill's body grows past ~300 lines**, consider splitting it. Skills are cheap to add; large skills are slow to load.
5. **Periodically prune.** Stale rules are worse than no rules.

## Maintenance commands

```bash
# What's loaded right now
pi -p "list every loaded skill and prompt template by name"

# Sanity-check a skill's frontmatter
head -10 ~/.pi/agent/skills/sql-engineering/SKILL.md

# Reset a session if config changes seem cached
pi --no-session "test message"
```

## Limits worth knowing

- Skill descriptions go in the system prompt always — too many skills will inflate context. Mo's 5 should be fine; revisit at 10+.
- AGENTS.md grows monotonically across sessions in long contexts. Keep the global one terse; details go in skills.
- Prompt templates do not chain. A `/template` expands once and that's it.
- `pi -p` subprocesses are independent runs — they re-read AGENTS.md and re-register skills, which costs tokens. Worth it for isolation, expensive for tight loops.

## References

- Pi docs: https://pi.dev
- Skills format reference: https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md
- Pi philosophy (why no sub-agents): https://mariozechner.at/posts/2025-11-30-pi-coding-agent/
