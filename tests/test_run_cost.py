#!/usr/bin/env python3
"""
bin/run-cost, sur des runs synthétiques (lot ITE, P1-0 ; adjudication ITE Q-N).

La preuve nominale est la reproduction exacte de la baseline adjugée sur le relevé QD réel
(1 648 989 = 404 007 + 1 244 982 avant coupure ; 2 335 526 après) : elle se fait sur la machine
de l'opérateur, là où le relevé vit. Ici, les cas qui mordraient sans faire de bruit : une coupure
posée alors que le plan n'est pas terminal, un INTEGRATED sans status compté comme final sous un
design_update, une relecture comptée quand le contenu a changé ; et, depuis l'adjudication ITE-1,
les entrées ambiguës : deux runs dans le dossier, une session étrangère, une ligne JSONL illisible,
un plan qui ne correspond plus à son planHash. Depuis le plan P1 (Q4) : --tours, qui lit la
transcription d'un enfant sans omission et rapproche la somme de ses tours du total de l'artefact.
Depuis LOT-REPRISES (R3) : --cycles, dont chaque cause de reprise se lit dans la porte puis le
verdict structuré, et vaut unknown sinon.

    python3 tests/test_run_cost.py
    bin/test-guards                # le lance aussi
"""

import contextlib
import hashlib
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


def monter(d, unites, evenements, design_update=False, run=RUN):
    runs = d / "runs"
    runs.mkdir(exist_ok=True)
    wus = [{"id": u, "goal": "g", "depends_on": [], "expected_write_scope": ["src"]} for u in unites]
    if design_update:
        wus[0]["design_update"] = {"decision_id": "D-001", "from_status": "proposé", "to_status": "en cours"}
    texte = json.dumps({"version": 1, "work_units": wus})
    (runs / f"{run}-plan.json").write_text(texte, encoding="utf-8")
    (runs / "active-run.json").write_text(json.dumps({
        "version": 2, "runId": run, "status": "active", "nextSeq": 1, "plan": f"{run}-plan.json",
        "planHash": hashlib.sha256(texte.encode("utf-8")).hexdigest()[:16]}), encoding="utf-8")
    ecrire_jsonl(runs / f"{run}-lanes.jsonl", [{"ledger": 2}] + evenements)
    ecrire_jsonl(runs / f"{run}-delegations.jsonl", [])
    sessions = d / "sessions"
    sessions.mkdir(exist_ok=True)
    return runs, sessions


def session_du_run(sessions, nom="s.jsonl", run=RUN, extra=()):
    lignes = [{"type": "session", "timestamp": "2026-01-01T00:00:00Z", "cwd": "/d"},
              {"type": "message", "timestamp": "2026-01-01T00:00:01Z", "message": {
                  "role": "toolResult", "toolCallId": "t", "toolName": "task",
                  "content": [{"type": "text", "text": f"[run {run}] ok"}]}}] + list(extra)
    ecrire_jsonl(sessions / nom, lignes)


def lancer(*args):
    sortie = io.StringIO()
    with contextlib.redirect_stdout(sortie):
        code = rc.main(["run-cost", *map(str, args)])
    return code, sortie.getvalue()


