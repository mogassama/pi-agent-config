Run a focused, isolated review of @{{file}} as a `pi -p` subprocess so the main session context stays clean.

Use this exact pattern (adjust `--model` if a different model is specified):

```bash
pi -p \
  --model anthropic/claude-haiku-4-5 \
  --tools read,grep,find,ls \
  --no-extensions \
  "Review @{{file}} for {{focus|bugs, style violations, and obvious performance issues}}. Output a numbered list, max 10 items, one line each. No preamble."
```

Notes:
- `--no-extensions` disables bash-guard — intentional here, subprocess is read-only
- `--tools read,grep,find,ls` — no write or edit access in the subprocess
- Haiku is the right model for this: cheap, fast, bounded scope

Run it via the `bash` tool, then summarize the top 3 findings in your own words. If the subprocess found nothing notable, say so in one line.

This is the canonical pi-native subagent pattern: isolated context, explicit tool subset, cheap model, structured output.
