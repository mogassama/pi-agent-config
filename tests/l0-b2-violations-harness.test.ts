/**
 * l0-b2-violations-harness.test.ts — L0, vague B2 : les violations durables.
 *
 * C3.1 fait d'une violation de réservé ou de bundle une règle **historique** : rien de ce
 * qui arrive dans la lane ne l'efface, et elle doit survivre à une nouvelle session. C3.6
 * et le tableau de C3 font au contraire du dépassement de scope une nature **d'état**,
 * qu'un rework réparateur lève — et cette distinction est ce que la correction risque
 * d'emporter en unifiant les deux.
 *
 * Montage : `l0-b2-harness.ts`. Espèces : voir l'en-tête de `l0-a2-units.test.ts`.
 */
import { test, type TestContext } from "node:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { PILOTE } from "./stubs/dispatch.ts";
import {
  acquireRunOwnership, type Lease, readManifest, releaseRunOwnership,
} from "../subagent-only/run-manifest.ts";
import {
  aJeter, blocages, compter, ecrire, enveloppeComplete, integree, issue, laneActive, monter, montrer,
  precondition, propriete, revue, tache, treeDeTravail, trieSansDoublon,
} from "./l0-b2-harness.ts";

type Preuve = (t: TestContext) => Promise<void> | void;
function regression(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, { todo: `rouge attendu sur l'objet jusqu'au lot qui corrige ${id}` }, fn);
}
function preservation(id: string, titre: string, fn: Preuve): void {
  test(`L0 PRES ${id} — ${titre}`, fn);
}
test.after(() => { for (const d of aJeter()) rmSync(d, { recursive: true, force: true }); });

/** Les deux natures historiques, et le fichier gelé que chacune fait toucher. */
const NATURES = [
  { kind: "reserved-violation", fichier: "DESIGN.md" },
  { kind: "bundle-violation", fichier: "ARCHITECTURE.md" },
] as const;

// ================================================================== survivre à la session

regression("B2-violation-reload", "une violation constatée survit à une nouvelle session", async () => {
  const manques: string[] = [];
  for (const nature of NATURES) {
    const h = await monter({ bundle: true });
    try {
      PILOTE.pendant = ecrire(nature.fichier, "touché par l'enfant\n");
      await h.outil.execute("1", tache("W03"));
      PILOTE.pendant = undefined;
      precondition(
        existsSync(join(h.root, ".git", "pi-lanes", `${h.runId}-W03`, nature.fichier)),
        `${nature.kind} : le fichier gelé doit être dans la lane`,
      );

      const lane = laneActive(h, "W03");
      const treeObserve = treeDeTravail(h, lane);
      const ecrit = h.evenements().find((e) => e.event === "VIOLATION" && e.work_unit === "W03");
      const source = ecrit?.source as Record<string, unknown> | undefined;
      const forme = [
        ...enveloppeComplete(ecrit, "W03", lane),
        ...(ecrit?.kind === nature.kind ? [] : [`kind ${JSON.stringify(ecrit?.kind)}`]),
        ...(trieSansDoublon(ecrit?.paths) &&
          JSON.stringify(ecrit?.paths) === JSON.stringify([nature.fichier])
          ? [] : [`paths ${JSON.stringify(ecrit?.paths)}`]),
        ...(Number.isInteger(source?.delegation_seq) ? [] : ["source.delegation_seq"]),
        ...(source?.agent === "worker" ? [] : [`source.agent ${JSON.stringify(source?.agent)}`]),
        ...(ecrit?.observed_tree === treeObserve ? [] : [`observed_tree ${JSON.stringify(ecrit?.observed_tree)}`]),
      ];

      /*
       * Le journal a le droit de refléter la violation (T4 n'interdit que d'y fonder la
       * décision). On le perturbe donc au lieu de le proscrire : effacé et remplacé par
       * un contenu contradictoire, la même violation doit bloquer avec le même jeton.
       */
      writeFileSync(
        join(h.runDir, `${h.runId}-delegations.jsonl`),
        `{ tronqué\n${JSON.stringify({ seq: 99, role: "worker", reserved_touched: [], violations_cleared: [nature.kind] })}\n`,
      );
      const neuve = await h.recharger();
      const relu = neuve.evenements().find((e) => e.event === "VIOLATION" && e.work_unit === "W03");
      const resultat = await issue(() => neuve.outil.execute("2", revue("W03")));
      PILOTE.resultat = undefined;
      const refuse =
        !integree(neuve.root, nature.fichier, "touché par l'enfant") &&
        (blocages(resultat.value) ?? []).includes(nature.kind);
      const identique = JSON.stringify(relu) === JSON.stringify(ecrit);

      if (forme.length > 0 || !refuse || !identique) {
        manques.push(
          `${nature.kind} : forme ${JSON.stringify(forme)}, refus après rechargement et ` +
            `journal contradictoire ${refuse} (blocages ${JSON.stringify(blocages(resultat.value))}), ` +
            `événement identique après rechargement ${identique}`,
        );
      }
    } finally { h.fin(); }
  }
  propriete(
    manques.length === 0,
    `chaque nature historique doit s'écrire en entier — enveloppe, kind, paths triés, source, ` +
      `observed_tree — puis refuser après rechargement malgré un journal contradictoire ; ` +
      `${manques.join(" · ")}`,
  );
});

