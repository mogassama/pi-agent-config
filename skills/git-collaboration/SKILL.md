---
name: git-collaboration
description: Load for git workflow tasks — security audit, staging, commit drafting, branch management, and dotfiles extension drift check. Auto-load on git status/commit/push tasks or when invoked with /skill:git-collaboration.
---

# Git Collaboration & Audit Protocol

## Conventional Commits — enforced format

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

**Subject rules:**
- Imperative present tense: `add`, `fix`, `update` — not `added`, `fixes`, `updated`
- Lowercase first letter
- No trailing period
- ≤72 characters

**Body:** explain *why*, not *what* — the diff already shows what changed.

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
2. `/check-extensions` — dotfiles drift (if in dotfiles repo)
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
   graphify-out/manifest.json
   graphify-out/cost.json
   ```
3. Stage everything: `git add -A`
4. Propose: `chore: initial commit`
5. Ask for confirmation before committing. If declined, abort and leave index as-is.

### Phase 1 — Pre-flight & staging

1. **Environment check:**
   - Ensure `.piignore` exists. Create if missing.
   - Entries in `.piignore`: `.git/`, `node_modules/`, `.pi/`, `dist/`, `build/`, `*.log`
   - `.gitignore` must include `graphify-out/manifest.json` and `graphify-out/cost.json`. Append if missing.
   - `graphify-out/` directory itself must NOT be ignored — `GRAPH_REPORT.md` and `wiki/` are committed.
   - If in dotfiles repo (detected by `git remote get-url origin` containing `dotfiles` OR repo root is `~/.pi` or `~/dotfiles`): auto-trigger `/check-extensions` before staging.

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
   - Body if the change is non-obvious: *why*, not *what*

### Phase 3 — Review & execution

1. Display commit message.
2. Ask: "Validate this commit? ('y' to commit and push, 'n' to abort, or edit message)"
3. If confirmed:
   ```bash
   git commit -m "<msg>"
   git push -u origin HEAD
   ```
4. Return: `[hash] pushed to [branch]`.

---

## /check-extensions — Dotfiles drift (dotfiles repo only)

Compares live `~/.pi/agent/extensions/` against what the dotfiles repo tracks.

```bash
# Local extensions
find ~/.pi/agent/extensions -maxdepth 2 -type f | sort

# Repo-tracked extensions
git ls-files -- 'extensions/' | sort
```

Render drift table:

| Extension | Tracked in repo | Status |
|---|---|---|
| `bash-guard/index.ts` | ✅ Yes | Clean |
| `new-ext/index.ts` | ❌ No | Untracked |
| `graphify-context.ts` | ✅ Yes | Modified |

**Untracked files:** propose adding to dotfiles. Stage and include in commit if confirmed.

**Modified files:** show diff, then ask: "Keep [L]ocal (default) / [R]epo / [S]kip?"
- Local wins by default. Never overwrite `~/.pi/agent/extensions/` with repo version without explicit `R`.
- Local → copy to repo path, stage.
- Repo → copy to local path, requires explicit confirmation.
- Skip → note in commit message if other changes staged.

Return control to Phase 1 staging.
