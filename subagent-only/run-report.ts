/**
 * Le relevé terminal d'un run : ce qui a été fait, ce qui traîne, ce que ça a
 * coûté de le savoir.
 *
 * **Il ne reconstruit rien.** Il reçoit les deux snapshots que `observeLanes` et
 * `observeIntegrations` ont produits, le plan de nettoyage bâti sur eux, et les
 * mesures de la reconstruction qui les a produits. Un relevé qui sonderait git
 * lui-même finirait par annoncer un état que ni le runtime ni l'outil de reprise
 * ne partagent — c'est la divergence qui a vécu tout 3c.1, et un relevé est
 * exactement le genre d'objet qu'on croit sur parole.
 *
 * **Il ne déduit rien non plus.** Le statut du run vient du manifeste, qui est
 * la seule vérité autoritaire sur ce point ; aucun statut synthétique n'est
 * fabriqué ici à partir de ce qu'on voit. La fonction projette, elle ne conclut
 * pas.
 *
 * **Ce qu'on n'a pas pu lire ne se publie pas comme vide.** Quand le registre
 * des tentatives est inexploitable, les champs qui en dépendent valent `null` et
 * non `[]` : `[]` affirmerait qu'il n'y avait aucun contexte, alors qu'on ne
 * sait pas. C'est le même refus que celui des observateurs, tenu jusqu'à la
 * sortie — sans quoi un relevé propre serait le dernier endroit où la prudence
 * se perdrait.
 *
 * Tout est trié : à entrées égales, le relevé est le même octet pour octet, ce
 * qui le rend comparable d'un run à l'autre et diffable.
 */

import type { CleanupPlan, Retained } from "./cleanup.ts";
import type { IntegrationSnapshot } from "./integration-observe.ts";
import type { LaneSnapshot } from "./lane-observe.ts";
import type { RunStatus } from "./run-manifest.ts";

/** Ce que la reconstruction qui a produit les snapshots a coûté. */
export interface RunMetrics {
  /** Durée d'une reconstruction autoritaire entière, en millisecondes. */
  recovery_scan_ms: number;
  /** Invocations de processus git tentées pendant cette reconstruction. */
  git_probe_count: number;
}

export interface ReportedLaneConflict {
  work_unit: string;
  kind: string;
  detail: string;
}

export interface ReportedIntegrationConflict {
  attempt: string | null;
  work_unit: string | null;
  kind: string;
  detail: string;
}

/**
 * Un avertissement, et d'où il vient.
 *
 * Les deux réconciliations en produisent, et les concaténer sans provenance
 * rendrait indistinguable un résidu de lane d'une tentative close sans contexte.
 * La règle qui sépare les conflits par provenance vaut ici pour la même raison.
 */
export interface ReportedWarning {
  source: "lanes" | "integrations";
  work_unit: string | null;
  detail: string;
}

export interface RunReport {
  run: { run_id: string; status: RunStatus };
  work_units: {
    open: string[];
    integrated: string[];
    abandoned: string[];
    conflicts: string[];
  };
  physical_state: {
    lane_worktrees: string[];
    lane_branches: string[];
    /** `null` : le registre des tentatives n'était pas lisible. */
    integration_contexts: string[] | null;
  };
  cleanup: {
    cleanable_worktrees: string[];
    cleanable_branches: string[];
    /** `null` : le registre des tentatives n'était pas lisible. */
    cleanable_contexts: string[] | null;
    retained: Retained[];
  };
  recovery: {
    lane_conflicts: ReportedLaneConflict[];
    /** `null` : le registre des tentatives n'était pas lisible. */
    integration_conflicts: ReportedIntegrationConflict[] | null;
    warnings: ReportedWarning[];
  };
  performance: {
    recovery_scan_ms: number;
    git_probe_count: number;
    run_branch_count: number;
  };
}

