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
verdict structuré, et vaut unknown sinon. Depuis LOT-EFFICACITÉ (M) : --postes, dont les catégories
D1 et D3 somment exactement à la grille, et dont les compteurs ne valent jamais 0 faute de trace.
Depuis le plan de phase 0 (v3) : --contexte, lecture directe des textes observés par origine
(caractères/4, résidu signé, verdict « attribution non établie ») ; classe Contexte, cas K01–K37,
fixtures et attendus chiffrés dans tests/fixtures/run-cost-contexte/.

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

    def test_revues_bloquantes_refusees_comptees(self):
        # LOT-REPRISES-CORRECTIF, RC : un submit bloquant refusé faute d'avoir lu les kept_consumers.
        refus_rc = {"type": "tool_execution_end", "toolName": "submit", "result": {
            "content": [{"type": "text", "text": "Refused"}],
            "details": {"refus": {"code": "REVIEW_BLOCKING_WITHOUT_KEPT_CONSUMERS", "unit": "W01",
                                  "missing_kept_consumers": ["tests/test_config.py"]}}}}
        with tempfile.TemporaryDirectory() as t:
            runs, sessions = monter(Path(t), ["W01"], [])
            unite_jouee(runs, sessions, [
                ("worker", {}),
                ("reviewer", {"verdict": "needs_rework", "transcription": [refus_rc, refus_rc]}),
            ])
            code, sortie = lancer(runs, sessions, "--cycles", "--json", Path(t) / "g.json")
            self.assertEqual(code, 0, sortie)
            k = json.loads((Path(t) / "g.json").read_text(encoding="utf-8"))["cycles"]["compteurs"]
            self.assertEqual((k["revues_bloquantes_refusees"], k["approved_refuses_r2"]), (2, 0))
            self.assertIn("revues_bloquantes_refusees 2", sortie)

    def test_ligne_illisible_d_une_transcription_refuse(self):
        with tempfile.TemporaryDirectory() as t:
            runs, sessions = monter(Path(t), ["W01"], [])
            unite_jouee(runs, sessions, [("worker", {"transcription": ["{tronquée"]}), ("reviewer", {"verdict": "approved"})])
            code, sortie = lancer(runs, sessions, "--cycles")
            self.assertEqual(code, 2, sortie)
            self.assertIn(f"{RUN}-01-worker.jsonl:1", sortie)


# ------------------------------------------------------------------ --postes (LOT-EFFICACITÉ, M)

LANE = f"/repo/.git/pi-lanes/{RUN}-W01-g1"


def appel_orch(minute, seconde, cout, outils=(), run=RUN):
    """Un appel facturé de l'orchestrateur ; outils : (id, nom, arguments)."""
    return {"type": "message", "timestamp": f"2026-01-01T00:{minute:02d}:{seconde:02d}Z", "message": {
        "role": "assistant", "usage": {"input": cout, "output": 0},
        "content": [{"type": "toolCall", "id": i, "name": n, "arguments": a} for i, n, a in outils]}}


def resultat_orch(id_, nom, texte_, details=None):
    m = {"role": "toolResult", "toolCallId": id_, "toolName": nom, "content": [{"type": "text", "text": texte_}]}
    if details is not None:
        m["details"] = details
    return {"type": "message", "timestamp": "2026-01-01T00:00:00Z", "message": m}


def tour_outils(cout, appels):
    """Un tour d'enfant ; appels : (id, nom, arguments)."""
    return {"type": "message_end", "message": {"role": "assistant", "usage": {"input": cout, "output": 0},
            "content": [{"type": "toolCall", "id": i, "name": n, "arguments": a} for i, n, a in appels]}}


def fin(id_, nom, erreur=False, texte_="ok", details=None):
    r = {"content": [{"type": "text", "text": texte_}]}
    if details is not None:
        r["details"] = details
    return {"type": "tool_execution_end", "toolCallId": id_, "toolName": nom, "isError": erreur, "result": r}


def debut(id_, nom, args):
    return {"type": "tool_execution_start", "toolCallId": id_, "toolName": nom, "args": args}


KEPT_UNITES = {"W01": {"kept": ["tests/test_a.py"], "derived": ["tests/test_a.py"], "declared": [],
                       "dropped": [{"path": "x.py", "reason": "non suivi"}]}}


