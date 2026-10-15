#!/usr/bin/env python3
"""
Génère les fixtures synthétiques de `run-cost --contexte` (phase 0). Déterministe : relancé, il réécrit
les mêmes octets. Aucune donnée réelle. Les attendus chiffrés sont dans ATTENDUS.md.

    python3 tests/fixtures/run-cost-contexte/generer.py
"""
import hashlib
import json
import shutil
from pathlib import Path

ICI = Path(__file__).resolve().parent
RUN = "f0f0f0f0f0f0f0f0"
T0 = "2026-01-01T00:00:"


def ts(n):
    return f"{T0}{n:02d}.000Z"


def ecrire(p, lignes):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("".join(json.dumps(x, ensure_ascii=False, sort_keys=True) + "\n" for x in lignes), encoding="utf-8")


def socle(d, unites=("W01",)):
    # pas « sessions/ » : le .gitignore du dépôt ignore tout dossier de ce nom, et la fixture manquerait au clone
    runs, sessions = d / "runs", d / "session-orchestrateur"
    runs.mkdir(parents=True)
    sessions.mkdir(parents=True)
    plan = json.dumps({"version": 1, "work_units": [{"id": u, "goal": "g", "depends_on": [], "expected_write_scope": ["src"]} for u in unites]})
    (runs / f"{RUN}-plan.json").write_text(plan, encoding="utf-8")
    (runs / "active-run.json").write_text(json.dumps({"version": 2, "runId": RUN, "status": "active", "nextSeq": 1,
                                                      "plan": f"{RUN}-plan.json",
                                                      "planHash": hashlib.sha256(plan.encode()).hexdigest()[:16]}), encoding="utf-8")
    ecrire(runs / f"{RUN}-lanes.jsonl", [{"ledger": 2}])
    ecrire(sessions / "s.jsonl", [
        {"type": "session", "version": 3, "id": "s0", "timestamp": ts(0), "cwd": "/d"},
        {"type": "message", "id": "e1", "parentId": "s0", "timestamp": ts(1),
         "message": {"role": "user", "timestamp": ts(1), "content": [{"type": "text", "text": "U" * 80}]}},
        {"type": "message", "id": "e2", "parentId": "e1", "timestamp": ts(2),
         "message": {"role": "assistant", "timestamp": ts(2), "content": [{"type": "text", "text": "A" * 20}],
                     "usage": {"input": 30, "output": 5, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 35}}},
        {"type": "message", "id": "e3", "parentId": "e2", "timestamp": ts(3),
         "message": {"role": "toolResult", "toolCallId": "t", "toolName": "task", "timestamp": ts(3),
                     "content": [{"type": "text", "text": f"[run {RUN}] ok"}]}},
    ])
    return runs, sessions


class Delegation:
    """Une délégation : messages finalisés, émis en message_start / message_end (système compris)."""

    def __init__(self, seq, role, unite="W01", cwd="/w", task="", for_risks=()):
        self.seq, self.role, self.unite, self.cwd, self.task = seq, role, unite, cwd, task
        self.for_risks = list(for_risks)
        self.ev = [{"type": "session", "version": 3, "id": f"{RUN}-{role}", "timestamp": ts(0), "cwd": cwd},
                   {"type": "agent_start"}]
        self.n, self.ids, self.payload = 0, 0, {}
        self.usages = []

    def _t(self):
        self.n += 1
        return ts(self.n)

    def systeme(self, sections):
        m = {"role": "system", "content": "", "sections": sections, "timestamp": self._t()}
        self.ev += [{"type": "message_start", "message": m}, {"type": "message_end", "message": m}]

    def user(self, texte_, apres_turn_end=False):
        if apres_turn_end:
            self.ev.append({"type": "turn_end"})
        m = {"role": "user", "content": [{"type": "text", "text": texte_}], "timestamp": self._t()}
        self.ev += [{"type": "message_start", "message": m}, {"type": "message_end", "message": m}]

    def assistant(self, contexte_, blocs, sortie=5, usage=True):
        self.ev.append({"type": "turn_start"})
        m = {"role": "assistant", "content": blocs, "timestamp": self._t()}
        if usage:
            m["usage"] = {"input": contexte_, "output": sortie, "cacheRead": 0, "cacheWrite": 0,
                          "totalTokens": contexte_ + sortie}
            self.usages.append(m["usage"])
        else:
            self.usages.append(None)
        self.ev += [{"type": "message_start", "message": m}, {"type": "message_update"}, {"type": "message_end", "message": m}]

    def appel(self, nom, args):
        self.ids += 1
        return {"type": "toolCall", "id": f"c{self.ids}", "name": nom, "arguments": args}

    def resultat(self, appel, blocs, erreur=False):
        if isinstance(blocs, str):
            blocs = [{"type": "text", "text": blocs}]
        m = {"role": "toolResult", "toolCallId": appel["id"], "toolName": appel["name"], "content": blocs,
             "isError": erreur, "timestamp": self._t()}
        self.ev += [{"type": "message_start", "message": m}, {"type": "message_end", "message": m}]
        self.ev.append({"type": "turn_end"})

    def ecrire(self, runs, transcription=True):
        nom = f"{RUN}-{self.seq:02d}-{self.role}"
        u = [x for x in self.usages if x]
        usage = {k: sum(x[k] for x in u) for k in ("input", "output", "cacheRead", "cacheWrite")}
        usage["total"] = sum(usage.values())
        art = {"runId": RUN, "role": self.role, "model": "m", "task": self.task, "turns": len(self.usages),
               "durationMs": 1000, "usage": usage, "envelope": {"role": self.role, "status": "ok",
                                                               "payload": self.payload}}
        (runs / f"{nom}.json").write_text(json.dumps(art, ensure_ascii=False, sort_keys=True), encoding="utf-8")
        if transcription:
            ecrire(runs / f"{nom}.jsonl", self.ev)
        return {"at": ts(self.seq), "seq": self.seq, "role": self.role, "work_unit": self.unite,
                "artifact": f"/x/.pi-subagent-runs/{nom}.json", "for_risks": self.for_risks, "failure": None}


