/**
 * Qui a le droit de tourner, et quand.
 *
 * La frontière tenue par ce module est celle qui a été posée avant d'écrire une
 * ligne : **l'orchestrateur choisit le travail, le runtime décide ce qu'il est
 * sûr d'exécuter en même temps.** L'orchestrateur propose des unités et rédige
 * chaque tâche ; il n'a pas à connaître l'état instantané des lanes actives, et
 * s'il devait le connaître le scheduling lui reviendrait.
 *
 * D'où deux réponses très différentes à un candidat qui ne démarre pas :
 *
 *     REFUSED   une dépendance n'est pas intégrée, l'unité est inconnue du plan
 *               → une erreur d'admission, que l'orchestrateur doit voir
 *     QUEUED    les scopes recouvrent une lane active
 *               → une unité parfaitement légale qui attend son tour
 *
 * Les confondre coûterait cher dans les deux sens. Refuser un chevauchement
 * ferait porter à l'orchestrateur une contrainte qu'il ne peut pas anticiper ;
 * mettre en file une dépendance manquante cacherait une faute derrière une
 * attente qui ne finirait jamais.
 *
 * **Remplissage continu, pas des vagues.** Dès qu'une lane finit, le premier
 * candidat compatible démarre. Une vague attendrait la plus lente du groupe, et
 * les durées du run 15 vont de 2,6 à 7,2 minutes par unité : attendre la plus
 * longue à chaque tour rendrait la moitié du gain. C'est aussi ce qui distingue
 * un scheduler d'un fan-out amélioré.
 *
 * Rien ici ne touche à git, ne lance de processus ni ne sait ce qu'est un
 * chemin. Le démarrage et la collision sont des paramètres, ce qui rend
 * l'ordonnancement éprouvable avec des délais contrôlés — la seule façon de
 * prouver qu'il ne s'agit pas d'une vague déguisée.
 */
import type { WorkUnit } from "./work-units.js";

/**
 * L'appel lui-même est mal formé : rien n'a été admis, rien n'a démarré.
 *
 * À distinguer d'un candidat `refused`, qui suppose au contraire qu'une
 * admission a bien eu lieu et qu'elle a répondu non. Ici il n'y a pas eu
 * d'admission du tout, et l'orchestrateur doit corriger son appel plutôt qu'un
 * de ses candidats.
 */
export class SchedulerInputError extends Error {}

/**
 * Le scheduler s'est contredit lui-même.
 *
 * Jamais présenté à l'orchestrateur comme une faute : il n'y peut rien, et le
 * maquiller en refus l'enverrait corriger un plan qui n'a rien. Une classe
 * distincte plutôt qu'un message à reconnaître, parce qu'un protocole fondé sur
 * du texte humain se casse à la première reformulation.
 */
export class SchedulerInvariantError extends Error {}

export type LaneState = "refused" | "queued" | "running" | "done";

export interface Candidate {
  workUnitId: string;
  task: string;
}

export interface Admission {
  /** Le plan gelé. */
  units: readonly WorkUnit[];
  /**
   * Les unités déjà intégrées.
   *
   * Intégrée, et non terminée : une dépendance dont le travail existe mais
   * n'est pas dans l'intégration laisserait la lane suivante partir d'une base
   * qui ne contient pas ce dont elle dépend.
   */
  integrated: ReadonlySet<string>;
  /**
   * Les unités qui détiennent déjà un scope hors de cet appel.
   *
   * Une lane ouverte et non intégrée possède ses fichiers, même quand plus
   * aucun worker n'y tourne : elle n'a pas été revue, son travail n'est pas
   * dans la base, et une candidate qui écrirait les mêmes fichiers partirait
   * d'un état qui ne la contient pas. Sans cette liste, `runLanes` ne verrait
   * que ses propres lanes et ignorerait celles d'un appel précédent.
   */
  owners?: readonly WorkUnit[];
  /**
   * Deux unités peuvent-elles écrire en même temps ?
   *
   * Fourni plutôt qu'importé. Ce module ordonnance ; il n'a aucune raison de
   * savoir ce qu'est un scope, encore moins comment deux motifs se recouvrent.
   * L'appelant passe `scopesCollide`, et l'ordonnancement reste éprouvable sans
   * rien connaître de git ni des chemins.
   */
  collide: (a: WorkUnit, b: WorkUnit) => boolean;
}

export interface LaneOutcome<T> {
  workUnitId: string;
  /**
   * `queued` est terminal pour cet appel, pas une promesse d'exécution.
   *
   * Le propriétaire de son scope ne peut pas se libérer pendant l'appel : sa
   * lane attend une review, qui est un appel séparé et n'arrivera qu'après le
   * retour de celui-ci. La candidate reste donc légale, non refusée, et
   * reproposable une fois le propriétaire intégré.
   */
  state: LaneState;
  /** Pourquoi le candidat n'a pas démarré. Vide quand il a tourné. */
  reason: string;
  value?: T;
  error?: unknown;
}

