#!/usr/bin/env python3
"""
Item 3 fixture (MATRICES § D, Python readers, declared limit). tests/l0-pi-surface.test.ts copies it over
bin/subagent-trace in a temporary copy only. It reads the declared keys of that reader except one,
"command", whose absence the counter-test must report. The control restores it.
"""
import json
import sys


def lire(ligne: str) -> None:
    e = json.loads(ligne)
    t = e.get("type")
    if t == "tool_execution_start" and e.get("toolName") == "bash":
        print((e.get("args") or {}))
    elif t == "turn_end":
        print("tour")
    elif t in ("message", "message_end"):
        m = e.get("message") or e
        u = m.get("usage") or {}
        if m.get("role") == "assistant":
            print(u.get("input"), u.get("output"), u.get("reasoning"), u.get("cacheRead"), u.get("cacheWrite"))


for ligne in sys.stdin:
    lire(ligne)
