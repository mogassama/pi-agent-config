/**
 * l0-q5-volets-session.test.ts — L0, phase 2 : les volets en session de Q-P2-5, en couvertures.
 *
 * Q-P2-5 (`142cb15d…`) a déplacé six reprises au refus de la montée sur un état illisible ; les
 * portes du runtime qu'elles traversaient ne sont plus atteintes que si la corruption suit une
 * montée admise. `execute-harness.test.ts` porte ces quatre volets en session ; Q-P2-10
 * (`89b911f0…`, option (b)) les éprouve aussi ici, sous L0, pour que `l0-mutants` puisse retirer
 * chaque porte et exiger un rouge sur la propriété.
 *
 *   V1  intégrations LOST                       porte des tentatives à trancher (M-Q5-1)
 *   V2  intégrations UNKNOWN, deux formes       porte des tentatives à trancher (M-Q5-1)
 *   V3  lanes malformées, tentative ouverte     porte du registre des lanes malformé (M-Q5-2)
 *   V4  lanes amputées après revue approuvée    porte du registre des lanes malformé (M-Q5-2)
 *
 * La montée est admise avant la corruption, dans la même session (`monter` : `session_start`,
 * `/subagents on`, une invite). Montage : `l0-b2-harness.ts` et le stub de dispatch seulement.
 * Les volets d'`execute-harness.test.ts` restent en place.
 */
import { test, type TestContext } from "node:test";
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { APPELS, PILOTE } from "./stubs/dispatch.ts";
import {
  aJeter, compter, ecrire, git, monter, precondition, propriete, revue, tache, texte, type Harnais,
} from "./l0-b2-harness.ts";

type Preuve = (t: TestContext) => Promise<void> | void;
function couverture(id: string, titre: string, fn: Preuve): void {
  test(`L0 COUV ${id} — ${titre}`, fn);
}
test.after(() => {
  for (const d of aJeter()) rmSync(d, { recursive: true, force: true });
});

const enErreur = (r: unknown): boolean => (r as { isError?: boolean })?.isError === true;
const lire = (p: string): string | undefined => (existsSync(p) ? readFileSync(p, "utf-8") : undefined);
const chemins = (h: Harnais) => ({
  integrations: join(h.runDir, `${h.runId}-integrations.jsonl`),
  lanes: join(h.runDir, `${h.runId}-lanes.jsonl`),
  manifeste: join(h.runDir, "active-run.json"),
});

/** Une session montée, la montée admise : la précondition de toutes les couvertures. */
async function session(): Promise<Harnais> {
  const h = await monter();
  precondition(h.montee.ok, `la montée doit être admise avant la corruption : ${JSON.stringify(h.montee)}`);
  return h;
}

/** Le worker de W03 écrit dans sa lane ; la racine avance sur la même ligne ; la revue approuve. */
async function tentativeOuverte(h: Harnais): Promise<void> {
  PILOTE.pendant = ecrire("src/a.py", "a = 'lane'\n");
  await h.outil.execute("1", tache("W03"));
  PILOTE.pendant = undefined;
  writeFileSync(join(h.root, "src", "a.py"), "a = 'racine'\n");
  git(h.root, "add", "-A");
  git(h.root, "commit", "-qm", "la racine avance sur la même ligne");
  await h.outil.execute("2", revue("W03"));
  PILOTE.resultat = undefined;
  const journal = lire(chemins(h).integrations) ?? "";
  precondition(/"event":"ATTEMPT_OPENED"/.test(journal), "la revue approuvée doit ouvrir une tentative d'intégration");
}

/** La délégation sans rapport, et ce qu'elle a laissé derrière elle. */
async function deleguerW09(h: Harnais) {
  const c = chemins(h);
  const avant = { integrations: lire(c.integrations), lanes: lire(c.lanes), manifeste: lire(c.manifeste) };
  const workers = compter("worker");
  const appels = APPELS.length;
  const r = await h.outil.execute("9", tache("W09"));
  return {
    r,
    t: texte(r),
    lances: compter("worker") - workers,
    appels: APPELS.length - appels,
    inchanges: lire(c.integrations) === avant.integrations && lire(c.lanes) === avant.lanes &&
      lire(c.manifeste) === avant.manifeste,
  };
}

