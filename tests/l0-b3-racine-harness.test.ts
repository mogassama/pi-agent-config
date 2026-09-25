/**
 * l0-b3-racine-harness.test.ts — L0, vague B3 : C5.1 et C5.2, indivisibles.
 *
 * C-P1-F06 veut qu'une racine sale fasse refuser toute intégration. Prise seule, cette
 * règle bloquerait le pilote au second livrable, puisque l'orchestrateur laisse
 * `DESIGN.md` modifié après chaque Statut. C5.5 en fait donc un seul lot : la racine est
 * refusée si elle est sale, et le runtime commite le Statut pour qu'elle ne le soit plus.
 *
 * Montage : `l0-b2-harness.ts` et `l0-b3-fixtures.ts`.
 */
import { test, type TestContext } from "node:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { PILOTE } from "./stubs/dispatch.ts";
import {
  aJeter, ecrire, git, integree, issue, monter, montrer, precondition, propriete, revue, tache,
} from "./l0-b2-harness.ts";
import {
  designMd, mergesDe, nettoyerHooks, planAvecDesign, racinePropre, statutDe, teteDe,
} from "./l0-b3-fixtures.ts";
import { openLanes } from "../subagent-only/worktree.ts";
import { readFileSync } from "node:fs";

type Preuve = (t: TestContext) => Promise<void> | void;
function regression(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, { todo: `rouge attendu sur l'objet jusqu'au lot qui corrige ${id}` }, fn);
}
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

const DESIGN = designMd([
  { id: "D-001", titre: "orchestration", statut: "proposé" },
  { id: "D-002", titre: "registres", statut: "proposé" },
]);
const PLAN_DEUX = planAvecDesign([
  { id: "W03", design_update: { decision_id: "D-001", from_status: "proposé", to_status: "en cours" } },
  { id: "W09", design_update: { decision_id: "D-002", from_status: "proposé", to_status: "en cours" } },
]);
/*
 * Le même dépôt, sans décision à traiter : la propriété de C5.1 — une racine sale refuse
 * toute intégration — ne dépend d'aucun Statut. Pendant les LOTS 3 à 8, C0 v1.8 ferme
 * avant le merge toute unité qui porte un `design_update` ; avec `PLAN_DEUX`, la preuve
 * verdissait pour cette raison-là, étrangère à la sienne (PLAN-LOT3 Q13).
 */
const PLAN_SANS_DECISION = planAvecDesign([{ id: "W03" }, { id: "W09" }]);

async function integrer(h: Awaited<ReturnType<typeof monter>>, unite: string, valeur: string, seq: string) {
  const fichier = unite === "W03" ? "src/a.py" : "src/b.py";
  PILOTE.pendant = ecrire(fichier, `${valeur}\n`);
  await h.outil.execute(`${seq}a`, tache(unite));
  PILOTE.pendant = undefined;
  const r = await issue(() => h.outil.execute(`${seq}b`, revue(unite)));
  PILOTE.resultat = undefined;
  return r;
}

// ================================================================== C5.1