def run_complet(d):
    """
    Un run W01 joué jusqu'à la coupure (00:30) : l'orchestrateur traverse chaque catégorie D1, un
    worker et un reviewer de lane laissent leurs transcriptions, et le runtime ses traces E1-bis, E2, E3.
    """
    runs, sessions = monter(d, ["W01"], [ouvert("W01", "2026-01-01T00:01:00Z"), integre("W01", "2026-01-01T00:30:00Z")])
    ph = json.loads((runs / "active-run.json").read_text(encoding="utf-8"))["planHash"]
    prov = {"run": RUN, "planHash": ph, "unit": "W01", "seq": 2, "tree": "t" * 40}
    obs = {"verdict": "needs_rework", "unit": "W01", "par_read": ["tests/test_b.py"], "par_injection": ["tests/test_a.py"],
           "controles": [{"path": "tests/test_a.py", "attendu": "b2", "lu": "b2", "ok": True}], "injection": {"etat": "valide", "provenance": prov}}
    plan = f".pi-subagent-runs/{RUN}-plan.json"
    session = [{"type": "session", "timestamp": "2026-01-01T00:00:00Z", "cwd": "/repo"},
               appel_orch(0, 10, 10, [("b1", "bash", {"command": "ls"})]),
               appel_orch(0, 20, 20, [("w1", "write", {"path": plan, "content": "A"})]),
               appel_orch(0, 30, 30, [("t1", "task", {"agent": "worker"})]),
               resultat_orch("t1", "task", "Refused: plan invalid — x"),
               appel_orch(0, 40, 40, [("w2", "write", {"path": plan, "content": "B"})]),
               appel_orch(0, 50, 50, [("t2", "task", {"agent": "worker"})]),
               resultat_orch("t2", "task", f"[run {RUN}] ok", {"plan_kept": KEPT_UNITES}),
               appel_orch(1, 0, 60, [("r1", "read", {"path": f".pi-subagent-runs/{RUN}-01-worker.json"})]),
               appel_orch(1, 10, 70, [("e1", "edit", {"path": "src/a.py"})]),
               appel_orch(1, 20, 80),
               appel_orch(40, 0, 1000, [("t3", "task", {"agent": "reviewer"})])]
    ecrire_jsonl(sessions / "s.jsonl", session)
    worker = [{"type": "session", "cwd": LANE},
              tour_outils(100, [("a", "read", {"path": "src/a.py"}), ("b", "grep", {"pattern": "x"})]),
              tour_outils(110, [("c", "bash", {"command": "uv run pytest -q"})]), fin("c", "bash", True, "exit code 127"),
              tour_outils(120, [("d", "bash", {"command": ".venv/bin/python -m pytest -q"})]), fin("d", "bash"),
              tour_outils(130, [("e", "bash", {"command": "command -v python3"})]), fin("e", "bash"),
              tour_outils(140, [("f", "edit", {"path": "src/a.py"}), ("g", "bash", {"command": "ls"})]),
              tour_outils(150, [("h", "submit", {})])]
    reviewer = [{"type": "session", "cwd": LANE},
                tour_outils(200, [("a", "read", {"path": "src/a.py"}), ("b", "read", {"path": "../../../src/a.py"})]),
                debut("a", "read", {"path": "src/a.py"}), debut("b", "read", {"path": "../../../src/a.py"}),
                tour_outils(210, [("c", "submit", {"verdict": "needs_rework"})]),
                debut("c", "submit", {"verdict": "needs_rework"}),
                fin("c", "submit", True, "Refused", {"refus": {"code": "X"}, "inspection": obs}),
                tour_outils(220, [("d", "submit", {"verdict": "needs_rework"})]),
                debut("d", "submit", {"verdict": "needs_rework"}),
                fin("d", "submit", False, "ok", {"verdict": "needs_rework", "inspection": obs})]
    journal = []
    for seq, role, lignes, total, minute in ((1, "worker", worker, 750, 2), (2, "reviewer", reviewer, 630, 5)):
        nom = f"{RUN}-{seq:02d}-{role}"
        (runs / f"{nom}.json").write_text(json.dumps({"usage": {"input": total, "output": 0}, "turns": 1,
                                                      "envelope": {"status": "ok", "payload": {"verdict": "needs_rework"}}}), encoding="utf-8")
        ecrire_jsonl(runs / f"{nom}.jsonl", lignes)
        journal.append({"at": f"2026-01-01T00:{minute:02d}:00Z", "seq": seq, "role": role, "work_unit": "W01", "artifact": f"/x/{nom}.json"})
    ecrire_jsonl(runs / f"{RUN}-delegations.jsonl", journal)
    manifeste = json.loads((runs / "active-run.json").read_text(encoding="utf-8"))
    (runs / f"{RUN}-kept.json").write_text(json.dumps({"schema": "pi-kept/1", "planHash": manifeste["planHash"], "units": KEPT_UNITES}), encoding="utf-8")
    (runs / f"{RUN}-01-transmis.json").write_text(json.dumps({"run": RUN, "seq": 1, "agent": "worker", "unit": "W01", "test_contract": {
        "decision": {"etat": "transmis", "commande": "uv run pytest -q"}, "transmis": "declaree", "commande": "uv run pytest -q"}}), encoding="utf-8")
    (runs / f"{RUN}-02-transmis.json").write_text(json.dumps({"run": RUN, "seq": 2, "agent": "reviewer", "unit": "W01", "injection": {
        "provenance": {**prov, "files": [{"path": "src/a.py", "blob": "b1", "size": 5},
                                                                      {"path": "tests/test_a.py", "blob": "b2", "size": 7}]},
        "exclus": [], "octets_injectes": 12, "surcout_octets": 90}}), encoding="utf-8")
    return runs, sessions


def postes_de(t, *extra):
    code, sortie = lancer(*extra, "--postes", "--json", Path(t) / "g.json")
    g = json.loads((Path(t) / "g.json").read_text(encoding="utf-8")) if (Path(t) / "g.json").exists() else {}
    return code, sortie, g.get("postes")


