/**
 * terminal.ts — quand une unité, puis un plan, ne doivent plus rien recevoir (lot ITE, P0-A et P0-C).
 *
 * Le constat qui fonde ce module est celui du run QD `1d085ea9` (sol/29) : après l'INTEGRATED de
 * W01, sans aucun message opérateur, quatre délégations de plus sur l'unité intégrée, deux REVIEWED
 * acceptés, et 58,6 % des tokens du run consommés après que le travail qualifié était intégré.
 *
 * Deux prédicats, et rien d'autre. Purs : ni pi, ni disque, ni git. Ce qu'ils lisent, c'est le
 * registre des lanes tel qu'il a été relu, et le texte du plan gelé dont l'identité a été vérifiée
 * ailleurs (`lirePlanAttache`, run-manifest.ts). Aucune décision terminale ne repose sur la mémoire
 * du processus, sur un worktree ou sur une branche (PLAN-LOT-ITE v2 § 0).
 *
 *   uniteTerminale   la lane courante de l'unité porte un INTEGRATED sans ABANDONED ultérieur de
 *                    cette lane. Un ABANDONED opérateur autorisé peut permettre une génération
 *                    suivante tant que le plan n'est pas devenu terminal.
 *
 *   terminalite      le plan devient terminal lorsque sa liste d'unités est non vide et que
 *                    chacune porte, sur sa lane courante non abandonnée, un INTEGRATED final dont
 *                    le `status` atteste le traitement de `design_update`. Une fois atteint, cet
 *                    état est IRRÉVOCABLE pour le run : le registre est parcouru dans l'ordre, et
 *                    le premier préfixe qui satisfait le prédicat suffit. Un événement ultérieur —
 *                    un ABANDONED opérateur compris — ne réouvre rien.
 *
 * Compatibilité (sol, adjudication ITE § 1) : un INTEGRATED sans `status` ne prouve pas
 * l'application d'un `design_update`. Si le plan gelé en prévoit un, l'état est INDÉTERMINÉ —
 * toute délégation est refusée, rien n'est déclaré achevé. S'il n'en prévoit aucun, les unités
 * intégrées sans `status` établissent la terminalité. Rien ici n'écrit quoi que ce soit.
 */
import type { LaneEvent } from "./lane-ledger.ts";
import { parsePlan } from "./work-units.ts";

/** Le plan gelé, réduit à ce que la terminalité lit. */
export interface PlanGele {
  unites: string[];
  /** Le plan déclare-t-il au moins un `design_update` ? */
  avecDesignUpdate: boolean;
}

/**
 * Le plan gelé tel que la terminalité le lit, depuis son texte exact.
 *
 * `undefined` si le texte ne donne pas un plan exploitable : l'appelant le traite comme un plan
 * rompu, jamais comme un plan non terminal.
 */
export function planGele(texte: string): PlanGele | undefined {
  const p = parsePlan(texte);
  if (p.status !== "usable" || p.units.length === 0) return undefined;
  let avecDesignUpdate = false;
  try {
    const doc = JSON.parse(texte) as { work_units?: unknown };
    if (Array.isArray(doc.work_units)) {
      avecDesignUpdate = doc.work_units.some((u) =>
        typeof u === "object" && u !== null && !Array.isArray(u) && "design_update" in u);
    }
  } catch {
    return undefined;
  }
  return { unites: p.units.map((u) => u.id), avecDesignUpdate };
}

type EtatLane = "ouverte" | "integree" | "abandonnee";
interface EtatUnite { lane: string; etat: EtatLane; avecStatus: boolean }

/**
 * La lane d'un événement : son champ en v2, l'unité elle-même en v1, où une unité n'a jamais eu
 * qu'une génération et aucune enveloppe ne nomme de lane.
 */
function laneDe(e: LaneEvent): string {
  return "lane" in e && typeof e.lane === "string" ? e.lane : `v1:${e.work_unit}`;
}

