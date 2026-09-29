/**
 * l0-ite-p1a.test.ts — lot ITE, P1-A : la commande de test établie dans le run (plan P1 v2 gelé, `fbf65045`).
 *
 * Le constat (QD-P0, `ec276ba9`) : W#3 a passé six tours à retrouver l'invocation que W#1 avait
 * établie. Ce que le levier doit tenir, et que chaque preuve ci-dessous fait rougir sur son mutant
 * (tests/l0-mutants.json) :
 *
 *   extraction   la commande est celle de l'exécution observée, appariée à sa fin, avec un succès
 *                réel des tests — ITE-P1A-extraction, ITE-P1A-succes-reel
 *   masquage     aucun opérateur de premier niveau qui rendrait 0 sur un échec — ITE-P1A-masquage
 *   caducité     aucun chemin de lane ni de contexte d'intégration — ITE-P1A-lane
 *   lancement    l'exécuteur est la commande même du dernier segment, pas un mot de la ligne ; un
 *                commentaire n'est pas exécuté — ITE-P1A-lancement (adjudication P1, Q1)
 *   commentaire  un commentaire suivi d'un saut de ligne refuse la commande : la ligne suivante
 *                s'exécute — ITE-P1A-commentaire-saut (adjudication P1b)
 *   portée       sélecteurs et cibles sont partiels, une option inconnue laisse la portée
 *                indéterminée ; ni l'une ni l'autre ne supplante une suite complète établie —
 *                ITE-P1A-portee (adjudication P1, Q1)
 *   illisible    une ligne qui ne se lit pas : rien, et pas d'erreur — ITE-P1A-illisible
 *
 * La note (ITE-P1A-note) et le câblage — l'inscription au journal, le transport vers le writer suivant
 * du même run (ITE-P1A-transport) — sont éprouvés dans `l0-ite-p1a-harness.test.ts` : `spawn-args` et
 * l'extension ne s'importent que sous le chargeur. Rien de pi n'est chargé ici.
 */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { commandeDeTest, commandeDeTestDuFichier, commandeEtablie } from "../subagent-only/test-command.ts";

type Preuve = (t: TestContext) => Promise<void> | void;
function regressionCorrigee(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, fn);
}
function propriete(vrai: boolean, message: string): void {
  assert.ok(vrai, `PROPRIÉTÉ — ${message}`);
}

const jetables: string[] = [];
test.after(() => { for (const d of jetables) rmSync(d, { recursive: true, force: true }); });
function dossier(): string {
  const d = mkdtempSync(join(tmpdir(), "pi-l0-p1a-"));
  jetables.push(d);
  return d;
}

// ------------------------------------------------------------------ transcriptions

const SUCCES_PYTEST = "tests/test_io.py ....\n======================= 120 passed, 1 warning in 49.84s ========================\n";
const ECHEC_PYTEST = "======================= 2 failed, 118 passed in 51.02s ========================\n";
const COMPLETE = 'PYTHON="$(uv run --extra dev python -c \'import sys; print(sys.executable)\')" && PYSPARK_PYTHON="$PYTHON" uv run --extra dev pytest';

let n = 0;
/** Un appel `bash` tel que pi l'écrit dans la transcription : début, puis fin appariée par `toolCallId`. */
function appel(command: string, sortie: string, isError = false): string[] {
  const id = `call_${++n}`;
  return [
    JSON.stringify({ type: "tool_execution_start", toolCallId: id, toolName: "bash", args: { command, timeout: 600 } }),
    JSON.stringify({ type: "tool_execution_end", toolCallId: id, toolName: "bash", isError, result: { content: [{ type: "text", text: sortie }] } }),
  ];
}
const bruit = [
  JSON.stringify({ type: "session", version: 3 }),
  JSON.stringify({ type: "turn_start" }),
];

// ------------------------------------------------------------------ preuves