class Postes(unittest.TestCase):
    """LOT-EFFICACITÉ, M : D1 et D3 versionnés, rapprochés à zéro ; compteurs lus dans les traces, jamais 0 par défaut."""

    def test_categories_d1_d3_et_compteurs(self):
        with tempfile.TemporaryDirectory() as t:
            runs, sessions = run_complet(Path(t))
            code, sortie, p = postes_de(t, runs, sessions)
            self.assertEqual(code, 0, sortie)
            d1 = {c: (x["appels"], x["tokens"]) for c, x in p["d1"].items()}
            self.assertEqual(d1["planification initiale"], (2, 30))
            self.assertEqual(d1["refus R1-a"], (1, 30))
            self.assertEqual(d1["réécriture après refus"], (1, 40))
            self.assertEqual(d1["dispatch/délégation"], (1, 50))
            self.assertEqual(d1["traitement des retours"], (1, 60))
            self.assertEqual(d1["autre / unknown"], (1, 70))
            self.assertEqual(d1["finalisation avant T"], (1, 80))
            self.assertIn("autre / unknown            [edit] · après le premier task : edit a.py", sortie)
            self.assertEqual(p["residuel_hors_r1a"], 360 - 30 - 40)
            w = p["d3_par_role"]["worker"]
            # Le tour edit + bash est mixed/other, une seule fois : les catégories somment au total.
            self.assertEqual((w["cats"]["lecture"], w["cats"]["test"], w["cats"]["environnement"], w["cats"]["mixed/other"],
                              w["cats"]["submit"]), (100, 230, 130, 140, 150))
            self.assertEqual(sum(w["cats"].values()), w["total"])
            self.assertEqual((w["tests"]["découverte / correction de la commande"], w["tests"]["validation finale"]), (110, 120))
            self.assertEqual(p["ecarts"], 0)
            self.assertIn("somme des écarts absolus = 0 (NUL)", sortie)
            k = {c: x["valeur"] for c, x in p["compteurs"].items()}
            self.assertEqual(k, {"kept_derives": 1, "kept_retires": 1, "fichiers_injectes": 2, "octets_injectes": 12,
                                 "relectures_injectees": 1, "kept_inspectes_par_injection": 1,
                                 "contrat_test": {"decision": "transmis", "premier_writer": "declaree"},
                                 "tours_decouverte_test": 1, "tours_environnement": 1})

    def test_trace_absente_n_est_jamais_zero(self):
        with tempfile.TemporaryDirectory() as t:
            runs, sessions = run_complet(Path(t))
            (runs / f"{RUN}-02-transmis.json").unlink()
            (runs / f"{RUN}-kept.json").unlink()
            (runs / f"{RUN}-01-transmis.json").unlink()
            code, sortie, p = postes_de(t, runs, sessions)
            self.assertEqual(code, 0, sortie)
            k = p["compteurs"]
            for c in ("fichiers_injectes", "octets_injectes", "relectures_injectees", "kept_inspectes_par_injection",
                      "contrat_test", "tours_decouverte_test", "tours_environnement"):
                self.assertIsNone(k[c]["valeur"], c)
                self.assertTrue(k[c]["etat"].startswith("absent"), k[c])
            # details.plan_kept publié, kept durable absent : la trace manque, le compteur n'est pas établi.
            self.assertTrue(k["kept_derives"]["etat"].startswith("non établi"), k["kept_derives"])
            self.assertIn("fichiers_injectes absent", sortie)
            self.assertNotIn("fichiers_injectes 0", sortie)

    def test_trace_partielle_ou_discordante_non_etablie(self):
        with tempfile.TemporaryDirectory() as t:
            runs, sessions = run_complet(Path(t))
            doc = json.loads((runs / f"{RUN}-kept.json").read_text(encoding="utf-8"))
            doc["units"]["W01"]["kept"] = []
            (runs / f"{RUN}-kept.json").write_text(json.dumps(doc), encoding="utf-8")
            # Une seconde revue de lane sans trace transmis.json : l'injection n'est plus établie.
            journal = rc.jsonl(str(runs / f"{RUN}-delegations.jsonl"))
            journal.append({"at": "2026-01-01T00:06:00Z", "seq": 3, "role": "reviewer", "work_unit": "W01", "artifact": f"/x/{RUN}-03-reviewer.json"})
            (runs / f"{RUN}-03-reviewer.json").write_text(json.dumps({"usage": {"input": 5, "output": 0}}), encoding="utf-8")
            ecrire_jsonl(runs / f"{RUN}-03-reviewer.jsonl", [tour_outils(5, [])])
            ecrire_jsonl(runs / f"{RUN}-delegations.jsonl", journal)
            code, sortie, p = postes_de(t, runs, sessions)
            self.assertEqual(code, 0, sortie)
            k = p["compteurs"]
            self.assertIn("details.plan_kept diffère", k["kept_derives"]["etat"])
            self.assertIn("#3", k["fichiers_injectes"]["etat"])
            self.assertTrue(k["fichiers_injectes"]["etat"].startswith("non établi"))

    def test_transcription_absente_non_etablie(self):
        with tempfile.TemporaryDirectory() as t:
            runs, sessions = run_complet(Path(t))
            (runs / f"{RUN}-01-worker.jsonl").unlink()
            code, sortie, p = postes_de(t, runs, sessions)
            self.assertEqual(code, 0, sortie)
            self.assertIn("#01 worker    avant T  transcription absente : non établi", sortie)
            self.assertIn("transcription absente : postes non établis", sortie)
            self.assertIn("worker    non établi : 1 transcription(s) absente(s)", sortie)
            self.assertEqual(p["transcriptions_absentes"], [1])
            self.assertIsNone(p["compteurs"]["tours_decouverte_test"]["valeur"])
            self.assertIn("transcription absente pour #1", p["compteurs"]["tours_decouverte_test"]["etat"])

    def test_rapprochement_non_nul_rend_1(self):
        with tempfile.TemporaryDirectory() as t:
            runs, sessions = run_complet(Path(t))
            (runs / f"{RUN}-02-reviewer.json").write_text(json.dumps({"usage": {"input": 631, "output": 0}}), encoding="utf-8")
            code, sortie, p = postes_de(t, runs, sessions)
            self.assertEqual(code, 1, sortie)
            self.assertIn("NON NUL", sortie)
            self.assertEqual(p["ecarts"], 2)

    # Adjudication de la livraison (02-10), correction 3 : jamais un faux zéro, jamais une trace contradictoire comptée.

    def _submit(self, runs, ident, f):
        p = runs / f"{RUN}-02-reviewer.jsonl"
        lignes = [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l]
        for e in lignes:
            if e.get("type") == "tool_execution_end" and e.get("toolCallId") == ident:
                f(e["result"]["details"])
        ecrire_jsonl(p, lignes)

    def test_submit_bloquant_sans_observation_non_etabli(self):
        with tempfile.TemporaryDirectory() as t:
            runs, sessions = run_complet(Path(t))
            self._submit(runs, "d", lambda det: det.pop("inspection"))
            code, sortie, p = postes_de(t, runs, sessions)
            self.assertEqual(code, 0, sortie)
            k = p["compteurs"]["kept_inspectes_par_injection"]
            self.assertIsNone(k["valeur"], k)
            self.assertTrue(k["etat"].startswith("non établi") and "#2 d" in k["etat"], k)
            self.assertNotIn("kept_inspectes_par_injection 0", sortie)

    def test_trace_d_une_autre_delegation_non_etablie(self):
        variantes = {
            "autre run": lambda d: d.update(run="fedcba9876543210"),
            "autre séquence": lambda d: d.update(seq=7),
            "provenance d'un autre run": lambda d: d["injection"]["provenance"].update(run="fedcba9876543210"),
            "provenance d'un autre plan": lambda d: d["injection"]["provenance"].update(planHash="0" * 16),
            "provenance sans arbre": lambda d: d["injection"]["provenance"].pop("tree"),
            "octets contradictoires": lambda d: d["injection"].update(octets_injectes=13),
        }
        for nom, f in variantes.items():
            with self.subTest(nom), tempfile.TemporaryDirectory() as t:
                runs, sessions = run_complet(Path(t))
                chemin = runs / f"{RUN}-02-transmis.json"
                doc = json.loads(chemin.read_text(encoding="utf-8"))
                f(doc)
                chemin.write_text(json.dumps(doc), encoding="utf-8")
                code, sortie, p = postes_de(t, runs, sessions)
                self.assertEqual(code, 0, sortie)
                for c in ("fichiers_injectes", "octets_injectes", "kept_inspectes_par_injection"):
                    x = p["compteurs"][c]
                    self.assertIsNone(x["valeur"], (nom, c, x))
                    self.assertTrue(x["etat"].startswith("non établi") and "#2" in x["etat"], (nom, c, x))
        with tempfile.TemporaryDirectory() as t:
            runs, sessions = run_complet(Path(t))
            chemin = runs / f"{RUN}-01-transmis.json"
            doc = json.loads(chemin.read_text(encoding="utf-8"))
            doc["run"] = "fedcba9876543210"
            chemin.write_text(json.dumps(doc), encoding="utf-8")
            code, sortie, p = postes_de(t, runs, sessions)
            x = p["compteurs"]["contrat_test"]
            self.assertIsNone(x["valeur"], x)
            self.assertTrue(x["etat"].startswith("non établi"), x)

    def test_par_injection_sans_controle_valide_non_etabli(self):
        variantes = {
            "contrôle en échec": lambda o: o["controles"][0].update(ok=False),
            "blob lu différent": lambda o: o["controles"][0].update(lu="b9"),
            "blob attendu différent du transmis": lambda o: o["controles"][0].update(attendu="b9", lu="b9"),
            "kept hors de la provenance": lambda o: o.update(par_injection=["tests/autre.py"],
                                                              controles=[{"path": "tests/autre.py", "attendu": "b2", "lu": "b2", "ok": True}]),
            "provenance observée d'un autre arbre": lambda o: o["injection"]["provenance"].update(tree="u" * 40),
        }
        for nom, f in variantes.items():
            with self.subTest(nom), tempfile.TemporaryDirectory() as t:
                runs, sessions = run_complet(Path(t))
                self._submit(runs, "d", lambda det: f(det["inspection"]))
                code, sortie, p = postes_de(t, runs, sessions)
                self.assertEqual(code, 0, sortie)
                x = p["compteurs"]["kept_inspectes_par_injection"]
                self.assertIsNone(x["valeur"], (nom, x))
                self.assertTrue(x["etat"].startswith("non établi") and "#2 d" in x["etat"], (nom, x))

    def test_par_injection_avec_injection_absente_ou_invalide_non_etabli(self):
        # Contrôles de blobs concordants avec la provenance transmise : seul l'état d'injection les
        # rend inexploitables (adjudication de la révision 2, correction 2).
        variantes = {
            "injection absente": lambda o: o.update(injection={"etat": "absente"}),
            "injection invalide": lambda o: o.update(injection={"etat": "invalide", "raison": "provenance illisible"}),
        }
        for nom, f in variantes.items():
            with self.subTest(nom), tempfile.TemporaryDirectory() as t:
                runs, sessions = run_complet(Path(t))
                self._submit(runs, "d", lambda det: f(det["inspection"]))
                code, sortie, p = postes_de(t, runs, sessions)
                self.assertEqual(code, 0, sortie)
                x = p["compteurs"]["kept_inspectes_par_injection"]
                self.assertIsNone(x["valeur"], (nom, x))
                self.assertTrue(x["etat"].startswith("non établi") and "#2 d" in x["etat"], (nom, x))

    def test_ligne_illisible_refuse(self):
        with tempfile.TemporaryDirectory() as t:
            runs, sessions = run_complet(Path(t))
            with open(runs / f"{RUN}-02-reviewer.jsonl", "a", encoding="utf-8") as f:
                f.write("{tronquée\n")
            code, sortie = lancer(runs, sessions, "--postes")
            self.assertEqual(code, 2, sortie)
            self.assertIn(f"{RUN}-02-reviewer.jsonl:", sortie)