/**
 * Ce candidat a-t-il le droit d'exister ? Question d'admission, pas d'ordre.
 *
 * Stricte sur une unité inconnue, à la différence du relevé shadow qui la note
 * `UNPLANNED` sans rien empêcher. Les deux ont raison sur leur terrain :
 * observer une unité imprévue est un résultat, l'exécuter sans dépendances ni
 * scope contractuels est un pari. Les tolérances de la mesure ne se
 * transportent pas dans l'exécution concurrente.
 */
export function admit(
  candidate: Candidate,
  ctx: Admission,
): { ok: true; unit: WorkUnit } | { ok: false; reason: string } {
  const unit = ctx.units.find((u) => u.id === candidate.workUnitId);
  if (!unit) {
    return { ok: false, reason: `${candidate.workUnitId} ne figure pas dans le plan gelé` };
  }
  const missing = unit.dependsOn.filter((d) => !ctx.integrated.has(d));
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `dépend de ${missing.join(", ")}, pas encore intégrée${missing.length > 1 ? "s" : ""}`,
    };
  }
  return { ok: true, unit };
}

/**
 * Exécute des candidats, au plus `maxParallel` à la fois.
 *
 * `start` reçoit un candidat et rend une promesse ; ce module ne sait pas ce
 * qu'elle fait. Une lane qui échoue libère son emplacement comme une autre :
 * son état est rendu, elle n'arrête pas les autres, et surtout son échec ne
 * fait pas disparaître les résultats déjà obtenus.
 *
 * L'ordre des résultats est celui des candidats reçus, pas celui des fins.
 * L'orchestrateur a écrit ses tâches dans un ordre ; les lui rendre mélangées
 * lui demanderait de les rapparier, et il le ferait par position.
 */