regressionCorrigee("ITE-P1A-extraction", "la commande retenue est celle d'une exécution observée et réussie, appariée par son identifiant", () => {
  const lignes = [
    ...bruit,
    ...appel("uv run pytest", "error: Failed to spawn: `pytest`\n\nCommand exited with code 2", true),
    ...appel(COMPLETE, SUCCES_PYTEST),
    ...appel("git status --short", " M src/a.py\n"),
  ];
  propriete(commandeDeTest(lignes) === COMPLETE, `la commande réussie est retenue (${commandeDeTest(lignes)})`);
  // Une fin sans début connu n'est rien : la commande doit être celle que l'appel a lancée.
  const orpheline = [JSON.stringify({ type: "tool_execution_end", toolCallId: "x", toolName: "bash", isError: false, result: { content: [{ type: "text", text: SUCCES_PYTEST }] } })];
  propriete(commandeDeTest(orpheline) === null, "une fin non appariée ne porte aucune commande");
  // Une complète l'emporte sur une partielle venue après.
  const partielle = `${COMPLETE} tests/test_io.py`;
  const deux = [...appel(COMPLETE, SUCCES_PYTEST), ...appel(partielle, SUCCES_PYTEST)];
  propriete(commandeDeTest(deux) === COMPLETE, "une commande complète n'est pas remplacée par une partielle");
  propriete(commandeDeTest([...appel(partielle, SUCCES_PYTEST)]) === partielle, "faute de complète, la partielle est retenue");
});

regressionCorrigee("ITE-P1A-succes-reel", "un appel sans erreur dont la sortie ne montre pas un succès réel des tests ne porte rien", () => {
  propriete(commandeDeTest(appel(COMPLETE, ECHEC_PYTEST)) === null, "des échecs comptés dans le résumé annulent le succès");
  propriete(commandeDeTest(appel(COMPLETE, "============ no tests ran in 0.01s ============\n")) === null, "aucun test lancé n'est pas un succès");
  propriete(commandeDeTest(appel(COMPLETE, "(no output)\n")) === null, "une sortie sans résumé n'est pas un succès");
  propriete(commandeDeTest(appel(COMPLETE, SUCCES_PYTEST, true)) === null, "un appel en erreur ne porte rien, même avec un résumé vert");
  propriete(commandeDeTest(appel("go test ./...", "ok  \texample.com/x\t0.3s\n")) === "go test ./...", "un autre exécuteur reconnu, réussi, est retenu");
  propriete(commandeDeTest(appel("go test ./...", "ok  \tex/x\t0.3s\n--- FAIL: TestY\nFAIL\n")) === null, "un échec go annule le succès");
});

regressionCorrigee("ITE-P1A-masquage", "une commande dont un enchaînement shell peut masquer l'échec n'est jamais portée", () => {
  for (const cmd of [
    "uv run pytest || true",
    "uv run pytest; echo fini",
    "uv run pytest | tee log.txt",
    "uv run pytest &",
    "(uv run pytest)",
    "set +e && uv run pytest",
    "uv run pytest\necho fini",
    "uv run pytest && echo fini",
    "`which pytest`",
  ]) {
    propriete(commandeDeTest(appel(cmd, SUCCES_PYTEST)) === null, `« ${cmd.replace(/\n/g, "⏎")} » ne doit pas être portée`);
  }
  // Ce qui ne masque rien reste portable : `&&` en tête, une redirection, une substitution.
  for (const cmd of [COMPLETE, "cd src && uv run pytest 2>&1", 'X="$(pwd; ls)" && uv run pytest']) {
    propriete(commandeDeTest(appel(cmd, SUCCES_PYTEST)) === cmd, `« ${cmd} » reste portable`);
  }
});

regressionCorrigee("ITE-P1A-lane", "une commande qui nomme un chemin de lane ou de contexte d'intégration n'est jamais portée", () => {
  for (const cmd of [
    "cd /d/.git/pi-lanes/0123456789abcdef-W01-g1 && uv run pytest",
    "/d/.git/pi-lanes/0123456789abcdef-W01-g1/.venv/bin/python -m pytest",
    "cd /d/.git/pi-integrations/att-1 && uv run pytest",
  ]) {
    propriete(commandeDeTest(appel(cmd, SUCCES_PYTEST)) === null, `« ${cmd} » dépend d'un répertoire de délégation`);
  }
});