/**
 * Comparer sur tous les champs, dans l'ordre, `null` compris.
 *
 * Un tri sur une seule clé n'est pas total : deux avertissements de la même
 * unité, deux conflits du même genre, deux objets retenus au même nom gardent
 * l'ordre d'entrée, et cet ordre-là vient d'une `Map` ou d'un `readdir`. Le
 * relevé serait alors identique la plupart du temps et différent sans raison
 * lisible le reste du temps — ce qui est pire qu'un désordre franc, parce qu'un
 * diff entre deux runs cesserait de vouloir dire quelque chose.
 *
 * **Comparaison ordinale UTF-16, pas `localeCompare`.** Le relevé se compare
 * d'une machine à l'autre et d'un mois à l'autre ; `localeCompare` dépend de la
 * locale et de la version d'ICU du poste, si bien que deux relevés du même état
 * pourraient différer sans qu'aucun run n'ait changé. L'ordre des points de code
 * est le seul qui soit le même partout.
 *
 * L'absence est un rang à part, avant la chaîne vide : `null` et `undefined`
 * disent « pas de valeur », `""` dit « valeur vide », et les confondre rendait
 * le comparateur non strictement total — deux entrées différentes ressortaient
 * égales, donc dans l'ordre d'entrée.
 *
 *     null = undefined  <  ""  <  toute chaîne non vide
 */
