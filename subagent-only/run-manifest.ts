/**
 * Ce qui fait qu'un run est le même run après un redémarrage.
 *
 * `RUN_ID` était tiré au hasard au chargement de l'extension, avec ce
 * commentaire : « it dies with the session ». C'était vrai et acceptable tant
 * que rien ne survivait au processus. Les worktrees ont changé ça sans que
 * l'identité suive : après un crash, une session repartait avec un nouvel
 * identifiant, ne retrouvait ni son plan gelé — `<runId>-plan.json` — ni ses
 * lanes — `<runId>-<workUnitId>` — et rouvrait des worktrees neufs à côté de
 * ceux qui portaient déjà le travail.
 *
 *     session     durée de vie du processus
 *     run         durée de vie d'un plan gelé et de son exécution
 *     lane        (runId, workUnitId)
 *
 * Une nouvelle session n'est donc pas un nouveau run. Un nouveau run est un
 * événement explicite : le précédent est terminé ou abandonné.
 *
 * Le `runId` reste tiré au hasard, mais une seule fois puis persisté. Le dériver
 * du plan aurait empêché deux exécutions successives du même plan de coexister ;
 * le `planHash` sert seulement à vérifier qu'on reprend bien le plan auquel ce
 * run est attaché.
 *
 * Aucune réparation silencieuse. Une contradiction entre le manifeste et le
 * disque est une erreur de reprise et non une supposition à faire — c'est la
 * règle de tout ce chantier, et c'est ici qu'elle compte le plus, puisque
 * deviner ferait perdre du travail.
 */