# ------------------------------------------------------------------ --contexte (phase 0, mesure A, niveau B)
# Fixtures : tests/fixtures/run-cost-contexte/ (generer.py) ; attendus chiffrés : ATTENDUS.md du même dossier.
FX = ROOT / "tests" / "fixtures" / "run-cost-contexte"
FXRUN = "f0f0f0f0f0f0f0f0"
SOMME_ESTIME_RELECTURE = 9989  # Σ estimé (quarts) de relecture, identique avant et après le reclassement de l'encadrement


def fixture(t, nom):
    import shutil
    d = Path(t) / nom
    shutil.copytree(FX / nom, d)
    return d / "runs", d / "session-orchestrateur"


def contexte_de(t, runs, sessions, *extra):
    sortie_json = Path(t) / "c.json"
    code, sortie = lancer(runs, sessions, "--contexte", *extra, "--json", sortie_json)
    c = json.loads(sortie_json.read_text(encoding="utf-8"))["contexte"] if code == 0 else None
    return code, sortie, c


def deleg(c, seq):
    return next(d for d in c["delegations"] if d["seq"] == seq)


def obs(c, seq, origine):
    return deleg(c, seq)["origines_observees"].get(origine, {}).get("caracteres", 0)


def libelles(c, seq, origine):
    return deleg(c, seq)["origines_observees"].get(origine, {}).get("par_libelle", {})


def refs(c, seq, origine):
    return deleg(c, seq)["origines_observees"].get(origine, {}).get("references", [])


def lire_art(runs, nom):
    return json.loads((runs / nom).read_text(encoding="utf-8"))


def ecrire_art(runs, nom, art):
    (runs / nom).write_text(json.dumps(art), encoding="utf-8")


def reecrire(chemin, f):
    lignes = [json.loads(x) for x in chemin.read_text(encoding="utf-8").splitlines() if x.strip()]
    lignes = f(lignes)
    chemin.write_text("".join(json.dumps(x, ensure_ascii=False, sort_keys=True) + "\n" for x in lignes), encoding="utf-8")


