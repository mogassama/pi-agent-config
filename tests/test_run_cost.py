#!/usr/bin/env python3
"""
bin/run-cost, sur des runs synthétiques (lot ITE, P1-0 ; adjudication ITE Q-N).

La preuve nominale est la reproduction exacte de la baseline adjugée sur le relevé QD réel
(1 648 989 = 404 007 + 1 244 982 avant coupure ; 2 335 526 après) : elle se fait sur la machine
de l'opérateur, là où le relevé vit. Ici, les trois cas qui mordraient sans faire de bruit :
une coupure posée alors que le plan n'est pas terminal, un INTEGRATED sans status compté comme
final sous un design_update, et une relecture comptée quand le contenu a changé.

    python3 tests/test_run_cost.py
    bin/test-guards                # le lance aussi
"""

import contextlib
import importlib.machinery
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
_loader = importlib.machinery.SourceFileLoader("run_cost", str(ROOT / "bin" / "run-cost"))
_spec = importlib.util.spec_from_loader("run_cost", _loader)
rc = importlib.util.module_from_spec(_spec)
_loader.exec_module(rc)

RUN = "0123456789abcdef"


def ecrire_jsonl(p, lignes):
    p.write_text("".join(json.dumps(x) + "\n" for x in lignes), encoding="utf-8")


def monter(d, unites, evenements, design_update=False):
    runs = d / "runs"
    runs.mkdir()
    wus = [{"id": u, "goal": "g", "depends_on": [], "expected_write_scope": ["src"]} for u in unites]
    if design_update:
        wus[0]["design_update"] = {"decision_id": "D-001", "from_status": "proposé", "to_status": "en cours"}
    (runs / f"{RUN}-plan.json").write_text(json.dumps({"version": 1, "work_units": wus}), encoding="utf-8")
    ecrire_jsonl(runs / f"{RUN}-lanes.jsonl", [{"ledger": 2}] + evenements)
    ecrire_jsonl(runs / f"{RUN}-delegations.jsonl", [])
    sessions = d / "sessions"
    sessions.mkdir()
    return runs, sessions


def ouvert(u, t):
    return {"event_seq": 1, "work_unit": u, "lane": f"{RUN}-{u}-g1", "at": t, "event": "OPENED", "base": "0" * 40, "generation": 1}


def integre(u, t, status=True):
    e = {"event_seq": 2, "work_unit": u, "lane": f"{RUN}-{u}-g1", "at": t, "event": "INTEGRATED", "integration_commit": "1" * 40}
    if status:
        e["status"] = {"outcome": "not-applicable"}
    return e


class Coupure(unittest.TestCase):
    def test_plan_partiellement_integre_sans_coupure(self):
        with tempfile.TemporaryDirectory() as t:
            runs, _ = monter(Path(t), ["W01", "W02"], [ouvert("W01", "2026-01-01T00:00:00Z"), integre("W01", "2026-01-01T00:10:00Z")])
            self.assertIsNone(rc.instant_terminal(str(runs), ["W01", "W02"], False))

    def test_plan_entierement_integre_coupe_au_dernier_integrated(self):
        with tempfile.TemporaryDirectory() as t:
            ev = [ouvert("W01", "2026-01-01T00:00:00Z"), integre("W01", "2026-01-01T00:10:00Z"),
                  ouvert("W02", "2026-01-01T00:11:00Z"), integre("W02", "2026-01-01T00:20:00Z")]
            runs, _ = monter(Path(t), ["W01", "W02"], ev)
            self.assertEqual(rc.instant_terminal(str(runs), ["W01", "W02"], False), "2026-01-01T00:20:00Z")

    def test_integrated_sans_status_sous_design_update_ne_termine_pas(self):
        with tempfile.TemporaryDirectory() as t:
            ev = [ouvert("W01", "2026-01-01T00:00:00Z"), integre("W01", "2026-01-01T00:10:00Z", status=False)]
            runs, _ = monter(Path(t), ["W01"], ev, design_update=True)
            self.assertIsNone(rc.instant_terminal(str(runs), ["W01"], True))
            self.assertEqual(rc.instant_terminal(str(runs), ["W01"], False), "2026-01-01T00:10:00Z")


class Relectures(unittest.TestCase):
    def test_seul_un_contenu_identique_est_une_relecture(self):
        with tempfile.TemporaryDirectory() as t:
            runs, sessions = monter(Path(t), ["W01"], [])

            def lecture(i, contenu):
                return [
                    {"type": "message", "timestamp": f"2026-01-01T00:0{i}:00Z", "message": {
                        "role": "assistant", "usage": {"input": 10, "output": 1},
                        "content": [{"type": "toolCall", "id": f"c{i}", "name": "read", "arguments": {"path": "src/a.py"}}]}},
                    {"type": "message", "timestamp": f"2026-01-01T00:0{i}:30Z", "message": {
                        "role": "toolResult", "toolCallId": f"c{i}", "toolName": "read",
                        "content": [{"type": "text", "text": contenu}]}},
                ]
            ecrire_jsonl(sessions / "s.jsonl", lecture(1, "A" * 400) + lecture(2, "A" * 400) + lecture(3, "B" * 400))
            sortie = io.StringIO()
            with contextlib.redirect_stdout(sortie):
                code = rc.main(["run-cost", str(runs), str(sessions), "--coupure", "aucune", "--json", str(Path(t) / "g.json")])
            self.assertEqual(code, 0)
            g = json.loads((Path(t) / "g.json").read_text(encoding="utf-8"))
            self.assertEqual(g["relectures_estime"], {"src/a.py": {"fois": 2, "tokens_chaque": 100}})
            self.assertEqual(g["releves"]["orchestrateur"]["avant"], 33)


if __name__ == "__main__":
    unittest.main(verbosity=0)