import { createHash, randomBytes } from "node:crypto";
import {
  appendFileSync, existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, statSync,
  writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import type { LaneEvent } from "./lane-ledger.js";
import type { IntegrationEvent } from "./integration-ledger.js";
import { join } from "node:path";

/** Le manifeste ne se répare pas : ce qu'il dit et ce que le disque montre doivent s'accorder. */
export class RecoveryError extends Error {}

/**
 * Une transition du run est en cours ailleurs, et elle dure.
 *
 * Ni une faute ni un incident : le run est occupé, et réessayer est la bonne
 * réponse. La distinguer d'une `RecoveryError` importe, parce que celle-ci
 * demande une réconciliation là où celle-là demande seulement de la patience.
 */
export class RunBusyError extends Error {}

export type RunStatus = "planning" | "active" | "completed" | "abandoned";

export interface RunManifest {
  version: 1;
  runId: string;
  status: RunStatus;
  /** Le fichier du plan gelé, une fois attaché. */
  plan?: string;
  /** Le plan tel qu'il était à son attachement. Vérifie la reprise, n'identifie pas le run. */
  planHash?: string;
  /** Le commit d'où ce run est parti. */
  baseCommit?: string;
  /**
   * La prochaine séquence libre.
   *
   * Durable, parce que les artefacts et les identifiants de risque en dépendent :
   * `<runId>-<seq>-worker.json`, `<runId>-<seq>-<position>`. Un compteur qui
   * repartirait de zéro après un crash ferait désigner deux risques différents
   * par le même identifiant, et écraserait des artefacts. Un trou dans la suite
   * ne coûte rien ; une réutilisation coûte la provenance.
   */
  nextSeq: number;
}

const MANIFEST = "active-run.json";

function manifestPath(dir: string): string {
  return join(dir, MANIFEST);
}

/**
 * Écriture par fichier temporaire puis renommage.
 *
 * `rename` est atomique sur un même système de fichiers : ou l'ancien manifeste
 * est là, ou le nouveau, jamais un fichier tronqué. Un manifeste à moitié écrit
 * serait un run irrécupérable, et c'est ce que ce module existe pour éviter.
 */
function writeAtomic(path: string, text: string): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

export function readManifest(dir: string): RunManifest | undefined {
  const path = manifestPath(dir);
  if (!existsSync(path)) return undefined;
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    throw new RecoveryError(
      `${MANIFEST} est illisible : ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const m = doc as Partial<RunManifest>;
  if (m?.version !== 1 || typeof m.runId !== "string" || !m.runId) {
    throw new RecoveryError(`${MANIFEST} ne porte pas de run exploitable`);
  }
  if (!["planning", "active", "completed", "abandoned"].includes(String(m.status))) {
    throw new RecoveryError(`${MANIFEST} : statut invalide (${String(m.status)})`);
  }
  if (typeof m.nextSeq !== "number" || !Number.isInteger(m.nextSeq) || m.nextSeq < 1) {
    throw new RecoveryError(`${MANIFEST} : nextSeq invalide (${String(m.nextSeq)})`);
  }
  return m as RunManifest;
}

function writeManifest(dir: string, manifest: RunManifest): void {
  mkdirSync(dir, { recursive: true });
  writeAtomic(manifestPath(dir), `${JSON.stringify(manifest, null, 2)}\n`);
}

export interface OpenRun {
  manifest: RunManifest;
  /** Ce run existait déjà : la session le reprend, elle ne le crée pas. */
  resumed: boolean;
}

/**
 * Le run actif du dépôt : repris s'il en existe un actif, créé sinon.
 *
 * Un run `completed` ou `abandoned` ne se reprend pas — il est fini, et le
 * suivant en est un autre. Un run `planning` ou `active` se reprend toujours :
 * c'est précisément le cas du crash.
 */
export function openRun(dir: string, baseCommit?: string): OpenRun {
  const existing = readManifest(dir);
  if (existing && (existing.status === "planning" || existing.status === "active")) {
    return { manifest: existing, resumed: true };
  }
  const manifest: RunManifest = {
    version: 1,
    /*
     * Huit octets, pas trois.
     *
     * Vingt-quatre bits suffisaient quand le run mourait avec la session. Le
     * même identifiant indexe maintenant durablement les archives, les
     * artefacts, les risques, les plans et les worktrees — et les runs terminés
     * sont conservés, précisément pour la réconciliation. Effet anniversaire :
     * environ 3 % de collision à mille runs, 11 % à deux mille, 52 % à cinq
     * mille. Une collision ferait partager le même espace de noms à deux runs
     * sans rapport.
     */
    runId: randomBytes(8).toString("hex"),
    status: "planning",
    nextSeq: 1,
    ...(baseCommit ? { baseCommit } : {}),
  };
  /*
   * Création exclusive, et c'est la seule mutation qui ne demande pas de bail.
   *
   * Elle ne peut pas en demander un : le bail se prend sur un `runId`, qui
   * n'existe pas encore. Elle doit donc porter sa propre exclusion, sinon deux
   * sessions démarrant ensemble sur un dépôt vierge créeraient chacune un run,
   * la seconde écraserait la première, et toutes deux prendraient un bail — sur
   * deux identités différentes dont une seule serait sur le disque. Chacune se
   * croirait propriétaire, écrirait ses artefacts sous son propre préfixe, et
   * ouvrirait ses propres worktrees.
   *
   * La création exclusive échoue si le manifeste actif existe déjà. Le perdant
   * relit et rejoint le run du gagnant, ce qui est exactement le comportement
   * voulu : il n'y a qu'un run actif par dépôt.
   */
  mkdirSync(dir, { recursive: true });

  if (!existing) return createRunExclusive(dir, manifest);

  /*
   * Le run précédent est terminé : celui-ci le remplace, et le remplacement doit
   * être aussi exclusif que la création.
   *
   * La première version écrivait puis relisait pour adopter ce qu'elle trouvait.
   * Ça ne converge que si les écritures s'entrelacent : A qui écrit puis relit
   * avant que B n'écrive repart sur une identité que le disque remplace ensuite.
   * C'est exactement le défaut que la création exclusive supprime sur dépôt
   * vierge, déplacé d'un chemin à l'autre.
   *
   * Le manifeste terminé est donc d'abord **archivé**, et `rename` tranche : le
   * premier réussit, le second échoue avec ENOENT parce que le fichier n'est
   * plus là. Les deux se retrouvent ensuite devant un dépôt sans manifeste, où
   * la création exclusive décide. Un seul run naît.
   *
   * L'archive n'est pas un effet secondaire : elle garde la trace du run
   * précédent, dont la réconciliation durable a besoin.
   */
  archiveFinished(dir, existing);
  return createRunExclusive(dir, manifest);
}

/**
 * Met de côté le manifeste d'un run terminé, une seule fois.
 *
 * `rename` est l'arbitre : deux sessions qui archivent ensemble, une seule
 * réussit. Celle qui échoue trouve simplement un dépôt sans manifeste, ce qui
 * est le bon état pour la suite.
 */
function archiveFinished(dir: string, finished: RunManifest): boolean {
  try {
    renameSync(manifestPath(dir), join(dir, `${finished.runId}-run.json`));
    return true;
  } catch (err) {
    if ((err as { code?: string })?.code === "ENOENT") return false;
    throw err;
  }
}

/**
 * Crée un run sur un dépôt qui n'en a pas, sans pouvoir en écraser un.
 *
 * Exportée pour être éprouvée directement : la course qu'elle protège tient
 * dans deux appels système, et deux processus synchronisés ne la reproduisent
 * qu'une fois sur quatre. Un invariant qu'on ne sait vérifier qu'au hasard n'est
 * pas vérifié, alors que le contrat de cette fonction — « si le manifeste
 * apparaît entre-temps, adopte-le » — se teste en une ligne.
 */
export function createRunExclusive(dir: string, manifest: RunManifest): OpenRun {
  mkdirSync(dir, { recursive: true });
  /*
   * Écrire ailleurs, puis lier : exclusif **et** atomique.
   *
   * `wx` donnait bien l'exclusivité de la création, mais pas celle du contenu :
   * le fichier apparaît vide puis se remplit, et le perdant qui le lit
   * entre-temps voit un JSON tronqué. Trouvé par le test concurrent, qui
   * échouait une fois sur deux avec « Unexpected end of JSON input » — je l'ai
   * d'abord pris pour de l'instabilité de test.
   *
   * `link` échoue si la destination existe, et rend visible un fichier déjà
   * complet. Le perdant lit donc toujours un manifeste entier.
   */
  const tmp = `${manifestPath(dir)}.${process.pid}.${randomBytes(3).toString("hex")}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`);
  try {
    linkSync(tmp, manifestPath(dir));
  } catch (err) {
    if ((err as { code?: string })?.code !== "EEXIST") throw err;
    const gagnant = readManifest(dir);
    if (!gagnant) throw err;
    return { manifest: gagnant, resumed: true };
  } finally {
    rmSync(tmp, { force: true });
  }
  return { manifest, resumed: false };
}

export function planHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/**
 * Attache un plan au run, ou vérifie que c'est bien le même.
 *
 * Le plan est gelé : s'il a changé sous un run qui l'exécute, les lanes ouvertes
 * et les mesures déjà prises portent sur autre chose. On refuse plutôt que de
 * continuer sur un plan qu'on n'a pas commencé.
 */
/**
 * Le manifeste durable, sous capacité, ou une erreur de reprise.
 *
 * Toute mutation part du disque et non d'une copie mémoire. La première version
 * reconstruisait le document par `{ ...manifest, champ }`, donc une mutation
 * sous un manifeste périmé réécrivait **tous** les autres champs avec leurs
 * anciennes valeurs : le statut redevenait `planning`, le plan gelé disparaissait,
 * et seule la séquence était protégée parce qu'elle relisait le disque. La
 * seconde vérité qu'on cherchait à supprimer, exactement.
 */
function mutable(dir: string, lease: Lease, quoi: string): RunManifest {
  assertOwner(dir, lease, quoi);
  const onDisk = readManifest(dir);
  if (!onDisk) {
    throw new RecoveryError(`${quoi} : le manifeste de ${lease.runId} a disparu`);
  }
  if (onDisk.runId !== lease.runId) {
    throw new RecoveryError(
      `${quoi} : le run actif est ${onDisk.runId}, la capacité porte ${lease.runId}`,
    );
  }
  return onDisk;
}

export function attachPlan(dir: string, text: string, lease: Lease): RunManifest {
  return withRunGuard(dir, lease.runId, () => attachPlanUnguarded(dir, text, lease));
}

function attachPlanUnguarded(dir: string, text: string, lease: Lease): RunManifest {
  const manifest = mutable(dir, lease, "geler le plan");
  const hash = planHash(text);
  if (manifest.planHash && manifest.planHash !== hash) {
    throw new RecoveryError(
      `le plan de ${manifest.runId} a changé depuis son attachement ` +
        `(${manifest.planHash} → ${hash}) : ce run exécute un autre plan`,
    );
  }
  if (manifest.planHash === hash && manifest.status === "active") return manifest;
  const next: RunManifest = {
    ...manifest,
    status: "active",
    plan: `${manifest.runId}-plan.json`,
    planHash: hash,
  };
  writeManifest(dir, next);
  return next;
}

/**
 * Réserve une séquence, durablement, avant la délégation.
 *
 * Exige la propriété : c'est la mutation la plus fréquente et la plus
 * dangereuse à partager. Deux sessions qui réserveraient chacune de leur côté
 * distribueraient le même numéro, donc le même nom d'artefact et le même
 * identifiant de risque.
 *
 * Avant et non après : si le processus meurt entre la réservation et l'artefact,
 * la suite a un trou, ce qui ne coûte rien. Réserver après aurait laissé deux
 * délégations prendre le même numéro, et deux risques porter le même identifiant.
 */
export function allocateSeq(dir: string, lease: Lease): { seq: number; manifest: RunManifest } {
  return withRunGuard(dir, lease.runId, () => {
    const manifest = mutable(dir, lease, "réserver une séquence");
    const next: RunManifest = { ...manifest, nextSeq: manifest.nextSeq + 1 };
    writeManifest(dir, next);
    return { seq: manifest.nextSeq, manifest: next };
  });
}

export function setStatus(dir: string, status: RunStatus, lease: Lease): RunManifest {
  return withRunGuard(dir, lease.runId, () => {
    const next: RunManifest = { ...mutable(dir, lease, "changer le statut du run"), status };
    writeManifest(dir, next);
    return next;
  });
}

/**
 * Décider sous la propriété, sur un état relu sous elle.
 *
 * Acquérir un bail sérialise les écritures **futures** ; cela ne rend pas
 * rétroactivement valide une décision prise avant. Un outil qui lit l'état, le
 * juge, puis prend le bail et écrit, écrit sur un monde qu'il a observé quand
 * une autre session pouvait encore le changer — et une autre session a
 * précisément le droit de clore la tentative ou d'abandonner la lane entre les
 * deux.
 *
 * Le premier relevé garde sa place : il sert à refuser vite et à savoir de quel
 * objet on parle. C'est le second, fait sous la capacité, qui autorise.
 *
 * `release` passe toujours, y compris sur un refus ou une exception : un bail
 * pris pour une décision qui n'a pas lieu doit être rendu, sans quoi la session
 * suivante attendrait son expiration pour rien.
 */
export function decideUnderLease<T>(steps: {
  acquire: () => void;
  reread: () => T;
  validate: (state: T) => string | null;
  act: (state: T) => void;
  release: () => void;
}): { ok: true } | { ok: false; reason: string } {
  steps.acquire();
  try {
    const state = steps.reread();
    const refus = steps.validate(state);
    if (refus) return { ok: false, reason: refus };
    steps.act(state);
    return { ok: true };
  } finally {
    steps.release();
  }
}

// ------------------------------------ le registre des tentatives d'intégration

/**
 * Un second registre, avec la même discipline et un vocabulaire à part.
 *
 * Distinct de celui des lanes parce qu'une tentative d'intégration n'est ni une
 * lane ni une WorkUnit : elle naît d'une rencontre entre deux commits, en meurt,
 * et plusieurs peuvent se succéder pour une même unité. Sous le même en-tête,
 * deux vocabulaires et deux durées de vie se seraient mêlés.
 */
export const INTEGRATION_LEDGER_VERSION = 1;

export function integrationLedgerPath(dir: string, runId: string): string {
  return join(dir, `${runId}-integrations.jsonl`);
}

export interface IntegrationLedgerRead {
  events: IntegrationEvent[];
  malformed: number;
  malformedLines: number[];
  version: number | undefined;
}

/** Lecture libre, comme pour les lanes : observer n'exige pas la propriété. */
export function readIntegrationEvents(dir: string, runId: string): IntegrationLedgerRead {
  const path = integrationLedgerPath(dir, runId);
  if (!existsSync(path)) {
    return { events: [], malformed: 0, malformedLines: [], version: INTEGRATION_LEDGER_VERSION };
  }
  const events: IntegrationEvent[] = [];
  let version: number | undefined;
  const malformedLines: number[] = [];
  let malformed = 0;
  let numero = 0;
  for (const ligne of readFileSync(path, "utf-8").split("\n")) {
    numero += 1;
    if (!ligne.trim()) continue;
    try {
      const doc = JSON.parse(ligne) as Record<string, unknown>;
      if (typeof doc.integration_ledger === "number" && numero === 1) {
        version = doc.integration_ledger;
        continue;
      }
      if (integrationEventIsWellFormed(doc)) {
        events.push(doc as unknown as IntegrationEvent);
      } else {
        malformed += 1;
        malformedLines.push(numero);
      }
    } catch {
      malformed += 1;
      malformedLines.push(numero);
    }
  }
  return { events, malformed, malformedLines, version };
}

/**
 * La forme d'un événement, vérifiée à la lecture.
 *
 * Chaque nature a ses champs obligatoires, et l'`id` l'est pour toutes : c'est
 * lui qui rattache un fait à sa tentative. Une ligne incomplète est abîmée, pas
 * partiellement utilisable — accepter un `COMMITTED` sans `tree` reviendrait à
 * enregistrer une preuve qui ne prouve rien.
 */
function integrationEventIsWellFormed(doc: Record<string, unknown>): boolean {
  const texte = (k: string) => typeof doc[k] === "string" && (doc[k] as string).length > 0;
  if (!texte("id")) return false;
  switch (doc.event) {
    case "ATTEMPT_OPENED":
      return (
        texte("work_unit") &&
        typeof doc.seq === "number" &&
        texte("p1") &&
        texte("p2") &&
        Array.isArray(doc.conflicts) &&
        (doc.conflicts as unknown[]).every((c) => typeof c === "string")
      );
    case "COMMITTED":
      return texte("commit") && texte("tree");
    case "RECOVERY_REQUIRED":
      return (
        texte("reason") &&
        (doc.observed_commit === undefined || texte("observed_commit"))
      );
    case "SUPERSEDED":
      return texte("by");
    case "CLOSED":
      return texte("outcome");
    default:
      return false;
  }
}

/**
 * Ajout gardé, exactement comme pour les lanes.
 *
 * Une session qui a perdu son bail ne doit pas pouvoir écrire l'histoire des
 * tentatives : c'est une vérité durable sur le run, et la laisser hors de la
 * capacité ouvrirait une seconde vérité sans règles — celle-là même que le
 * registre des lanes a été gardé pour éviter.
 */
export function appendIntegrationEvent(
  dir: string,
  event: IntegrationEvent,
  lease: Lease,
): void {
  withRunGuard(dir, lease.runId, () => {
    assertOwner(dir, lease, `enregistrer ${event.event} sur ${event.id}`);
    const path = integrationLedgerPath(dir, lease.runId);
    if (!existsSync(path)) {
      appendFileSync(path, `${JSON.stringify({ integration_ledger: INTEGRATION_LEDGER_VERSION })}\n`);
    } else {
      const lu = readIntegrationEvents(dir, lease.runId);
      if (lu.version !== INTEGRATION_LEDGER_VERSION) {
        const trouve = lu.version === undefined ? "sans version" : `version ${lu.version}`;
        throw new RecoveryError(
          `registre d'intégrations ${lease.runId} ${trouve} : migration requise avant toute écriture`,
        );
      }
      if (lu.malformedLines.length > 0) {
        throw new RecoveryError(
          `registre d'intégrations ${lease.runId} illisible ligne(s) ${lu.malformedLines.join(", ")}`,
        );
      }
    }
    appendFileSync(path, `${JSON.stringify(event)}\n`);
  });
}