/** Appliquer un événement à l'état courant des unités. Seuls OPENED, INTEGRATED et ABANDONED comptent. */
function appliquer(etats: Map<string, EtatUnite>, e: LaneEvent): void {
  const lane = laneDe(e);
  if (e.event === "OPENED") {
    etats.set(e.work_unit, { lane, etat: "ouverte", avecStatus: false });
    return;
  }
  const courant = etats.get(e.work_unit);
  if (e.event === "INTEGRATED") {
    // En v1, un INTEGRATED peut précéder tout OPENED relu (registre ancien) : il vaut pour l'unité.
    if (courant === undefined || courant.lane === lane) {
      etats.set(e.work_unit, {
        lane,
        etat: courant?.etat === "abandonnee" ? "abandonnee" : "integree",
        avecStatus: "status" in e && e.status !== undefined,
      });
    }
    return;
  }
  if (e.event === "ABANDONED") {
    if (courant === undefined || courant.lane === lane) {
      etats.set(e.work_unit, { lane, etat: "abandonnee", avecStatus: false });
    }
  }
}

/** L'état de chaque unité après tout le registre. */
function etatsFinaux(events: readonly LaneEvent[]): Map<string, EtatUnite> {
  const etats = new Map<string, EtatUnite>();
  for (const e of events) appliquer(etats, e);
  return etats;
}

/** P0-A : la lane courante de l'unité est intégrée et n'a pas été abandonnée depuis. */
export function uniteTerminale(events: readonly LaneEvent[], unite: string): boolean {
  return etatsFinaux(events).get(unite)?.etat === "integree";
}

/** Les unités terminales parmi celles données, dans leur ordre, sans doublon. */
export function unitesTerminales(events: readonly LaneEvent[], unites: readonly string[]): string[] {
  const etats = etatsFinaux(events);
  return [...new Set(unites)].filter((u) => etats.get(u)?.etat === "integree");
}

export type Terminalite =
  | { etat: "en-cours" }
  /** `indice` : la position, dans le registre relu, de l'événement qui a rendu le plan terminal. */
  | { etat: "terminal"; indice: number }
  | { etat: "indetermine"; raison: string };

/**
 * P0-C : le plan est-il, ou a-t-il jamais été, entièrement intégré ?
 *
 * Parcours dans l'ordre du registre ; le premier préfixe terminal fixe l'issue. C'est ce qui rend
 * l'état irrévocable sans rien mémoriser : un redémarrage relit le même registre et retrouve le
 * même préfixe.
 */
export function terminalite(plan: PlanGele, events: readonly LaneEvent[]): Terminalite {
  if (plan.unites.length === 0) return { etat: "en-cours" };
  const etats = new Map<string, EtatUnite>();
  for (let i = 0; i < events.length; i++) {
    appliquer(etats, events[i]);
    const toutes = plan.unites.every((u) => {
      const s = etats.get(u);
      return s?.etat === "integree" && (s.avecStatus || !plan.avecDesignUpdate);
    });
    if (toutes) return { etat: "terminal", indice: i };
  }
  /*
   * Pas terminal. Un INTEGRATED sans status sous un plan qui déclare un design_update ne se
   * complète jamais : il rend la qualification indéterminée dès qu'il existe, et toute délégation
   * est refusée — attendre que les autres unités s'intègrent ne prouverait rien de plus.
   */
  if (plan.avecDesignUpdate) {
    const sansStatus = plan.unites.find((u) => {
      const s = etats.get(u);
      return s?.etat === "integree" && !s.avecStatus;
    });
    if (sansStatus !== undefined) {
      return {
        etat: "indetermine",
        raison:
          `${sansStatus} est intégrée sans status alors que le plan gelé déclare un design_update : ` +
          "l'application du Statut n'est pas prouvée",
      };
    }
  }
  return { etat: "en-cours" };
}
