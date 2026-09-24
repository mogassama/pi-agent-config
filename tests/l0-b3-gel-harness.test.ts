/**
 * l0-b3-gel-harness.test.ts — L0, vague B3 : la provenance du gel.
 *
 * C2.4 et Q1.3 : le gel s'enregistre avant le merge, et un hook qui transforme l'arbre
 * après la revue fait refuser. Deux formes, et elles ne se corrigent pas de la même
 * façon — l'une appelle une nouvelle revue, l'autre un refus immédiat sans boucle.
 *
 * Montage : `l0-b2-harness.ts` et `l0-b3-fixtures.ts`. Espèces : voir `l0-a2-units.test.ts`.
 */
import { test, type TestContext } from "node:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { PILOTE } from "./stubs/dispatch.ts";
import {
  aJeter, compter, ecrire, enveloppeComplete, git, integree, issue, laneActive, monter, montrer,
  precondition, propriete, revue, tache, treeDeTravail,
} from "./l0-b2-harness.ts";
import {
  aTourne, CONTENU_INDEX, etatCanonique, HOOK_FICHIERS, HOOK_INDEX, marqueurHook, nettoyerHooks,
  poserPreCommit, teteDe, teteDeLane, treeDe,
} from "./l0-b3-fixtures.ts";

type Preuve = (t: TestContext) => Promise<void> | void;
function regressionCorrigee(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, fn);
}
function preservation(id: string, titre: string, fn: Preuve): void {
  test(`L0 PRES ${id} — ${titre}`, fn);
}
test.after(() => {
  nettoyerHooks();
  for (const d of aJeter()) rmSync(d, { recursive: true, force: true });
});

// ================================================================== Q1.3 — le gel enregistré

regressionCorrigee("B3-frozen-ecrit", "le gel ordinaire s'enregistre avant le merge, et en entier", async () => {
  const h = await monter();
  try {
    PILOTE.pendant = ecrire("src/a.py", "a = 2\n");
    await h.outil.execute("1", tache("W03"));
    PILOTE.pendant = undefined;
    const lane = laneActive(h, "W03");
    const base = teteDe(join(h.root, ".git", "pi-lanes", lane));
    const tl = treeDeTravail(h, lane);

    await h.outil.execute("2", revue("W03"));
    PILOTE.resultat = undefined;
    precondition(integree(h.root, "src/a.py", "a = 2"), "la lane doit avoir été intégrée");

    /*
     * Chaque champ est confronté à git, pas à lui-même.
     *
     * `undefined === undefined` validerait le renvoi vers REVIEWED sans qu'aucun des deux
     * existe : le renvoi doit désigner un `event_seq` entier, porté par un REVIEWED réel
     * de cette lane.
     */
    const decrire = (evts: Array<Record<string, unknown>>): string[] => {
      const gel = evts.find((e) => e.event === "FROZEN" && e.work_unit === "W03");
      const revueEvt = evts.find((e) => e.event === "REVIEWED" && e.work_unit === "W03");
      /*
       * Le premier événement d'intégration de la lane : MERGED dès le LOT 9, la forme
       * transitoire d'INTEGRATED avant lui (C0 v1.8). Exiger MERGED ici faisait dépendre la
       * preuve du gel d'un événement que seul le LOT 9 écrit.
       */
      const merge = evts.find((e) => (e.event === "MERGED" || e.event === "INTEGRATED") && e.work_unit === "W03");
      const commit = typeof gel?.commit === "string" ? (gel.commit as string) : undefined;
      const existe = commit !== undefined && teteDeLane(h.root, lane) === commit;
      const parentGit = existe ? git(h.root, "rev-parse", `${commit}^`).trim() : undefined;
      const treeGit = existe ? treeDe(h.root, commit!) : undefined;
      return [
        ...enveloppeComplete(gel, "W03", lane),
        ...(revueEvt !== undefined && Number.isInteger(revueEvt.event_seq) ? [] : ["REVIEWED absent"]),
        ...(existe ? [] : [`commit ${JSON.stringify(commit)} n'est pas la tête de la lane`]),
        ...(gel?.parent === base && parentGit === base
          ? [] : [`parent ${JSON.stringify(gel?.parent)} / git ${JSON.stringify(parentGit)}`]),
        ...(gel?.tree === tl && treeGit === tl
          ? [] : [`tree ${JSON.stringify(gel?.tree)} / git ${JSON.stringify(treeGit)}`]),
        ...(Number.isInteger(gel?.reviewed_event_seq) && gel?.reviewed_event_seq === revueEvt?.event_seq
          ? [] : [`reviewed_event_seq ${JSON.stringify(gel?.reviewed_event_seq)}`]),
        ...(gel !== undefined && merge !== undefined && Number(gel.event_seq) < Number(merge.event_seq)
          ? [] : ["FROZEN ne précède pas l'intégration enregistrée"]),
      ];
    };
    const ecrit = decrire(h.evenements());
    const neuve = await h.recharger();
    const relu = decrire(neuve.evenements());

    propriete(
      ecrit.length === 0 && relu.length === 0,
      `FROZEN doit porter un commit qui existe, son parent et son tree confirmés par git, et ` +
        `un renvoi vers un REVIEWED réel — puis se relire à l'identique ; à l'écriture ` +
        `${JSON.stringify(ecrit)}, après rechargement ${JSON.stringify(relu)}`,
    );
  } finally { h.fin(); }
});

