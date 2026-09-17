/**
 * La politique métier de `completed` — et rien d'autre.
 *
 * POURQUOI CE MODULE EXISTE, ET PAS UN CALCUL DANS LE BINAIRE.
 *
 * Observer les lanes, les intégrations et la racine dans `bin/subagent-recover`, PUIS
 * appeler la transition terminale, c'est un TOCTOU : entre l'observation et l'écriture,
 * une autre session peut ouvrir une lane, rouvrir une tentative, ou salir la racine. Le
 * verbe conclurait alors sur un monde qui n'existe plus.
 *
 * `verifierCompleted` ne reçoit donc AUCUN instantané. Elle lit tout elle-même, au moment
 * où elle est appelée — sous l'exclusion de l'espace de runs ET sous celle du run, avant
 * la première écriture terminale (PLAN-LOT2, § 5).
 *
 * AUCUN VÉRIFICATEUR NE VIENT DE L'APPELANT. La politique appartient à la primitive
 * terminale : un callback optionnel se contourne en passant une fonction qui ne fait rien.
 * Ce module n'exporte donc ni type de vérificateur, ni fabrique de vérificateur.
 *
 * TOUTE DÉCISION PORTE SUR `state`. Le champ de compatibilité des observations n'est lu
 * nulle part ici : il est dérivé de `state`, et décider sur lui reviendrait à décider sur
 * une déduction (C4.8, P5).
 *
 * Sept contrôles, sept refus nommés, dans l'ordre du § 5. Aucun n'est un avertissement :
 * une fin explicite affirme que le run est abouti, et ce qui ne peut pas être prouvé ne
 * s'affirme pas. Chaque refus laisse tout en l'état.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { dirtyRoot } from "./integration.ts";
import { isActive } from "./integration-ledger.ts";
import { observeIntegrations } from "./integration-observe.ts";
import { observeLanes } from "./lane-observe.ts";
import { planHash, readLaneEvents, RecoveryError, type RunManifest } from "./run-manifest.ts";
import { validatePlan } from "./work-units.ts";

function refuser(quoi: string): never {
  throw new RecoveryError(`fin refusée : ${quoi}. Ce refus ne modifie rien.`);
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * La racine est-elle propre ?
 *
 * La même observation que la porte d'intégration (`dirtyRoot`), fichiers non suivis
 * compris : un run ne se déclare pas abouti sur une racine qu'une intégration refuserait.
 * Un échec de `git status` n'est PAS une racine propre : `dirtyRoot` le rend comme une
 * ligne sentinelle, que ce module nomme (T2).
 */
function racineSale(root: string): string | null {
  const lignes = dirtyRoot(root);
  if (lignes.length === 1 && lignes[0] === STATUT_ILLISIBLE) return "l'état de la racine n'a pas pu être observé";
  return lignes.length === 0 ? null : `la racine porte ${lignes.length} modification(s) non validée(s)`;
}

/** La sentinelle de `dirtyRoot` quand git échoue. Une ligne de statut commence par deux colonnes. */
const STATUT_ILLISIBLE = "statut illisible";

/**
 * Le plan attaché au run, relu et prouvé identique à celui que le run a commencé.
 *
 * L'empreinte est comparée AVANT toute autre décision : un plan réécrit après son
 * attachement ferait juger le run sur des unités qu'il n'a pas eues à faire.
 */
function planAttache(dir: string, manifest: RunManifest): string[] {
  if (!manifest.plan) refuser("aucun plan n'est attaché au run");
  if (!manifest.planHash) refuser("le manifeste ne porte pas l'empreinte du plan attaché");
  let texte: string;
  try {
    texte = readFileSync(join(dir, manifest.plan), "utf-8");
  } catch (err) {
    refuser(`le plan attaché est illisible (${manifest.plan}) : ${message(err)}`);
  }
  if (planHash(texte) !== manifest.planHash) {
    refuser(`le plan attaché ne correspond plus à son empreinte (${manifest.planHash})`);
  }
  let plan: unknown;
  try {
    plan = JSON.parse(texte);
  } catch (err) {
    refuser(`le plan attaché n'est pas du JSON : ${message(err)}`);
  }
  const verdict = validatePlan(plan);
  if (verdict.status !== "usable") refuser(`le plan attaché est ${verdict.status} : ${verdict.reason}`);
  return verdict.units.map((u) => u.id);
}

/**
 * Les sept contrôles d'une fin explicite, relus sur place (PLAN-LOT2, § 5).
 *
 * `root` est la racine du dépôt, `dir` son espace de runs. L'appelant est `terminerRun`,
 * et lui seul : c'est lui qui tient les deux exclusions.
 */
export function verifierCompleted(input: { root: string; dir: string; manifest: RunManifest }): void {
  const { root, dir, manifest } = input;
  const runId = manifest.runId;

  // 1. Le plan attaché, lisible, valide, et identique à son empreinte.
  const unites = planAttache(dir, manifest);

  // 2. Les lanes, reconstruites depuis leur registre autoritaire : KNOWN, rien d'autre.
  const lu = readLaneEvents(dir, runId);
  const laneRead = { events: lu.events, malformedLines: lu.malformedLines, version: lu.version, present: lu.present };
  const lanes = observeLanes({ root, runId, laneRead });
  if (lanes.state !== "KNOWN") refuser(`le registre des lanes est ${lanes.state}`);
  const bilan = lanes.snapshot.reconciliation;

  /*
   * 3. Aucune lane ouverte AU REGISTRE, jugée par identité de lane.
   *
   * Ni `openUnits`, qui exige un worktree au nom attendu, ni le pli par unité, où une
   * génération intégrée masquerait une autre génération ouverte de la même unité. Une
   * lane ouverte refuse la fin, qu'elle appartienne au plan ou non, qu'un worktree existe
   * ou non.
   */
  const ouvertes = lanes.snapshot.projections.openLanes;
  if (ouvertes.length > 0) {
    refuser(`des lanes sont encore ouvertes : ${ouvertes.join(", ")}`);
  }

  // 4. Chaque unité du plan intégrée, et prouvée telle. Un abandon n'est pas une intégration.
  const manquantes = unites
    .filter((id) => !bilan.integrated.has(id))
    .map((id) => `${id} (${bilan.states.get(id) ?? "jamais ouverte"})`);
  if (manquantes.length > 0) {
    refuser(`des unités du plan ne sont pas intégrées : ${manquantes.join(", ")}`);
  }

  // 5. Les tentatives d'intégration : état exploitable, aucune encore active.
  const integrations = observeIntegrations({ root, runDir: dir, runId, laneRead });
  if (integrations.state !== "KNOWN" && integrations.state !== "EMPTY") {
    refuser(`le registre des tentatives d'intégration est ${integrations.state}`);
  }
  const actives = [...integrations.snapshot.facts.entries()]
    .filter(([, faits]) => isActive(faits))
    .map(([id]) => id)
    .sort();
  if (actives.length > 0) {
    refuser(`des tentatives d'intégration sont encore ouvertes : ${actives.join(", ")}`);
  }

  // 6. Aucun risque ouvert, chacun jugé sous (R, work_unit, id) sur sa dernière transition.
  const ouverts = [...lanes.snapshot.projections.risks.values()]
    .filter((r) => r.open)
    .map((r) => `${r.work_unit}:${r.id} (${r.transition})`)
    .sort();
  if (ouverts.length > 0) refuser(`des risques restent ouverts : ${ouverts.join(", ")}`);

  // 7. La racine propre.
  const sale = racineSale(root);
  if (sale) refuser(sale);
}
