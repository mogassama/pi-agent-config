/**
 * compaction-guard — compaction automatique de l'orchestrateur à 50 % de la fenêtre du
 * modèle courant, sur front (lot post-pilote B, adjugé par Sol le 27-09).
 *
 * À chaque `turn_end`, l'usage du contexte est relu (`ctx.getContextUsage()`) et remis à
 * la décision pure de `garde.ts`. Une décision « compacter » lance `ctx.compact()`, qui
 * n'attend pas : le verrou `enCours` tombe dans `onComplete` ou `onError`.
 *
 * `ctx.compact()` interrompt le run de l'agent et ne le reprend pas (pi 0.86.0). Si un run
 * était actif au lancement (`!ctx.isIdle()`), la première fin de la tentative, réussie ou
 * non, envoie donc exactement une reprise (`pi.sendMessage`, `triggerTurn`). Voir garde.ts.
 *
 * L'orchestrateur seulement. Les sous-agents sont lancés avec `--no-extensions` et une
 * liste `-e` explicite (spawn-args.ts) : ce répertoire n'y est jamais chargé.
 *
 * Le /compact manuel reste un mécanisme de récupération : il n'interagit pas avec ce
 * garde, sinon par la baisse d'usage qu'il produit, qui réarme le garde.
 */

import {
  clore,
  decider,
  etatInitial,
  MESSAGE_REPRISE,
  ouvrirTentative,
  terminer,
  TYPE_REPRISE,
  type EtatGarde,
  type Tentative,
  type Usage,
} from "./garde.ts";

/** La part de l'API de pi 0.86.0 dont le garde se sert, et rien d'autre. */
interface ContexteGarde {
  getContextUsage(): Usage | undefined;
  compact(options?: { onComplete?: (resultat: unknown) => void; onError?: (erreur: Error) => void }): void;
  /** Aucun run de l'agent en cours (ni compaction). Sur `turn_end`, un run est en cours. */
  isIdle(): boolean;
  hasUI?: boolean;
  ui?: { notify(message: string, niveau: "info" | "warning" | "error"): void };
}

interface ApiGarde {
  on(evenement: "turn_end", handler: (evenement: unknown, ctx: ContexteGarde) => void): unknown;
  sendMessage(
    message: { customType: string; content: string; display: boolean },
    options?: { triggerTurn?: boolean },
  ): void;
}

export default function compactionGuard(pi: ApiGarde): void {
  let etat: EtatGarde = etatInitial();

  pi.on("turn_end", (_evenement, ctx) => {
    const decision = decider(ctx.getContextUsage(), etat);
    etat = decision.etat;
    if (decision.action !== "compacter") return;

    const dire = (message: string, niveau: "info" | "warning" | "error") => {
      if (ctx.hasUI && ctx.ui) ctx.ui.notify(message, niveau);
    };
    dire(
      `compaction-guard : contexte ${decision.tokens} ≥ ${Math.round(decision.seuil)} (50 % de la fenêtre) — compaction`,
      "info",
    );
    // Mémorisé AVANT le lancement : c'est ce run-là que ctx.compact() va interrompre.
    let tentative: Tentative = ouvrirTentative(!ctx.isIdle());
    const finir = (message: string, niveau: "info" | "error") => {
      const issue = clore(tentative);
      if (!issue.premiere) return; // callback répété ou réentrant : ni verrou, ni reprise
      tentative = issue.tentative;
      etat = terminer(etat);
      dire(message, niveau);
      if (!issue.reprise) return;
      try {
        pi.sendMessage({ customType: TYPE_REPRISE, content: MESSAGE_REPRISE, display: true }, { triggerTurn: true });
        dire("compaction-guard : reprise du run", "info");
      } catch (erreur) {
        dire(`compaction-guard : reprise impossible — ${(erreur as Error).message}`, "error");
      }
    };
    try {
      ctx.compact({
        onComplete: () => finir("compaction-guard : compaction terminée", "info"),
        onError: (erreur) => finir(`compaction-guard : compaction en échec — ${erreur.message}`, "error"),
      });
    } catch (erreur) {
      // Un lancement qui jette n'établit pas qu'un tour a été interrompu : le verrou tombe,
      // l'arme reste baissée, et AUCUNE reprise (adjudication du 28-09).
      tentative = { runActif: tentative.runActif, close: true };
      etat = terminer(etat);
      dire(`compaction-guard : compaction non lancée — ${(erreur as Error).message}`, "error");
    }
  });
}