preservation("B3-frozen-crash", "un gel sans FROZEN est refusé, là où un gel enregistré passe", async () => {
  /*
   * Deux états canoniques, et il faut les deux.
   *
   * Un registre v2 est inerte pour le runtime d'aujourd'hui : il ne reconnaît ni son
   * en-tête ni la grammaire `-g1` de ses lanes, et refuse tout. « Refusé » seul serait
   * donc vrai sans qu'aucune provenance ait été regardée. Le témoin — le même état, mais
   * complet jusqu'à FROZEN — doit intégrer.
   */
  const sansGel = await monter();
  const avecGel = await monter();
  try {
    const etatSans = etatCanonique(sansGel, { jusqua: "REVIEWED" });
    const racineAvant = teteDe(sansGel.root);
    precondition(
      sansGel.evenements().filter((e) => e.event === "REVIEWED").length === 1 &&
        !sansGel.evenements().some((e) => e.event === "FROZEN"),
      "le premier registre doit s'arrêter à REVIEWED",
    );
    precondition(
      teteDeLane(sansGel.root, etatSans.lane) === etatSans.gel,
      "la branche doit porter le gel non enregistré",
    );

    const neuveSans = await sansGel.recharger();
    const rSans = await issue(() => neuveSans.outil.execute("1", revue("W03")));
    PILOTE.resultat = undefined;
    const refuse =
      teteDe(neuveSans.root) === racineAvant &&
      teteDeLane(neuveSans.root, etatSans.lane) === etatSans.gel &&
      existsSync(join(neuveSans.root, ".git", "pi-lanes", etatSans.lane));

    // Le témoin : FROZEN est au registre, la provenance est connue, l'intégration passe.
    const etatAvec = etatCanonique(avecGel, { jusqua: "FROZEN" });
    // La fixture merge après FROZEN : c'est la fenêtre du LOT 9 (merge sans MERGED). Le
    // témoin du gel s'arrête au gel enregistré, avant tout merge.
    git(avecGel.root, "reset", "-q", "--hard", etatAvec.base);
    const neuveAvec = await avecGel.recharger();
    const rAvec = await issue(() => neuveAvec.outil.execute("1", revue("W03")));
    PILOTE.resultat = undefined;
    const temoin =
      neuveAvec.evenements().some((e) => e.event === "INTEGRATED" && e.work_unit === "W03") &&
      teteDe(neuveAvec.root) !== etatAvec.base;

    propriete(
      neuveSans.chargement.ok && neuveAvec.chargement.ok && refuse && temoin,
      `les deux sessions doivent s'ouvrir sur un manifeste v2 ` +
        `(${JSON.stringify(neuveSans.chargement)}) ; sans FROZEN : refus, racine intacte, ` +
        `branche non remise à sa base, lane conservée ` +
        `(${refuse}) ; avec FROZEN : la même histoire s'intègre (${temoin}) — sans ce témoin, ` +
        `« refusé » serait vrai d'un runtime qui refuse tout registre v2 ; ${montrer(rSans)} · ` +
        `${montrer(rAvec)}`,
    );
  } finally { sansGel.fin(); avecGel.fin(); }
});