// ------------------------------------------------ le registre des lanes

/**
 * Le registre de vie des lanes : ajout gardé, lecture libre.
 *
 * Gardé pour la même raison que le manifeste : c'est une vérité durable sur le
 * run, et une session qui a perdu son bail ne doit pas pouvoir écrire son
 * histoire. Le laisser hors de la capacité aurait sécurisé le manifeste tout en
 * ouvrant une seconde vérité sans règles.
 *
 * L'ajout est sous `withRunGuard`, donc l'ordre physique du JSONL est déjà
 * l'ordre de sérialisation. Il n'a pas de compteur propre : `nextSeq` sert aux
 * artefacts et aux identifiants de risque, et lui emprunter sa numérotation
 * mêlerait deux espaces qui n'ont rien à voir.
 */
export function laneLedgerPath(dir: string, runId: string): string {
  return join(dir, `${runId}-lanes.jsonl`);
}

/**
 * La version du protocole du registre.
 *
 * Le manifeste en a une, le registre n'en avait pas — et c'est lui qui contient
 * la provenance. Un durcissement du contrat rendait donc tout registre écrit
 * avant lui « illisible », c'est-à-dire indistinguable d'une corruption : le run
 * se fermait avec un diagnostic faux, et la seule issue était de deviner
 * lesquelles de ses lignes réécrire.
 *
 * Une version rend l'évolution détectable au lieu d'être subie. Ce que le
 * registre ne sait pas lire doit se dire « ce registre est d'une autre
 * version », jamais « ces lignes sont abîmées ».
 */
