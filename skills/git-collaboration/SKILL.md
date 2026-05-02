---
name: git-collaboration
description: Complete Git management with built-in security auditing. Use /audit for a deep repo scan, or /git-collaboration for safe staging and committing.
---

# Skill: Git Collaboration & Audit Protocol

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

## Phase 1: Pre-flight & Staging
1. **Environment Check:** - Check if `.piignore` exists. If not, create it.
   - Ensure `.git/`, `node_modules/`, `.pi/`, `dist/`, `build/`, `*.log` and `.pi/` are listed in `.piignore`.
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