regressionCorrigee("B3-racine-sale", "une racine sale fait refuser toute intégration", async () => {
  const manques: string[] = [];
  /*
   * Le produit des deux dimensions : le chemin par lequel l'intégration arrive, et ce
   * qui salit la racine. Le chemin conflit se prépare en faisant avancer la racine sur
   * le même fichier que la lane — le merge ne peut plus être direct.
   */
  for (const chemin of ["ordinaire", "conflit"] as const) {
    for (const [quoi, salir] of [
      ["fichier suivi", (root: string) => writeFileSync(join(root, "src", "b.py"), "b = 'sale'\n")],
      ["DESIGN.md", (root: string) => writeFileSync(join(root, "DESIGN.md"), `${DESIGN}\n<!-- sale -->\n`)],
    ] as const) {
      const cas = `${chemin} · ${quoi}`;
      const h = await monter({ bundle: true, design: DESIGN, plan: PLAN_SANS_DECISION });
      try {
        PILOTE.pendant = ecrire("src/a.py", "a = 2\n");
        await h.outil.execute("1", tache("W03"));
        PILOTE.pendant = undefined;
        if (chemin === "conflit") {
          writeFileSync(join(h.root, "src", "a.py"), "a = 'racine'\n");
          git(h.root, "add", "-A");
          git(h.root, "commit", "-qm", "la racine avance sur le même fichier");
        }
        precondition(racinePropre(h.root), `${cas} : la racine doit être propre avant la salissure`);
        const lane = openLanes(h.root).find((l) => l.includes("W03"));
        precondition(lane !== undefined, `${cas} : la lane doit être ouverte`);
        salir(h.root);
        const avant = teteDe(h.root);
        precondition(!racinePropre(h.root), `${cas} : la racine doit être sale`);

        const r = await issue(() => h.outil.execute("2", revue("W03")));
        PILOTE.resultat = undefined;
        const intacte =
          teteDe(h.root) === avant &&
          !integree(h.root, "src/a.py", "a = 2") &&
          mergesDe(h.root, "W03") === 0 &&
          openLanes(h.root).includes(lane!);
        if (!intacte) {
          manques.push(
            `${cas} : HEAD bougé ${teteDe(h.root) !== avant}, intégrée ` +
              `${integree(h.root, "src/a.py", "a = 2")}, merges ${mergesDe(h.root, "W03")}, lane ` +
              `conservée ${openLanes(h.root).includes(lane!)} ; ${montrer(r)}`,
          );
        }
      } finally { h.fin(); }
    }
  }
  propriete(
    manques.length === 0,
    `une racine sale, DESIGN.md compris, doit faire refuser sur les deux chemins, sans merge, ` +
      `sans que HEAD bouge, lane conservée ; ${manques.join(" · ")}`,
  );
});

// ================================================================== C5.1 + C5.2, ensemble

regressionCorrigee("B3-racine-apres", "après un Statut commité, la racine est propre et la suite passe", async () => {
  const h = await monter({ bundle: true, design: DESIGN, plan: PLAN_DEUX });
  try {
    const premiere = await integrer(h, "W03", "a = 2", "1");
    const propreApresUn = racinePropre(h.root);
    const premierStatut = statutDe(readFileSync(join(h.root, "DESIGN.md"), "utf-8"), "D-001");

    // C'est ici que le lot se joue : sans commit de Statut, la racine reste sale et la
    // seconde intégration est refusée par C5.1.
    const seconde = await integrer(h, "W09", "b = 2", "2");

    propriete(
      integree(h.root, "src/a.py", "a = 2") &&
        propreApresUn &&
        premierStatut === "en cours" &&
        integree(h.root, "src/b.py", "b = 2") &&
        statutDe(readFileSync(join(h.root, "DESIGN.md"), "utf-8"), "D-002") === "en cours" &&
        racinePropre(h.root),
      `deux livrables d'affilée : chacun intègre, chacun commite son Statut, et la racine ` +
        `reste propre entre les deux (C5.5) ; propre après le premier ${propreApresUn}, D-001 ` +
        `${JSON.stringify(premierStatut)}, W09 intégrée ${integree(h.root, "src/b.py", "b = 2")}, ` +
        `propre à la fin ${racinePropre(h.root)} ; ${montrer(premiere)} · ${montrer(seconde)}`,
    );
  } finally { h.fin(); }
});

// ================================================================== ce qui doit survivre

preservation("B3-racine-propre", "une racine propre sans Statut à écrire reste intégrable", async () => {
  // Sans bundle, aucun Statut n'est à écrire : c'est le régime le plus courant, et il ne
  // doit pas être emporté par la correction de C5.
  const h = await monter();
  try {
    precondition(racinePropre(h.root), "la racine doit être propre au départ");
    const r = await integrer(h, "W03", "a = 2", "1");
    propriete(
      integree(h.root, "src/a.py", "a = 2") && racinePropre(h.root) && r.kind === "returned",
      `une intégration ordinaire, sans bundle ni Statut, doit passer et laisser la racine ` +
        `propre ; intégrée ${integree(h.root, "src/a.py", "a = 2")}, propre ` +
        `${racinePropre(h.root)} ; ${montrer(r)}`,
    );
  } finally { h.fin(); }
});
