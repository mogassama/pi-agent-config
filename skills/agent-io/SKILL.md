---
name: agent-io
description: >-
  Output envelope contract for subagent runs. Load in the orchestrator session
  before delegating to worker, planner, or oracle so the contract reaches the
  subagent through inherited context.
---

# Agent I/O

End your response with a JSON envelope in a fenced `json` block. Nothing after
the closing fence. This overrides the final-response shape in your agent
template — emit that shape first, then the envelope.

The envelope is a projection of your human-readable response, never a second
analysis. If they disagree, the envelope is wrong.

Emit it even when there is nothing to report.

## worker

Exempt. The `pi-subagents` worker template prescribes its own final-response
shape and overrides context-supplied contracts. Its native output is parsable:
`Implemented:` / `Changed files:` / `Validation:` / `Open risks/questions:` /
`Recommended next step:`.

## planner

```json
{
  "agent": "planner",
  "status": "success",
  "summary": "Three steps to make load.py idempotent.",
  "steps": [
    { "id": 1, "goal": "...", "files": ["src/load.py"], "risk": "medium",
      "verification": "Rerun load twice, expect no IntegrityError" }
  ],
  "assumptions": [],
  "open_risks": []
}
```

## oracle

```json
{
  "agent": "oracle",
  "status": "success",
  "summary": "...",
  "recommendation": "...",
  "alternatives": [
    { "option": "...", "tradeoff": "...", "rejected_because": "..." }
  ],
  "confidence": "probable",
  "open_risks": []
}
```

`status` is `success`, `partial`, or `failed`. Use `partial` when you stop
before completing the task.

Reviewer: see the code-review skill. Scout: exempt.
