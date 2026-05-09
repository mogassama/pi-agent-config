---
name: git-collaboration
description: "Full Git workflow: security audit, extension drift check, then safe staging and commit. Invoke with /skill:git-collaboration to run all three phases in sequence."
---

# Skill: Git Collaboration & Audit Protocol

## Execution Order
When invoked as `/skill:git-collaboration`, run the following sequence automatically without prompting for selection:
1. Execute Trigger 1 (/audit)
2. Execute Trigger 3 (/check-extensions)
3. Execute Trigger 2 (/git-collaboration)

## Trigger 1: /audit (Deep Security Scan)
Invoke this to scan the entire repository for "forgotten" secrets before starting work.
1. **Scout Recon:** Execute a broad search for sensitive patterns:
   - `find . -maxdepth 4 -not -path '*/.*' -not -path '*node_modules*'` (Structure mapping).
   - `grep -rE "AIza|key|secret|password|token|SESSION|SECRET_KEY|PRIVATE KEY" . --exclude-dir={.git,node_modules,venv,__pycache__}`.
2. **Analysis:** Gemini 3.1 Pro evaluates findings. 
3. **Report:** Display a table of "Risk Level | File | Reason".
4. **Fix:** Ask: *"Should I add these to .gitignore and wipe them from the current staging? (y/n)"*

## Trigger 2: /git-collaboration (Standard Workflow)
**NOTE:** ALL commit messages MUST be written in **ENGLISH**.

## Phase 0: Init Detection (runs before Phase 1)
Run `git log --oneline -1 2>&1`. If the output contains `does not have any commits` or the command fails:

1. **Repo check:** Run `git rev-parse --is-inside-work-tree 2>/dev/null`. If it fails, run `git init`.
2. **Bootstrap `.gitignore`:** If `.gitignore` is absent or missing the following entries, create/append them:
   ```
   .pi/
   node_modules/
   dist/
   build/
   *.log
   graphify-out/manifest.json
   graphify-out/cost.json
   ```
3. **Stage everything:** `git add -A`
4. **Propose init commit message:** `chore: initial commit`
5. **Ask for validation** before running `git commit`. If confirmed, commit — then continue to Phase 1 normally for any remaining unstaged changes. If declined, abort and leave the index as-is.

## Phase 1: Pre-flight & Staging
1. **Environment Check:**
   - Check if `.piignore` exists. If not, create it.
   - Ensure `.git/`, `node_modules/`, `.pi/`, `dist/`, `build/`, `*.log` and `.pi/` are listed in `.piignore`.
   - **Graphify guard:** Confirm that `graphify-out/manifest.json` and `graphify-out/cost.json` are present in `.gitignore`. If missing, append them. `graphify-out/` itself must **not** be ignored — the directory and its other contents (e.g. `GRAPH_REPORT.md`, `wiki/`) are committed.
   - If `graphify-out/GRAPH_REPORT.md` exists and shows as untracked in `git status -s`, include it in staging automatically.
   - **Dotfiles repo check:** If the current repo is the dotfiles repo (detected by: `git remote get-url origin` contains `dotfiles` OR the repo root is `~/.pi` or `~/dotfiles`), auto-trigger `/check-extensions` before proceeding to staging.
2. **Status:** Execute `git status -s` and `git branch --show-current`.
3. **Auto-Scan:** Briefly check the current `git diff` for obvious secrets.
4. **Security Shield:** If sensitive files are detected:
   - Append to `.gitignore`.
   - `git rm -r --cached <files>`.
   - `git add .gitignore`.
   - Notify: "🛡️ Security Shield: Auto-excluded [files] and secured .piignore."
5. **Validation:** List staged files and ask: "Any other exclusions or type 'y' to proceed?"

## Phase 2: Context & Drafting
1. **Smart Diff:** Execute `git diff --cached`. 
   - **IGNORE:** `.lock`, `.csv`, `.parquet`, `.json` data files, `vendor/`.
2. **Generation:** Draft a **Conventional Commit** message.
   - Format: `<type>(<scope>): <summary>` + bullet points for logic.

## Phase 3: Review & Execution
1. Display the commit message.
2. Ask: **"Validate this commit? (Type 'y' to push, 'n' to abort, or edit message)."**
3. If 'y':
   - `git commit -m "<msg>"`
   - `git push -u origin HEAD`
   - Return: ✅ [hash] pushed to [branch].

---

## Trigger 3: /check-extensions (Dotfiles Repo Only)
Compares live `~/.pi/agent/extensions/` against what the dotfiles repo tracks.

### Steps
1. **Enumerate local extensions:**
   ```bash
   find ~/.pi/agent/extensions -maxdepth 2 -type f | sort
   ```
2. **Enumerate tracked extensions** in the repo:
   ```bash
   git ls-files -- 'extensions/' | sort   # adjust prefix to repo layout
   ```
3. **Render drift table:**

   | Extension | Tracked in repo | Drift |
   |-----------|----------------|-------|
   | `my-ext/index.js` | ✅ Yes | None |
   | `new-ext/index.js` | ❌ No | Untracked |
   | `old-ext/index.js` | ✅ Yes | Modified |

4. **Untracked files:** If any local extension file has no tracked counterpart, propose:
   > "Add `<file>` to dotfiles? (y/n)"

   Stage and include in the upcoming commit if confirmed.

5. **Modified files (drift):** Show a `diff` between the local file and the repo's tracked version:
   ```bash
   diff ~/.pi/agent/extensions/<file> <repo-path>/<file>
   ```
   Then ask:
   > "Which version to keep? [L]ocal (default) / [R]epo / [S]kip"

   - **Local wins by default.** Never overwrite `~/.pi/agent/extensions/` with the repo version without explicit `R` confirmation.
   - If Local: copy local → repo path, stage the change.
   - If Repo: copy repo → local path (requires explicit confirmation).
   - If Skip: leave both as-is, note in commit message if other changes are staged.

6. Return control to Phase 1 staging.