class Contexte(unittest.TestCase):
    def test_K01_nominal_estimations_et_residus(self):
        with tempfile.TemporaryDirectory() as t:
            code, sortie, c = contexte_de(t, *fixture(t, "nominal"))
            self.assertEqual(code, 0, sortie)
            d = deleg(c, 1)
            self.assertEqual(obs(c, 1, "O-tâche"), 240)
            self.assertEqual(obs(c, 1, "O-préfixe"), 400)
            self.assertEqual(obs(c, 1, "O-sortie"), 41 + 2)
            self.assertEqual(obs(c, 1, "O-sortie-thinking"), 40)
            self.assertEqual(obs(c, 1, "O-lecture"), 9)
            v = d["variantes"]["avec_thinking"]
            self.assertEqual([x["R_q"] for x in v["tours"]], [-40, 70])
            self.assertEqual(v["bilan"]["somme_C"], 350)
            self.assertEqual(v["bilan"]["somme_estime_q"], 1370)
            self.assertEqual(d["variantes"]["sans_thinking"]["bilan"]["somme_estime_q"], 1330)
            self.assertEqual(c["par_role"]["worker"]["variantes"]["avec_thinking"]["classement"]["verdict"],
                             "attribution non établie")

    def test_K02_sans_contexte_sortie_identique_au_golden(self):
        with tempfile.TemporaryDirectory() as t:
            runs, sessions = fixture(t, "nominal")
            j = Path(t) / "g.json"
            code, sortie = lancer(runs, sessions, "--json", j)
            self.assertEqual(code, 0, sortie)
            self.assertEqual(sortie, (FX / "golden" / "nominal-sans-contexte.txt").read_text(encoding="utf-8"))
            self.assertEqual(j.read_bytes(), (FX / "golden" / "nominal-sans-contexte.json").read_bytes())

    def test_K03_redecoupage_d_une_origine_sans_effet(self):
        with tempfile.TemporaryDirectory() as t:
            runs, sessions = fixture(t, "nominal")
            tr = runs / f"{FXRUN}-01-worker.jsonl"
            def couper(lignes):
                for e in lignes:
                    m = e.get("message") or {}
                    if m.get("role") == "system":
                        m["sections"] = {"a": "P" * 201, "b": "P" * 199}
                return lignes
            reecrire(tr, couper)
            code, sortie, c = contexte_de(t, runs, sessions)
            self.assertEqual(code, 0, sortie)
            self.assertEqual(obs(c, 1, "O-préfixe"), 400)

    def test_K04_chevauchement_partiel(self):
        with tempfile.TemporaryDirectory() as t:
            code, sortie, c = contexte_de(t, *fixture(t, "relecture"))
            self.assertEqual(code, 0, sortie)
            self.assertEqual(obs(c, 1, "O-relecture"), 30 + 15)
            self.assertEqual(obs(c, 1, "O-lecture"), 585)  # lignes nouvelles seules ; l'encadrement est en O-autre (K47)

    def test_K05_plage_tronquee_lue_dans_le_pied(self):
        with tempfile.TemporaryDirectory() as t:
            code, sortie, c = contexte_de(t, *fixture(t, "relecture"))
            self.assertEqual(code, 0, sortie)
            self.assertEqual(obs(c, 1, "O-relecture"), 45)
            self.assertEqual(obs(c, 1, "O-relecture-incertaine"), 10 + 31)

    def test_K06_ecriture_invalide_les_lignes_lues(self):
        with tempfile.TemporaryDirectory() as t:
            code, sortie, c = contexte_de(t, *fixture(t, "relecture"))
            self.assertEqual(obs(c, 1, "O-relecture"), 45)
            self.assertEqual(obs(c, 1, "O-edit-write"), 35)

    def test_K07_bash_rend_la_relecture_incertaine(self):
        with tempfile.TemporaryDirectory() as t:
            code, sortie, c = contexte_de(t, *fixture(t, "relecture"))
            self.assertEqual(obs(c, 1, "O-relecture-incertaine"), 41)
            self.assertEqual(obs(c, 1, "O-bash"), 10)

    def test_K08_erreur_pied_inconnu_alias(self):
        with tempfile.TemporaryDirectory() as t:
            code, sortie, c = contexte_de(t, *fixture(t, "relecture"))
            self.assertEqual(libelles(c, 1, "O-autre")["read en erreur"], 20)
            self.assertEqual(obs(c, 1, "O-lecture"), 585)

    def test_K09_vrai_bloc_ruff(self):
        with tempfile.TemporaryDirectory() as t:
            code, sortie, c = contexte_de(t, *fixture(t, "lint"))
            self.assertEqual(code, 0, sortie)
            self.assertEqual(obs(c, 1, "O-lint"), 121 + 56)

    def test_K10_marque_litterale_sans_transport(self):
        with tempfile.TemporaryDirectory() as t:
            code, sortie, c = contexte_de(t, *fixture(t, "lint"))
            self.assertEqual(obs(c, 1, "O-edit-write"), 35 + 36 + 31)
            self.assertEqual(obs(c, 1, "O-lecture"), 31)
            self.assertEqual(obs(c, 1, "O-bash"), 40)

    def test_K11_vrai_message_mypy(self):
        with tempfile.TemporaryDirectory() as t:
            code, sortie, c = contexte_de(t, *fixture(t, "lint"))
            self.assertEqual(obs(c, 1, "O-lint"), 177)

    def test_K12_champ_entier_et_sous_chaine(self):
        with tempfile.TemporaryDirectory() as t:
            code, sortie, c = contexte_de(t, *fixture(t, "revue"))
            self.assertEqual(code, 0, sortie)
            self.assertEqual(obs(c, 5, "O-revue"), 67 + 45 + 68)

    def test_K13_sources_multiples_comptees_une_fois(self):
        with tempfile.TemporaryDirectory() as t:
            code, sortie, c = contexte_de(t, *fixture(t, "revue"))
            self.assertEqual(obs(c, 5, "O-revue"), 180)

    def test_K14_texte_generique_exclu(self):
        with tempfile.TemporaryDirectory() as t:
            code, sortie, c = contexte_de(t, *fixture(t, "revue"))
            self.assertEqual(obs(c, 5, "O-revue"), 180)
            self.assertIn("texte générique commun exclu (1 bloc(s))", deleg(c, 5)["etats"])

    def test_K15_reformulation_non_reconnue(self):
        with tempfile.TemporaryDirectory() as t:
            runs, sessions = fixture(t, "revue")
            i1 = "Le calcul des montants ignore les écritures lettrées partiellement."  # I1 de generer.py
            def sans_i1(lignes):
                for e in lignes:
                    m = e.get("message") or {}
                    if m.get("role") == "user":
                        m["content"][0]["text"] = m["content"][0]["text"].replace("Reprise. " + i1, "Reprise.")
                return lignes
            reecrire(runs / f"{FXRUN}-05-worker.jsonl", sans_i1)
            code, sortie, c = contexte_de(t, runs, sessions)
            self.assertEqual(code, 0, sortie)
            self.assertEqual(obs(c, 5, "O-revue"), 45 + 68)

    def test_K16_autre_unite_non_reconnue(self):
        with tempfile.TemporaryDirectory() as t:
            code, sortie, c = contexte_de(t, *fixture(t, "revue"))
            self.assertEqual(obs(c, 5, "O-revue"), 180)

    def test_K17_reviewer_posterieur_non_reconnu(self):
        with tempfile.TemporaryDirectory() as t:
            code, sortie, c = contexte_de(t, *fixture(t, "revue"))
            self.assertEqual(obs(c, 5, "O-revue"), 180)

    def test_K18_lien_for_risks_seulement_identifiable(self):
        with tempfile.TemporaryDirectory() as t:
            code, sortie, c = contexte_de(t, *fixture(t, "revue"))
            self.assertEqual(deleg(c, 5)["liens_for_risks"], [
                {"risque": f"{FXRUN}-02-1", "reviewer": 2, "piece": f"{FXRUN}-02-reviewer.json"},
                {"risque": f"{FXRUN}-99-1", "lien": "non documenté"}])

    def test_K19_compaction_reconstruit_le_resident(self):
        with tempfile.TemporaryDirectory() as t:
            code, sortie, c = contexte_de(t, *fixture(t, "compaction"))
            self.assertEqual(code, 0, sortie)
            seg = c["orchestrateur"]["sessions"][0]["segments"]
            self.assertEqual([g["variantes"]["avec_thinking"]["bilan"]["somme_estime_q"] for g in seg], [214, 120])
            self.assertEqual([g["variantes"]["avec_thinking"]["bilan"]["somme_C"] for g in seg], [130, 60])

    def test_K20_usage_absent_et_contexte_nul(self):
        with tempfile.TemporaryDirectory() as t:
            code, sortie, c = contexte_de(t, *fixture(t, "usage"))
            self.assertEqual(code, 0, sortie)
            tours = deleg(c, 1)["variantes"]["sans_thinking"]["tours"]
            self.assertEqual([x["etat"] for x in tours], ["ok", "contexte nul", "ok", "ok", "usage absent"])
            self.assertIsNone(tours[4]["C"])

    def test_K21_contexte_decroissant(self):
        with tempfile.TemporaryDirectory() as t:
            code, sortie, c = contexte_de(t, *fixture(t, "usage"))
            self.assertEqual(deleg(c, 1)["variantes"]["sans_thinking"]["bilan"]["tours_non_monotones"], 2)

    def test_K22_masse_residuelle_en_valeurs_absolues(self):
        with tempfile.TemporaryDirectory() as t:
            code, sortie, c = contexte_de(t, *fixture(t, "nominal"))
            b = deleg(c, 1)["variantes"]["avec_thinking"]["bilan"]
            self.assertEqual((b["somme_R_q"], b["somme_abs_R_q"]), (30, 110))

    def test_K23_entete_d_un_autre_run_refuse(self):
        with tempfile.TemporaryDirectory() as t:
            runs, sessions = fixture(t, "identite")
            def autre(lignes):
                lignes[0]["id"] = "aaaaaaaaaaaaaaaa-worker"
                return lignes
            reecrire(runs / f"{FXRUN}-01-worker.jsonl", autre)
            code, sortie, _ = contexte_de(t, runs, sessions)
            self.assertEqual(code, 2, sortie)
            self.assertIn("en-tête de session aaaaaaaaaaaaaaaa-worker", sortie)

    def test_K24_sequence_du_journal_discordante_refuse(self):
        with tempfile.TemporaryDirectory() as t:
            runs, sessions = fixture(t, "identite")
            def seq3(lignes):
                lignes[0]["seq"] = 3
                return lignes
            reecrire(runs / f"{FXRUN}-delegations.jsonl", seq3)
            code, sortie, _ = contexte_de(t, runs, sessions)
            self.assertEqual(code, 2, sortie)
            self.assertIn("délégation #3 (worker)", sortie)

    def test_K25_collision_d_evenements_refuse(self):
        with tempfile.TemporaryDirectory() as t:
            runs, sessions = fixture(t, "identite")
            def doubler(lignes):
                fins = [e for e in lignes if e.get("type") == "message_end"]
                return lignes + [fins[-1]]
            reecrire(runs / f"{FXRUN}-01-worker.jsonl", doubler)
            code, sortie, _ = contexte_de(t, runs, sessions)
            self.assertEqual(code, 2, sortie)
            self.assertIn("collision de message_end", sortie)

    def test_K26_trace_transmis_hors_effectifs(self):
        with tempfile.TemporaryDirectory() as t:
            code, sortie, c = contexte_de(t, *fixture(t, "identite"))
            self.assertEqual(code, 0, sortie)
            self.assertEqual(sorted(c["par_role"]), ["reviewer", "worker"])
            self.assertEqual(deleg(c, 2)["diff_injecte_trace"], 123)

    def test_K27_ligne_illisible_refuse(self):
        with tempfile.TemporaryDirectory() as t:
            runs, sessions = fixture(t, "identite")
            with open(runs / f"{FXRUN}-01-worker.jsonl", "a", encoding="utf-8") as f:
                f.write("{tronquée\n")
            code, sortie, _ = contexte_de(t, runs, sessions)
            self.assertEqual(code, 2, sortie)
            self.assertIn(f"{FXRUN}-01-worker.jsonl:", sortie)

    def test_K28_systeme_compte_une_fois(self):
        with tempfile.TemporaryDirectory() as t:
            code, sortie, c = contexte_de(t, *fixture(t, "nominal"))
            self.assertEqual(code, 0, sortie)
            self.assertEqual(deleg(c, 1)["origines_observees"]["O-préfixe"]["occurrences"], 1)

    def test_K29_delegation_sans_transcription_reste_attendue(self):
        with tempfile.TemporaryDirectory() as t:
            code, sortie, c = contexte_de(t, *fixture(t, "usage"))
            r = c["par_role"]["reviewer"]
            self.assertEqual((r["attendues"], r["lues"], [x["seq"] for x in r["non_etablies"]]), (1, 0, [2]))

    def test_K30_divergence_thinking_rapportee(self):
        with tempfile.TemporaryDirectory() as t:
            code, sortie, c = contexte_de(t, *fixture(t, "usage"))
            self.assertIn("O-sortie-thinking", c["par_role"]["worker"]["divergence_thinking"] or "")
            self.assertIn("DIVERGENCE", sortie)

    def test_K31_contexte_change_textes_identiques(self):
        with tempfile.TemporaryDirectory() as t:
            runs, sessions = fixture(t, "nominal")
            code0, sortie0, c0 = contexte_de(t, runs, sessions)
            self.assertEqual(code0, 0, sortie0)
            def plus10(lignes):
                for e in lignes:
                    m = e.get("message") or {}
                    if e.get("type") == "message_end" and m.get("role") == "assistant" and m["usage"]["input"] == 150:
                        m["usage"]["input"] = 160
                return lignes
            reecrire(runs / f"{FXRUN}-01-worker.jsonl", plus10)
            art = json.loads((runs / f"{FXRUN}-01-worker.json").read_text(encoding="utf-8"))
            art["usage"]["input"] += 10
            (runs / f"{FXRUN}-01-worker.json").write_text(json.dumps(art), encoding="utf-8")
            code, sortie, c1 = contexte_de(t, runs, sessions)
            self.assertEqual(code, 0, sortie)
            v0, v1 = (deleg(x, 1)["variantes"]["avec_thinking"] for x in (c0, c1))
            self.assertEqual([x["estime_q"] for x in v0["tours"]], [x["estime_q"] for x in v1["tours"]])
            self.assertEqual(v1["tours"][0]["R_q"] - v0["tours"][0]["R_q"], 40)

    def test_K32_parts_non_renormalisees(self):
        with tempfile.TemporaryDirectory() as t:
            code, sortie, c = contexte_de(t, *fixture(t, "usage"))
            parts = c["par_role"]["worker"]["variantes"]["avec_thinking"]["classement"]["parts"]
            self.assertGreater(sum(p["part"] for p in parts), 1)

    def test_K33_marque_mypy_hors_transport(self):
        with tempfile.TemporaryDirectory() as t:
            code, sortie, c = contexte_de(t, *fixture(t, "lint"))
            self.assertEqual(obs(c, 1, "O-autre"), 59)

    def test_K34_branche_ambigue_non_etablie(self):
        with tempfile.TemporaryDirectory() as t:
            code, sortie, c = contexte_de(t, *fixture(t, "compaction-ambigue"))
            self.assertEqual(code, 0, sortie)
            self.assertEqual(c["orchestrateur"]["sessions"][0]["etats"], ["non établie : branche ambiguë dans la session"])

    def test_K35_somme_des_tours_differente_refuse(self):
        with tempfile.TemporaryDirectory() as t:
            runs, sessions = fixture(t, "nominal")
            art = json.loads((runs / f"{FXRUN}-01-worker.json").read_text(encoding="utf-8"))
            art["usage"]["output"] += 1
            (runs / f"{FXRUN}-01-worker.json").write_text(json.dumps(art), encoding="utf-8")
            code, sortie, _ = contexte_de(t, runs, sessions)
            self.assertEqual(code, 2, sortie)
            self.assertIn("champ output", sortie)

    def test_K36_artefact_hors_journal_refuse(self):
        with tempfile.TemporaryDirectory() as t:
            runs, sessions = fixture(t, "identite")
            reecrire(runs / f"{FXRUN}-delegations.jsonl", lambda l: l[:1])
            code, sortie, _ = contexte_de(t, runs, sessions)
            self.assertEqual(code, 2, sortie)
            self.assertIn("absent du journal des délégations", sortie)

    def test_K37_rapprochement_interne_en_defaut_arrete(self):
        from unittest import mock
        vrai = rc.ctx_bilan

        def fausse(tours):
            b = vrai(tours)
            b["somme_R_q"] += 1
            return b
        with tempfile.TemporaryDirectory() as t:
            runs, sessions = fixture(t, "nominal")
            with mock.patch.object(rc, "ctx_bilan", fausse):
                code, sortie, _ = contexte_de(t, runs, sessions)
            self.assertEqual(code, 1, sortie)
            self.assertIn("INCOHÉRENCE INTERNE (--contexte) — délégation #1 avec_thinking", sortie)

    # ---- corrections R1–R6 de la revue r3 (décision 6ea3062b) : K38–K47
    def test_K38_sequence_portee_par_deux_artefacts_refuse(self):
        with tempfile.TemporaryDirectory() as t:
            runs, sessions = fixture(t, "identite")
            for ext in (".json", ".jsonl"):
                (runs / f"{FXRUN}-02-reviewer{ext}").rename(runs / f"{FXRUN}-01-reviewer{ext}")
            def seq1(lignes):
                lignes[1]["seq"] = 1
                lignes[1]["artifact"] = f"/x/.pi-subagent-runs/{FXRUN}-01-reviewer.json"
                return lignes
            reecrire(runs / f"{FXRUN}-delegations.jsonl", seq1)
            code, sortie, _ = contexte_de(t, runs, sessions)
            self.assertEqual(code, 2, sortie)
            self.assertIn(f"séquence #1 portée par deux artefacts, {FXRUN}-01-worker.json et {FXRUN}-01-reviewer.json", sortie)

    def _revue_risques(self, t, for_risks, evenements):
        runs, sessions = fixture(t, "revue")
        def w5(lignes):
            for x in lignes:
                if x["seq"] == 5:
                    x["for_risks"] = x["for_risks"] + for_risks
            return lignes
        reecrire(runs / f"{FXRUN}-delegations.jsonl", w5)
        reecrire(runs / f"{FXRUN}-risks.jsonl", lambda l: l + evenements)
        code, sortie, c = contexte_de(t, runs, sessions)
        self.assertEqual(code, 0, sortie)
        return {x["risque"]: x for x in deleg(c, 5)["liens_for_risks"]}

    def test_K39_for_risks_autre_run_ou_autre_role_non_documente(self):
        with tempfile.TemporaryDirectory() as t:
            liens = self._revue_risques(t, [f"{FXRUN}-02-2", f"{FXRUN}-02-3"], [
                {"at": "2026-01-01T00:00:03.000Z", "event": "opened", "id": f"{FXRUN}-02-2", "by": "/x/.pi-subagent-runs/aaaaaaaaaaaaaaaa-02-reviewer.json"},
                {"at": "2026-01-01T00:00:03.000Z", "event": "opened", "id": f"{FXRUN}-02-3", "by": f"/x/.pi-subagent-runs/{FXRUN}-02-worker.json"}])
            self.assertEqual(liens[f"{FXRUN}-02-1"], {"risque": f"{FXRUN}-02-1", "reviewer": 2, "piece": f"{FXRUN}-02-reviewer.json"})
            self.assertEqual(liens[f"{FXRUN}-02-2"], {"risque": f"{FXRUN}-02-2", "lien": "non documenté"})
            self.assertEqual(liens[f"{FXRUN}-02-3"], {"risque": f"{FXRUN}-02-3", "lien": "non documenté"})

    def test_K40_for_risks_evenement_contradictoire_ou_sans_source_non_documente(self):
        with tempfile.TemporaryDirectory() as t:
            liens = self._revue_risques(t, [f"{FXRUN}-02-4", f"{FXRUN}-03-5"], [
                {"at": "2026-01-01T00:00:03.000Z", "event": "opened", "id": f"{FXRUN}-02-1", "by": f"/x/.pi-subagent-runs/{FXRUN}-02-reviewer.json"},
                {"at": "2026-01-01T00:00:03.000Z", "event": "opened", "id": f"{FXRUN}-02-4", "by": f"/x/.pi-subagent-runs/{FXRUN}-02-reviewer.json"},
                {"at": "2026-01-01T00:00:03.000Z", "event": "opened", "id": f"{FXRUN}-02-4", "by": f"/x/.pi-subagent-runs/{FXRUN}-03-reviewer.json"},
                {"at": "2026-01-01T00:00:03.000Z", "event": "opened", "id": f"{FXRUN}-03-5"}])
            self.assertEqual(liens[f"{FXRUN}-02-1"]["reviewer"], 2)  # doublon identique : lien maintenu
            self.assertEqual(liens[f"{FXRUN}-02-4"], {"risque": f"{FXRUN}-02-4", "lien": "non documenté"})
            self.assertEqual(liens[f"{FXRUN}-03-5"], {"risque": f"{FXRUN}-03-5", "lien": "non documenté"})

    def test_K41_champ_d_usage_absent_de_l_artefact_n_est_pas_zero(self):
        with tempfile.TemporaryDirectory() as t:
            runs, sessions = fixture(t, "nominal")
            code, sortie, c = contexte_de(t, runs, sessions)
            self.assertEqual(code, 0, sortie)
            self.assertEqual(deleg(c, 1)["rapprochement"], "rapproché")  # vrai zéro présent : contrôle nominal
            art = lire_art(runs, f"{FXRUN}-01-worker.json")
            del art["usage"]["cacheWrite"]  # cacheWrite = 0 dans tous les tours
            ecrire_art(runs, f"{FXRUN}-01-worker.json", art)
            code, sortie, c = contexte_de(t, runs, sessions)
            self.assertEqual(code, 0, sortie)
            d = deleg(c, 1)
            self.assertEqual(d["rapprochement"], "non établi")
            self.assertIn("non établie pour le rapprochement : champ cacheWrite absent de l'artefact", d["etats"])
            self.assertNotIn("cacheWrite", d["usage_artefact"])

    def test_K42_turns_absent_de_l_artefact_n_est_pas_zero(self):
        with tempfile.TemporaryDirectory() as t:
            runs, sessions = fixture(t, "nominal")
            art = lire_art(runs, f"{FXRUN}-01-worker.json")
            del art["turns"]
            ecrire_art(runs, f"{FXRUN}-01-worker.json", art)
            code, sortie, c = contexte_de(t, runs, sessions)
            self.assertEqual(code, 0, sortie)
            d = deleg(c, 1)
            self.assertEqual(d["rapprochement"], "non établi")
            self.assertIn("non établie pour le rapprochement : champ turns absent de l'artefact", d["etats"])

    def test_K43_booleen_n_est_pas_un_entier_de_comptage(self):
        with self.subTest("artefact"), tempfile.TemporaryDirectory() as t:
            runs, sessions = fixture(t, "nominal")
            art = lire_art(runs, f"{FXRUN}-01-worker.json")
            art["usage"]["cacheWrite"] = False
            ecrire_art(runs, f"{FXRUN}-01-worker.json", art)
            code, sortie, _ = contexte_de(t, runs, sessions)
            self.assertEqual(code, 2, sortie)
            self.assertIn("champ cacheWrite de l'artefact non entier (False)", sortie)
        with self.subTest("tours"), tempfile.TemporaryDirectory() as t:
            runs, sessions = fixture(t, "nominal")
            def faux(lignes):
                for e in lignes:
                    m = e.get("message") or {}
                    if m.get("role") == "assistant":
                        m["usage"]["cacheWrite"] = False
                return lignes
            reecrire(runs / f"{FXRUN}-01-worker.jsonl", faux)
            code, sortie, c = contexte_de(t, runs, sessions)
            self.assertEqual(code, 0, sortie)
            self.assertEqual(deleg(c, 1)["rapprochement"], "non établi")

    def test_K44_masses_connues_d_une_delegation_sans_transcription(self):
        with tempfile.TemporaryDirectory() as t:
            runs, sessions = fixture(t, "usage")
            art = {"runId": FXRUN, "role": "worker", "model": "m", "task": "t", "turns": 1, "durationMs": 1,
                   "usage": {"input": 70, "output": 2, "cacheRead": 5, "cacheWrite": 0, "total": 77},
                   "envelope": {"role": "worker", "status": "ok", "payload": {}}}
            ecrire_art(runs, f"{FXRUN}-03-worker.json", art)
            reecrire(runs / f"{FXRUN}-delegations.jsonl", lambda l: l + [
                {"at": "2026-01-01T00:00:03.000Z", "seq": 3, "role": "worker", "work_unit": "W01",
                 "artifact": f"/x/.pi-subagent-runs/{FXRUN}-03-worker.json", "for_risks": [], "failure": None}])
            code, sortie, c = contexte_de(t, runs, sessions)
            self.assertEqual(code, 0, sortie)
            w = c["par_role"]["worker"]
            self.assertEqual((w["attendues"], w["lues"]), (2, 1))
            self.assertEqual((w["masse_observee"], w["masse_attendue_connue"], w["masse_attendue_inconnue"]), (450, 525, []))
            self.assertEqual([(x["seq"], x["masse_attendue"]) for x in w["non_etablies"]], [(3, 75)])
            perimetre = "sous-ensemble observé : 1 délégation(s) lue(s) sur 2 attendue(s)"
            self.assertEqual(w["perimetre"], perimetre)
            self.assertEqual(w["variantes"]["avec_thinking"]["classement"]["perimetre"], perimetre)
            self.assertIn(perimetre, sortie)

    def test_K45_origine_tracable_a_chaque_appel(self):
        with tempfile.TemporaryDirectory() as t:
            code, sortie, c = contexte_de(t, *fixture(t, "relecture"))
            self.assertEqual(code, 0, sortie)
            membre = f"{FXRUN}-01-worker.jsonl"
            self.assertEqual([(r["membre"], r["appel"], r["outil"], r["lignes"]) for r in refs(c, 1, "O-lecture")], [
                (membre, "c1", "read", [[1, 10]]), (membre, "c2", "read", [[11, 100]]), (membre, "c3", "read", [[1, 3]]),
                (membre, "c4", "read", [[4, 5]]), (membre, "c6", "read", [[1, 10]]), (membre, "c11", "read", [[1, 2]])])
            self.assertEqual([(r["appel"], r["lignes"]) for r in refs(c, 1, "O-relecture")], [("c2", [[5, 10]]), ("c4", [[1, 3]])])
            self.assertTrue(all(isinstance(r["message"], int) for r in refs(c, 1, "O-lecture")))

    def test_K46_references_de_revue_conservees_apres_fusion(self):
        with tempfile.TemporaryDirectory() as t:
            code, sortie, c = contexte_de(t, *fixture(t, "revue"))
            self.assertEqual(code, 0, sortie)
            self.assertEqual(obs(c, 5, "O-revue"), 180)
            self.assertEqual(sorted((r["reviewer"], r["artefact"], r["champ"]) for r in refs(c, 5, "O-revue")), [
                (2, f"{FXRUN}-02-reviewer.json", "findings[0].fix"), (2, f"{FXRUN}-02-reviewer.json", "findings[0].issue"),
                (2, f"{FXRUN}-02-reviewer.json", "open_risks[0]"), (3, f"{FXRUN}-03-reviewer.json", "findings[0].issue"),
                (3, f"{FXRUN}-03-reviewer.json", "open_risks[0]")])
            i1 = [r["intervalle_tache"] for r in refs(c, 5, "O-revue") if r["champ"] == "findings[0].issue"]
            self.assertEqual(len(i1), 2)
            self.assertEqual(i1[0], i1[1])  # même intervalle, deux sources, caractères comptés une fois

    def test_K47_encadrement_de_read_hors_lignes_nouvelles(self):
        with tempfile.TemporaryDirectory() as t:
            code, sortie, c = contexte_de(t, *fixture(t, "relecture"))
            self.assertEqual(code, 0, sortie)
            self.assertEqual((obs(c, 1, "O-lecture"), obs(c, 1, "O-relecture"), libelles(c, 1, "O-autre")),
                             (585, 45, {"encadrement de read": 50, "read en erreur": 20}))
            enc = [r for r in refs(c, 1, "O-autre") if r["appel"] == "c3"]
            self.assertEqual(len(enc), 1)
            self.assertNotIn("lignes", enc[0])
            self.assertEqual(deleg(c, 1)["variantes"]["avec_thinking"]["bilan"]["somme_estime_q"], SOMME_ESTIME_RELECTURE)

    # ---- correction C1 de la revue r4 (décision 27f08c00) : K48
    def test_K48_masse_attendue_inconnue_si_champ_absent_de_l_artefact(self):
        with tempfile.TemporaryDirectory() as t:
            runs, sessions = fixture(t, "nominal")
            code, sortie, c = contexte_de(t, runs, sessions)
            self.assertEqual(code, 0, sortie)
            w = c["par_role"]["worker"]  # contrôle nominal : vrai zéro présent, masse attendue connue
            self.assertEqual((deleg(c, 1)["masse_attendue"], w["masse_attendue_connue"], w["masse_attendue_inconnue"],
                              w["masse_observee"]), (350, 350, [], 350))
            art = lire_art(runs, f"{FXRUN}-01-worker.json")
            del art["usage"]["cacheWrite"]  # tous les tours portent cacheWrite = 0 explicitement
            ecrire_art(runs, f"{FXRUN}-01-worker.json", art)
            code, sortie, c = contexte_de(t, runs, sessions)
            self.assertEqual(code, 0, sortie)
            w = c["par_role"]["worker"]
            self.assertIsNone(deleg(c, 1)["masse_attendue"])
            self.assertEqual((w["masse_attendue_connue"], w["masse_attendue_inconnue"], w["masse_observee"]), (0, [1], 350))
            self.assertIn("masse attendue inconnue : #1", sortie)


if __name__ == "__main__":
    unittest.main(verbosity=0)