/** Les constats d'absence d'effet, communs aux quatre couvertures. */
function sansEffet(d: Awaited<ReturnType<typeof deleguerW09>>): void {
  propriete(enErreur(d.r), `la délégation doit être refusée : ${d.t}`);
  propriete(d.lances === 0 && d.appels === 0, `aucune délégation lancée (workers ${d.lances}, appels ${d.appels}) : ${d.t}`);
  propriete(/Aucune délégation n'a été lancée/.test(d.t), `le refus le dit : ${d.t}`);
  propriete(d.inchanges, "registres et manifeste restent intacts à l'octet");
}

couverture("P2-Q5-V1", "intégrations LOST après une montée admise : la porte des tentatives à trancher refuse, sans effet", async () => {
  const h = await session();
  try {
    await tentativeOuverte(h);
    const c = chemins(h);
    precondition(/"integrations": 1/.test(lire(c.manifeste) ?? ""), "le témoin des intégrations doit être publié");
    rmSync(c.integrations);
    precondition(!existsSync(c.integrations), "le registre des intégrations doit être retiré");
    const d = await deleguerW09(h);
    propriete(d.t.includes("[run: tentatives d'intégration à trancher]"), `la porte des tentatives à trancher nomme l'état : ${d.t}`);
    propriete(/LOST/.test(d.t) && /registre absent, alors que le manifeste l'atteste/.test(d.t), `raison LOST du runtime : ${d.t}`);
    sansEffet(d);
    propriete(!existsSync(c.integrations), "le registre des intégrations n'est pas recréé");
  } finally {
    h.fin();
  }
});

couverture("P2-Q5-V2", "intégrations UNKNOWN (version inconnue, ligne abîmée) après une montée admise : la porte des tentatives à trancher refuse, sans effet", async () => {
  const formes: Array<[string, (p: string) => void]> = [
    ["version inconnue", (p) => writeFileSync(p, `${JSON.stringify({ integration_ledger: 2 })}\n`)],
    ["ligne abîmée", (p) => appendFileSync(p, "{ pas du json\n")],
  ];
  for (const [nom, abimer] of formes) {
    const h = await session();
    try {
      await tentativeOuverte(h);
      const c = chemins(h);
      const sain = lire(c.integrations);
      abimer(c.integrations);
      precondition(lire(c.integrations) !== sain, `${nom} : le registre des intégrations doit être abîmé`);
      const d = await deleguerW09(h);
      propriete(d.t.includes("[run: tentatives d'intégration à trancher]"), `${nom} : la porte des tentatives à trancher nomme l'état : ${d.t}`);
      propriete(/inexploitable/.test(d.t), `${nom} : raison UNKNOWN du runtime : ${d.t}`);
      sansEffet(d);
    } finally {
      h.fin();
    }
  }
});

couverture("P2-Q5-V3", "lanes malformées avec une tentative ouverte, après une montée admise : la porte du registre illisible refuse, sans effet", async () => {
  const h = await session();
  try {
    await tentativeOuverte(h);
    appendFileSync(chemins(h).lanes, "{ pas du json\n");
    const d = await deleguerW09(h);
    propriete(d.t.includes("[run: registre illisible]"), `la porte du registre des lanes malformé nomme l'état : ${d.t}`);
    propriete(/n'ont pas pu être lues/.test(d.t), `raison du runtime : lignes illisibles : ${d.t}`);
    sansEffet(d);
  } finally {
    h.fin();
  }
});

couverture("P2-Q5-V4", "lanes amputées après une revue approuvée, après une montée admise : la porte du registre illisible refuse, sans effet", async () => {
  const h = await session();
  try {
    PILOTE.pendant = ecrire("src/a.py", "a = 'lane'\n");
    await h.outil.execute("1", tache("W03"));
    PILOTE.pendant = undefined;
    await h.outil.execute("2", revue("W03"));
    PILOTE.resultat = undefined;
    precondition(h.evenements().some((e) => e.event === "REVIEWED"), "la revue doit être enregistrée");
    appendFileSync(chemins(h).lanes, "{ pas du json\n");
    const d = await deleguerW09(h);
    propriete(d.t.includes("[run: registre illisible]"), `la porte du registre des lanes malformé nomme l'état : ${d.t}`);
    propriete(/n'ont pas pu être lues/.test(d.t), `raison du runtime : lignes illisibles : ${d.t}`);
    sansEffet(d);
  } finally {
    h.fin();
  }
});