regressionCorrigee("ITE-P1A-illisible", "une transcription ou un journal dont une ligne ne se lit pas ne porte rien, sans erreur", () => {
  const d = dossier();
  const transcription = join(d, "r-01-worker.jsonl");
  writeFileSync(transcription, [...appel(COMPLETE, SUCCES_PYTEST), "{tronquée"].join("\n") + "\n");
  let rendu: unknown = "non appelé";
  assert.doesNotThrow(() => { rendu = commandeDeTestDuFichier(transcription); });
  propriete(rendu === null, `transcription illisible : rien (${String(rendu)})`);
  propriete(commandeDeTestDuFichier(join(d, "absente.jsonl")) === null, "transcription absente : rien");

  const journal = join(d, "r-delegations.jsonl");
  writeFileSync(journal, [JSON.stringify({ seq: 1, test_command: COMPLETE }), "{tronquée"].join("\n") + "\n");
  propriete(commandeEtablie(journal) === null, "journal illisible : rien, pas la dernière ligne lisible");
  writeFileSync(journal, [JSON.stringify({ seq: 1, test_command: COMPLETE }), JSON.stringify({ seq: 2, test_command: null })].join("\n") + "\n");
  propriete(commandeEtablie(journal) === COMPLETE, "journal lisible : la commande inscrite est relue");
  writeFileSync(journal, JSON.stringify({ seq: 1, test_command: "uv run pytest || true" }) + "\n");
  propriete(commandeEtablie(journal) === null, "une commande inscrite qui masque l'échec n'est pas reprise du journal");
});

regressionCorrigee("ITE-P1A-lancement", "l'exécuteur doit être réellement lancé par le dernier segment : un résumé affiché ou un mot de la ligne ne prouve rien", () => {
  propriete(
    commandeDeTest(appel(
      "echo '======================= 120 passed in 0.01s =======================' # pytest",
      "======================= 120 passed in 0.01s ========================\n"
    )) === null,
    "un résumé affiché par echo ne prouve aucune exécution de pytest"
  );
  for (const cmd of [
    "echo pytest",
    "cat rapport.txt # pytest",
    "grep pytest pyproject.toml",
    "uv run pytest --version && echo '== 3 passed in 0.1s =='",
    "printf '%s\\n' '= 3 passed in 0.1s =' && true pytest",
    '"$PYTHON" -c "import pytest"',
  ]) {
    propriete(commandeDeTest(appel(cmd, SUCCES_PYTEST)) === null, `« ${cmd} » ne lance pas pytest`);
  }
  for (const cmd of [
    'PYTHON="$(uv run which python)" && PYSPARK_PYTHON="$PYTHON" "$PYTHON" -m pytest',
    "env A=1 B=2 pytest -q",
    ".venv/bin/python -m pytest",
    "uv run --extra dev --with pytest-xdist pytest -n 4",
    "poetry run pytest",
  ]) {
    propriete(commandeDeTest(appel(cmd, SUCCES_PYTEST)) === cmd, `« ${cmd} » lance pytest`);
  }
  // Un commentaire n'est pas exécuté : ses mots ne sont ni un exécuteur ni une cible.
  const commentee = "uv run pytest -q # toute la suite";
  propriete(commandeDeTest([...appel(COMPLETE, SUCCES_PYTEST), ...appel(commentee, SUCCES_PYTEST)]) === commentee,
    "une commande complète suivie d'un commentaire reste complète");
});