export const LANE_LEDGER_VERSION = 1;

export function appendLaneEvent(dir: string, event: LaneEvent, lease: Lease): void {
  withRunGuard(dir, lease.runId, () => {
    assertOwner(dir, lease, `enregistrer ${event.event} sur ${event.work_unit}`);
    const path = laneLedgerPath(dir, lease.runId);
    if (!existsSync(path)) {
      appendFileSync(path, `${JSON.stringify({ ledger: LANE_LEDGER_VERSION })}\n`);
    } else {
      /*
       * La version fait partie de l'invariant d'écriture, pas seulement de la
       * porte `task`. Un nouvel appelant ne doit jamais pouvoir mélanger des
       * événements v1 dans un registre legacy, futur ou amputé.
       */
      const lu = readLaneEvents(dir, lease.runId);
      if (lu.version !== LANE_LEDGER_VERSION) {
        const trouve = lu.version === undefined ? "sans version" : `version ${lu.version}`;
        throw new RecoveryError(
          `registre ${lease.runId} ${trouve} : migration requise avant toute écriture`,
        );
      }
      if (lu.malformedLines.length > 0) {
        throw new RecoveryError(
          `registre ${lease.runId} illisible ligne(s) ${lu.malformedLines.join(", ")}`,
        );
      }
    }
    appendFileSync(path, `${JSON.stringify(event)}\n`);
  });
}