def evenements(runs, run=RUN):
    return [e for e in rc.jsonl(str(runs / f"{run}-lanes.jsonl")) if "event" in e]


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
            self.assertIsNone(rc.instant_terminal(evenements(runs), ["W01", "W02"], False))

    def test_plan_entierement_integre_coupe_au_dernier_integrated(self):
        with tempfile.TemporaryDirectory() as t:
            ev = [ouvert("W01", "2026-01-01T00:00:00Z"), integre("W01", "2026-01-01T00:10:00Z"),
                  ouvert("W02", "2026-01-01T00:11:00Z"), integre("W02", "2026-01-01T00:20:00Z")]
            runs, _ = monter(Path(t), ["W01", "W02"], ev)
            self.assertEqual(rc.instant_terminal(evenements(runs), ["W01", "W02"], False), "2026-01-01T00:20:00Z")

    def test_integrated_sans_status_sous_design_update_ne_termine_pas(self):
        with tempfile.TemporaryDirectory() as t:
            ev = [ouvert("W01", "2026-01-01T00:00:00Z"), integre("W01", "2026-01-01T00:10:00Z", status=False)]
            runs, _ = monter(Path(t), ["W01"], ev, design_update=True)
            self.assertIsNone(rc.instant_terminal(evenements(runs), ["W01"], True))
            self.assertEqual(rc.instant_terminal(evenements(runs), ["W01"], False), "2026-01-01T00:10:00Z")


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
            session_du_run(sessions, extra=lecture(1, "A" * 400) + lecture(2, "A" * 400) + lecture(3, "B" * 400))
            code, sortie = lancer(runs, sessions, "--coupure", "aucune", "--json", Path(t) / "g.json")
            self.assertEqual(code, 0, sortie)
            g = json.loads((Path(t) / "g.json").read_text(encoding="utf-8"))
            self.assertEqual(g["relectures_estime"], {"src/a.py": {"fois": 2, "tokens_chaque": 100}})
            self.assertEqual(g["releves"]["orchestrateur"]["avant"], 33)


class EntreesAmbigues(unittest.TestCase):
    """Adjudication ITE-1 : sans sélection explicite, un run, son plan vérifié, ses seules sessions."""

    def test_deux_runs_dans_le_dossier_refusent_sans_selection(self):
        with tempfile.TemporaryDirectory() as t:
            autre = "fedcba9876543210"
            runs, sessions = monter(Path(t), ["W01"], [])
            (runs / f"{autre}-plan.json").write_text("{}", encoding="utf-8")
            session_du_run(sessions)
            code, sortie = lancer(runs, sessions)
            self.assertEqual(code, 2)
            self.assertIn("2 runs", sortie)
            code, sortie = lancer(runs, sessions, "--run", RUN)
            self.assertEqual(code, 0, sortie)
            self.assertIn(f"run {RUN} (explicite (--run))", sortie)

    def test_session_etrangere_refuse_sans_selection(self):
        with tempfile.TemporaryDirectory() as t:
            runs, sessions = monter(Path(t), ["W01"], [])
            session_du_run(sessions)
            session_du_run(sessions, nom="autre.jsonl", run="fedcba9876543210")
            code, sortie = lancer(runs, sessions)
            self.assertEqual(code, 2)
            self.assertIn("étrangère", sortie)
            self.assertIn("autre.jsonl", sortie)
            code, sortie = lancer(runs, sessions, "--session", sessions / "s.jsonl")
            self.assertEqual(code, 0, sortie)
            self.assertIn("s.jsonl", sortie.split("\n")[2])
            code, sortie = lancer(
                runs, sessions, "--session", sessions / "autre.jsonl")
            self.assertEqual(code, 2, sortie)
            self.assertIn("autre.jsonl", sortie)

    def test_ligne_jsonl_illisible_refuse_avec_fichier_et_ligne(self):
        with tempfile.TemporaryDirectory() as t:
            runs, sessions = monter(Path(t), ["W01"], [ouvert("W01", "2026-01-01T00:00:00Z")])
            session_du_run(sessions)
            with open(sessions / "s.jsonl", "a", encoding="utf-8") as f:
                f.write("{pas du json\n")
            code, sortie = lancer(runs, sessions)
            self.assertEqual(code, 2)
            self.assertIn("s.jsonl:3", sortie)
            session_du_run(sessions)
            with open(runs / f"{RUN}-lanes.jsonl", "a", encoding="utf-8") as f:
                f.write("{tronquée\n")
            code, sortie = lancer(runs, sessions)
            self.assertEqual(code, 2)
            self.assertIn(f"{RUN}-lanes.jsonl:3", sortie)

    def test_plan_qui_ne_correspond_plus_au_planhash_refuse(self):
        with tempfile.TemporaryDirectory() as t:
            runs, sessions = monter(Path(t), ["W01"], [])
            session_du_run(sessions)
            (runs / f"{RUN}-plan.json").write_text(json.dumps({"version": 1, "work_units": []}), encoding="utf-8")
            code, sortie = lancer(runs, sessions)
            self.assertEqual(code, 2)
            self.assertIn("planHash", sortie)