regression("B2-violation-retablie", "rétablir le fichier gelé ne lève pas la violation", async () => {
  const manques: string[] = [];
  for (const nature of NATURES) {
    const h = await monter({ bundle: true });
    try {
      PILOTE.pendant = ecrire(nature.fichier, "touché par l'enfant\n");
      await h.outil.execute("1", tache("W03"));
      // Le rework rétablit le fichier : l'état final de la lane est propre.
      PILOTE.pendant = (a) => {
        if (a.cwd) writeFileSync(join(a.cwd, nature.fichier), `# ${nature.fichier}\n`);
      };
      await h.outil.execute("2", revue("W03", { verdict: "needs_rework" }));
      PILOTE.resultat = undefined;
      await h.outil.execute("3", tache("W03"));
      PILOTE.pendant = undefined;
      const cheminLane = join(h.root, ".git", "pi-lanes", `${h.runId}-W03`, nature.fichier);
      precondition(
        readFileSync(cheminLane, "utf-8") === `# ${nature.fichier}\n`,
        `${nature.kind} : le rework doit avoir rétabli le fichier`,
      );

      const neuve = await h.recharger();
      const resultat = await issue(() => neuve.outil.execute("4", revue("W03")));
      PILOTE.resultat = undefined;
      const refuse = (blocages(resultat.value) ?? []).includes(nature.kind);
      if (!refuse) {
        manques.push(
          `${nature.kind} : blocages ${JSON.stringify(blocages(resultat.value))}, racine ` +
            `${existsSync(join(neuve.root, "src", "a.py")) ? "présente" : "absente"}`,
        );
      }
    } finally { h.fin(); }
  }
  propriete(
    manques.length === 0,
    `une règle historique ne s'efface pas par ce qui arrive dans la lane, même après ` +
      `rechargement (C3.1) ; ${manques.join(" · ")}`,
  );
});

