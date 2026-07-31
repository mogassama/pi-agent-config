---
name: git-collaboration
description: Load for git workflow tasks — security audit, staging, commit drafting, branch management, and config repo consistency check. Auto-load on git status/commit/push tasks or when invoked with /skill:git-collaboration.
---

# Git Collaboration & Audit Protocol
 
## Conventional Commits — drafting aid

The format is **enforced by the `commit-msg` git hook** (`git-hooks/commit-msg` in
this repo), not by this skill. Git rejects a malformed subject whatever wrote
it — agent, Claude Code, or a terminal. What follows is here to help draft a
message that passes, not to be the thing that enforces it.
 
```
<type>(<scope>): <subject>
 
<body — optional>
 
<footer — optional>
```
 
**Types:**
 
| Type | Use |
|---|---|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `refactor` | Code change with no behavior change |
| `perf` | Performance improvement |
| `docs` | Documentation only |
| `test` | Add or modify tests |
| `chore` | Maintenance — deps, config, tooling |
| `ci` | CI/CD pipeline changes |
| `build` | Build system, scripts, packaging |
 
**Scope** (optional but recommended): module or subsystem — `dag`, `bq`, `pipeline`, `dbt`, `infra`, `auth`.
 
**Subject rules** (the first three are checked by the hook; the fourth is not —
no regex can tell `add` from `added`):
- Lowercase first letter
- No trailing period
- ≤72 characters
- Imperative present tense: `add`, `fix`, `update` — not `added`, `fixes`, `updated`
**Body:** explain *why*, not *what* — the diff already shows what changed. Use bullet points.
 
**Footer:** `BREAKING CHANGE:`, `Refs: TICKET-123`, `Co-authored-by:`.
 
**Examples:**
```
feat(dag): add daily revenue aggregation pipeline
fix(bq): handle null partition values in stg_orders
refactor(pipeline): extract retry logic into decorator
perf(dbt): add clustering to fct_user_events
chore(deps): bump apache-beam from 2.55 to 2.57
ci(composer): add dbt source freshness check to DAG CI step
```
 
## Branching — trunk-based
 
- **Model:** trunk-based. Branches live <3 days. `main` is always deployable.
- **Branch naming:** `<type>/<short-description>`
  - `feat/revenue-pipeline`
  - `fix/null-partition-handling`
  - `refactor/extract-bq-client`
- Never commit directly to `main` for non-trivial changes.
## Merge strategy
 
- **Squash and merge** by default → clean, linear `main` history. Each commit tells a complete story.
- **Rebase and merge** when the branch contains multiple logically distinct commits worth preserving.
- **No merge commits** on `main` unless explicitly justified.
## PR discipline
 
- One PR = one logical change. No mixing feat + unrelated fix.
- PR title = Conventional Commit subject of the squash commit.
- PR description answers: *what*, *why*, *how to test*, *risks*.
- Self-review the diff before requesting human review.
- Tests passing before review is requested.
---
 
## Execution sequence
 
When invoked as `/skill:git-collaboration`, run in order without prompting for selection:
 
1. `/audit` — security scan
2. `/check-config` — config repo consistency (if in the pi config repo)
3. `/git-collaboration` — standard commit workflow
---
 
## /audit — Deep security scan
 
Scan the entire repo for forgotten secrets before starting work.
 
```bash
# Structure mapping
find . -maxdepth 4 -not -path '*/.*' -not -path '*node_modules*'
 
# Secret pattern scan
grep -rE "AIza|key|secret|password|token|SESSION|SECRET_KEY|PRIVATE KEY" . \
  --exclude-dir={.git,node_modules,venv,__pycache__}
```
 
Evaluate findings. Report as table: `Risk Level | File | Pattern matched`.
 
If sensitive files found:
- Append to `.gitignore`
- `git rm -r --cached <files>`
- Ask: "Add these to .gitignore and remove from staging? (y/n)"
---
 
## /git-collaboration — Standard commit workflow
 
**All commit messages in English.**
 
### Phase 0 — Init detection
 
Run `git log --oneline -1 2>&1`. If no commits exist:
 
1. Run `git rev-parse --is-inside-work-tree 2>/dev/null`. If fails, run `git init`.
2. Bootstrap `.gitignore` if missing entries:
   ```
   .pi/
   node_modules/
   dist/
   build/
   *.log
   ```