/**
 * Le registre tel qu'il est sur le disque.
 *
 * Une ligne illisible n'est pas ignorée : elle est comptée et signalée. Sauter
 * en silence une ligne du registre reviendrait à réécrire l'histoire du run,
 * et c'est précisément ce que ce fichier existe pour empêcher.
 */
export interface LedgerRead {
  events: LaneEvent[];
  malformed: number;
  malformedLines: number[];
  /**
   * La version déclarée en tête, ou `undefined` si le registre n'en porte pas.
   *
   * `undefined` sur un registre non vide veut dire « écrit avant que le
   * protocole soit versionné », ce qui est une évolution à traiter et non une
   * corruption à réparer.
   */
  version?: number;
}

export function readLaneEvents(dir: string, runId: string): LedgerRead {
  const path = laneLedgerPath(dir, runId);
  if (!existsSync(path)) {
    return { events: [], malformed: 0, malformedLines: [], version: LANE_LEDGER_VERSION };
  }
  const events: LaneEvent[] = [];
  let version: number | undefined;
  // Les numéros, pas seulement le compte : une procédure de récupération qui
  // sait qu'elle doit agir mais pas où n'est pas une procédure.
  const malformedLines: number[] = [];
  let malformed = 0;
  let numero = 0;
  for (const ligne of readFileSync(path, "utf-8").split("\n")) {
    numero += 1;
    if (!ligne.trim()) continue;
    try {
      const doc = JSON.parse(ligne) as Record<string, unknown>;
      // L'en-tête, s'il est là, est la première ligne physique.
      if (typeof doc.ledger === "number" && numero === 1) {
        version = doc.ledger;
        continue;
      }
      const nature = doc.event;
      const unite = typeof doc.work_unit === "string" ? doc.work_unit : "";
      const connu = nature === "OPENED" || nature === "INTEGRATED" || nature === "ABANDONED";
      // Une ouverture sans base n'est pas une ouverture : `base` décide si
      // l'unité peut être prouvée intégrée, donc si ses dépendantes sont
      // admissibles. L'accepter laisserait le run utilisable jusqu'au merge, où
      // il se rebloquerait sans qu'on sache pourquoi.
      const complete =
        nature !== "OPENED" || (typeof doc.base === "string" && doc.base.length > 0);
      /*
       * Le commit d'intégration est facultatif, sa forme ne l'est pas.
       *
       * Absent, l'intégration se prouve par la branche — c'est le cas legacy,
       * légitime. Présent mais vide ou d'un autre type, c'est une ligne écrite
       * par quelque chose qui a cru enregistrer une preuve : l'accepter en
       * silence rendrait `integration_commit: ""` indistinguable de l'absence,
       * et la lane retomberait sur la preuve par branche en croyant en avoir
       * une durable. La ligne est abîmée, et se dit telle.
       */
      const preuve =
        nature !== "INTEGRATED" ||
        doc.integration_commit === undefined ||
        (typeof doc.integration_commit === "string" && doc.integration_commit.length > 0);
      if (connu && unite && complete && preuve) {
        events.push(doc as unknown as LaneEvent);
      } else {
        malformed += 1;
        malformedLines.push(numero);
      }
    } catch {
      malformed += 1;
      malformedLines.push(numero);
    }
  }
  return { events, malformed, malformedLines, version };
}

export type LaneLedgerMigration =
  | { status: "missing" }
  | { status: "current"; events: number }
  | { status: "unsupported"; version: number }
  | { status: "malformed"; lines: number[] }
  | { status: "migrated"; events: number };

/**
 * Pose l'en-tête courant sur un registre legacy, sous la même capability et la
 * même clôture que les autres mutations durables du run.
 *
 * Le remplacement est atomique : un crash pendant l'écriture du fichier
 * temporaire ne peut pas tronquer la provenance existante.
 */
export function migrateLaneLedger(
  dir: string,
  runId: string,
  lease: Lease,
): LaneLedgerMigration {
  if (lease.runId !== runId) {
    throw new NotOwnerError(`le bail ${lease.runId} ne peut pas migrer ${runId}`);
  }
  return withRunGuard(dir, runId, () => {
    assertOwner(dir, lease, `migrer le registre de ${runId}`);
    const path = laneLedgerPath(dir, runId);
    if (!existsSync(path)) return { status: "missing" };

    const lu = readLaneEvents(dir, runId);
    if (lu.version === LANE_LEDGER_VERSION) {
      return { status: "current", events: lu.events.length };
    }
    if (lu.version !== undefined) {
      return { status: "unsupported", version: lu.version };
    }
    if (lu.malformedLines.length > 0) {
      return { status: "malformed", lines: [...lu.malformedLines] };
    }

    const original = readFileSync(path, "utf-8");
    const temp = `${path}.migrate-${lease.leaseId}-${randomBytes(4).toString("hex")}`;
    try {
      writeFileSync(
        temp,
        `${JSON.stringify({ ledger: LANE_LEDGER_VERSION })}\n${original}`,
        { flag: "wx" },
      );
      renameSync(temp, path);
    } finally {
      rmSync(temp, { force: true });
    }
    return { status: "migrated", events: lu.events.length };
  });
}

// -------------------------------------------------------------- le bail

/**
 * Cette session ne possède pas ce run.
 *
 * Lire ne demande rien : découvrir le run actif, relire son plan, examiner ses
 * lanes et ses artefacts sont des opérations sûres, et les interdire priverait
 * une seconde session de tout diagnostic pendant qu'une première exécute.
 * Muter, en revanche, demande la propriété — et l'exiger au chargement aurait
 * confondu « ouvrir le dépôt » avec « prendre la responsabilité exclusive ».
 */
export class NotOwnerError extends Error {}

