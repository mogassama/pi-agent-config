/**
 * compaction-guard — compaction automatique de l'orchestrateur à 50 % de la fenêtre du
 * modèle courant, sur front (lot post-pilote B, adjugé par Sol le 27-09).
 *
 * À chaque `turn_end`, l'usage du contexte est relu (`ctx.getContextUsage()`) et remis à
 * la décision pure de `garde.ts`. Une décision « compacter » lance `ctx.compact()`, qui
 * n'attend pas : le verrou `enCours` tombe dans `onComplete` ou `onError`.
 *
 * L'orchestrateur seulement. Les sous-agents sont lancés avec `--no-extensions` et une
 * liste `-e` explicite (spawn-args.ts) : ce répertoire n'y est jamais chargé.
 *
 * Le /compact manuel reste un mécanisme de récupération : il n'interagit pas avec ce
 * garde, sinon par la baisse d'usage qu'il produit, qui réarme le garde.
 */

import { decider, etatInitial, terminer, type EtatGarde, type Usage } from "./garde.ts";

/** La part de l'API de pi 0.86.0 dont le garde se sert, et rien d'autre. */
interface ContexteGarde {
  getContextUsage(): Usage | undefined;
  compact(options?: { onComplete?: (resultat: unknown) => void; onError?: (erreur: Error) => void }): void;
  hasUI?: boolean;
  ui?: { notify(message: string, niveau: "info" | "warning" | "error"): void };
}

interface ApiGarde {
  on(evenement: "turn_end", handler: (evenement: unknown, ctx: ContexteGarde) => void): unknown;
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
    try {
      ctx.compact({
        onComplete: () => {
          etat = terminer(etat);
          dire("compaction-guard : compaction terminée", "info");
        },
        onError: (erreur) => {
          etat = terminer(etat);
          dire(`compaction-guard : compaction en échec — ${erreur.message}`, "error");
        },
      });
    } catch (erreur) {
      // Un lancement qui jette n'a rien lancé : le verrou tombe, l'arme reste baissée.
      etat = terminer(etat);
      dire(`compaction-guard : compaction non lancée — ${(erreur as Error).message}`, "error");
    }
  });
}