regression("B2-violation-bail", "sous bail perdu rien ne s'écrit, et le nouveau propriétaire recalcule", async () => {
  const h = await monter({ bundle: true });
  try {
    /*
     * Branche 1 — le bail se perd pendant la délégation qui touche le fichier gelé.
     *
     * L'instantané se prend À LA PERTE, pas avant la délégation : l'ouverture de la lane
     * et l'allocation de séquence la précèdent légitimement. Ce qui doit être vide, c'est
     * ce qui vient après.
     */
    let apresPerte: { evenements: number; seq: number } | undefined;
    PILOTE.pendant = (a) => {
      if (!a.cwd) return;
      writeFileSync(join(a.cwd, "DESIGN.md"), "touché sous bail perdu\n");
      // Le bail entier, tel qu'il est sur le disque : en décrire une partie suffirait au
      // code, pas au compilateur — et la baseline stricte compte.
      const bail = JSON.parse(
        readFileSync(join(h.runDir, `${h.runId}.lease`, "owner.json"), "utf-8"),
      ) as Lease;
      releaseRunOwnership(h.runDir, bail);
      const autre = acquireRunOwnership(h.runDir, h.runId, "session-autre");
      if (autre.ok) releaseRunOwnership(h.runDir, autre.lease);
      apresPerte = { evenements: h.evenements().length, seq: readManifest(h.runDir)!.nextSeq };
    };
    await h.outil.execute("1", { agent: "worker", batch: [{ work_unit: "W03", task: "écrire pour W03" }] });
    PILOTE.pendant = undefined;
    precondition(apresPerte !== undefined, "l'instantané doit avoir été pris à la perte du bail");
    const rienEcrit =
      !h.evenements().some((e) => e.event === "VIOLATION") &&
      h.evenements().length === apresPerte!.evenements &&
      readManifest(h.runDir)!.nextSeq === apresPerte!.seq;

    // Branche 3 — le nouveau propriétaire, qui n'a rien vu, refuse sur recalcul.
    const neuve = await h.recharger();
    const resultat = await issue(() => neuve.outil.execute("2", revue("W03")));
    PILOTE.resultat = undefined;
    const recalcul =
      !integree(neuve.root, "DESIGN.md", "touché sous bail perdu") &&
      (blocages(resultat.value) ?? []).includes("reserved-violation");

    // Branche 2 — le témoin : la même observation, bail tenu, écrit bien la violation.
    const temoin = await monter({ bundle: true });
    let ecritSousBail = false;
    try {
      PILOTE.pendant = ecrire("DESIGN.md", "touché sous bail valide\n");
      await temoin.outil.execute("1", { agent: "worker", batch: [{ work_unit: "W03", task: "écrire pour W03" }] });
      PILOTE.pendant = undefined;
      ecritSousBail = temoin.evenements().some(
        (e) => e.event === "VIOLATION" && e.work_unit === "W03" && e.kind === "reserved-violation",
      );
    } finally { temoin.fin(); }

    propriete(
      rienEcrit && ecritSousBail && recalcul,
      `sous bail perdu : rien d'écrit ${rienEcrit} · témoin sous bail valide, VIOLATION écrite ` +
        `${ecritSousBail} — sans lui, « rien d'écrit » serait vrai d'un runtime qui n'écrit ` +
        `jamais · nouveau propriétaire, recalcul et refus ${recalcul} ` +
        `(blocages ${JSON.stringify(blocages(resultat.value))})`,
    );
  } finally { h.fin(); }
});

// ================================================================== ce qui doit survivre

preservation("B2-scope-breach-etat", "un rework qui répare le scope rend la lane intégrable", async () => {
  const h = await monter();
  try {
    // Hors scope : W03 ne possède que src/a.py.
    PILOTE.pendant = (a) => {
      if (!a.cwd) return;
      writeFileSync(join(a.cwd, "src", "a.py"), "a = 2\n");
      writeFileSync(join(a.cwd, "src", "b.py"), "b = 'hors scope'\n");
    };
    await h.outil.execute("1", tache("W03"));
    PILOTE.pendant = undefined;
    const bloquee = await issue(() => h.outil.execute("2", revue("W03")));
    PILOTE.resultat = undefined;
    precondition(
      !integree(h.root, "src/b.py", "b = 'hors scope'"),
      `le dépassement doit bloquer une première fois ; ${montrer(bloquee)}`,
    );
    precondition(compter("reviewer") === 1, "la première revue doit être partie");

    // Le rework répare : l'état final de la lane est dans le scope.
    PILOTE.pendant = (a) => {
      if (a.cwd) writeFileSync(join(a.cwd, "src", "b.py"), "b = 1\n");
    };
    await h.outil.execute("3", tache("W03"));
    PILOTE.pendant = undefined;
    const apres = await issue(() => h.outil.execute("4", revue("W03")));
    PILOTE.resultat = undefined;

    propriete(
      apres.kind === "returned" &&
        integree(h.root, "src/a.py", "a = 2") &&
        integree(h.root, "src/b.py", "b = 1") &&
        !(blocages(apres.value) ?? []).includes("scope-breach"),
      `le dépassement est d'état : ce qui compte pour intégrer est ce que la lane contient, ` +
        `pas ce qu'elle a traversé ; a.py intégré ${integree(h.root, "src/a.py", "a = 2")}, ` +
        `blocages ${JSON.stringify(blocages(apres.value))}, ${montrer(apres)}`,
    );
  } finally { h.fin(); }
});