export interface Lease {
  version: 1;
  runId: string;
  /** Éphémère : il distingue les sessions, il n'identifie pas le run. */
  sessionId: string;
  /**
   * Cette acquisition-ci, et pas une autre de la même session.
   *
   * Une session peut libérer un run puis le reprendre. Sans lui, une opération
   * retardée de l'ancienne acquisition agirait sous le nouveau bail au seul
   * motif que le `sessionId` correspond.
   */
  leaseId: string;
  pid: number;
  host: string;
  acquiredAt: string;
}

/**
 * Le bail est un **répertoire**, et c'est `mkdir` qui tranche.
 *
 * La première version faisait « regarder puis écrire » : deux sessions
 * pouvaient toutes deux observer un run libre, puis écrire chacune son bail.
 * Mesuré par Sol sur quarante courses synchronisées : trois fois, les deux
 * sessions se sont crues propriétaires. Un remplacement atomique ne donne pas
 * l'exclusion — il garantit seulement qu'on ne lit pas un fichier à moitié
 * écrit.
 *
 *     <runId>.lease/            mkdir échoue si elle existe : l'arbitre
 *       owner.json              écrit une fois, jamais modifié
 *       hb-<leaseId>            battement, un fichier par acquisition
 *
 * La séparation entre l'identité et le battement supprime la seconde course.
 * Un battement n'écrit que le fichier portant **son** `leaseId`, et la vivacité
 * se lit dans celui du propriétaire **courant**. Un battement retardé de L1
 * écrit donc dans un fichier que plus personne ne lit, au lieu de ressusciter
 * une propriété que L2 a reprise. Il n'y a plus de fenêtre entre la
 * vérification et l'acte : il n'y a plus de vérification à faire.
 */
export const LEASE_STALE_MS = 90_000;

/**
 * L'intervalle entre deux battements.
 *
 * Plusieurs battements manqués avant de qualifier un bail de périmé : un run
 * dont un worker tourne sept minutes ne doit pas voir son bail expirer parce
 * qu'aucune délégation ne s'est terminée.
 */
export const LEASE_HEARTBEAT_MS = 15_000;

/**
 * Le temps au-delà duquel une section critique est forcément un vestige.
 *
 * Elles sont synchrones et tiennent en quelques appels système. Un verrou plus
 * vieux que ça n'est pas une contention : c'est un processus mort au milieu
 * d'une transition, et ça se réconcilie, ça ne se force pas.
 */
const GUARD_STALE_MS = 5_000;

/**
 * Combien de temps on accepte d'attendre une transition en cours.
 *
 * Distinct du seuil de péremption, que la première version confondait avec lui :
 * `GUARD_STALE_MS` dit à partir de quand un verrou est un vestige, pas combien
 * de temps on patiente. Les deux mêlés bloquaient pi cinq secondes sur une
 * contention parfaitement normale, sans rien afficher — et `withRunGuard` est
 * synchrone, donc « bloqué » veut dire bloqué.
 *
 * Une section critique fait quelques appels système. Une demi-seconde est
 * largement au-dessus, et ce qui dure plus longtemps sans être périmé n'est pas
 * une attente : c'est un run occupé, et on le dit.
 */
const GUARD_WAIT_MS = 500;

function guardPath(dir: string, runId: string): string {
  return join(dir, `${runId}.guard`);
}

