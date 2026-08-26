---
name: git-collaboration
description: Load for git workflow tasks — security audit, staging, commit drafting, branch management, and config repo consistency check. Auto-load on git status, staging and history questions. The commit workflow itself runs only when the operator invokes /skill:git-collaboration; loading this skill is never by itself a reason to commit.
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

**Never create a branch. Commit on the branch already checked out.**

A new branch is an operator decision and it is stated in the request. If a
change looks like it warrants one, say so in a line and commit on the current
branch anyway — moving a commit afterwards costs one `git switch` plus one
`git merge --ff-only`, while an unrequested branch leaves the operator with a
staged tree on a branch they did not ask for and no commit to move.

The rules below apply once the operator has asked for a branch.

- **Model:** trunk-based. Branches live <3 days. `main` is always deployable.
- **Branch naming:** `<type>/<short-description>`
  - `feat/revenue-pipeline`
  - `fix/null-partition-handling`
  - `refactor/extract-bq-client`
- On shared repos where work lands through review, non-trivial changes go via a
  branch — still only when the operator asks. This is not a licence to create
  one unprompted.
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

**Operator-initiated, then run to completion.** This workflow never starts on the
agent's own initiative — invoking `/skill:git-collaboration` *is* the instruction to
commit. Once invoked, go all the way through the push; do not stop after drafting and
ask whether to proceed. Two confirmations gate the run, one on the message and one on
the push, and nothing else interrupts it.

**Never create `~/.pi/.allow-commit` yourself, under any circumstance.** The token is
the operator's authorisation. An agent that issues its own removes the only hard
guarantee in this config. If a commit is blocked for want of a token, report it and
stop — never work around it.

This is now enforced: bash-guard refuses any command naming that path, ahead of the
whitelist and with no dialog and no token of its own. The line stays because a rule
whose mechanism is invisible gets rediscovered by trying it, and that costs a turn.

**This workflow never delegates.** Staging, drafting a message and committing are
orchestrator work: there is no context to isolate and nothing to parallelise, so a
subagent adds a full context and minutes of latency for nothing. Never spawn
`reviewer` from here, whatever the size of the diff — a staged tree is not a code
review, and reviewing it a second time at commit time gates work that was already
gated.

When invoked as `/skill:git-collaboration`, run in order without prompting for selection:
 
1. `/audit` — security scan
2. `/check-config` — config repo consistency (if in the pi config repo)
3. `/git-collaboration` — standard commit workflow
---
 
## /audit — Deep security scan

Scan the repo for forgotten secrets before starting work.

```bash
git ls-files -z | xargs -0 rg -n --no-heading \
  -e 'AIza[0-9A-Za-z_-]{35}' \
  -e 'sk-[A-Za-z0-9_-]{20,}' \
  -e 'BEGIN [A-Z ]*PRIVATE KEY' \
  -e '(?i)(api[_-]?key|secret|password|token)\s*[:=]\s*["\x27][^"\x27]{8,}'
```

`git ls-files` scopes the scan to tracked files: an untracked `.env` is already
outside the repository, and scanning it produces findings nobody can act on.
The patterns match credential *shapes*, not the words — grepping for `token`
across a codebase returns every variable name and buries the one real hit.

Report as a table: `Risk | File:line | Pattern`. If sensitive files are found,
propose `.gitignore` entries and `git rm -r --cached`, then ask before doing it.

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
3. Stage explicitly, never `git add -A` or `git add .` — bash-guard stops both,
   and an initial commit is where blanket staging is most dangerous: nothing is
   tracked yet, so nothing has ever been reviewed, and `.gitignore` was written
   one step ago. Run `git status -s`, show the list, stage the paths by name.
   A repository root holding an `auth.json` is not hypothetical: this config's
   own does.
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
2. Run `git status -s` and `git branch --show-current`. Whatever it reports is
   the branch you commit on. Do not create, switch, or rename.
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
 
### Phase 3 — Commit, then push

Two gates, not one. A commit is local and trivially undone; a push is neither. They
are approved separately.

1. The `y/n/edit?` of Phase 2 approves the **message**. On `edit`, redraft and ask
   again. On `n`, stop and leave the index as it is.
2. On `y`, commit:
   ```bash
   git commit -m "<msg>"
   ```
   bash-guard intercepts this and asks the operator for a single-use authorisation.
   That dialog approves the **act**; the prompt above approved the wording. Both are
   expected — do not try to avoid the second one.
3. Return the result in one line: `[hash] committed to [branch]`.
4. Then ask, exactly, on one line, nothing else:
   ```
   push to <branch>? y/n
   ```
5. On `y`:
   ```bash
   git push -u origin HEAD
   ```
   Return `[hash] pushed to [branch]` — one line, nothing else.
   On `n`, return `[hash] committed, not pushed` and stop. A local commit is a
   perfectly good stopping point.
---
 
## /check-config — Config repo consistency (pi config repo only)

Registered as a real command by the `pi-check-config` extension. It runs itself;
this file does not restate what it checks. Read its output, act on the blocking
tier, report the rest.