// ================================================================== C2.4 — les deux hooks

/** Les deux chemins où un gel a lieu : l'ordinaire, et le `p2` du chemin conflit (C2.6). */
const CHEMINS = [
  { nom: "ordinaire", conflit: false },
  { nom: "conflit", conflit: true },
] as const;

/**
 * Une lane prête à geler, sur l'un des deux chemins.
 *
 * Pour le chemin conflit, la racine avance sur le même fichier : le merge ne peut plus
 * être direct, et le gel devient `p2` d'une tentative.
 */
async function prete(conflit: boolean) {
  const h = await monter();
  PILOTE.pendant = ecrire("src/a.py", "a = 2\n");
  await h.outil.execute("1", tache("W03"));
  PILOTE.pendant = undefined;
  if (conflit) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(h.root, "src", "a.py"), "a = 'racine'\n");
    git(h.root, "add", "-A");
    git(h.root, "commit", "-qm", "la racine avance sur le même fichier");
  }
  return h;
}

regressionCorrigee("B3-hook-fichiers", "un hook qui réécrit les fichiers rend l'approbation caduque", async () => {
  const manques: string[] = [];
  for (const chemin of CHEMINS) {
    const h = await prete(chemin.conflit);
    try {
      const lane = laneActive(h, "W03");
      const marqueur = marqueurHook();
      poserPreCommit(h, lane, HOOK_FICHIERS("src/a.py", marqueur));
      const cwd = join(h.root, ".git", "pi-lanes", lane);
      const avant = teteDeLane(h.root, lane);
      const reviewersAvant = compter("reviewer");

      const resultat = await issue(() => h.outil.execute("2", revue("W03")));
      PILOTE.resultat = undefined;

      const transforme =
        existsSync(join(cwd, "src", "a.py")) &&
        readFileSync(join(cwd, "src", "a.py"), "utf-8").includes("transformé");
      const refuse = !integree(h.root, "src/a.py", "a = 2") && !integree(h.root, "src/a.py", "transformé par le hook");
      const gelDefait = teteDeLane(h.root, lane) === avant;
      // C2.6 : le gel transformé n'ouvre aucune tentative d'intégration.
      const journalTentatives = join(h.runDir, `${h.runId}-integrations.jsonl`);
      const sansTentative = !existsSync(journalTentatives) ||
        !/"event":"ATTEMPT_OPENED"/.test(readFileSync(journalTentatives, "utf-8"));
      const uneSeuleRevue = compter("reviewer") === reviewersAvant + 1;
      const treeTransforme = existsSync(cwd) ? treeDeTravail(h, lane) : undefined;
      // L'arbre transformé appelle une nouvelle revue : c'est la sortie prévue par C2.4.
      PILOTE.pendant = undefined;
      const suivante = await issue(() => h.outil.execute("3", revue("W03")));
      PILOTE.resultat = undefined;
      const deuxRevues = compter("reviewer") === reviewersAvant + 2;
      const derniere = h.evenements().filter((e) => e.event === "REVIEWED").at(-1);
      const surLArbreTransforme = derniere?.tree === treeTransforme;

      // Sans marqueur, le chemin conflit peut refuser sans jamais avoir exécuté le hook.
      if (!aTourne(marqueur) || !transforme || !refuse || !gelDefait || !sansTentative || !uneSeuleRevue ||
          !deuxRevues || !surLArbreTransforme) {
        manques.push(
          `${chemin.nom} : hook exécuté ${aTourne(marqueur)}, arbre transformé ${transforme}, ` +
            `refus ${refuse}, gel défait ${gelDefait}, aucune tentative ${sansTentative}, une revue puis deux ` +
            `${uneSeuleRevue}/${deuxRevues}, nouveau REVIEWED sur l'arbre transformé ` +
            `${surLArbreTransforme} ; ${montrer(resultat)} · ${montrer(suivante)}`,
        );
      }
    } finally { h.fin(); }
  }
  propriete(
    manques.length === 0,
    `un hook qui réécrit les fichiers doit faire refuser, défaire le gel et appeler une ` +
      `nouvelle revue sur l'arbre transformé, sur les deux chemins ; ${manques.join(" · ")}`,
  );
});