def delegation_avec_transcription(runs, lignes_transcription, total_artefact, seq=1, role="worker"):
    """Une délégation au journal, son artefact (usage total) et sa transcription."""
    nom = f"{RUN}-{seq:02d}-{role}"
    (runs / f"{nom}.json").write_text(json.dumps({
        "usage": {"input": total_artefact, "output": 0, "cacheRead": 0, "cacheWrite": 0}, "turns": 2,
        "envelope": {"status": "ok"}}), encoding="utf-8")
    (runs / f"{nom}.jsonl").write_text("".join(
        (x if isinstance(x, str) else json.dumps(x)) + "\n" for x in lignes_transcription), encoding="utf-8")
    ecrire_jsonl(runs / f"{RUN}-delegations.jsonl", [
        {"at": "2026-01-01T00:00:05Z", "seq": seq, "role": role, "work_unit": "W01", "artifact": f"/x/{nom}.json"}])


def tour_assistant(total, appels=()):
    return {"type": "message_end", "message": {"role": "assistant", "usage": {"input": total, "output": 0},
            "content": [{"type": "toolCall", "id": i, "name": "read", "arguments": {"path": p}} for i, p in appels]}}


def resultat(id_, texte_):
    return {"type": "message_end", "message": {"role": "toolResult", "toolCallId": id_, "toolName": "read",
            "content": [{"type": "text", "text": texte_}]}}


class Tours(unittest.TestCase):
    """Adjudication P1, Q4 : --tours lit la transcription sans omission, rapproche ses totaux, distingue relevé et estimé."""

    def test_tours_rapproche_et_distingue_releve_et_estime(self):
        with tempfile.TemporaryDirectory() as t:
            runs, sessions = monter(Path(t), ["W01"], [])
            session_du_run(sessions)
            delegation_avec_transcription(runs, [
                {"type": "session"}, tour_assistant(100, [("c1", "src/a.py")]), resultat("c1", "A" * 400),
                tour_assistant(150)], 250)
            code, sortie = lancer(runs, sessions, "--tours", "--json", Path(t) / "g.json")
            self.assertEqual(code, 0, sortie)
            self.assertIn("relevé      250 = artefact 250 (rapproché)", sortie)
            self.assertIn("contexte par tour [relevé] : 100 150", sortie)
            self.assertIn("[estimé, caractères / 4] : read · dépôt 1× 100 (relus 100)", sortie)
            g = json.loads((Path(t) / "g.json").read_text(encoding="utf-8"))
            self.assertEqual(g["tours"][0]["releve"], 250)

    def test_ligne_illisible_de_la_transcription_refuse_avec_fichier_et_ligne(self):
        with tempfile.TemporaryDirectory() as t:
            runs, sessions = monter(Path(t), ["W01"], [])
            session_du_run(sessions)
            delegation_avec_transcription(runs, [tour_assistant(100), "{tronquée", tour_assistant(150)], 250)
            code, sortie = lancer(runs, sessions, "--tours")
            self.assertEqual(code, 2, sortie)
            self.assertIn(f"{RUN}-01-worker.jsonl:2", sortie)
            # Sans --tours, la grille ne compte pas sur la transcription : elle n'y est lue que pour
            # les estimations, et une ligne illisible y est comptée, pas refusée.
            code, sortie = lancer(runs, sessions)
            self.assertEqual(code, 0, sortie)

    def test_somme_des_tours_differente_de_l_artefact_refuse(self):
        with tempfile.TemporaryDirectory() as t:
            runs, sessions = monter(Path(t), ["W01"], [])
            session_du_run(sessions)
            delegation_avec_transcription(runs, [tour_assistant(100), tour_assistant(100)], 250)
            code, sortie = lancer(runs, sessions, "--tours")
            self.assertEqual(code, 2, sortie)
            self.assertIn("délégation #1 (worker)", sortie)
            self.assertIn("(200) n'égale pas le total de l'artefact (250)", sortie)

    def test_transcription_absente_refuse(self):
        with tempfile.TemporaryDirectory() as t:
            runs, sessions = monter(Path(t), ["W01"], [])
            session_du_run(sessions)
            delegation_avec_transcription(runs, [tour_assistant(250)], 250)
            (runs / f"{RUN}-01-worker.jsonl").unlink()
            code, sortie = lancer(runs, sessions, "--tours")
            self.assertEqual(code, 2, sortie)
            self.assertIn("transcription absente", sortie)