3. Stage everything: `git add -A`
4. Propose: `chore: initial commit`
5. Ask for confirmation before committing. If declined, abort and leave index as-is.
### Phase 1 — Pre-flight & staging
 
1. **Environment check:**
   - Ensure `.piignore` exists. Create if missing.
   - Entries in `.piignore`: `.git/`, `node_modules/`, `.pi/`, `dist/`, `build/`, `*.log`
   - If in the pi config repo, auto-trigger `/check-config` **before** staging.
     Detect structurally, never by path or remote name:
     ```bash
     root=$(git rev-parse --show-toplevel)
     [ -f "$root/AGENTS.md" ] && [ -f "$root/settings.json" ] && [ -d "$root/skills" ]
     ```
     A path- or remote-name test breaks on the first rename and fails silently.
2. Run `git status -s` and `git branch --show-current`.
3. **Secret scan:** Quick `git diff` scan for obvious secrets before staging.
4. **Security shield:** If sensitive files detected:
   - Append to `.gitignore`
   - `git rm -r --cached <files>`
   - `git add .gitignore`
   - Report: "Security Shield: auto-excluded [files]."
5. **Staged files review:** List files. Ask: "Any exclusions, or 'y' to proceed?"
### Phase 2 — Context & drafting
 
1. Run `git diff --cached`. Ignore: `.lock`, `.csv`, `.parquet`, `.json` data files, `vendor/`.
2. Draft Conventional Commit message following the format above:
   - Correct type from the enforced list
   - Scope if relevant
   - Subject: imperative, lowercase, ≤72 chars, no trailing period
   - Body if the change is non-obvious: bullet points explaining *why*, not *what*
3. Display using **exactly** this format — no preamble, no explanation, no alternatives:
```
feat(dag): add daily revenue aggregation pipeline
 
- extract retry logic into decorator
- add partition filter on stg_orders
 
y/n/edit?
```
 
### Phase 3 — Review & execution
 
1. Prompt is exactly `y/n/edit?` — one line, nothing else.
2. If confirmed:
   ```bash
   git commit -m "<msg>"
   git push -u origin HEAD
   ```
3. Return: `[hash] pushed to [branch]` — one line, nothing else.
---
 
## /check-config — Config repo consistency (pi config repo only)
 
This repo **is** the live `~/.pi/agent/` working tree — there is no second copy to
compare against. `git status` already covers file-level drift. What it cannot see is
whether the config is internally coherent: a skill declared but absent, a frontmatter
that stops a skill from ever auto-loading, a README describing a tree that no longer
exists.
 
Run before staging. Two tiers, deliberately unequal.
 
### Tier 1 — blocking
 
These mean something is broken right now. Stop, report, do not draft a commit.
 
| Check | Failure mode if unnoticed |
|---|---|
| Every skill in `settings.json` `skills` arrays exists in `skills/` | The sub-agent fails at load |
| Every skill listed in `AGENTS.md` exists in `skills/` | The agent is told a skill exists that does not |
| Every `SKILL.md` has YAML frontmatter with `name` and `description` | The skill never registers |
| Each frontmatter `name` equals its directory name | The skill never auto-loads, silently |
 
### Tier 2 — report only
 
Untidy, not broken. Print and continue.
 
| Check | Note |
|---|---|
| Skills on disk absent from `README.md` | Documentation drift |
| Skills loaded by no sub-agent in `settings.json` | Expected for orchestrator-only skills (`git-collaboration`, `grill-me`) — informational, never an error |
| Uncommitted or unpushed changes | This is the normal state mid-work |
 
### Implementation

Registered by the `pi-check-config` extension as `/check-config`. It is a real
command, not a passage a model has to notice and decide to run — same reason the
commit format moved to a git hook and commits moved behind a bash-guard token.

Frontmatter is parsed as YAML, not regex-matched. The earlier regex version
accepted an unquoted single-line `description:` containing a colon: valid to the
regex, a syntax error to pi's loader, and a skill that never registers.

### Output contract
 
Render as a table: `Tier | Item | Finding`.
 
If any Tier 1 check fails: report and **stop**. Do not stage, do not draft a commit
message. Propose the specific fix for each blocking item and wait for confirmation.
 
If only Tier 2 findings exist: print them, then return control to Phase 1 staging
without prompting. A tier-2 finding is never a reason to interrupt a commit.