export async function runLanes<T>(
  candidates: readonly Candidate[],
  ctx: Admission,
  maxParallel: number,
  start: (candidate: Candidate, unit: WorkUnit) => Promise<T>,
): Promise<Array<LaneOutcome<T>>> {
  /*
   * Une configuration invalide meurt ici, avant tout worktree et tout processus.
   *
   * `Math.max(1, maxParallel)` corrigeait silencieusement un `0` en `1`. C'est
   * précisément la réparation muette qui fabrique une mesure plausible et
   * fausse : la configuration dirait zéro, le runtime exécuterait, et le relevé
   * rapporterait une concurrence que personne n'a demandée. `2` doit vouloir
   * dire exactement deux, donc `0`, `-1`, `1.5` et `NaN` ne doivent rien
   * vouloir dire du tout.
   */
  if (!Number.isInteger(maxParallel) || maxParallel < 1) {
    throw new SchedulerInputError(`maxParallel invalide : ${maxParallel}`);
  }

  /*
   * Toute la machine est indexée par identifiant d'unité — les résultats, les
   * lanes actives, l'ownership. Deux candidats pour la même unité n'y sont pas
   * représentables : au mieux le second écrase le premier, au pire les deux
   * deviennent actifs sous la même clé et une promesse disparaît du suivi.
   *
   * Un lot mal formé est une erreur d'interface, pas un candidat refusé parmi
   * d'autres : rien ne démarre.
   */
  const seen = new Set<string>();
  const duplicates = candidates
    .map((c) => c.workUnitId)
    .filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
  if (duplicates.length > 0) {
    throw new SchedulerInputError(
      `lot invalide : ${[...new Set(duplicates)].join(", ")} apparaît deux fois`,
    );
  }

  const outcomes = new Map<string, LaneOutcome<T>>();
  const waiting: Array<{ candidate: Candidate; unit: WorkUnit }> = [];

  for (const c of candidates) {
    const verdict = admit(c, ctx);
    if (!verdict.ok) {
      outcomes.set(c.workUnitId, { workUnitId: c.workUnitId, state: "refused", reason: verdict.reason });
      continue;
    }
    outcomes.set(c.workUnitId, { workUnitId: c.workUnitId, state: "queued", reason: "" });
    waiting.push({ candidate: c, unit: verdict.unit });
  }

  /*
   * Deux ressources distinctes, et les confondre annulait tout le bénéfice.
   *
   * L'**emplacement d'exécution** est tenu pendant le worker et rendu quand il
   * finit : c'est lui que `maxParallel` compte.
   *
   * La **possession du scope** est tenue par l'unité depuis son démarrage
   * jusqu'à son intégration. Elle survit à la fin du worker, parce que la lane
   * existe encore, n'est pas revue et n'est pas dans la base. La première
   * version libérait le scope avec le worker : deux unités écrivant le même
   * fichier étaient sérialisées, puis produisaient quand même deux branches
   * concurrentes depuis la même base. La sérialisation n'achetait rien.
   *
   * Une intégration ne peut pas survenir pendant cet appel — la review est un
   * appel séparé — donc ce qui est possédé ici le reste jusqu'au retour.
   */
  const running = new Map<string, { unit: WorkUnit; done: Promise<string> }>();
  const owned: WorkUnit[] = [...(ctx.owners ?? [])];

  const startable = (): number => {
    /*
     * Le premier candidat **actuellement compatible**, pas le premier candidat.
     *
     * La nuance est le contraire d'un détail. Si W02 attend l'ownership d'une
     * lane active et que W03 est libre, la file démarre W03 en passant au-dessus
     * de W02 : laisser l'emplacement vide par respect de l'ordre reviendrait à
     * refaire un scheduler de vagues. W02 ne perd rien — il garde sa place et
     * n'est pas refusé, il attend simplement que sa ressource se libère.
     *
     * L'ordre des candidats reste la règle de départage entre plusieurs
     * compatibles ; il ne l'est pas entre compatible et bloqué.
     */
    return waiting.findIndex(({ unit }) => blockedBy(unit) === undefined);
  };

  /**
   * Le propriétaire qui empêche cette unité de démarrer, s'il existe.
   *
   * Une unité possède son scope **contre les autres**, jamais contre
   * elle-même : sinon un rework se bloquerait sur sa propre lane, alors que
   * c'est exactement la même lane qu'il vient reprendre — même worktree, même
   * branche, même état. Le rework est éligible immédiatement, et peut partager
   * un lot avec une unité indépendante.
   *
   * Le propriétaire est nommé plutôt que constaté : pour l'orchestrateur, savoir
   * quelle lane intégrer est ce qui lui permet d'agir, et « une lane non
   * intégrée » ne le lui dit pas.
   */
  const blockedBy = (unit: WorkUnit): WorkUnit | undefined =>
    owned.find((o) => o.id !== unit.id && ctx.collide(o, unit));

  while (waiting.length > 0 || running.size > 0) {
    while (running.size < maxParallel) {
      const next = startable();
      if (next === -1) break;
      const [{ candidate, unit }] = waiting.splice(next, 1);
      owned.push(unit);
      outcomes.set(unit.id, { workUnitId: unit.id, state: "running", reason: "" });
      /*
       * `Promise.resolve().then(...)` et non `start(...)` directement : un
       * `start` qui jette **avant** de rendre sa promesse ferait rejeter
       * `runLanes` lui-même, et les autres lanes sortiraient du contrat qui
       * promet qu'un échec n'emporte pas les résultats acquis. Le callback fera
       * du travail synchrone — ouvrir un worktree, valider — donc le cas n'est
       * pas théorique.
       */
      const done = Promise.resolve()
        .then(() => start(candidate, unit))
        .then(
        (value) => {
          outcomes.set(unit.id, { workUnitId: unit.id, state: "done", reason: "", value });
          return unit.id;
        },
        (error) => {
          // Une lane qui explose rend son emplacement et son erreur. Les autres
          // continuent, et ce qu'elles ont produit reste.
          outcomes.set(unit.id, { workUnitId: unit.id, state: "done", reason: "échec", error });
          return unit.id;
        },
      );
      running.set(unit.id, { unit, done });
    }

    if (running.size === 0) {
      /*
       * Plus rien ne tourne et rien ne peut démarrer : chaque candidate restante
       * se heurte à un scope déjà possédé. C'est terminal pour cet appel, et
       * légitime — le propriétaire attend une review, qui viendra après.
       *
       * Sans propriétaire, en revanche, l'état est impossible : `startable()`
       * ne compare qu'à `owned`, donc un `owned` vide rend toujours le premier
       * candidat démarrable. Si cela arrive, c'est une régression du scheduler
       * et non une faute d'admission, et la maquiller en refus enverrait
       * l'orchestrateur corriger un plan qui n'a rien.
       */
      for (const { unit } of waiting) {
        const owner = blockedBy(unit);
        if (owner) {
          outcomes.set(unit.id, {
            workUnitId: unit.id,
            state: "queued",
            reason: `scope détenu par ${owner.id}, pas encore intégrée`,
          });
        }
      }
      if (owned.length === 0) {
        throw new SchedulerInvariantError(
          `invariant rompu : ${waiting.length} candidat(s) en attente, aucun scope possédé`,
        );
      }
      break;
    }

    const finished = await Promise.race([...running.values()].map((a) => a.done));
    running.delete(finished);
  }

  return candidates.map(
    (c) =>
      outcomes.get(c.workUnitId) ?? {
        workUnitId: c.workUnitId,
        state: "refused",
        reason: "candidat inconnu",
      },
  );
}