# ------------------------------------------------------------------ --cycles (LOT-REPRISES, R3)

def unite_jouee(runs, sessions, chaine):
    """
    Une unité W01 jouée délégation par délégation. Chaque élément : (rôle, extra) où extra porte
    verdict, open_risks, changed_files, gate (la porte relevée sur le résultat `task`), refus (le
    plan refusé avant elle) et transcription (lignes brutes de la transcription de l'enfant).
    """
    journal, session = [], [{"type": "session", "timestamp": "2026-01-01T00:00:00Z", "cwd": "/d"}]
    for i, (role, x) in enumerate(chaine, 1):
        nom = f"{RUN}-{i:02d}-{role}"
        payload = {"verdict": x.get("verdict"), "open_risks": x.get("open_risks", []), "findings": x.get("findings", [])} \
            if role == "reviewer" else {}
        (runs / f"{nom}.json").write_text(json.dumps({
            "usage": {"input": 10, "output": 0}, "turns": 1, "envelope": {"status": "ok", "payload": payload}}), encoding="utf-8")
        (runs / f"{nom}.jsonl").write_text("".join(
            (l if isinstance(l, str) else json.dumps(l)) + "\n" for l in x.get("transcription", [])), encoding="utf-8")
        journal.append({"at": f"2026-01-01T00:{i:02d}:00Z", "seq": i, "role": role, "work_unit": "W01",
                        "artifact": f"/x/{nom}.json", "changed_files": x.get("changed_files", [])})
        if x.get("refus"):
            session.append({"type": "message", "timestamp": f"2026-01-01T00:{i:02d}:00Z", "message": {
                "role": "toolResult", "toolName": "task", "toolCallId": f"r{i}", "content": [{"type": "text", "text": "Refused"}],
                "details": {"plan_refusal": {"code": "PLAN_DIRECT_STATIC_CONSUMERS_UNCLASSIFIED", "missing": {"W01": ["x.py"]}}}}})
        details = {"artifact": f"/x/{nom}.json", "children": [{"artifact": f"/x/{nom}.json"}]}
        if x.get("gate"):
            details["integration_gate"] = {"outcome": "blocked", "policy_blockers": x["gate"]}
        session.append({"type": "message", "timestamp": f"2026-01-01T00:{i:02d}:01Z", "message": {
            "role": "toolResult", "toolName": "task", "toolCallId": f"t{i}",
            "content": [{"type": "text", "text": f"[run {RUN}] ok"}], "details": details}})
    ecrire_jsonl(runs / f"{RUN}-delegations.jsonl", journal)
    ecrire_jsonl(sessions / "s.jsonl", session)


def risque(id_, transition, minute):
    return {"event_seq": minute, "work_unit": "W01", "lane": f"{RUN}-W01-g1", "at": f"2026-01-01T00:{minute:02d}:00.500Z",
            "event": "RISK", "id": id_, "transition": transition}


