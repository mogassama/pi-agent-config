/**
 * Un `dispatch` piloté par le harnais.
 *
 * Le vrai lance un processus enfant : impossible à faire dans un test, et sans
 * rapport avec ce qu'on vérifie. Ce substitut rend ce que le scénario demande,
 * et retient chaque appel — c'est ce qui permet d'affirmer « aucun enfant n'a
 * été lancé » au lieu de le supposer.
 */
export type { RunResult } from "../../subagent-only/dispatch.ts";
import type { RunResult } from "../../subagent-only/dispatch.ts";

export interface AppelDispatch {
  agent: string;
  task: string;
  seq?: number;
  cwd?: string;
}

/** Les appels reçus, dans l'ordre. Le harnais le vide entre deux scénarios. */
export const APPELS: AppelDispatch[] = [];

/** Ce que le prochain appel rendra, et ce qu'il fait avant de rendre. */
export const PILOTE: {
  resultat?: Partial<RunResult>;
  pendant?: (appel: AppelDispatch) => void | Promise<void>;
} = {};

export function reinitialiser(): void {
  APPELS.length = 0;
  PILOTE.resultat = undefined;
  PILOTE.pendant = undefined;
}

export async function dispatch(
  agent: { name?: string },
  task: string,
  opts: { ctx?: { cwd?: string }; seq?: number },
): Promise<RunResult> {
  const appel: AppelDispatch = {
    agent: agent?.name ?? "?",
    task,
    seq: opts?.seq,
    cwd: opts?.ctx?.cwd,
  };
  APPELS.push(appel);
  // Le scénario peut agir pendant que « l'enfant tourne » — c'est ainsi qu'on
  // reproduit une perte de propriété au milieu d'une délégation.
  await PILOTE.pendant?.(appel);
  /*
   * Un résultat complet, pas minimal.
   *
   * `execute` lit des champs que le contrat déclare obligatoires — `turns`,
   * `usage`, `withoutDelta`. Un substitut qui n'en rendrait qu'une partie ferait
   * échouer le harnais pour une raison qui n'a rien à voir avec ce qu'il
   * vérifie, et masquerait le vrai comportement derrière une exception.
   */
  const vide = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  return {
    role: appel.agent,
    status: "ok",
    summary: `${appel.agent} a fini`,
    next: "done",
    artifact: `artefact-${appel.seq ?? 0}.json`,
    turns: 1,
    usage: vide,
    withoutDelta: [],
    modelUsed: "modèle-de-test",
    changedFiles: [],
    ...(PILOTE.resultat ?? {}),
  } as unknown as RunResult;
}