regressionCorrigee("B3-hook-index", "un hook qui ne touche que l'index est refusé sans amorcer de boucle", async () => {
  const manques: string[] = [];
  for (const chemin of CHEMINS) {
    const h = await prete(chemin.conflit);
    try {
      const lane = laneActive(h, "W03");
      const marqueur = marqueurHook();
      poserPreCommit(h, lane, HOOK_INDEX("src/a.py", marqueur));
      const cwd = join(h.root, ".git", "pi-lanes", lane);
      const tl = treeDeTravail(h, lane);
      const teteAvant = teteDeLane(h.root, lane);
      const revuesAvant = h.evenements().filter((e) => e.event === "REVIEWED").length;
      const reviewersAvant = compter("reviewer");

      const resultat = await issue(() => h.outil.execute("2", revue("W03")));
      PILOTE.resultat = undefined;

      // L'arbre de travail n'a pas bougé : après reset, il vaut exactement T_L.
      const arbreIntact = existsSync(cwd) && treeDeTravail(h, lane) === tl;
      /*
       * Le fichier visé est dans le scope : rien ne peut refuser à la place de C2.4. Ce
       * que le hook a indexé ne doit atteindre ni la racine ni l'arbre de travail.
       */
      const refuse =
        !integree(h.root, "src/a.py", CONTENU_INDEX.trim()) &&
        !integree(h.root, "src/a.py", "a = 2");
      // « Sans nouvelle revue ni boucle » : exactement une délégation reviewer de plus.
      const sansBoucle = compter("reviewer") === reviewersAvant + 1;

      const brancheRendue = teteDeLane(h.root, lane) === teteAvant;
      // L'approbation de cet appel est enregistrée avant le gel (C2.4) : une, et une seule.
      const sansNouveauReviewed =
        h.evenements().filter((e) => e.event === "REVIEWED").length === revuesAvant + 1;
      // C2.6 : le gel dont l'index a été transformé n'ouvre aucune tentative d'intégration.
      const journalTentatives = join(h.runDir, `${h.runId}-integrations.jsonl`);
      const sansTentative = !existsSync(journalTentatives) ||
        !/"event":"ATTEMPT_OPENED"/.test(readFileSync(journalTentatives, "utf-8"));

      if (!aTourne(marqueur) || !arbreIntact || !refuse || !sansBoucle || !brancheRendue || !sansTentative ||
          !sansNouveauReviewed) {
        manques.push(
          `${chemin.nom} : hook exécuté ${aTourne(marqueur)}, arbre intact ${arbreIntact}, ` +
            `branche rendue ${brancheRendue}, une seule approbation ${sansNouveauReviewed}, ` +
            `aucune tentative ${sansTentative}, ` +
            `refus ${refuse} (racine : ` +
            `${readFileSync(join(h.root, "src", "a.py"), "utf-8").trim()}), une seule délégation ` +
            `reviewer ${sansBoucle} (${compter("reviewer") - reviewersAvant}) ; ${montrer(resultat)}`,
        );
      }
    } finally { h.fin(); }
  }
  propriete(
    manques.length === 0,
    `une transformation qui n'existe que dans l'index se refuse au premier écart, sans ` +
      `nouvelle revue ni boucle (C2.4), sur les deux chemins ; ${manques.join(" · ")}`,
  );
});