function comparerTexte(a: string | null | undefined, b: string | null | undefined): number {
  if (a == null) return b == null ? 0 : -1;
  if (b == null) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function comparerChamps(
  gauche: Array<string | null | undefined>,
  droite: Array<string | null | undefined>,
): number {
  for (let i = 0; i < gauche.length; i += 1) {
    const comparaison = comparerTexte(gauche[i], droite[i]);
    if (comparaison !== 0) return comparaison;
  }
  return 0;
}

/**
 * Une seule collation dans tout le relevé.
 *
 * `Array.sort()` par défaut convertit en chaîne puis compare les unités de code,
 * ce qui est déjà l'ordre voulu — mais l'écrire explicitement évite qu'une
 * seconde collation réapparaisse ici le jour où quelqu'un ajoute un tri.
 */
const trier = (xs: Iterable<string>): string[] => [...xs].sort(comparerTexte);

/**
 * Projeter. Rien d'autre.
 *
 * `integrations` est absent quand le registre des tentatives est inexploitable :
 * l'appelant a le droit de produire un relevé quand même — les lanes, elles,
 * sont connues — mais il ne fera pas dire à ce relevé qu'il n'y avait pas de
 * contexte.
 *
 * `run_branch_count` se déduit des observations déjà faites, sans nouvelle
 * sonde : le relevé n'a aucune raison de payer un processus git de plus pour
 * compter ce que l'observateur a déjà compté.
 */
export function buildRunReport(
  run: { runId: string; status: RunStatus },
  lanes: LaneSnapshot,
  integrations: IntegrationSnapshot | undefined,
  cleanup: CleanupPlan,
  metrics: RunMetrics,
): RunReport {
  const bilan = lanes.reconciliation;
  /*
   * `Observations.runBranches` est optionnel dans le type parce que d'autres
   * appelants de `reconcile` n'en fournissent pas. Un `LaneSnapshot` vient
   * toujours d'`observeLanes`, qui le remplit sans condition : le repli existe
   * pour le type, pas pour un cas réel.
   */
  const branches = lanes.observations.runBranches ?? [];

  const abandoned = [...bilan.states.entries()]
    .filter(([, etat]) => etat === "abandoned")
    .map(([unite]) => unite)
    .sort(comparerTexte);

  const warnings: ReportedWarning[] = bilan.warnings
    .map(
      (w): ReportedWarning => ({ source: "lanes", work_unit: w.workUnitId, detail: w.detail }),
    )
    .concat(
      (integrations?.reconciliation.warnings ?? []).map((detail) => ({
        source: "integrations" as const,
        work_unit: null,
        detail,
      })),
    )
    .sort((a, b) =>
      comparerChamps([a.source, a.work_unit, a.detail], [b.source, b.work_unit, b.detail]),
    );

  return {
    run: { run_id: run.runId, status: run.status },
    work_units: {
      open: trier(bilan.openUnits),
      integrated: trier(bilan.integrated),
      abandoned,
      conflicts: trier(bilan.conflicts.keys()),
    },
    physical_state: {
      lane_worktrees: trier(lanes.observations.openWorktrees),
      lane_branches: trier(branches),
      integration_contexts: integrations ? trier(integrations.contexts) : null,
    },
    cleanup: {
      cleanable_worktrees: trier(cleanup.laneWorktrees),
      cleanable_branches: trier(cleanup.laneBranches),
      // Le plan rend `[]` quand il n'a pas reçu de réconciliation des
      // tentatives. Ce vide-là est une absence d'information, pas une absence
      // de contexte, et le relevé ne les confond pas.
      cleanable_contexts: integrations ? trier(cleanup.integrationContexts) : null,
      // Cloné objet par objet : `[...]` ne copie que le tableau, et un relevé qui
      // rendrait les mêmes objets laisserait un appelant modifier le plan à
      // travers lui.
      retained: cleanup.retained
        .map((item) => ({ object: item.object, reason: item.reason }))
        .sort((a, b) => comparerChamps([a.object, a.reason], [b.object, b.reason])),
    },
    recovery: {
      lane_conflicts: [...bilan.conflicts.values()]
        .map((c) => ({ work_unit: c.workUnitId, kind: c.kind, detail: c.detail }))
        .sort((a, b) =>
          comparerChamps(
            [a.work_unit, a.kind, a.detail],
            [b.work_unit, b.kind, b.detail],
          ),
        ),
      integration_conflicts: integrations
        ? integrations.reconciliation.conflicts
            .map((c) => ({
              attempt: c.attemptId ?? null,
              work_unit: c.workUnitId ?? null,
              kind: c.kind,
              detail: c.detail,
            }))
            .sort((a, b) =>
              comparerChamps(
                [a.attempt, a.work_unit, a.kind, a.detail],
                [b.attempt, b.work_unit, b.kind, b.detail],
              ),
            )
        : null,
      warnings,
    },
    performance: {
      recovery_scan_ms: metrics.recovery_scan_ms,
      git_probe_count: metrics.git_probe_count,
      run_branch_count: branches.length,
    },
  };
}

/** Une ligne par objet, et l'inconnu dit comme inconnu. */
function bloc(titre: string, valeurs: string[] | null): string[] {
  if (valeurs === null) return [`${titre} : inconnu (registre des tentatives illisible)`];
  return valeurs.length === 0 ? [`${titre} : —`] : [`${titre} : ${valeurs.join(" ")}`];
}

/**
 * Le relevé en texte. Pure elle aussi : elle ne relit rien et ne mesure rien.
 *
 * `recovery_scan_ms` est arrondi à la milliseconde à l'affichage seulement. La
 * valeur transportée garde ses décimales — c'est elle qui alimentera un p95, et
 * arrondir à la source rendrait le percentile faux d'un demi-millisecond par
 * échantillon.
 */
export function formatRunReport(r: RunReport): string {
  const l: string[] = [];
  l.push(`run ${r.run.run_id} — ${r.run.status}`);
  l.push("");
  l.push(...bloc("  ouvertes  ", r.work_units.open));
  l.push(...bloc("  intégrées ", r.work_units.integrated));
  l.push(...bloc("  abandonnées", r.work_units.abandoned));
  l.push(...bloc("  en conflit", r.work_units.conflicts));
  l.push("");
  l.push(...bloc("  worktrees ", r.physical_state.lane_worktrees));
  l.push(...bloc("  branches  ", r.physical_state.lane_branches));
  l.push(...bloc("  contextes ", r.physical_state.integration_contexts));
  l.push("");
  l.push("à ranger :");
  l.push(...bloc("  worktrees ", r.cleanup.cleanable_worktrees));
  l.push(...bloc("  branches  ", r.cleanup.cleanable_branches));
  l.push(...bloc("  contextes ", r.cleanup.cleanable_contexts));
  if (r.cleanup.retained.length > 0) {
    l.push("conservé :");
    for (const g of r.cleanup.retained) l.push(`  ${g.object}\n    ${g.reason}`);
  }

  const conflits = r.recovery.lane_conflicts.length > 0 || r.recovery.integration_conflicts === null
    || (r.recovery.integration_conflicts?.length ?? 0) > 0 || r.recovery.warnings.length > 0;
  if (conflits) {
    l.push("");
    l.push("reprise :");
    for (const c of r.recovery.lane_conflicts) l.push(`  lane ${c.work_unit} — ${c.kind} : ${c.detail}`);
    if (r.recovery.integration_conflicts === null) {
      l.push("  tentatives : registre illisible, aucune contradiction n'en est tirée");
    } else {
      for (const c of r.recovery.integration_conflicts) {
        l.push(`  tentative ${c.attempt ?? c.work_unit ?? "?"} — ${c.kind} : ${c.detail}`);
      }
    }
    for (const w of r.recovery.warnings) {
      l.push(`  à ranger (${w.source}) ${w.work_unit ? `${w.work_unit} ` : ""}: ${w.detail}`);
    }
  }

  l.push("");
  l.push(
    `reconstruction : ${Math.round(r.performance.recovery_scan_ms)} ms, ` +
      `${r.performance.git_probe_count} invocation(s) git, ` +
      `${r.performance.run_branch_count} branche(s) de run`,
  );
  return l.join("\n");
}
