/**
 * l0-ite-p1bc-harness.test.ts — lot ITE, P1-B et P1-C : la note, telle que role-guard la branche.
 *
 * Le vrai `role-guard.ts` est chargé (donc l'API de pi substituée, donc le chargeur) et reçoit la suite
 * d'événements que pi 0.86 émet : `tool_call` pour chaque appel du tour, puis `tool_result`, puis
 * `turn_end`. La note est ajoutée au CONTENU du résultat, après ce que les extensions précédentes y ont
 * mis — un retour ruff reste en place — et jamais sous forme de refus — ITE-P1B-branchement (worker),
 * ITE-P1C-branchement (reviewer).
 */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import roleGuard from "../subagent-only/role-guard.ts";

type Preuve = (t: TestContext) => Promise<void> | void;
function regressionCorrigee(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, fn);
}
function propriete(vrai: boolean, message: string): void {
  assert.ok(vrai, `PROPRIÉTÉ — ${message}`);
}
function precondition(vrai: boolean, message: string): void {
  assert.ok(vrai, `PRÉCONDITION — ${message}`);
}

type Contenu = Array<{ type: string; text?: string }>;
type Handler = (event: unknown) => Promise<unknown> | unknown;

function enfant(role: string, readOnly: boolean) {
  const avant = { role: process.env.PI_SUBAGENT_ROLE, ro: process.env.PI_SUBAGENT_READONLY };
  process.env.PI_SUBAGENT_ROLE = role;
  process.env.PI_SUBAGENT_READONLY = readOnly ? "1" : "0";
  const handlers = new Map<string, Handler>();
  roleGuard({ on: (nom: string, h: Handler) => handlers.set(nom, h), registerTool() {} } as never);
  if (avant.role === undefined) delete process.env.PI_SUBAGENT_ROLE; else process.env.PI_SUBAGENT_ROLE = avant.role;
  if (avant.ro === undefined) delete process.env.PI_SUBAGENT_READONLY; else process.env.PI_SUBAGENT_READONLY = avant.ro;
  for (const nom of ["tool_call", "tool_result", "turn_end"]) precondition(handlers.has(nom), `role-guard doit s'abonner à ${nom}`);
  let id = 0;
  /** Un tour : tous les `tool_call`, puis les `tool_result`, puis `turn_end`. Rend ce que chaque résultat est devenu. */
  return async (appels: Array<{ outil: string; path?: string; contenu?: Contenu }>): Promise<Array<Contenu | undefined>> => {
    const ids = appels.map(() => `c${++id}`);
    for (let i = 0; i < appels.length; i++) {
      const d = await handlers.get("tool_call")!({ toolName: appels[i].outil, toolCallId: ids[i], input: appels[i].path ? { path: appels[i].path, edits: [] } : {} });
      propriete(d === undefined, `aucun appel n'est refusé (${JSON.stringify(d)})`);
    }
    const sorties: Array<Contenu | undefined> = [];
    for (let i = 0; i < appels.length; i++) {
      const contenu = appels[i].contenu ?? [{ type: "text", text: "ok" }];
      const r = await handlers.get("tool_result")!({ toolName: appels[i].outil, toolCallId: ids[i], input: {}, content: contenu, isError: false }) as { content?: Contenu } | undefined;
      sorties.push(r?.content);
    }
    await handlers.get("turn_end")!({ turnIndex: 0 });
    return sorties;
  };
}
const texte = (c: Contenu | undefined) => (c ?? []).map((x) => x.text ?? "").join("");

regressionCorrigee("ITE-P1B-branchement", "role-guard ajoute la note P1-B au résultat de l'edit, après le contenu déjà présent, sans refus, et pas après un retour ruff", async () => {
  const worker = enfant("worker", false);
  const RUN = "src/run.py";
  await worker([{ outil: "read", path: RUN }, { outil: "read", path: "src/io.py" }]);
  const [premier] = await worker([{ outil: "edit", path: RUN }]);
  propriete(premier === undefined, "un premier edit isolé n'est pas modifié");
  const [second] = await worker([{ outil: "edit", path: RUN }]);
  propriete(texte(second).includes(`2 modifications de ${RUN} en 2 tours`), `le deuxième edit isolé porte la note (${texte(second)})`);
  propriete(texte(second).startsWith("ok"), "le contenu d'origine reste en tête");

  // Un retour ruff, laissé par pi-lint-gate avant role-guard dans la chaîne : l'edit suivant n'est pas noté.
  const ruff: Contenu = [{ type: "text", text: "ok" }, { type: "text", text: "\n\n--- ruff (src/io.py) ---\nE501 line too long" }];
  await worker([{ outil: "edit", path: "src/io.py", contenu: ruff }]);
  const [correction] = await worker([{ outil: "edit", path: "src/io.py" }]);
  propriete(correction === undefined, `la correction d'un retour ruff n'est pas notée (${texte(correction)})`);
});

regressionCorrigee("ITE-P1C-branchement", "role-guard ajoute la note P1-C au premier résultat du deuxième tour de lecture seule du reviewer, sans refus", async () => {
  const reviewer = enfant("reviewer", true);
  await reviewer([{ outil: "read", path: "src/config.py" }, { outil: "read", path: "src/run.py" }]);
  const t1 = await reviewer([{ outil: "read", path: "src/config.py" }]);
  propriete(t1.every((c) => c === undefined), "premier tour de lecture après le premier : rien");
  const t2 = await reviewer([{ outil: "read", path: "tests/a.py" }, { outil: "read", path: "tests/b.py" }]);
  propriete(texte(t2[0]).includes("Lectures échelonnées sur 2 tours"), `deuxième tour de lecture : note (${texte(t2[0])})`);
  propriete(t2[1] === undefined, "une seule note dans le tour");
});