/** Depuis quand ce verrou est-il là ? Un vestige de crash se reconnaît à son âge. */
function ageOf(path: string): number {
  try {
    return Date.now() - statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

/** Attente synchrone. Les sections sont courtes ; il n'y a rien à ordonnancer. */
function pause(ms: number): void {
  const partage = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(partage, 0, 0, ms);
}

/**
 * Sérialise les transitions d'un run : personne ne peut le reprendre au milieu.
 *
 * `mkdir` rendait l'acquisition exclusive, mais pas les transitions. Il restait
 * partout la même fenêtre entre la vérification et l'acte :
 *
 *     A relâche L1 : vérifie qu'il possède      → vrai
 *     B reprend    : retire L1, installe L2
 *     A relâche L1 : supprime le répertoire     → efface L2
 *
 * et la même sur les mutations du manifeste : `assertOwner` passait, la reprise
 * s'intercalait, l'écriture avait lieu sous une capacité déjà perdue. Vérifier
 * qu'on possède le run et empêcher qu'on nous le reprenne d'ici la fin de
 * l'écriture sont deux choses, et 3b.1 a besoin de la seconde.
 *
 * Le verrou est distinct du bail : il ne dure que le temps d'une transition, et
 * il ne confère aucune propriété. Un vestige de crash devient une reprise à
 * faire, jamais une prise de force — c'est la règle de tout ce chantier.
 */
function withRunGuard<T>(dir: string, runId: string, fn: () => T): T {
  mkdirSync(dir, { recursive: true });
  const path = guardPath(dir, runId);
  const limite = Date.now() + GUARD_WAIT_MS;
  for (;;) {
    try {
      mkdirSync(path);
      break;
    } catch (err) {
      if ((err as { code?: string })?.code !== "EEXIST") throw err;
      /*
       * L'âge du verrou, pas seulement le temps qu'on a passé à l'attendre.
       *
       * Attendre l'échéance avant de conclure faisait patienter cinq secondes
       * devant un vestige qui se reconnaît immédiatement — et trois transitions
       * refusées coûtaient quinze secondes pour un diagnostic qu'on avait dès
       * la première lecture. La contention, elle, se résout en millisecondes.
       */
      const depuis = ageOf(path);
      if (depuis > GUARD_STALE_MS) {
        throw new RecoveryError(
          `une transition de ${runId} est restée inachevée (${path}, ` +
            `${Math.round(depuis / 1000)} s) : réconcilier avant de reprendre`,
        );
      }
      if (Date.now() > limite) {
        throw new RunBusyError(
          `une transition de ${runId} est en cours depuis ${Math.round(depuis)} ms : réessayer`,
        );
      }
      pause(2);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
}

function leaseDir(dir: string, runId: string): string {
  return join(dir, `${runId}.lease`);
}
function ownerPath(dir: string, runId: string): string {
  return join(leaseDir(dir, runId), "owner.json");
}
function beatPath(dir: string, runId: string, leaseId: string): string {
  return join(leaseDir(dir, runId), `hb-${leaseId}`);
}

function readOwner(dir: string, runId: string): { owner?: Lease; unreadable: boolean } {
  const path = ownerPath(dir, runId);
  if (!existsSync(path)) {
    // Le répertoire existe sans propriétaire lisible : une acquisition
    // interrompue entre le `mkdir` et l'écriture. On ne devine pas.
    return { unreadable: existsSync(leaseDir(dir, runId)) };
  }
  try {
    const doc = JSON.parse(readFileSync(path, "utf-8")) as Partial<Lease>;
    if (doc?.version !== 1 || typeof doc.sessionId !== "string" || !doc.sessionId) {
      return { unreadable: true };
    }
    if (typeof doc.leaseId !== "string" || !doc.leaseId) return { unreadable: true };
    return { owner: doc as Lease, unreadable: false };
  } catch {
    return { unreadable: true };
  }
}

/** Le dernier battement du propriétaire courant, ou son acquisition à défaut. */
function lastBeat(dir: string, owner: Lease): number {
  try {
    const t = Date.parse(readFileSync(beatPath(dir, owner.runId, owner.leaseId), "utf-8").trim());
    if (!Number.isNaN(t)) return t;
  } catch {
    // Pas encore battu : l'acquisition fait foi.
  }
  const a = Date.parse(owner.acquiredAt);
  return Number.isNaN(a) ? 0 : a;
}

function beat(dir: string, lease: Lease): void {
  writeFileSync(beatPath(dir, lease.runId, lease.leaseId), `${new Date().toISOString()}\n`);
}

export type RunAccess =
  | { kind: "free" }
  | { kind: "owned"; lease: Lease }
  | { kind: "owned-by-other"; lease: Lease }
  | { kind: "recovery-required"; reason: string; lease?: Lease };

export type Ownership =
  | { ok: true; lease: Lease; taken: "acquired" | "already-mine" }
  | { ok: false; kind: "held"; lease: Lease }
  | { ok: false; kind: "recovery-required"; reason: string; lease?: Lease };

/**
 * Regarder qui possède le run, sans le prendre.
 *
 * Observer un propriétaire n'est pas devenir propriétaire : le chargement de
 * l'extension appelle ceci pour afficher l'état et n'acquiert rien.
 */
export function inspectRun(dir: string, runId: string, sessionId: string): RunAccess {
  const { owner, unreadable } = readOwner(dir, runId);
  if (unreadable) {
    return {
      kind: "recovery-required",
      reason: `le bail de ${runId} est illisible : la sortie du propriétaire précédent n'est pas prouvée`,
    };
  }
  if (!owner) return { kind: "free" };
  if (owner.sessionId === sessionId) return { kind: "owned", lease: owner };
  if (leaseAlive(dir, owner)) return { kind: "owned-by-other", lease: owner };
  return {
    kind: "recovery-required",
    reason:
      `le bail de ${runId} est périmé (session ${owner.sessionId}, ` +
      `dernier battement ${new Date(lastBeat(dir, owner)).toISOString()})`,
    lease: owner,
  };
}

/**
 * La propriété du run, demandée avant toute mutation et pas avant.
 *
 * `mkdir` est l'arbitre : il échoue si le répertoire existe, donc une seule
 * session peut créer le bail. Celle qui échoue lit le propriétaire et répond
 * selon son état, sans jamais l'écraser.
 */
export function acquireRunOwnership(dir: string, runId: string, sessionId: string): Ownership {
  return withRunGuard(dir, runId, () => acquireUnguarded(dir, runId, sessionId));
}

function acquireUnguarded(dir: string, runId: string, sessionId: string): Ownership {
  mkdirSync(dir, { recursive: true });
  const lease: Lease = {
    version: 1,
    runId,
    sessionId,
    leaseId: randomBytes(6).toString("hex"),
    pid: process.pid,
    host: hostname(),
    acquiredAt: new Date().toISOString(),
  };
  try {
    mkdirSync(leaseDir(dir, runId));
  } catch (err) {
    if ((err as { code?: string })?.code !== "EEXIST") throw err;
    const etat = inspectRun(dir, runId, sessionId);
    switch (etat.kind) {
      case "owned":
        // Déjà nôtre : on rafraîchit son battement, on n'en crée pas un second.
        beat(dir, etat.lease);
        return { ok: true, lease: etat.lease, taken: "already-mine" };
      case "owned-by-other":
        return { ok: false, kind: "held", lease: etat.lease };
      case "recovery-required":
        return { ok: false, kind: "recovery-required", reason: etat.reason, lease: etat.lease };
      case "free":
        // Inatteignable : sous le verrou, personne ne peut libérer entre le
        // `mkdir` et la lecture, et un répertoire sans `owner.json` est déjà
        // classé « reprise requise » par `readOwner`. La récursion qui vivait
        // ici n'était nécessaire que parce que les transitions n'étaient pas
        // sérialisées.
        throw new RecoveryError(
          `invariant rompu : le bail de ${runId} existe et n'a pas de propriétaire`,
        );
    }
  }
  writeFileSync(ownerPath(dir, runId), `${JSON.stringify(lease, null, 2)}\n`);
  beat(dir, lease);
  return { ok: true, lease, taken: "acquired" };
}

/**
 * Reprend un run dont le bail est périmé ou illisible.
 *
 * Refuse mécaniquement tant que l'état n'est pas `recovery-required` : la
 * première version pouvait écraser n'importe quel bail si un appelant se
 * trompait, ce qui vidait de son sens tout le reste.
 */
export function takeOverRun(dir: string, runId: string, sessionId: string): Lease {
  return withRunGuard(dir, runId, () => {
    const etat = inspectRun(dir, runId, sessionId);
    if (etat.kind !== "recovery-required") {
      throw new NotOwnerError(
        `reprendre ${runId} demande un bail périmé ou illisible ; il est « ${etat.kind} »`,
      );
    }
    rmSync(leaseDir(dir, runId), { recursive: true, force: true });
    const pris = acquireUnguarded(dir, runId, sessionId);
    if (!pris.ok) throw new NotOwnerError(`reprise de ${runId} impossible : ${pris.kind}`);
    return pris.lease;
  });
}

/**
 * Ce bail est-il celui qui possède actuellement le run ?
 *
 * Les trois champs, pas seulement la session. Une opération asynchrone
 * appartenant à une acquisition libérée pourrait se réveiller après que la même
 * session a repris le run.
 */
export function ownsRun(dir: string, lease: Lease): boolean {
  const owner = readOwner(dir, lease.runId).owner;
  return (
    owner !== undefined &&
    owner.runId === lease.runId &&
    owner.sessionId === lease.sessionId &&
    owner.leaseId === lease.leaseId
  );
}

/**
 * Repousse la péremption.
 *
 * N'écrit que le fichier portant **son** `leaseId`, jamais l'identité du
 * propriétaire. Un battement retardé de L1 après une reprise par L2 écrit donc
 * dans un fichier que plus personne ne lit — il ne peut plus ressusciter une
 * propriété perdue, et il n'y a aucune fenêtre entre la vérification et l'acte.
 */
export function heartbeatRun(dir: string, lease: Lease): boolean {
  try {
    beat(dir, lease);
  } catch (err) {
    // Le répertoire de bail a disparu entre-temps : une reprise ou une
    // libération. C'est une réponse, pas une panne — tester son existence avant
    // d'écrire ne faisait que déplacer la course d'un appel système.
    if ((err as { code?: string })?.code === "ENOENT") return false;
    throw err;
  }
  return ownsRun(dir, lease);
}

/**
 * Sortie propre : le bail disparaît, le run reste ce qu'il est.
 *
 * Ne libère que le bail qu'on tient. Un état illisible n'est **pas** libérable :
 * la première version le supprimait, ce qui laissait une ancienne capacité
 * effacer un bail que tout le reste classait « reprise requise ».
 */
export function releaseRunOwnership(dir: string, lease: Lease): boolean {
  return withRunGuard(dir, lease.runId, () => {
    // Sous le verrou : une reprise ne peut plus s'intercaler entre la
    // vérification et la suppression, donc on n'efface plus le bail d'autrui.
    if (!ownsRun(dir, lease)) return false;
    rmSync(leaseDir(dir, lease.runId), { recursive: true, force: true });
    return true;
  });
}

function assertOwner(dir: string, lease: Lease, quoi: string): void {
  if (!ownsRun(dir, lease)) {
    throw new NotOwnerError(
      `${quoi} demande le bail courant de ${lease.runId} ; celui présenté ne l'est plus. ` +
        `Lire reste possible, muter non.`,
    );
  }
}

export interface Heartbeat {
  stop(): void;
}

/**
 * Bat tant que cette session possède le run.
 *
 * Attaché à la propriété et non aux délégations : c'est pendant une délégation
 * que le temps passe. Le timer est `unref` — il n'a aucune raison de maintenir
 * pi en vie à lui seul.
 */
export function startHeartbeat(
  dir: string,
  lease: Lease,
  onLost?: (runId: string) => void,
  everyMs: number = LEASE_HEARTBEAT_MS,
): Heartbeat {
  const timer = setInterval(() => {
    if (!heartbeatRun(dir, lease)) {
      clearInterval(timer);
      onLost?.(lease.runId);
    }
  }, everyMs);
  (timer as unknown as { unref?: () => void }).unref?.();
  return { stop: () => clearInterval(timer) };
}

/**
 * Le refus, dit de façon à ce qu'on sache quoi faire ensuite.
 */
export function describeAccess(access: RunAccess, runId: string): string {
  switch (access.kind) {
    case "free":
      return `run ${runId} · libre`;
    case "owned":
      return `run ${runId} · possédé par cette session`;
    case "owned-by-other":
      return (
        `run ${runId} · LECTURE SEULE\n` +
        `  tenu par la session ${access.lease.sessionId}, pid ${access.lease.pid} ` +
        `sur ${access.lease.host}\n` +
        `  aucune séquence réservée, aucun artefact, aucune lane. Cette session peut ` +
        `inspecter le dépôt et l'état du run, pas le modifier.`
      );
    case "recovery-required":
      return (
        `run ${runId} · REPRISE REQUISE\n` +
        `  ${access.reason}\n` +
        `  la réconciliation du manifeste, du journal et des worktrees doit précéder ` +
        `toute reprise ; rien n'est repris automatiquement.`
      );
  }
}

/**
 * Le propriétaire tourne-t-il encore ?
 *
 * Trois conditions, et aucune ne suffit seule. Un bail posé sur une autre
 * machine est considéré vivant : on ne peut rien en savoir, et prendre un run
 * qui tourne coûte plus cher que refuser un run libre. Un battement trop vieux
 * périme le bail même si le PID répond, parce qu'un PID se réutilise.
 */
function leaseAlive(dir: string, owner: Lease): boolean {
  if (Date.now() - lastBeat(dir, owner) > LEASE_STALE_MS) return false;
  if (owner.host !== hostname()) return true;
  if (typeof owner.pid !== "number" || owner.pid <= 0) return false;
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch {
    return false;
  }
}
