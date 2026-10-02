/**
 * l0-efficacite-e3.test.ts — LOT-EFFICACITÉ, E3 : le `test_command` déclaré par le plan, analysé sans
 * exécution (plan des leviers v2 complétée, § 4).
 *
 *   analyse   conforme : transmis ; masqué, caduc, sans exécuteur reconnu, portée partielle ou
 *             indéterminée, forme invalide : ignoré avec sa raison — jamais un refus ; une commande
 *             recevable qui échoue à l'exécution ne devient pas une commande établie — E3-analyse
 *
 * La transmission, dans la vraie extension, est dans tests/l0-efficacite-e3-harness.test.ts.
 */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import { commandeDeTestDetail, decisionCommandeDeclaree } from "../subagent-only/test-command.ts";

type Preuve = (t: TestContext) => Promise<void> | void;
function regressionCorrigee(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, fn);
}
function propriete(vrai: boolean, message: string): void {
  assert.ok(vrai, `PROPRIÉTÉ — ${message}`);
}

const CONFORME = 'PYTHON_BIN="$(uv run --extra dev python -c \'import sys; print(sys.executable)\')" && PYSPARK_PYTHON="$PYTHON_BIN" uv run --extra dev pytest';

regressionCorrigee("E3-analyse", "un test_command recevable est transmis, tout autre est ignoré avec sa raison, jamais refusé ni établi", () => {
  const d = decisionCommandeDeclaree(CONFORME);
  propriete(d.etat === "transmis" && d.commande === CONFORME, `la commande de QD-RC, portée complète : transmise (${JSON.stringify(d)})`);
  propriete(decisionCommandeDeclaree("uv run --extra dev pytest -q").etat === "transmis", "option neutre : transmise");
  propriete(decisionCommandeDeclaree(undefined).etat === "absent", "champ absent : absent");
  for (const [cas, valeur, motif] of [
    ["masquée par ;", "uv run pytest; true", /masquée/],
    ["masquée par ||", "uv run pytest || true", /masquée/],
    ["masquée par un tube", "uv run pytest | tee log", /masquée/],
    ["caduque", "cd .git/pi-lanes/x && uv run pytest", /caduque/],
    ["sans exécuteur", "make test", /exécuteur/],
    ["portée partielle (cible)", "uv run pytest tests/test_io.py", /partielle/],
    ["portée partielle (sélecteur)", "uv run pytest -k io", /partielle/],
    ["portée indéterminée", "uv run pytest --option-inconnue", /indéterminée/],
    ["pas une chaîne", 3, /chaîne/],
    ["vide", "  ", /chaîne/],
  ] as const) {
    const r = decisionCommandeDeclaree(valeur);
    propriete(r.etat === "ignore" && motif.test(r.raison), `${cas} : ignorée, raison publiée (${JSON.stringify(r)})`);
  }
  // Une commande statiquement recevable mais échouant à l'exécution ne devient pas une commande établie par P1-A.
  const lignes = [
    JSON.stringify({ type: "tool_execution_start", toolName: "bash", toolCallId: "c1", args: { command: CONFORME } }),
    JSON.stringify({ type: "tool_execution_end", toolName: "bash", toolCallId: "c1", isError: true,
      result: { content: [{ type: "text", text: "error: Failed to spawn: `pytest`\nCommand exited with code 2" }] } }),
  ];
  propriete(commandeDeTestDetail(lignes) === null, "Une commande statiquement recevable mais échouant à l'exécution ne devient pas une commande établie par P1-A.");
});