def journal(runs, lignes):
    ecrire(runs / f"{RUN}-delegations.jsonl", lignes)


# ------------------------------------------------------------------ nominal (K1, K2, K22, K28, K31, K32)
def nominal(d):
    runs, _ = socle(d)
    w = Delegation(1, "worker", task="T" * 200 + "é" * 40)
    w.systeme({"preamble": "P" * 400})
    w.user("T" * 200 + "é" * 40)
    lire = w.appel("read", {"path": "a.py", "offset": 1, "limit": 10})
    w.assistant(150, [{"type": "thinking", "thinking": "h" * 40}, lire])
    w.resultat(lire, "l1\nl2\nl3\n")
    w.assistant(200, [{"type": "text", "text": "ok"}])
    journal(runs, [w.ecrire(runs)])


# ------------------------------------------------------------------ relecture (K4–K8)
def relecture(d):
    runs, _ = socle(d)
    w = Delegation(1, "worker", task="tâche")
    w.systeme({"preamble": "S" * 40})
    w.user("tâche")
    a10 = "".join(f"A{i:03d}\n" for i in range(1, 11))                 # a.py 1–10 : 10 × 5 caractères
    a5_100 = "".join(f"A{i:03d}\n" for i in range(5, 101))             # a.py 5–100 : 96 × 5
    b_tronque = "".join(f"B{i:03d}\n" for i in range(1, 4)) + "\n[7 more lines in file. Use offset=4 to continue.]"
    b1_5 = "".join(f"B{i:03d}\n" for i in range(1, 6))
    pas = [
        ("read", {"path": "a.py", "offset": 1, "limit": 10}, a10, False),          # t2 : nouveau 50
        ("read", {"path": "a.py", "offset": 5, "limit": 96}, a5_100, False),        # t3 : relu 6×5, nouveau 90×5 (K4)
        ("read", {"path": "b.py", "offset": 1, "limit": 10}, b_tronque, False),     # t4 : plage 1–3 (K5)
        ("read", {"path": "b.py", "offset": 1, "limit": 5}, b1_5, False),           # t5 : relu 3×5, nouveau 2×5 (K5)
        ("edit", {"path": "a.py", "oldText": "x", "newText": "y"}, "Successfully replaced text in a.py.", False),
        ("read", {"path": "a.py", "offset": 1, "limit": 10}, a10, False),          # t7 : nouveau 50 (K6)
        ("bash", {"command": "ls"}, "a.py\nb.py\n", False),
        ("read", {"path": "b.py", "offset": 1, "limit": 2}, "B001\nB002\n", False),  # t9 : incertain 10 (K7)
        ("read", {"path": "c.py"}, "ENOENT: no such file", True),                  # t10 : O-autre (K8)
        ("read", {"path": "d.py", "offset": 1}, "D001\n[Output truncated at 50KB]", False),  # t11 : incertain (K8)
        ("read", {"path": "lien/a.py", "offset": 1, "limit": 2}, "A001\nA002\n", False),  # t12 : alias → nouveau (K8)
    ]
    contexte_ = 100
    appels = []
    for nom, args, res, err in pas:
        c = w.appel(nom, args)
        w.assistant(contexte_, [c])
        w.resultat(c, res, erreur=err)
        contexte_ += 100
    w.assistant(contexte_, [{"type": "text", "text": "fin"}])
    journal(runs, [w.ecrire(runs)])


