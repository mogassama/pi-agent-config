Debug the issue described below (or in @{{file}} if a file is provided).

**Don't jump to a fix.** Work through this sequence explicitly. Output each section as you go.

## 1. Reproduce

State what you understand the problem to be, in your own words. Then identify the smallest reliable reproduction:
- Exact command(s) that trigger it
- Exact input that triggers it
- Exact error / wrong behavior observed
- What was expected instead

If you can't reproduce it (or the error is intermittent), say so and stop here. Ask for the missing info — don't guess.

## 2. Hypotheses (ranked)

List 2-4 hypotheses for the root cause, ordered from most to least likely. For each:
- One-sentence statement of the hypothesis
- One concrete check that would confirm or refute it (a command to run, a value to inspect, a log line to find)

Don't make these vague ("maybe a race condition"). Concrete: "the `dt` column is timezone-naive but the filter assumes UTC, so rows on the boundary are dropped — confirm by `SELECT MIN(dt), MAX(dt), TYPEOF(dt) FROM ...`".

## 3. Investigate

Run the checks for hypothesis #1. Use `bash` for commands, `read` for code inspection. Show what you ran and what came back.

If hypothesis #1 is confirmed → go to step 4.
If refuted → move to hypothesis #2. Don't skip ahead, don't combine.

For data eng issues specifically, check in this order before coding hypotheses:
- Schema mismatch (column types, nullability, presence)
- Time/timezone handling (UTC vs local, naive vs aware, partition boundaries)
- Data volume (was the test on 10 rows but prod has 10M?)
- Permissions (IAM, dataset access, service account)
- Then logic bugs

## 4. Fix

The smallest change that addresses the confirmed root cause. Not adjacent improvements, not refactors, not "while we're here". Just the fix.

State explicitly:
- What you're changing
- Why this fixes the root cause (one sentence linking back to the confirmed hypothesis)
- What you're NOT changing (visible related issues you noticed but are leaving alone)

## 5. Verify

Re-run the reproduction from step 1. Show the new output. Confirm the original symptom is gone AND nothing new broke (run the existing tests if there are any).

If the fix doesn't work, go back to step 3 with what you learned. Don't pile on more changes.

## 6. Report

One paragraph: root cause in plain language, what you changed, what you verified, any followup that should be tracked separately.

---

**Anti-patterns to avoid:**

- Wrapping the failing call in `try/except` to "fix" it. That hides the bug.
- Adding `print` / `logger.debug` everywhere then calling it "investigation". One targeted check beats five scattered prints.
- Refactoring "for clarity" while debugging. Two changes simultaneously means you can't tell which fixed it (or broke it more).
- Suggesting a fix without having confirmed the hypothesis. "Try changing X" is for forums, not for here.
