---
name: git-collaboration
description: Use for Git repository version control management — safe staging, automated secret protection (.env, keys), diff analysis, Conventional Commits generation, and remote pushing. Trigger on the /git-collaboration command or any task requesting a repository commit, push, or git review.
---

# Skill: Git Collaboration Protocol

## Trigger: /git-collaboration
Invoke this protocol using **Gemini 3.1 Pro**. 
**NOTE:** ALL commit messages MUST be written exclusively in **ENGLISH**.

## Phase 1: Pre-flight & Staging (Interactive)
1. **Status Check:** Execute `git status -s`. If there are no changes, abort the protocol.
2. **Initial Add:** Execute `git add .` to stage all current changes.
3. **Automated Secret Protection (CRITICAL):** Scan the staged files. If any potentially sensitive files are detected (e.g., `.env`, `*.key`, `.pem`, `secrets.json`, or files containing API keys/passwords), AUTOMATICALLY:
   - Append them to `.gitignore`.
   - Execute `git rm -r --cached <sensitive_files>` to unstage them.
   - Execute `git add .gitignore`.
   - Notify the user with: *"🛡️ Security Shield: Auto-excluded [list of files] to prevent leaking secrets."*
4. **Review Stage:** Concisely list the files currently remaining in the Staging Area.
5. **User Feedback:** Explicitly ask the user: 
   *"Are there any OTHER files or folders you want to EXCLUDE and add to .gitignore? (List them, or type 'y' / 'none' to proceed)."*
6. **Exclusion Logic (If requested):**
   - Append the requested exclusions to the `.gitignore` file.
   - Execute `git rm -r --cached <files>` to unstage them.
   - Execute `git add .gitignore` to ensure the new exclusion rules are tracked.
   - Display the updated staged files list.

## Phase 2: Smart Context & Generation
1. **Diff Analysis:** Execute `git diff --cached`. 
   *(Golden Rule: Ignore the contents of `.lock` files, `.csv` data files, or minified assets to avoid context overflow. Focus strictly on source code and logic changes).*
2. **Drafting:** Draft a commit message following the **Conventional Commits** format:
   - `<type>(<scope>): <summary>`
   - Use a bulleted list in the body to detail the technical achievements and architectural decisions.

## Phase 3: Review & Refine (Human in the Loop)
1. Display the proposed commit message.
2. Ask the exact question: **"Validate this commit? (Type 'y' to push, 'n' to abort, or type your modifications to adjust the message)."**
3. *If the user requests a modification, regenerate the message based on their feedback and repeat the validation question.*

## Phase 4: Bulletproof Execution
If the user approves by typing "y":
1. Execute `git commit -m "<generated_message>"`
2. Execute `git push -u origin HEAD` *(This ensures the upstream branch is set if it is a newly created local branch).*
3. Confirm success to the user and provide the generated commit hash.