# ------------------------------------------------------------------ lint (K9–K11)
def lint(d):
    runs, _ = socle(d)
    w = Delegation(1, "worker", task="tâche")
    w.systeme({"preamble": "S" * 40})
    w.user("tâche")
    ruff = "\n\n--- ruff (x.py) ---\nx.py:1:1: E1 erreur\nFix these before continuing. Do not proceed to the next edit with ruff failing."
    e1 = w.appel("edit", {"path": "x.py", "oldText": "a", "newText": "b"})
    w.assistant(100, [e1])
    w.resultat(e1, [{"type": "text", "text": "Successfully replaced text in x.py."}, {"type": "text", "text": ruff}])
    e2 = w.appel("edit", {"path": "y.txt", "oldText": "a", "newText": "b"})
    w.assistant(200, [e2])
    w.resultat(e2, [{"type": "text", "text": "Successfully replaced text in y.txt."},
                    {"type": "text", "text": "\n\n--- ruff (y.txt) ---\nlitteral"}])
    r = w.appel("read", {"path": "z.py", "offset": 1})
    w.assistant(300, [r])
    w.resultat(r, "# cite\n--- ruff (z.py) ---\nfin\n")
    b = w.appel("bash", {"command": "cat log"})
    w.assistant(400, [b])
    w.resultat(b, "\n\n--- ruff (x.py) ---\nsortie arbitraire\n")
    w.user("mypy failed on files edited this turn:\n\nx.py:2: error: e", apres_turn_end=True)
    w.assistant(500, [{"type": "text", "text": "vu"}])
    w.user("mypy failed on files edited this turn: cité par l'opérateur")
    w.assistant(600, [{"type": "text", "text": "fin"}])
    journal(runs, [w.ecrire(runs)])


# ------------------------------------------------------------------ revue (K12–K18)
I1 = "Le calcul des montants ignore les écritures lettrées partiellement."      # 67 caractères
F1 = "Filtrer les écritures par statut de lettrage avant l'agrégation finale."   # 71 caractères
R1 = "Risque ouvert : la reprise ne relit pas le fichier de configuration."     # 68 caractères
Z1 = "Autre unité : la sortie CSV perd l'encodage des colonnes accentuées."      # 68 caractères
Y1 = "Revue postérieure : le test de reprise dépend de l'heure locale du poste." # 73 caractères
G1 = "Respecter strictement le périmètre d'écriture déclaré dans le plan gelé." # 72 caractères


def revue(d):
    runs, _ = socle(d, unites=("W01", "W02"))
    lignes = []
    w1 = Delegation(1, "worker", task="Première tâche. " + G1)
    w1.systeme({"preamble": "S" * 40}); w1.user(w1.task); w1.assistant(50, [{"type": "text", "text": "x"}])
    lignes.append(w1.ecrire(runs))
    r2 = Delegation(2, "reviewer")
    r2.payload = {"verdict": "needs_rework", "findings": [{"issue": I1, "fix": F1, "impact": "court", "severity": "HIGH",
                                                          "confidence": "certain", "location": "a.py"},
                                                         {"issue": G1, "fix": "", "impact": 3}],
                  "open_risks": [R1]}
    r2.systeme({"preamble": "R" * 40}); r2.user("revue"); r2.assistant(50, [{"type": "text", "text": "x"}])
    lignes.append(r2.ecrire(runs))
    r3 = Delegation(3, "reviewer")
    r3.payload = {"verdict": "needs_rework", "findings": [{"issue": I1}], "open_risks": [R1]}
    r3.systeme({"preamble": "R" * 40}); r3.user("revue"); r3.assistant(50, [{"type": "text", "text": "x"}])
    lignes.append(r3.ecrire(runs))
    r4 = Delegation(4, "reviewer", unite="W02")
    r4.payload = {"verdict": "needs_rework", "findings": [{"issue": Z1}], "open_risks": []}
    r4.systeme({"preamble": "R" * 40}); r4.user("revue"); r4.assistant(50, [{"type": "text", "text": "x"}])
    lignes.append(r4.ecrire(runs))
    reformule = I1.replace("montants", "montant").replace("écritures", "ecritures")
    tache = ("Reprise. " + I1 + " | " + F1[:45] + " | " + R1 + " | " + R1 + " | " + Z1 + " | " + reformule + " | "
             + Y1 + " | " + G1)
    w5 = Delegation(5, "worker", task=tache, for_risks=[f"{RUN}-02-1", f"{RUN}-99-1"])
    w5.systeme({"preamble": "S" * 40 + G1})
    w5.user(tache)
    w5.assistant(500, [{"type": "text", "text": "x"}])
    lignes.append(w5.ecrire(runs))
    r6 = Delegation(6, "reviewer")
    r6.payload = {"verdict": "approved", "findings": [{"issue": Y1}], "open_risks": []}
    r6.systeme({"preamble": "R" * 40}); r6.user("revue"); r6.assistant(50, [{"type": "text", "text": "x"}])
    lignes.append(r6.ecrire(runs))
    journal(runs, lignes)
    ecrire(runs / f"{RUN}-risks.jsonl", [
        {"at": ts(2), "event": "opened", "id": f"{RUN}-02-1", "by": f"/x/.pi-subagent-runs/{RUN}-02-reviewer.json"}])


