Run a focused, isolated review of @{{file}} as a `pi -p` subprocess so the main session context stays clean.

Use this exact pattern (adjust `--model` if Mo specified one):

```bash
pi -p \
  --model google/gemini-3-flash \
  --tools read,grep,find,ls \
  --no-extensions \
  "Review @{{file}} for {{focus|bugs, style violations, and obvious performance issues}}. Output a numbered list, max 10 items, one line each. No preamble."
```

Run it via the `bash` tool, then summarize the top 3 findings in your own words. If the subprocess found nothing notable, say so in one line.

This is the canonical Pi-native subagent pattern: isolated context, explicit tool subset, cheap model, structured output.
