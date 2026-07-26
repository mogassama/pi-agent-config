Diagnose the issue described below (or in @{{file}} if a file is provided).

Load the `diagnose` skill and follow its full loop: reproduce, minimise, hypothesise, instrument, fix, regression test. Do not skip a phase without saying why.

**Before any business-logic hypothesis**, exhaust the data engineering triage order from the skill: schema, then time and timezones, then volume, then permissions. Logic comes last.

**The hypothesis list is closed.** If all of them are refuted, stop and report what was ruled out — do not invent an extra one. An expanding list means the reproduction signal from step 1 is too weak; go back there.

**No fix before a confirmed hypothesis.** And when the fix lands, it is the smallest change that addresses the confirmed root cause — adjacent problems get reported, not repaired.