class Cycles(unittest.TestCase):
    """LOT-REPRISES, R3 : les cycles de reprise et leur cause, lus dans les registres et la porte ; unknown sinon."""

    def test_causes_lues_dans_la_porte_puis_le_verdict(self):
        with tempfile.TemporaryDirectory() as t:
            runs, sessions = monter(Path(t), ["W01"], [risque("r-1", "opened", 2)])
            unite_jouee(runs, sessions, [
                ("worker", {"changed_files": ["src/a.py", "lib/hors.py"]}),
                ("reviewer", {"verdict": "approved", "open_risks": ["où ?"], "gate": ["open-risks", "scope-breach"]}),
                ("worker", {}),
                ("reviewer", {"verdict": "needs_rework", "findings": [{"severity": "LOW"}]}),
                ("worker", {}),
                ("reviewer", {"verdict": "approved"}),
            ])
            code, sortie = lancer(runs, sessions, "--cycles", "--json", Path(t) / "g.json")
            self.assertEqual(code, 0, sortie)
            c = json.loads((Path(t) / "g.json").read_text(encoding="utf-8"))["cycles"]
            r = c["unites"]["W01"]["reprises"]
            self.assertEqual([x["cause"] for x in r], ["open-risks+scope-breach", "needs_rework"])
            self.assertEqual(r[0]["ecrits_hors_scope"], ["lib/hors.py"])
            self.assertEqual(r[0]["risques_ouverts"], ["r-1"])
            k = c["compteurs"]
            self.assertEqual((k["worker_initial"], k["rework_workers"], k["cycles_rework"], k["reviewers"]), (1, 2, 2, 3))
            self.assertEqual((k["porte_scope_breach"], k["reprises_scope_breach"], k["porte_open_risks"],
                              k["reprises_open_risks"], k["approved_avec_risque_ouvert"]), (1, 1, 1, 1, 1))

    def test_cause_non_demontrable_est_unknown(self):
        with tempfile.TemporaryDirectory() as t:
            runs, sessions = monter(Path(t), ["W01"], [])
            unite_jouee(runs, sessions, [
                ("worker", {}), ("worker", {}),
                ("reviewer", {"verdict": "approved"}), ("worker", {}),
            ])
            code, sortie = lancer(runs, sessions, "--cycles", "--json", Path(t) / "g.json")
            self.assertEqual(code, 0, sortie)
            r = json.loads((Path(t) / "g.json").read_text(encoding="utf-8"))["cycles"]["unites"]["W01"]["reprises"]
            self.assertEqual([x["cause"] for x in r], ["unknown", "unknown"])
            self.assertIn("aucune revue entre les deux workers", r[0]["source"])
            self.assertIn("sans porte relevée", r[1]["source"])

    def test_refus_structures_et_codes_comptes(self):
        refus_r2 = {"type": "tool_execution_end", "toolName": "submit", "result": {
            "content": [{"type": "text", "text": "Refused"}],
            "details": {"refus": {"code": "REVIEW_APPROVED_WITH_OPEN_RISKS", "new_open_risks": 1, "open_risk_ids": []}}}}
        hors = {"type": "tool_execution_end", "toolName": "edit", "isError": True, "result": {
            "content": [{"type": "text", "text": "blocked by role-guard: WRITE_OUTSIDE_SCOPE lib/hors.py — fichier"}]}}
        with tempfile.TemporaryDirectory() as t:
            runs, sessions = monter(Path(t), ["W01"], [])
            unite_jouee(runs, sessions, [
                ("worker", {"refus": True, "transcription": [hors, hors]}),
                ("reviewer", {"verdict": "approved", "transcription": [refus_r2]}),
            ])
            code, sortie = lancer(runs, sessions, "--cycles", "--json", Path(t) / "g.json")
            self.assertEqual(code, 0, sortie)
            k = json.loads((Path(t) / "g.json").read_text(encoding="utf-8"))["cycles"]["compteurs"]
            self.assertEqual((k["ecritures_hors_scope_refusees"], k["approved_refuses_r2"], k["plan_validation_retries"],
                              k["cycles_rework"]), (2, 1, 1, 0))

    def test_ligne_illisible_d_une_transcription_refuse(self):
        with tempfile.TemporaryDirectory() as t:
            runs, sessions = monter(Path(t), ["W01"], [])
            unite_jouee(runs, sessions, [("worker", {"transcription": ["{tronquée"]}), ("reviewer", {"verdict": "approved"})])
            code, sortie = lancer(runs, sessions, "--cycles")
            self.assertEqual(code, 2, sortie)
            self.assertIn(f"{RUN}-01-worker.jsonl:1", sortie)


if __name__ == "__main__":
    unittest.main(verbosity=0)