regressionCorrigee("ITE-P1A-portee", "sélecteurs et cibles sont partiels, une portée inconnue est indéterminée, et aucune des deux ne supplante une suite complète établie", () => {
  const selection = [
    ...appel(COMPLETE, SUCCES_PYTEST),
    ...appel(
      "uv run pytest -k fingerprints",
      "======================= 1 passed, 119 deselected in 0.01s ========================\n"
    ),
  ];
  propriete(
    commandeDeTest(selection) === COMPLETE,
    "une sélection -k ne remplace pas une suite complète"
  );
  for (const partielle of ["uv run pytest -m slow", "uv run pytest --lf", "uv run pytest --deselect tests/a.py::t", "uv run pytest tests/", "uv run pytest tests/a.py::t"]) {
    propriete(commandeDeTest([...appel(COMPLETE, SUCCES_PYTEST), ...appel(partielle, SUCCES_PYTEST)]) === COMPLETE,
      `« ${partielle} » ne remplace pas la suite complète`);
  }
  // Un résumé qui compte des désélectionnés rend partielle une commande d'apparence complète.
  const deselection = "======================= 3 passed, 117 deselected in 0.01s ========================\n";
  propriete(commandeDeTest([...appel(COMPLETE, SUCCES_PYTEST), ...appel("uv run pytest", deselection)]) === COMPLETE,
    "une sortie qui compte des désélectionnés ne remplace pas la suite complète");
  // Indéterminée : ne supplante pas une complète ; supplante une partielle ; une complète la supplante.
  const inconnue = "uv run pytest --option-inconnue";
  propriete(commandeDeTest([...appel(COMPLETE, SUCCES_PYTEST), ...appel(inconnue, SUCCES_PYTEST)]) === COMPLETE,
    "une portée indéterminée ne supplante pas une complète établie");
  propriete(commandeDeTest([...appel("uv run pytest -k a", SUCCES_PYTEST), ...appel(inconnue, SUCCES_PYTEST)]) === inconnue,
    "une indéterminée l'emporte sur une partielle");
  propriete(commandeDeTest([...appel(inconnue, SUCCES_PYTEST), ...appel("uv run pytest -k a", SUCCES_PYTEST)]) === inconnue,
    "une sélection -k est partielle : elle ne supplante pas une indéterminée");
  propriete(commandeDeTest([...appel(inconnue, SUCCES_PYTEST), ...appel("uv run pytest -q", SUCCES_PYTEST)]) === "uv run pytest -q",
    "une complète l'emporte sur une indéterminée");
  propriete(commandeDeTest(appel("cd src && uv run pytest 2>&1", SUCCES_PYTEST)) === "cd src && uv run pytest 2>&1",
    "une redirection n'est pas une cible");
  // Au journal : la portée inscrite, qui tient compte de la sortie, fait foi quand elle est plus faible.
  const d = dossier();
  const journal = join(d, "r-delegations.jsonl");
  writeFileSync(journal, [
    JSON.stringify({ seq: 1, test_command: COMPLETE, test_command_portee: "complete" }),
    JSON.stringify({ seq: 2, test_command: "uv run pytest", test_command_portee: "partielle" }),
    JSON.stringify({ seq: 3, test_command: inconnue, test_command_portee: "indeterminee" }),
  ].join("\n") + "\n");
  propriete(commandeEtablie(journal) === COMPLETE, `au journal, la complète établie reste (${commandeEtablie(journal)})`);
});

regressionCorrigee("ITE-P1A-commentaire-saut", "un commentaire suivi d'un saut de ligne ne masque pas la commande qui suit : rien n'est porté", () => {
  const cmd = "uv run pytest # note\necho '======================= 120 passed in 0.01s ======================='";
  const sortie = "uv: command not found\n======================= 120 passed in 0.01s =======================\n";
  propriete(commandeDeTest(appel(cmd, sortie)) === null,
    "l'échec de pytest suivi d'un résumé affiché par echo après le commentaire ne porte rien");
  propriete(commandeDeTest(appel("uv run pytest -q # toute la suite", SUCCES_PYTEST)) === "uv run pytest -q # toute la suite",
    "un commentaire en fin de commande, sans ligne suivante, reste admis");
});