# ------------------------------------------------------------------ compaction (K19)
def compaction(d, ambigue=False):
    runs, sessions = socle(d)
    w = Delegation(1, "worker", task="t")
    w.systeme({"preamble": "S" * 4}); w.user("t"); w.assistant(10, [{"type": "text", "text": "x"}])
    journal(runs, [w.ecrire(runs)])

    def msg(i, parent, role, texte_, usage=None):
        m = {"role": role, "timestamp": ts(i), "content": [{"type": "text", "text": texte_}]}
        if usage is not None:
            m["usage"] = {"input": usage, "output": 1, "cacheRead": 0, "cacheWrite": 0, "totalTokens": usage + 1}
        return {"type": "message", "id": f"e{i}", "parentId": parent, "timestamp": ts(i), "message": m}
    lignes = [{"type": "session", "version": 3, "id": "s0", "timestamp": ts(0), "cwd": "/d"},
              msg(1, "s0", "user", "U" * 40 + f" [run {RUN}]"),
              msg(2, "e1", "assistant", "A" * 8, usage=50),
              msg(3, "e2", "user", "V" * 80),
              msg(4, "e3", "assistant", "B" * 8, usage=80),
              {"type": "compaction", "id": "c5", "parentId": "e4", "timestamp": ts(5), "summary": "Z" * 20,
               "firstKeptEntryId": "e3", "tokensBefore": 80},
              msg(6, "c5", "user", "W" * 12),
              msg(7, "e6", "assistant", "C" * 8, usage=60)]
    if ambigue:
        lignes.append(msg(8, "e6", "assistant", "D" * 8, usage=61))
    ecrire(sessions / "s.jsonl", lignes)


# ------------------------------------------------------------------ usage (K20, K21, K29, K30)
def usage(d):
    runs, _ = socle(d)
    w = Delegation(1, "worker", task="t")
    w.systeme({"preamble": "S" * 400})
    w.user("t" * 40)
    w.assistant(200, [{"type": "thinking", "thinking": "h" * 4000}, {"type": "text", "text": "a"}])
    w.assistant(0, [{"type": "text", "text": "b"}])                    # contexte nul (K20)
    w.assistant(150, [{"type": "text", "text": "c"}])                  # décroissant ? non : 0 → 150 croît
    w.assistant(100, [{"type": "text", "text": "d"}])                  # 150 → 100 : non monotone (K21)
    w.assistant(0, [{"type": "text", "text": "e"}], usage=False)       # usage absent (K20)
    r = Delegation(2, "reviewer")                                      # transcription absente (K29)
    r.assistant(10, [{"type": "text", "text": "x"}])
    journal(runs, [w.ecrire(runs), r.ecrire(runs, transcription=False)])


# ------------------------------------------------------------------ identité (K23–K27)
def identite(d):
    runs, _ = socle(d)
    w = Delegation(1, "worker", task="t")
    w.systeme({"preamble": "S" * 40}); w.user("t"); w.assistant(20, [{"type": "text", "text": "x"}])
    r = Delegation(2, "reviewer")
    r.systeme({"preamble": "R" * 40}); r.user("revue"); r.assistant(20, [{"type": "text", "text": "x"}])
    journal(runs, [w.ecrire(runs), r.ecrire(runs)])
    (runs / f"{RUN}-02-transmis.json").write_text(json.dumps({"injection": {"etat": "valide", "octets_injectes": 123}}),
                                                  encoding="utf-8")


def main():
    for f in (nominal, relecture, lint, revue, usage, identite):
        d = ICI / f.__name__
        if d.exists():
            shutil.rmtree(d)
        f(d)
    for nom, amb in (("compaction", False), ("compaction-ambigue", True)):
        d = ICI / nom
        if d.exists():
            shutil.rmtree(d)
        compaction(d, ambigue=amb)


if __name__ == "__main__":
    main()
