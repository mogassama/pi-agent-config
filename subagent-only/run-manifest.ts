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
  appendFileSync, closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync,
  readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import {
  laneLedgerIncoherences, parseLaneEventV2, projectRisks, riskKey, type IntegrationStatus, type LaneEvent,
  type LaneEventV1, type ProofMode, type RiskFact, type RiskTransition, type ViolationKind,
} from "./lane-ledger.ts";
import { verifierCompleted } from "./run-end.ts";
import type { IntegrationEvent } from "./integration-ledger.js";
import { basename, dirname, join, resolve } from "node:path";

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

/**
 * Le jeton d'un vestige de transition (C1.10).
 *
 * Un verrou dont l'âge dépasse `GUARD_STALE_MS` est un obstacle NOMMÉ, jamais une
 * autorisation : l'ancienneté seule ne prouve pas l'absence d'un propriétaire
 * vivant (C1.4). Le refus porte ce code pour qu'un opérateur ET un script le
 * reconnaissent sans lire une phrase, et la levée appartient à un verbe dédié,
 * après réconciliation et consentement explicite.
 */
export const RUN_TRANSITION_LOCKED = "RUN_TRANSITION_LOCKED";

/**
 * Un vestige de transition, nommé par son code, et que ce refus ne lève jamais.
 *
 * Elle hérite de `RecoveryError` : une réconciliation est due, ce n'est pas une
 * contention qu'il suffirait de réessayer. `details` porte de quoi décider sans
 * analyser un message — le verrou, son âge, et le jeton.
 */
export class TransitionLockedError extends RecoveryError {
  /*
   * Champs déclarés puis assignés, jamais paramètres-propriété : pi lit ce code en
   * strip-only, où `constructor(readonly x)` n'existe pas.
   */
  readonly code: typeof RUN_TRANSITION_LOCKED;
  readonly details: { code: typeof RUN_TRANSITION_LOCKED; path: string; ageMs: number };
  constructor(message: string, details: { path: string; ageMs: number }) {
    super(message);
    this.code = RUN_TRANSITION_LOCKED;
    this.details = { code: RUN_TRANSITION_LOCKED, path: details.path, ageMs: details.ageMs };
  }
}

export type RunStatus = "planning" | "active" | "completed" | "abandoned";

/**
 * Les deux versions que ce module distingue.
 *
 * Il les distingue plutôt qu'il ne les confond. Un manifeste v1 se lit tel qu'il
 * est écrit et n'est jamais réécrit à l'ouverture : ses registres restent sans
 * témoin possible (C4.7), ce qui est une information et non une lacune à corriger
 * en silence. Convertir v1 en v2 inventerait une provenance que personne n'a.
 */
export const MANIFEST_VERSIONS = [1, 2] as const;
export type ManifestVersion = (typeof MANIFEST_VERSIONS)[number];

/** La version dans laquelle les nouveaux runs naissent. */
export const MANIFEST_VERSION_COURANTE: ManifestVersion = 2;

/** Le jeton d'un blocage durable après contournement de la garde inline (C6.6). */
export const RUN_CONTINUATION_BLOCKED = "RUN_CONTINUATION_BLOCKED";

/**
 * Les seuls registres qui peuvent porter un témoin (C4.5).
 *
 * La table `ledgers` est PARTIELLE : une clé n'apparaît qu'une fois son registre
 * écrit. Un témoin pour autre chose que ces deux-là ne désigne rien d'autoritaire.
 */
const REGISTRES_ATTENDUS = ["lanes", "integrations"];

/** La fin du run, posée par le verbe opérateur et par lui seul (C1.8). */
export interface RunEnd {
  at: string;
  /** Une identité ou une provenance locale de commande, à défaut le littéral "operator". */
  by: string;
  outcome: "completed" | "abandoned";
  /** Obligatoire pour `abandoned`, qui ne s'accorde pas sans raison. */
  reason?: string;
}

export interface RunManifest {
  version: ManifestVersion;
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
  /**
   * Les registres dont l'existence est attestée, et leur version (§ F, C4.1).
   *
   * Table partielle, et v2 seulement. Écrire les deux clés d'office créerait un
   * témoin en avance : un registre attendu mais absent se lit PERDU alors qu'il
   * n'a jamais existé.
   */
  ledgers?: Record<string, number>;
  /** Présente si et seulement si le run est terminal, et `ended.outcome = status`. */
  ended?: RunEnd;
  /**
   * Un contournement de la garde d'écriture inline a été constaté (C6.6).
   *
   * Ce lot ne le produit jamais : il le lit, le préserve, et le verbe `completed`
   * refusera tant qu'il est là. Le produire appartient au lot qui implémente C6.
   */
  continuation_block?: { at: string; code: typeof RUN_CONTINUATION_BLOCKED };
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

/**
 * Les champs de version 2, contrôlés sans jamais être normalisés.
 *
 * Un manifeste v1 qui porterait `ended`, `ledgers` ou `continuation_block` n'est
 * pas un v2 mal étiqueté : c'est un document dont la provenance est inconnue. Le
 * ramener à l'une des deux versions inventerait ce qu'on ne sait pas. Refus nommé,
 * et aucune conversion implicite — ni ici, ni ailleurs.
 *
 * L'ÉQUIVALENCE V2 EST COMPLÈTE, dans les deux sens.
 *
 *     status ∈ {completed, abandoned} ⇔ ended est présent
 *
 * L'étape 1 ne fermait qu'un sens, parce que le setter général historique pouvait
 * encore produire un statut terminal sans fin. Ce chemin est fermé au même changement :
 * la fin d'un run passe désormais par le verbe opérateur et par lui seul (C1.8), donc un
 * manifeste v2 terminal sans `ended` ne peut plus naître d'un runtime correct.
 *
 * Il devient illisible ET non réinscriptible : ne pas savoir QUI a terminé, QUAND et
 * POURQUOI, c'est ne pas savoir si le run est terminé. Un manifeste v1 reste soumis à
 * C4.7 — aucun champ v2 ne lui est ajouté, et sa migration opérateur reste hors de ce lot.
 */
function assertVersionedFields(m: Partial<RunManifest>, quoi: string): void {
  const champsV2 = ["ledgers", "ended", "continuation_block"].filter(
    (cle) => (m as Record<string, unknown>)[cle] !== undefined,
  );
  if (m.version === 1) {
    if (champsV2.length === 0) return;
    throw new RecoveryError(
      `${quoi} : manifeste de version 1 portant ${champsV2.sort().join(", ")} — ` +
        `champ de version 2, et aucune conversion n'est implicite`,
    );
  }

  if (m.ledgers !== undefined) {
    const table: unknown = m.ledgers;
    if (typeof table !== "object" || table === null || Array.isArray(table)) {
      throw new RecoveryError(`${quoi} : ledgers n'est pas une table`);
    }
    for (const [cle, valeur] of Object.entries(table as Record<string, unknown>)) {
      if (!REGISTRES_ATTENDUS.includes(cle)) {
        throw new RecoveryError(
          `${quoi} : ledgers atteste « ${cle} », qui n'est pas un registre autoritaire ` +
            `(${REGISTRES_ATTENDUS.join(", ")})`,
        );
      }
      if (typeof valeur !== "number" || !Number.isInteger(valeur) || valeur < 1) {
        throw new RecoveryError(
          `${quoi} : ledgers.${cle} ne porte pas une version de registre (${String(valeur)})`,
        );
      }
    }
  }

  const terminal = m.status === "completed" || m.status === "abandoned";
  if (terminal !== (m.ended !== undefined)) {
    throw new RecoveryError(
      `${quoi} : statut ${String(m.status)} et ` +
        `${m.ended === undefined ? "aucune fin" : "une fin posée"} se contredisent — ` +
        `en version 2, un run est terminal si et seulement s'il porte sa fin`,
    );
  }

  const fin: unknown = m.ended;
  if (fin !== undefined) {
    if (typeof fin !== "object" || fin === null || Array.isArray(fin)) {
      throw new RecoveryError(`${quoi} : ended n'est pas un objet`);
    }
    const f = fin as Partial<RunEnd>;
    if (typeof f.at !== "string" || !f.at) {
      throw new RecoveryError(`${quoi} : ended.at absent ou vide`);
    }
    if (typeof f.by !== "string" || !f.by) {
      throw new RecoveryError(`${quoi} : ended.by absent ou vide`);
    }
    if (f.outcome !== "completed" && f.outcome !== "abandoned") {
      throw new RecoveryError(`${quoi} : ended.outcome invalide (${String(f.outcome)})`);
    }
    if (f.outcome !== m.status) {
      throw new RecoveryError(
        `${quoi} : ended.outcome (${f.outcome}) et status (${String(m.status)}) se contredisent`,
      );
    }
    if (f.outcome === "abandoned" && (typeof f.reason !== "string" || !f.reason)) {
      throw new RecoveryError(`${quoi} : abandoned sans raison opérateur`);
    }
    if (f.reason !== undefined && typeof f.reason !== "string") {
      throw new RecoveryError(`${quoi} : ended.reason n'est pas du texte`);
    }
  }

  const bloc: unknown = m.continuation_block;
  if (bloc !== undefined) {
    if (typeof bloc !== "object" || bloc === null || Array.isArray(bloc)) {
      throw new RecoveryError(`${quoi} : continuation_block n'est pas un objet`);
    }
    const b = bloc as { at?: unknown; code?: unknown };
    if (typeof b.at !== "string" || !b.at) {
      throw new RecoveryError(`${quoi} : continuation_block.at absent ou vide`);
    }
    if (b.code !== RUN_CONTINUATION_BLOCKED) {
      throw new RecoveryError(
        `${quoi} : continuation_block.code invalide (${String(b.code)}), ` +
          `attendu ${RUN_CONTINUATION_BLOCKED}`,
      );
    }
  }
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
  if (
    !MANIFEST_VERSIONS.includes(m?.version as ManifestVersion) ||
    typeof m.runId !== "string" ||
    !m.runId
  ) {
    throw new RecoveryError(
      `${MANIFEST} ne porte pas de run exploitable ` +
        `(version ${String(m?.version)}, attendue ${MANIFEST_VERSIONS.join(" ou ")})`,
    );
  }
  if (!["planning", "active", "completed", "abandoned"].includes(String(m.status))) {
    throw new RecoveryError(`${MANIFEST} : statut invalide (${String(m.status)})`);
  }
  if (typeof m.nextSeq !== "number" || !Number.isInteger(m.nextSeq) || m.nextSeq < 1) {
    throw new RecoveryError(`${MANIFEST} : nextSeq invalide (${String(m.nextSeq)})`);
  }
  assertVersionedFields(m, MANIFEST);
  return m as RunManifest;
}

/**
 * L'écrivain est discriminé comme le lecteur.
 *
 * Le contrôle a lieu AVANT le renommage atomique : un manifeste incohérent refusé
 * en mémoire est une panne, le même posé sur le disque est un run irrécupérable.
 * Et la version n'est jamais relevée au passage — les mutateurs recopient le
 * document relu, donc un run v1 reste un run v1 quoi qu'on y change.
 */
function writeManifest(dir: string, manifest: RunManifest): void {
  assertVersionedFields(manifest, `écriture de ${MANIFEST}`);
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
  /*
   * L'ouverture participe à l'exclusion de N, et ce n'est pas une précaution.
   *
   * Sans elle, deux ouvertures concurrentes lisent le MÊME manifeste terminal : la
   * première archive et fait naître un successeur, la seconde supprime ensuite
   * l'`active-run.json` de ce successeur en croyant finir son propre archivage. Le
   * successeur existe et n'est plus courant.
   *
   * Archivage, publication, unlink et création exclusive du successeur restent donc
   * tous dans la MÊME garde de N.
   */
  return withSpaceGuard(dir, () => openRunSousGuard(dir, baseCommit));
}

function openRunSousGuard(dir: string, baseCommit?: string): OpenRun {
  /*
   * La première lecture ne décide de rien : elle sert à connaître R.
   *
   * L'exclusion de N empêche deux ouvertures de se marcher dessus, mais pas une
   * mutation ORDINAIRE du run de détenir R en même temps. Archiver un manifeste lu
   * hors de R, c'est archiver un état qu'une autre session est peut-être en train de
   * changer. C1.9 demande la reprise de la transition COMPLÈTE : l'ordre est donc
   * N → R ici aussi, et la décision se prend sur la relecture protégée.
   */
  const observe = readManifest(dir);
  if (observe) {
    const decision = withRunGuard(dir, observe.runId, () => {
      const stable = readManifest(dir);
      if (!stable || stable.runId !== observe.runId) {
        throw new RecoveryError(
          `openRun : le run courant a changé pendant l'acquisition de son exclusion`,
        );
      }
      if (stable.status === "planning" || stable.status === "active") {
        return { kind: "resume" as const, manifest: stable };
      }
      /*
       * Le run précédent est terminé : archivage, publication et unlink ont lieu ici,
       * sous N ET sous R. La création du successeur, elle, attend la libération de R —
       * elle porte une autre identité, et son exclusion est celle de N.
       */
      archiveFinished(dir, stable);
      return { kind: "archived" as const };
    });
    if (decision.kind === "resume") {
      return { manifest: decision.manifest, resumed: true };
    }
  }

  const manifest: RunManifest = {
    version: MANIFEST_VERSION_COURANTE,
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

  /*
   * Création exclusive, toujours sous N mais après libération de R.
   *
   * Elle ne peut pas demander de bail : le bail se prend sur un `runId`, qui n'existe
   * pas encore. Elle porte donc sa propre exclusion — sinon deux sessions démarrant
   * ensemble sur un dépôt vierge créeraient chacune un run, la seconde écraserait la
   * première, et toutes deux prendraient un bail sur deux identités différentes dont
   * une seule serait sur le disque. Chacune se croirait propriétaire, écrirait ses
   * artefacts sous son propre préfixe, et ouvrirait ses propres worktrees.
   *
   * Le perdant relit et rejoint le run du gagnant : il n'y a qu'un run actif par dépôt.
   */
  return createRunExclusive(dir, manifest);
}

/** Le nom sous lequel le manifeste d'un run terminé est publié, une fois pour toutes. */
export function archivePath(dir: string, runId: string): string {
  return join(dir, `${runId}-run.json`);
}

/**
 * Ce qu'une publication a trouvé : elle a posé l'archive, ou elle était déjà là,
 * identique. Il n'y a pas de troisième issue qui n'échoue pas.
 */
export type Publication = "publiee" | "identique";

/**
 * Publie un fichier existant sous un nom d'archive, SANS JAMAIS REMPLACER.
 *
 * `rename` ne convient pas : sous POSIX il écrase silencieusement une destination
 * existante. Une archive écrasée est une histoire réécrite, et A-P1-F01-archive dit
 * exactement cela — une archive contradictoire se refuse, elle ne se remplace pas.
 *
 * Le chemin canonique est le LIEN du manifeste terminal lui-même, puis son unlink :
 * pas de fichier temporaire, pas de second contenu qui pourrait diverger. `link`
 * échoue si la destination existe, et rend visible un fichier déjà complet — le
 * perdant ne lit jamais un JSON tronqué.
 *
 * Le repli sert les systèmes de fichiers sans lien physique : création exclusive par
 * `wx`, puis RELECTURE. Une copie partielle ne s'efface pas — elle devient un obstacle
 * durable à réconcilier, parce qu'effacer une destination qu'on ne sait pas décrire
 * serait choisir à la place de l'opérateur.
 */
function publierSansRemplacer(
  source: string,
  destination: string,
  contenu: string,
): Publication {
  const confronter = (): Publication => {
    if (readFileSync(destination, "utf-8") === contenu) return "identique";
    throw new RecoveryError(
      `archive contradictoire : ${destination} existe déjà avec un contenu différent. ` +
        `Une archive n'est jamais remplacée — réconcilier avant de reprendre.`,
    );
  };

  if (readFileSync(source, "utf-8") !== contenu) {
    throw new RecoveryError(`source de publication incohérente : ${source}`);
  }

  try {
    linkSync(source, destination);
    return "publiee";
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "EEXIST") return confronter();
    if (code !== "EPERM" && code !== "ENOSYS" && code !== "EXDEV" && code !== "EOPNOTSUPP") {
      throw err;
    }
  }

  try {
    writeFileSync(destination, contenu, { encoding: "utf-8", flag: "wx" });
  } catch (err) {
    if ((err as { code?: string })?.code === "EEXIST") return confronter();
    throw err;
  }
  if (readFileSync(destination, "utf-8") !== contenu) {
    throw new RecoveryError(`archive non vérifiée après copie exclusive : ${destination}`);
  }
  return "publiee";
}

/**
 * Force un chemin sur le disque — fichier ou répertoire.
 *
 * Une écriture rendue par le noyau n'est pas une écriture durable. Sans `fsync`, une
 * coupure d'alimentation peut laisser l'archive visible et son contenu absent, ou
 * l'`unlink` propagé sans le lien qui le précède : l'ordre observé par un lecteur après
 * redémarrage n'est plus celui que le code a écrit. C0 impose donc la séquence, et le
 * répertoire se synchronise lui aussi — c'est lui qui porte les entrées de nom.
 */
function synchroniserChemin(path: string): void {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * Publie durablement le manifeste terminal, et libère `active-run.json`.
 *
 * Chemin UNIQUE : la succession et le verbe opérateur passent tous deux par ici, sans
 * quoi deux séquences de durabilité divergeraient au premier correctif appliqué à une
 * seule d'entre elles.
 *
 * L'ordre est celui de C0, et il n'est pas décoratif :
 *
 *   fsync source · fsync N · link ou wx · fsync destination · fsync N · unlink · fsync N
 *
 * Aucune tolérance à la disparition de la source. L'ancien `ENOENT → false` venait de
 * l'arbitrage par `rename`, où le perdant trouvait légitimement un dépôt sans manifeste.
 * Sous N → R, après une relecture stable, une source disparue est un état que personne ne
 * sait reconstruire : elle refuse (T2). La confondre avec une transition correctement
 * achevée ferait naître un successeur sur une histoire jamais publiée.
 */
function archiveFinished(dir: string, finished: RunManifest): void {
  const source = manifestPath(dir);
  const destination = archivePath(dir, finished.runId);

  let contenu: string;
  try {
    contenu = readFileSync(source, "utf-8");
  } catch (err) {
    throw new RecoveryError(
      `archivage de ${finished.runId} : manifeste terminal impossible à relire : ${messageOf(err)}`,
    );
  }

  synchroniserChemin(source);
  synchroniserChemin(dir);

  publierSansRemplacer(source, destination, contenu);

  // Nécessaire aussi pour le repli O_EXCL, dont la destination est un autre inode.
  synchroniserChemin(destination);
  synchroniserChemin(dir);

  unlinkSync(source);
  synchroniserChemin(dir);
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

/**
 * La racine du dépôt d'un espace de runs.
 *
 * L'espace de runs est `<racine>/.pi-subagent-runs` ; tout autre dossier n'a pas de racine
 * connue, et une fin `completed` n'y est pas jugeable — la politique observe le dépôt.
 */
function racineDesRuns(dir: string, quoi: string): string {
  const absolu = resolve(dir);
  if (basename(absolu) !== RUNS_DIR) {
    throw new RecoveryError(
      `${quoi} : ${dir} n'est pas un espace de runs (${RUNS_DIR}) ; la racine du dépôt ` +
        `n'est pas connue. Ce refus ne modifie rien.`,
    );
  }
  return dirname(absolu);
}

/** Ce qu'un verbe opérateur apporte pour terminer un run. */
export interface FinDemandee {
  /** Une identité ou une provenance locale de commande, à défaut le littéral "operator". */
  by: string;
  outcome: "completed" | "abandoned";
  /** Obligatoire pour `abandoned`, qui ne s'accorde pas sans raison. */
  reason?: string;
  /** Horodatage imposé — pour rejouer une reprise à l'identique. Sinon, maintenant. */
  at?: string;
}

/**
 * LA primitive de transition terminale. Il n'y en a pas d'autre.
 *
 * Quatre temps, dans cet ordre et sans entrelacement possible :
 *
 *   validation              tout est prouvé avant la première écriture ; une première
 *                           fin `completed` passe les sept contrôles de run-end.ts
 *   manifeste terminal      écrit durablement dans active-run.json, `ledgers` et
 *                           `continuation_block` préservés
 *   publication exclusive   l'archive est posée sans jamais remplacer
 *   unlink                  `active-run.json` est libéré, et le successeur devient possible
 *
 * L'ORDRE DES EXCLUSIONS N'EST PAS INDICATIF. `withSpaceGuard` d'abord, `withRunGuard`
 * ensuite : une succession met en jeu DEUX runs, celui qui finit et celui qui naît, et un
 * verrou nommé par l'un d'eux ne les exclut pas l'un de l'autre. C'est C1.2 — N englobe R,
 * jamais l'inverse — imposé ici, là où il se joue, et éprouvé par `A-P1-F01-concurrence`.
 *
 * Un refus ne modifie RIEN : ni manifeste, ni archive, ni `active-run.json`, ni séquence.
 * C'est pour cela que la validation est entière avant le premier octet écrit.
 *
 * Sur un run DÉJÀ terminal, la primitive ne termine pas une seconde fois : elle REPREND
 * la transition interrompue, sans réécrire la fin déjà posée. Voir la section Reprise.
 */
export function terminerRun(
  dir: string,
  runId: string,
  fin: FinDemandee,
): RunManifest {
  const quoi = `terminer ${runId} en ${fin.outcome}`;
  return withSpaceGuard(dir, () =>
    withRunGuard(dir, runId, () => {
      /*
       * ---- 1. VALIDATION STRUCTURELLE, sous les deux exclusions ----
       *
       * Identité du run, absence de propriétaire, version, raison et
       * `continuation_block` sont contrôlés avant toute écriture. Les préconditions
       * MÉTIER de `completed` (1 bis) le sont dans cette même section critique N → R et
       * avant `writeManifest` — jamais avant l'acquisition, jamais dans un préfiltre du
       * dispatcher. La reprise d'une fin déjà durable ne les recalcule pas.
       */
      const courant = readManifest(dir);
      if (!courant || courant.runId !== runId) {
        throw new RecoveryError(
          `${quoi} : run courant différent ou absent (${courant?.runId ?? "aucun"})`,
        );
      }

      /*
       * Aucun bail n'est exigé, et c'est le contraire d'un relâchement.
       *
       * C1.8 termine un run dont plus personne n'est propriétaire : exiger un bail
       * vivant rendrait la fin impossible dans le seul cas où elle est nécessaire.
       * Ce qui est exigé, c'est l'ABSENCE PROUVÉE de propriétaire — et l'absence se
       * prouve par une observation, pas par le fait de n'avoir rien vu.
       *
       * ENOENT prouve l'absence. Un propriétaire présent refuse les deux issues. Toute
       * autre erreur d'observation refuse aussi (T2) : un `statSync` qui échoue pour
       * EACCES n'a rien constaté, et traiter ce silence comme une absence terminerait
       * le run d'autrui.
       */
      try {
        statSync(ownerPath(dir, runId));
        throw new RecoveryError(
          `${quoi} : un propriétaire est encore inscrit (${ownerPath(dir, runId)}). ` +
            `Une fin ne se pose pas sur un run possédé. Ce refus ne modifie rien.`,
        );
      } catch (err) {
        if (err instanceof RecoveryError) throw err;
        const code = (err as { code?: string })?.code;
        if (code !== "ENOENT") {
          throw new RecoveryError(
            `${quoi} : la propriété de ${runId} n'a pas pu être observée ` +
              `(${code ?? "erreur inconnue"}). Ne rien avoir vu n'est pas avoir vu ` +
              `qu'il n'y a rien. Ce refus ne modifie rien.`,
          );
        }
      }

      /*
       * La raison d'abandon est exigée AVANT la branche de reprise, et pas après.
       *
       * Placée après, elle laissait aboutir une reprise `abandoned` sans raison : la
       * branche terminale rendait avant de l'atteindre. Un abandon ne s'accorde jamais
       * sans raison opérateur — ni à la première demande, ni à la reprise. Que la raison
       * conservée soit celle d'origine ne dispense pas d'en fournir une : c'est la
       * demande qui doit être motivée, pas seulement l'archive.
       */
      if (fin.outcome === "abandoned" && !fin.reason?.trim()) {
        throw new RecoveryError(`${quoi} : un abandon ne s'accorde pas sans raison opérateur`);
      }

      /*
       * ---- REPRISE d'une transition interrompue ----
       *
       * L'étape 3 a rendu le manifeste terminal DURABLE avant l'archive : une coupure
       * dans la fenêtre terminal → link → unlink laisse donc un terminal publiable, et
       * c'est exactement l'état que C1.9 demande de reprendre.
       *
       * Reprendre, ce n'est pas terminer une seconde fois. La fin déjà posée n'est pas
       * réécrite : son `at`, son `by` et sa raison sont ceux de la décision d'origine, et
       * les remplacer par l'instant de la reprise effacerait qui a décidé et quand. Seule
       * la fenêtre se referme — publication si elle manque, unlink ensuite.
       *
       * L'idempotence tombe d'elle-même : une archive identique se reconnaît comme déjà
       * publiée, et la reprise conclut sans rien réécrire. Une archive contradictoire
       * refuse, comme partout ailleurs.
       */
      if (courant.status === "completed" || courant.status === "abandoned") {
        const posee = courant.ended;
        /*
         * Inatteignable à l'exécution depuis l'étape 4 : `readManifest` refuse déjà un v2
         * terminal sans fin. C'est le type qui exige ce rétrécissement, et le refus vaut
         * mieux qu'un `!` — le jour où le lecteur changerait, il échouerait fermé.
         * Aucune preuve ne l'atteint, et c'est pour cette raison-là, pas par omission.
         */
        if (!posee) {
          throw new RecoveryError(
            `${quoi} : le run est ${courant.status} sans porter sa fin — état que personne ` +
              `ne sait reconstruire. Ce refus ne modifie rien.`,
          );
        }
        if (posee.outcome !== fin.outcome) {
          throw new RecoveryError(
            `${quoi} : le run porte déjà une fin ${posee.outcome}, posée le ${posee.at} ` +
              `par ${posee.by}. Une reprise conclut la transition commencée, elle n'en ` +
              `change pas l'issue. Ce refus ne modifie rien.`,
          );
        }
        archiveFinished(dir, courant);
        return courant;
      }
      /*
       * Un manifeste v1 ne peut pas être terminé dans ce lot, et pas seulement pour
       * `completed`. Poser `ended` sur un v1 serait une conversion implicite v1 → v2,
       * que le § 1 interdit ; la terminalisation d'un ancien v1 sera spécifiée à part.
       * Les deux refus sont distincts parce que leurs raisons le sont.
       */
      if (courant.version === 1) {
        throw new RecoveryError(
          fin.outcome === "completed"
            ? `${quoi} : un manifeste de version 1 ne porte pas de quoi prouver les ` +
              `préconditions d'une fin explicite`
            : `${quoi} : poser une fin sur un manifeste de version 1 serait une conversion ` +
              `implicite vers la version 2, qu'aucune migration n'autorise dans ce lot`,
        );
      }
      /*
       * C6.6 : un contournement constaté de la garde d'écriture inline interdit de
       * DÉCLARER le run abouti. L'abandon reste ouvert — c'est précisément la sortie
       * qu'un run bloqué doit garder. Le champ est seulement lu, et préservé tel quel.
       */
      if (fin.outcome === "completed" && courant.continuation_block) {
        throw new RecoveryError(
          `${quoi} : ${courant.continuation_block.code} posé le ` +
            `${courant.continuation_block.at} — un run dont la garde d'écriture a été ` +
            `contournée ne peut pas être déclaré abouti. L'abandon motivé reste ouvert. ` +
            `Ce refus ne modifie rien.`,
        );
      }

      /*
       * ---- 1 bis. la politique de `completed` ----
       *
       * Les sept contrôles de run-end.ts, relus ici, sous N → R et avant toute écriture.
       * La politique vit dans la primitive : aucun appelant ne fournit ni ne remplace de
       * vérificateur. Un refus lève avant `writeManifest` et ne modifie donc rien. La
       * reprise d'une fin déjà durable a rendu plus haut et ne passe pas ici.
       */
      if (fin.outcome === "completed") {
        verifierCompleted({ root: racineDesRuns(dir, quoi), dir, manifest: courant });
      }

      // ---- 2. active-run.json devient DURABLEMENT terminal ----
      /*
       * Écrit sur le disque avant l'archive, et non gardé en mémoire : c'est ce qui
       * fait exister la fenêtre canonique terminal → link → unlink. Une interruption
       * après ce point laisse un terminal publiable, que la reprise sait finir. Sans
       * cette durabilité, la même interruption laisserait un run actif sans trace de
       * la décision prise.
       */
      const ended: RunEnd = {
        at: fin.at ?? new Date().toISOString(),
        by: fin.by,
        outcome: fin.outcome,
        ...(fin.outcome === "abandoned" ? { reason: fin.reason?.trim() } : {}),
      };
      const terminal: RunManifest = { ...courant, status: fin.outcome, ended };
      assertVersionedFields(terminal, `${quoi} : manifeste terminal`);
      writeManifest(dir, terminal);

      // ---- 3 et 4. publication durable et libération, par le chemin UNIQUE ----
      archiveFinished(dir, terminal);

      return terminal;
    }),
  );
}

/**
 * Le setter général des statuts NON TERMINAUX.
 *
 * C1.8 : la fin d'un run est posée par un verbe opérateur, et par lui seul. Tant que ce
 * setter acceptait `completed` et `abandoned`, il existait DEUX chemins de terminaison —
 * celui-ci écrivant un statut terminal sous le seul verrou du run, sans exclusion de N,
 * sans précondition, sans `ended`, sans archive et sans libérer `active-run.json`.
 *
 * La garde est de RUNTIME, et le paramètre reste `RunStatus`. Rétrécir le type à
 * `Exclude<RunStatus, "completed" | "abandoned">` rendrait
 * `C1.8-setStatus-terminal-interdit` incompilable : elle appelle ce setter avec
 * `completed`, c'est son objet. Une garde qu'aucune preuve ne peut atteindre est une
 * garde décorative.
 */
export function setStatus(dir: string, status: RunStatus, lease: Lease): RunManifest {
  if (status === "completed" || status === "abandoned") {
    throw new RecoveryError(
      `changer le statut du run : « ${status} » ne s'obtient pas par le setter général. ` +
        `La fin d'un run passe par le verbe opérateur, qui prend l'exclusion de l'espace, ` +
        `contrôle ses préconditions, pose sa fin, publie l'archive et libère le manifeste ` +
        `actif (C1.8). Ce refus ne modifie rien.`,
    );
  }
  return withRunGuard(dir, lease.runId, () => {
    const next: RunManifest = { ...mutable(dir, lease, "changer le statut du run"), status };
    writeManifest(dir, next);
    return next;
  });
}

/**
 * Pose le blocage durable de continuation (C6.6) : `{ at, code: RUN_CONTINUATION_BLOCKED }`.
 *
 * Écrit une fois, jamais remplacé : un blocage déjà posé est rendu tel quel, son `at`
 * compris. Il ne touche pas `status` — un run bloqué reste actif, et seule la fin
 * `completed` le refuse (`terminerRun`). Un manifeste v1 ne porte aucun champ v2 (C4.7),
 * et un manifeste terminal n'accepte plus aucune mutation (C4.6) : les deux refusent.
 */
export function poserBlocageContinuation(dir: string, at: string, lease: Lease): RunManifest {
  return withRunGuard(dir, lease.runId, () => {
    const courant = mutable(dir, lease, "poser le blocage de continuation");
    if (courant.continuation_block) return courant;
    if (courant.version !== 2) {
      throw new RecoveryError(
        `poser le blocage de continuation : un manifeste v${String(courant.version)} ne porte pas continuation_block`,
      );
    }
    if (courant.status === "completed" || courant.status === "abandoned") {
      throw new RecoveryError(`poser le blocage de continuation : ${courant.runId} est terminal (${courant.status})`);
    }
    const next: RunManifest = { ...courant, continuation_block: { at, code: RUN_CONTINUATION_BLOCKED } };
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
  /** Le fichier a-t-il été observé ? Même snapshot que le contenu (C4.9). */
  present: boolean;
}

/** Lecture libre, comme pour les lanes : observer n'exige pas la propriété. */
export function readIntegrationEvents(dir: string, runId: string): IntegrationLedgerRead {
  const path = integrationLedgerPath(dir, runId);
  const contenu = lireSiPresent(path);
  if (contenu === null) {
    return { events: [], malformed: 0, malformedLines: [], version: INTEGRATION_LEDGER_VERSION, present: false };
  }
  const events: IntegrationEvent[] = [];
  let version: number | undefined;
  const malformedLines: number[] = [];
  let malformed = 0;
  let numero = 0;
  for (const ligne of contenu.split("\n")) {
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
  return { events, malformed, malformedLines, version, present: true };
}

/**
 * Le contenu d'un registre, ou `null` si le fichier n'existe pas.
 *
 * Une seule observation : lire, et conclure à l'absence seulement sur ENOENT. Un
 * `existsSync` suivi d'une lecture regarderait deux fois, à deux instants. Toute autre
 * erreur remonte : ne pas avoir pu lire n'est pas avoir vu qu'il n'y avait rien (C4.9).
 */
function lireSiPresent(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
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
 *
 * Et gardé par C4, comme le registre des lanes (PLAN-CORRECTIF-PRE-PILOTE-C4 § 6, C4.1, C4.2,
 * C4.5, C4.9). La décision se prend ici, sur un seul passage : registre des lanes, registre des
 * intégrations, témoins, puis `laneState` et `integrationLedgerState` sur ce même état des lanes.
 * Seuls KNOWN et EMPTY s'écrivent ; LOST, UNKNOWN (lanes inexploitables comprises),
 * MIGRATION_REQUIRED et RUN_WITHOUT_WITNESS refusent avant tout octet. Le fichier absent n'est
 * plus « à créer » d'office : sous un témoin, il est perdu, et le recréer effacerait l'histoire
 * que le témoin atteste. Les appelants — `noteAttempt`, le binaire — héritent du refus.
 */
export function appendIntegrationEvent(
  dir: string,
  event: IntegrationEvent,
  lease: Lease,
): void {
  withRunGuard(dir, lease.runId, () => {
    assertOwner(dir, lease, `enregistrer ${event.event} sur ${event.id}`);
    const path = integrationLedgerPath(dir, lease.runId);
    const lanes = readLaneEvents(dir, lease.runId);
    const integrations = readIntegrationEvents(dir, lease.runId);
    const temoins = readWitnesses(dir, lease.runId);
    const etatLanes = laneState(temoins, { ...lanes, version: lanes.version }, lease.runId);
    const etat = integrationLedgerState(temoins, integrations, etatLanes);
    if (etat !== "KNOWN" && etat !== "EMPTY") {
      // La décision est prise sur `etat` ; le diagnostic dit seulement pourquoi, au plus précis.
      const faits = integrations.present && integrations.malformedLines.length > 0
        ? `illisible ligne(s) ${integrations.malformedLines.join(", ")}`
        : integrations.present && integrations.version !== INTEGRATION_LEDGER_VERSION
          ? `${integrations.version === undefined ? "sans version" : `version ${integrations.version}`} : ` +
            "migration requise avant toute écriture"
          : ledgerFacts(temoins, integrations, "integrations", INTEGRATION_LEDGER_VERSION);
      throw new RecoveryError(
        `registre des intégrations ${lease.runId} ${etat} (lanes ${etatLanes}) : ${faits} ; aucun ` +
          `${event.event}, rien n'est écrit`,
      );
    }
    if (etat === "EMPTY") {
      creerRegistreIntegrations(dir, lease, path);
    } else if (temoins?.manifestVersion === 2 && temoins.ledgers.integrations === undefined) {
      synchroniserChemin(path);
      synchroniserChemin(dir);
      publierTemoinIntegrations(dir, lease);
    }
    appendFileSync(path, `${JSON.stringify(event)}\n`);
  });
}

/**
 * Crée le registre des intégrations d'un run, sous EMPTY seulement, puis publie son témoin.
 *
 * L'ordre de C4.1, le même que pour les lanes (`creerRegistreV2`) : création exclusive — un
 * fichier apparu depuis la décision fait échouer, il n'est pas écrasé —, en-tête seul, `fsync`
 * du fichier, puis du répertoire, et seulement ensuite `ledgers.integrations = 1`. Un crash entre
 * les deux laisse un en-tête durable sans témoin, que C4.9 lit KNOWN (ligne 6) et que l'ajout
 * suivant reprend ; l'ordre inverse laisserait un témoin sans registre, lu LOST.
 */
function creerRegistreIntegrations(dir: string, lease: Lease, path: string): void {
  const manifeste = mutable(dir, lease, "créer le registre des intégrations");
  if (manifeste.version !== 2) {
    throw new RecoveryError(
      `registre des intégrations ${lease.runId} : un manifeste v${String(manifeste.version)} ne peut ` +
        "attester aucun registre, aucun n'est créé",
    );
  }
  const fd = openSync(path, "wx");
  try {
    writeFileSync(fd, `${JSON.stringify({ integration_ledger: INTEGRATION_LEDGER_VERSION })}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  synchroniserChemin(dir);
  publierTemoinIntegrations(dir, lease);
}

/**
 * Publie `ledgers.integrations = 1` sur un manifeste v2 qui ne le porte pas encore.
 *
 * Appelé après un en-tête durable : à la création, ou pour reprendre la fenêtre de crash de C4.1
 * (registre KNOWN, témoin absent). Rien n'est réécrit dans le registre. Un témoin déjà présent et
 * différent n'est jamais corrigé : l'état est alors UNKNOWN, et la décision en amont a refusé.
 */
function publierTemoinIntegrations(dir: string, lease: Lease): void {
  const manifeste = mutable(dir, lease, "publier le témoin du registre des intégrations");
  const temoins = manifeste.ledgers ?? {};
  if (temoins.integrations === INTEGRATION_LEDGER_VERSION) return;
  if (temoins.integrations !== undefined) {
    throw new RecoveryError(
      `registre des intégrations ${lease.runId} : le manifeste atteste déjà integrations: ` +
        `${String(temoins.integrations)}, rien n'est corrigé`,
    );
  }
  writeManifest(dir, { ...manifeste, ledgers: { ...temoins, integrations: INTEGRATION_LEDGER_VERSION } });
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

/**
 * La version du registre des lanes que C0 § F décrit : `{"ledger":2}`.
 *
 * ÉCRITE depuis le LOT 3, avec les identités g1 (C4.9) : un run neuf crée son registre
 * en v2, et un registre v1 existant n'est jamais réécrit ni migré vers elle.
 */
export const LANE_LEDGER_V2 = 2;

/**
 * Ce qu'un appelant demande d'enregistrer. L'enveloppe n'en fait pas partie.
 *
 * `event_seq`, `lane` d'un événement de vie et `generation` d'un abandon se DÉDUISENT
 * du registre relu sous la garde du run, pas de ce que l'appelant croit savoir : une
 * séquence ou une lane fournie de l'extérieur serait une seconde vérité, et deux
 * écrivains qui la calculeraient chacun de leur côté produiraient deux fois la même.
 *
 * Seule l'ouverture nomme sa lane et sa génération : c'est l'allocation qui les décide,
 * et l'écrivain vérifie seulement qu'elles se tiennent.
 */
export type LaneWrite =
  | { event: "OPENED"; work_unit: string; at: string; base: string; lane?: string; generation?: number }
  /*
   * Deux formes, que `status` départage. Sans `status` : la forme historique de C0 v1.8,
   * écrite par les trois appelants historiques jusqu'à la bascule du LOT 9 (PLAN-LOT9
   * E-L9-3). Avec `status` : l'INTEGRATED final de C0 § F, qui ne s'écrit que par
   * `appendIntegratedEvent` — `lane` y est un contrôle, comme pour FROZEN.
   */
  | {
      event: "INTEGRATED";
      work_unit: string;
      at: string;
      integration_commit?: string;
      lane?: string;
      status?: IntegrationStatus;
    }
  | MergedWrite
  | { event: "ABANDONED"; work_unit: string; at: string; reason?: string; by?: string }
  /*
   * La revue d'une lane (C2.2, § F). `lane` n'est pas une seconde vérité : c'est un
   * CONTRÔLE, comme pour l'ouverture — l'écrivain refuse si le registre relu sous R ne
   * désigne pas cette lane comme la lane courante de l'unité, et il refuse une chaîne
   * que `from_tree` romprait. Le reste du payload est ce que le runtime a observé.
   */
  | {
      event: "REVIEWED";
      /*
       * Jamais fournie : la séquence se déduit du registre relu sous R. Un événement v2
       * complet, enveloppe comprise, n'est donc pas une demande d'écriture — et la borne de
       * type de `tests/run-manifest.test.ts` (`ecrivainRefuseUnReviewedEnveloppe`) continue de le refuser.
       */
      event_seq?: never;
      work_unit: string;
      at: string;
      lane: string;
      from_tree: string;
      tree: string;
      verdict: string;
      reviewer: { delegation_seq: number; agent: string; role: string };
      proof: { mode: ProofMode; paths?: string[] };
    }
  /*
   * Une violation historique observée (C3.1, § F). Même discipline que REVIEWED : la lane
   * est un contrôle, l'enveloppe se déduit sous R, et l'écriture passe par
   * `appendViolationEvent`, qui garde le verrou R si elle échoue (PLAN-LOT6 Q7).
   */
  | {
      event: "VIOLATION";
      event_seq?: never;
      work_unit: string;
      at: string;
      lane: string;
      kind: ViolationKind;
      paths: string[];
      source: { delegation_seq: number; agent: string };
      observed_tree: string;
    }
  | RiskWrite
  | FrozenWrite;

/**
 * Le gel durable d'une lane (C2.4, § F, PLAN-LOT8 Q5).
 *
 * Même discipline que REVIEWED : la lane est un contrôle, l'enveloppe se déduit sous R. Les
 * faits git — le commit existe, ses vrais parent et tree — sont établis par le runtime avant
 * l'appel ; l'écrivain vérifie sous R ce que le registre sait : la dernière approbation, son
 * tree, la base ouverte, et qu'aucun gel vivant ne précède celui-ci.
 */
export type FrozenWrite = {
  event: "FROZEN";
  event_seq?: never;
  work_unit: string;
  at: string;
  lane: string;
  commit: string;
  parent: string;
  tree: string;
  reviewed_event_seq: number;
};

/**
 * La lane mergée (C0 § F, PLAN-LOT9 L9-Q3) : le commit d'intégration réellement présent dans
 * la racine, et le gel qu'il consomme.
 *
 * Même discipline que FROZEN : la lane est un contrôle, l'enveloppe se déduit sous R. Le fait
 * git — ce commit est bien l'intégration de ce gel — est établi par le runtime avant l'appel ;
 * l'écrivain vérifie sous R ce que les registres savent : le gel désigné est le gel vivant de
 * la lane, aucune tentative ne l'a rendu `returned-to-lane`, et rien ne l'a déjà consommé.
 */
export type MergedWrite = {
  event: "MERGED";
  event_seq?: never;
  work_unit: string;
  at: string;
  lane: string;
  integration_commit: string;
  frozen_event_seq: number;
};

/**
 * Une transition de risque (C3.4, § F). Même discipline que REVIEWED et VIOLATION : la lane
 * est un contrôle — la lane courante de l'unité, jamais abandonnée —, l'enveloppe se déduit
 * sous R, et la transition se juge contre la projection autoritaire relue sous R
 * (PLAN-LOT7 Q4). La clé est `(R, work_unit, id)` ; la lane n'en fait pas partie.
 *
 * `by` ou `to`, exactement un : `opened` et `resolved` disent qui agit, `routed` à qui c'est
 * confié. Leur valeur est une provenance opaque (PLAN-LOT7 Q3) : aucune décision ne la lit.
 */
export type RiskWrite = {
  event: "RISK";
  event_seq?: never;
  work_unit: string;
  at: string;
  lane: string;
  id: string;
  transition: RiskTransition;
  by?: string;
  to?: string;
};

/**
 * Une ouverture refusée dans un run legacy (PLAN-LOT3 § 1, lecture (b)).
 *
 * Un registre v1 reste lisible, clôturable et continuable pour ses lanes déjà ouvertes ;
 * aucune nouvelle lane n'y naît, parce qu'elle y naîtrait sous une grammaire que C0 ne
 * crée plus. Levée AVANT toute écriture : rien n'est ajouté au fichier.
 */
export class LegacyLaneLedgerError extends RecoveryError {}

/**
 * La lane d'une unité dans un registre v2 : celle de sa DERNIÈRE ouverture, et sa génération.
 *
 * C'est la lane dont un `INTEGRATED` ou un `ABANDONED` écrit ensuite relève — y compris
 * l'abandon d'une lane que le registre dit intégrée sans que git le confirme. Rien ici ne
 * lit un worktree ni une branche : le registre dit quelle lane est celle de l'unité.
 */
export function lastLaneOfUnit(
  events: readonly LaneEvent[],
  workUnit: string,
): { lane: string; generation: number } | undefined {
  let derniere: { lane: string; generation: number } | undefined;
  for (const e of events) {
    if (e.work_unit === workUnit && e.event === "OPENED" && "lane" in e) {
      derniere = { lane: e.lane, generation: e.generation };
    }
  }
  return derniere;
}

/**
 * Crée le registre v2 d'un run neuf, puis publie son témoin.
 *
 * L'ordre de C4.1 : l'en-tête d'abord, rendu durable — fichier puis répertoire — et
 * seulement ensuite le témoin `ledgers.lanes = 2`. Un crash entre les deux laisse un
 * registre sans témoin, que C4.9 (ligne 5) lit KNOWN ; l'ordre inverse laisserait un
 * témoin sans registre, lu LOST, donc un run fermé sur un fichier qui n'a jamais existé.
 *
 * Réservé à un manifeste v2 : un manifeste v1 ne peut porter aucun témoin (C4.7), et y
 * créer un registre v2 fabriquerait la ligne 15 de C4.9.
 */
function creerRegistreV2(dir: string, lease: Lease, path: string): void {
  const manifeste = mutable(dir, lease, "créer le registre des lanes");
  if (manifeste.version !== 2) {
    throw new RecoveryError(
      `registre ${lease.runId} : un manifeste v${String(manifeste.version)} ne peut attester ` +
        "aucun registre, aucun n'est créé",
    );
  }
  const fd = openSync(path, "wx");
  try {
    writeFileSync(fd, `${JSON.stringify({ ledger: LANE_LEDGER_V2 })}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  synchroniserChemin(dir);
  const temoins = manifeste.ledgers ?? {};
  if (temoins.lanes === LANE_LEDGER_V2) return;
  if (temoins.lanes !== undefined) {
    throw new RecoveryError(
      `registre ${lease.runId} : le manifeste atteste déjà lanes: ${String(temoins.lanes)}`,
    );
  }
  writeManifest(dir, { ...manifeste, ledgers: { ...temoins, lanes: LANE_LEDGER_V2 } });
}

/**
 * L'événement v2 complet, enveloppe déduite du registre relu.
 *
 * Chaque refus précède l'écriture. Ce que C0 exige d'un événement v2 et que l'appelant ne
 * peut pas fournir — une lane pour une unité qui n'en a pas d'ouverte, un commit
 * d'intégration absent — ne se complète pas : il se refuse.
 */
function evenementV2(
  lu: LedgerRead,
  event: LaneWrite,
  runId: string,
  integrations?: readonly IntegrationEvent[],
): Record<string, unknown> {
  const seq = lu.events.reduce((m, e) => ("event_seq" in e ? Math.max(m, e.event_seq) : m), 0) + 1;
  const quoi = `${event.event} sur ${event.work_unit}`;
  if (event.event === "OPENED") {
    const { lane, generation } = event;
    if (lane === undefined || generation === undefined || !Number.isSafeInteger(generation) || generation < 1) {
      throw new RecoveryError(`${quoi} : une ouverture v2 porte sa lane et sa génération`);
    }
    /*
     * La grammaire de C0 § F, redite ici et non importée : c'est un CONTRÔLE de ce que
     * l'allocation a produit, le même que celui du lecteur (`laneLedgerIncoherences`). Le
     * lui emprunter à `lane-context.ts` ferait entrer ce module et ses dépendances dans le
     * programme de `bin/subagent-recover`, qui n'en a pas besoin.
     */
    if (lane !== `${runId}-${event.work_unit}-g${generation}`) {
      throw new RecoveryError(`${quoi} : ${lane} n'est pas la lane de g${generation}`);
    }
    if (lu.events.some((e) => e.event === "OPENED" && "lane" in e && e.lane === lane)) {
      throw new RecoveryError(`${quoi} : ${lane} a déjà été ouverte, aucune génération n'est réutilisée`);
    }
    return { event_seq: seq, work_unit: event.work_unit, lane, at: event.at, event: "OPENED", base: event.base, generation };
  }
  const ouverte = lastLaneOfUnit(lu.events, event.work_unit);
  if (!ouverte) {
    throw new RecoveryError(`${quoi} : le registre n'a jamais ouvert de lane pour ${event.work_unit}`);
  }
  const enveloppe = { event_seq: seq, work_unit: event.work_unit, lane: ouverte.lane, at: event.at };
  if (event.event === "VIOLATION") {
    if (event.lane !== ouverte.lane) {
      throw new RecoveryError(`${quoi} : ${event.lane} n'est pas la lane courante ${ouverte.lane}`);
    }
    if (lu.events.some((e) => e.event === "ABANDONED" && "lane" in e && e.lane === ouverte.lane)) {
      throw new RecoveryError(`${quoi} : ${ouverte.lane} est abandonnée, aucune violation ne s'y enregistre`);
    }
    const doc = {
      ...enveloppe,
      event: "VIOLATION",
      kind: event.kind,
      paths: [...event.paths],
      source: { delegation_seq: event.source.delegation_seq, agent: event.source.agent },
      observed_tree: event.observed_tree,
    };
    if (parseLaneEventV2(doc) === null) throw new RecoveryError(`${quoi} : forme refusée par § F`);
    return doc;
  }
  if (event.event === "RISK") {
    if (event.lane !== ouverte.lane) {
      throw new RecoveryError(`${quoi} : ${event.lane} n'est pas la lane courante ${ouverte.lane}`);
    }
    if (lu.events.some((e) => e.event === "ABANDONED" && "lane" in e && e.lane === ouverte.lane)) {
      throw new RecoveryError(`${quoi} : ${ouverte.lane} est abandonnée, aucun risque ne s'y enregistre`);
    }
    // La machine de C0 § F, sur la projection du LOT 2 : `opened` naît une fois, `routed` et
    // `resolved` n'agissent que sur un risque ouvert, et un risque fermé ne se rouvre pas.
    const fait = projectRisks(lu.events, runId).get(riskKey(runId, event.work_unit, event.id));
    if (event.transition === "opened" && fait !== undefined) {
      throw new RecoveryError(`${quoi} : le risque ${event.id} existe déjà pour ${event.work_unit}`);
    }
    if (event.transition !== "opened" && (fait === undefined || !fait.open)) {
      throw new RecoveryError(
        `${quoi} : ${event.transition} sur le risque ${event.id} de ${event.work_unit}, ` +
          `${fait === undefined ? "absent" : "déjà fermé"}`,
      );
    }
    const doc = {
      ...enveloppe,
      event: "RISK",
      id: event.id,
      transition: event.transition,
      ...(event.by !== undefined ? { by: event.by } : {}),
      ...(event.to !== undefined ? { to: event.to } : {}),
    };
    if (parseLaneEventV2(doc) === null) throw new RecoveryError(`${quoi} : forme refusée par § F`);
    return doc;
  }
  if (event.event === "REVIEWED") {
    if (event.lane !== ouverte.lane) {
      throw new RecoveryError(`${quoi} : ${event.lane} n'est pas la lane courante ${ouverte.lane}`);
    }
    if (lu.events.some((e) => e.event === "ABANDONED" && "lane" in e && e.lane === ouverte.lane)) {
      throw new RecoveryError(`${quoi} : ${ouverte.lane} est abandonnée, aucune revue ne s'y enregistre`);
    }
    // La chaîne `from_tree → tree` (§ F) : une revue part de là où la précédente s'est
    // arrêtée. La première part de la base, que seul git connaît : l'appelant la fournit
    // et la porte la revérifie avant de fonder une décision.
    let precedent: string | undefined;
    for (const e of lu.events) if (e.event === "REVIEWED" && e.lane === ouverte.lane) precedent = e.tree;
    if (precedent !== undefined && precedent !== event.from_tree) {
      throw new RecoveryError(`${quoi} : from_tree ${event.from_tree} romprait la chaîne après tree ${precedent}`);
    }
    const proof = event.proof.paths === undefined
      ? { mode: event.proof.mode }
      : { mode: event.proof.mode, paths: [...event.proof.paths] };
    const doc = {
      ...enveloppe,
      event: "REVIEWED",
      from_tree: event.from_tree,
      tree: event.tree,
      verdict: event.verdict,
      reviewer: {
        delegation_seq: event.reviewer.delegation_seq,
        agent: event.reviewer.agent,
        role: event.reviewer.role,
      },
      proof,
    };
    // La forme d'une ligne se juge par le lecteur lui-même : l'écrivain n'écrit rien
    // qu'une relecture compterait abîmée.
    if (parseLaneEventV2(doc) === null) throw new RecoveryError(`${quoi} : forme refusée par § F`);
    return doc;
  }
  if (event.event === "FROZEN") {
    if (event.lane !== ouverte.lane) {
      throw new RecoveryError(`${quoi} : ${event.lane} n'est pas la lane courante ${ouverte.lane}`);
    }
    if (lu.events.some((e) => e.event === "ABANDONED" && "lane" in e && e.lane === ouverte.lane)) {
      throw new RecoveryError(`${quoi} : ${ouverte.lane} est abandonnée, aucun gel ne s'y enregistre`);
    }
    let base: string | undefined;
    let derniere: { event_seq: number; verdict: string; tree: string } | undefined;
    const gels: Array<{ event_seq: number; commit: string; reviewed_event_seq: number }> = [];
    let integree = false;
    let fusionnee = false;
    for (const e of lu.events) {
      if (!("lane" in e) || e.lane !== ouverte.lane) continue;
      if (e.event === "OPENED") base = e.base;
      else if (e.event === "REVIEWED") derniere = { event_seq: e.event_seq, verdict: e.verdict, tree: e.tree };
      else if (e.event === "FROZEN") {
        gels.push({ event_seq: e.event_seq, commit: e.commit, reviewed_event_seq: e.reviewed_event_seq });
      } else if (e.event === "INTEGRATED") integree = true;
      else if (e.event === "MERGED") fusionnee = true;
    }
    // L9-Q3 : un MERGED consomme son gel pour toujours. Après lui, aucun FROZEN de cette lane,
    // quelles que soient les tentatives `returned-to-lane`.
    if (fusionnee) {
      throw new RecoveryError(`${quoi} : ${ouverte.lane} porte un MERGED ; son gel est consommé, aucun nouveau gel`);
    }
    // Le gel se fonde sur la DERNIÈRE revue de la lane, et elle doit approuver : un gel
    // appuyé sur une approbation qu'une revue plus récente a remplacée gèlerait un arbre
    // que plus rien n'autorise.
    if (derniere === undefined || derniere.verdict !== "approved" || derniere.event_seq !== event.reviewed_event_seq) {
      throw new RecoveryError(
        `${quoi} : reviewed_event_seq ${event.reviewed_event_seq} n'est pas la dernière approbation ` +
          `de ${ouverte.lane} (${derniere === undefined ? "aucune revue" : `${derniere.event_seq} ${derniere.verdict}`})`,
      );
    }
    if (event.tree !== derniere.tree) {
      throw new RecoveryError(`${quoi} : tree ${event.tree} n'est pas le tree approuvé ${derniere.tree}`);
    }
    if (base === undefined || event.parent !== base) {
      throw new RecoveryError(`${quoi} : parent ${event.parent} n'est pas la base ouverte ${String(base)}`);
    }
    /*
     * Un seul gel VIVANT par lane (PLAN-LOT8 Q5, adjudication L8-A1).
     *
     * Un gel précédent ne cède la place que s'il a été durablement consommé sans
     * intégration : une tentative de cette unité, dont `p2` est exactement ce gel, close
     * `returned-to-lane` ; aucune tentative encore vivante ni intégrée sur le même `p2` ;
     * aucune intégration de la lane ; et une approbation plus récente que celle qui l'a
     * fondé. La preuve est au registre des intégrations, relu sous le même R.
     */
    const precedent = gels.at(-1);
    if (precedent !== undefined) {
      if (integrations === undefined) {
        throw new RecoveryError(
          `${quoi} : un gel existe déjà pour ${ouverte.lane} (${precedent.commit.slice(0, 12)}) ; ` +
            "sa consommation ne se prouve que par le registre des intégrations",
        );
      }
      if (integree) throw new RecoveryError(`${quoi} : ${ouverte.lane} est déjà intégrée`);
      const tentatives = new Map<string, { p2: string; ferme?: string; remplacee: boolean }>();
      for (const i of integrations) {
        if (i.event === "ATTEMPT_OPENED") {
          if (i.work_unit === event.work_unit) tentatives.set(i.id, { p2: i.p2, remplacee: false });
        } else if (i.event === "CLOSED") {
          const t = tentatives.get(i.id);
          if (t) t.ferme = i.outcome;
        } else if (i.event === "SUPERSEDED") {
          const t = tentatives.get(i.id);
          if (t) t.remplacee = true;
        }
      }
      const surCeGel = [...tentatives.values()].filter((t) => t.p2 === precedent.commit);
      const rendue = surCeGel.some((t) => t.ferme === "returned-to-lane");
      const vivante = surCeGel.some((t) => t.ferme === undefined && !t.remplacee);
      const consommeeParIntegration = surCeGel.some((t) => t.ferme === "integrated");
      if (!rendue || vivante || consommeeParIntegration) {
        throw new RecoveryError(
          `${quoi} : le gel ${precedent.commit.slice(0, 12)} de ${ouverte.lane} est encore vivant ` +
            `(tentative returned-to-lane ${rendue}, tentative vivante ${vivante}, intégrée ` +
            `${consommeeParIntegration}) ; aucun second gel`,
        );
      }
      if (event.reviewed_event_seq <= precedent.reviewed_event_seq) {
        throw new RecoveryError(
          `${quoi} : aucune approbation plus récente que ${precedent.reviewed_event_seq}, qui a fondé ` +
            `le gel ${precedent.commit.slice(0, 12)}`,
        );
      }
      if (gels.some((g) => g.commit === event.commit)) {
        throw new RecoveryError(`${quoi} : le commit ${event.commit.slice(0, 12)} a déjà été gelé ; un gel consommé ne revit pas`);
      }
    }
    const doc = {
      ...enveloppe,
      event: "FROZEN",
      commit: event.commit,
      parent: event.parent,
      tree: event.tree,
      reviewed_event_seq: event.reviewed_event_seq,
    };
    if (parseLaneEventV2(doc) === null) throw new RecoveryError(`${quoi} : forme refusée par § F`);
    return doc;
  }
  if (event.event === "MERGED") {
    if (event.lane !== ouverte.lane) {
      throw new RecoveryError(`${quoi} : ${event.lane} n'est pas la lane courante ${ouverte.lane}`);
    }
    if (lu.events.some((e) => e.event === "ABANDONED" && "lane" in e && e.lane === ouverte.lane)) {
      throw new RecoveryError(`${quoi} : ${ouverte.lane} est abandonnée, aucun merge ne s'y enregistre`);
    }
    if (integrations === undefined) {
      throw new RecoveryError(
        `${quoi} : la consommation d'un gel ne se juge que sur le registre des intégrations relu sous R`,
      );
    }
    let gel: { event_seq: number; commit: string } | undefined;
    let fusionnee = false;
    let integree = false;
    for (const e of lu.events) {
      if (!("lane" in e) || e.lane !== ouverte.lane) continue;
      if (e.event === "FROZEN") gel = { event_seq: e.event_seq, commit: e.commit };
      else if (e.event === "MERGED") fusionnee = true;
      else if (e.event === "INTEGRATED") integree = true;
    }
    if (integree) throw new RecoveryError(`${quoi} : ${ouverte.lane} est déjà intégrée`);
    // Un gel se consomme une fois, et après MERGED ni regel ni second MERGED (L9-Q3).
    if (fusionnee) throw new RecoveryError(`${quoi} : ${ouverte.lane} porte déjà un MERGED ; un gel ne se consomme qu'une fois`);
    // Le gel VIVANT est le dernier de la lane : un gel antérieur n'a cédé la place qu'en
    // étant consommé `returned-to-lane` (L8-A1), et ne se merge donc plus.
    if (gel === undefined || gel.event_seq !== event.frozen_event_seq) {
      throw new RecoveryError(
        `${quoi} : frozen_event_seq ${event.frozen_event_seq} ne désigne pas le gel vivant de ` +
          `${ouverte.lane} (${gel === undefined ? "aucun gel" : `dernier gel ${gel.event_seq}`})`,
      );
    }
    /*
     * Consommé sans intégration : la règle du LOT 8, inchangée (L9-Q3) et identique à celle de
     * l'écrivain FROZEN — une tentative de l'unité sur ce gel exact close `returned-to-lane`,
     * et aucune autre sur le même gel encore vivante ni intégrée.
     */
    const tentatives = new Map<string, { ferme?: string; remplacee: boolean }>();
    for (const i of integrations) {
      if (i.event === "ATTEMPT_OPENED") {
        if (i.work_unit === event.work_unit && i.p2 === gel.commit) tentatives.set(i.id, { remplacee: false });
      } else if (i.event === "CLOSED") {
        const t = tentatives.get(i.id);
        if (t) t.ferme = i.outcome;
      } else if (i.event === "SUPERSEDED") {
        const t = tentatives.get(i.id);
        if (t) t.remplacee = true;
      }
    }
    const surCeGel = [...tentatives.values()];
    const rendu = surCeGel.some((t) => t.ferme === "returned-to-lane") &&
      !surCeGel.some((t) => (t.ferme === undefined && !t.remplacee) || t.ferme === "integrated");
    if (rendu) {
      throw new RecoveryError(
        `${quoi} : le gel ${gel.commit.slice(0, 12)} a été consommé returned-to-lane ; il ne se merge plus`,
      );
    }
    const doc = {
      ...enveloppe,
      event: "MERGED",
      integration_commit: event.integration_commit,
      frozen_event_seq: event.frozen_event_seq,
    };
    if (parseLaneEventV2(doc) === null) throw new RecoveryError(`${quoi} : forme refusée par § F`);
    return doc;
  }
  if (event.event === "INTEGRATED" && event.status !== undefined) {
    /*
     * L'INTEGRATED final (C0 § F) : le MERGED exact de la lane le précède, le commit est le
     * même, et le `status` est l'une des trois issues à clés exactes — jugée par le lecteur.
     */
    if (event.lane !== ouverte.lane) {
      throw new RecoveryError(`${quoi} : ${String(event.lane)} n'est pas la lane courante ${ouverte.lane}`);
    }
    if (lu.events.some((e) => e.event === "ABANDONED" && "lane" in e && e.lane === ouverte.lane)) {
      throw new RecoveryError(`${quoi} : ${ouverte.lane} est abandonnée, aucune intégration ne s'y enregistre`);
    }
    if (integrations === undefined) {
      throw new RecoveryError(`${quoi} : un INTEGRATED final ne s'écrit que sur des registres jugés sous R`);
    }
    let merge: string | undefined;
    let integree = false;
    for (const e of lu.events) {
      if (!("lane" in e) || e.lane !== ouverte.lane) continue;
      if (e.event === "MERGED") merge = e.integration_commit;
      else if (e.event === "INTEGRATED") integree = true;
    }
    if (integree) throw new RecoveryError(`${quoi} : ${ouverte.lane} est déjà intégrée`);
    if (merge === undefined) {
      throw new RecoveryError(`${quoi} : aucun MERGED sur ${ouverte.lane} ; un INTEGRATED final le suit toujours`);
    }
    if (event.integration_commit !== merge) {
      throw new RecoveryError(
        `${quoi} : integration_commit ${String(event.integration_commit)} diverge du MERGED ${merge}`,
      );
    }
    const doc = { ...enveloppe, event: "INTEGRATED", integration_commit: event.integration_commit, status: event.status };
    if (parseLaneEventV2(doc) === null) throw new RecoveryError(`${quoi} : forme refusée par § F`);
    return doc;
  }
  if (event.event === "INTEGRATED") {
    /*
     * La forme historique de C0 v1.8 — le commit seul, aucun `status` — reste lisible pour
     * toujours, mais ne s'écrit plus (C0 v2.0, E-L9-3) : un INTEGRATED v2 passe par son
     * écrivain, après son MERGED exact, avec l'issue du Statut. Le refus « sans commit »
     * garde son motif, et vient d'abord.
     */
    if (!event.integration_commit) {
      throw new RecoveryError(`${quoi} : sous v2, une intégration porte son commit exact`);
    }
    throw new RecoveryError(
      `${quoi} : la forme transitoire d'INTEGRATED, sans status, n'est plus écrite ; un INTEGRATED v2 ` +
        "s'écrit par appendIntegratedEvent, après son MERGED exact",
    );
  }
  if (!event.reason) throw new RecoveryError(`${quoi} : un abandon v2 porte sa raison`);
  /*
   * B-2 (adjudication de la livraison A) : une lane MERGED sans INTEGRATED porte une transition
   * d'intégration inachevée. L'abandonner la masquerait ; elle ne s'abandonne pas.
   */
  if (lu.events.some((e) => e.event === "MERGED" && "lane" in e && e.lane === ouverte.lane) &&
    !lu.events.some((e) => e.event === "INTEGRATED" && "lane" in e && e.lane === ouverte.lane)) {
    throw new RecoveryError(
      `${quoi} : ${ouverte.lane} porte un MERGED sans INTEGRATED ; une transition d'intégration inachevée ` +
        "ne s'abandonne pas",
    );
  }
  return {
    ...enveloppe,
    event: "ABANDONED",
    by: event.by ?? "operator",
    reason: event.reason,
    generation: ouverte.generation,
  };
}

/**
 * Enregistre un événement de vie de lane, dans la grammaire de la version réellement lue.
 *
 * L'aiguillage se fait sur l'en-tête relu sous la garde du run, jamais sur une supposition :
 *
 *   registre absent   run neuf : création v2 (en-tête durable, puis témoin), événement v2
 *   registre v2       événement v2 complet, enveloppe déduite
 *   registre v1       continuation legacy des lanes déjà ouvertes ; aucune ouverture
 *
 * Tout autre en-tête, ou une ligne illisible, refuse : écrire à la suite d'un registre
 * qu'on ne sait pas lire en entier ajouterait un fait à une histoire inconnue.
 */
export function appendLaneEvent(
  dir: string,
  event: LaneWrite,
  lease: Lease,
  risquesAvant?: CalculDesRisques,
): void {
  withRunGuard(dir, lease.runId, () => {
    assertOwner(dir, lease, `enregistrer ${event.event} sur ${event.work_unit}`);
    if (risquesAvant === undefined) {
      ajouterSousR(dir, event, lease);
      return;
    }
    ecrireSequenceSousR(dir, risquesAvant, [event], lease);
  });
}

/**
 * Ce que le producteur de risques reçoit sous R (PLAN-LOT7 § 3.3) : la projection du LOT 2,
 * `(R, work_unit, id)`, sur le registre relu sous la garde et jugé KNOWN, et la lane courante
 * d'une unité (dernier OPENED). C'est le même fold que `vu.snapshot.projections.risks` : sur
 * un registre v2 KNOWN, l'observation n'y ajoute rien.
 */
export interface EtatDesRisques {
  faits: ReadonlyMap<string, RiskFact>;
  laneCourante: (workUnit: string) => string | undefined;
}
export type CalculDesRisques = (etat: EtatDesRisques) => readonly RiskWrite[];

/**
 * Des transitions de risque seules, sous UNE acquisition de R (PLAN-LOT7 § 3.3) : le routage
 * d'un scout, la continuation qui n'a rien rendu, le reviewer de tentative T_I. Les
 * transitions se calculent sous R, sur l'état relu sous R.
 */
export function appendRiskEvents(dir: string, workUnit: string, calcul: CalculDesRisques, lease: Lease): void {
  withRunGuard(dir, lease.runId, () => {
    assertOwner(dir, lease, `enregistrer RISK sur ${workUnit}`);
    ecrireSequenceSousR(dir, calcul, [], lease);
  });
}

/**
 * Une séquence RISK (puis REVIEWED) commencée et non achevée.
 *
 * Le registre est append-only : aucun octet écrit ne se reprend, et une troncature
 * simulerait une atomicité que le fichier n'a pas. Dès qu'un append a été tenté, son issue
 * compte comme possiblement durable ; le verrou R reste donc comme vestige de transition
 * (C1.10), et l'appel suivant rencontre `RUN_TRANSITION_LOCKED` jusqu'à la réconciliation
 * opérateur (PLAN-LOT7 Q6).
 */
export class RiskNotRecordedError extends RecoveryError {}

/**
 * Tout se décide avant le premier octet, puis tout s'écrit dans l'ordre, sans jamais défaire.
 *
 * Phase 1, sous R : registre présent, lisible, v2, KNOWN ; les transitions de risque
 * calculées sur cet état ; chaque événement construit par `evenementV2` contre le registre
 * relu ET les événements qui le précèdent dans la séquence. Un refus ici n'a rien écrit :
 * `RecoveryError`, verrou libéré. Phase 2 : un append par ligne. La première panne après
 * un RISK tenté lève `RiskNotRecordedError` et garde R ; une séquence sans aucun RISK garde
 * la règle de sa seule entrée.
 */
function ecrireSequenceSousR(
  dir: string,
  calcul: CalculDesRisques,
  suite: readonly LaneWrite[],
  lease: Lease,
): void {
  const path = laneLedgerPath(dir, lease.runId);
  let quoi = ["RISK", ...suite.map((e) => e.event)].join(" → ");
  if (!existsSync(path)) {
    throw new RecoveryError(`registre ${lease.runId} absent : ${quoi} sans lane ouverte ; rien n'est écrit`);
  }
  const lu = readLaneEvents(dir, lease.runId);
  if (lu.malformedLines.length > 0) {
    throw new RecoveryError(`registre ${lease.runId} illisible ligne(s) ${lu.malformedLines.join(", ")}`);
  }
  if (lu.version !== LANE_LEDGER_V2) {
    throw new RecoveryError(
      `registre ${lease.runId} en version ${String(lu.version)} : ${quoi} n'existe qu'en v2 ; rien n'est écrit`,
    );
  }
  exigerRegistreConnu(dir, lease.runId, lu, quoi);
  const risques = calcul({
    faits: projectRisks(lu.events, lease.runId),
    laneCourante: (u) => lastLaneOfUnit(lu.events, u)?.lane,
  });
  const events: LaneWrite[] = [...risques, ...suite];
  quoi = events.map((e) => e.event).join(" → ") || "aucune transition";
  const lignes: string[] = [];
  let courant: LedgerRead = lu;
  for (const event of events) {
    const doc = evenementV2(courant, event, lease.runId);
    lignes.push(`${JSON.stringify(doc)}\n`);
    courant = { ...courant, events: [...courant.events, doc as unknown as LaneEvent] };
  }
  for (let i = 0; i < lignes.length; i++) {
    try {
      appendFileSync(path, lignes[i]);
    } catch (err) {
      if (!events.slice(0, i + 1).some((e) => e.event === "RISK")) {
        throw new RecoveryError(`${quoi} : append en échec (${messageOf(err)}) ; aucun risque n'était en jeu`);
      }
      throw new RiskNotRecordedError(
        `${quoi} : append ${i + 1}/${lignes.length} en échec sous bail valide (${messageOf(err)}) ; ` +
          `${i} ligne(s) déjà écrite(s), aucune n'est reprise. Le verrou ${guardPath(dir, lease.runId)} ` +
          "est conservé comme vestige ; réconcilier le registre avant de le lever.",
      );
    }
  }
}

/**
 * Une violation observée sous bail valide, et que le registre n'a pas pu recevoir.
 *
 * Ce n'est pas une panne ordinaire : le fait historique existe, il n'est écrit nulle part,
 * et une restauration du fichier l'effacerait du seul recalcul qui resterait. Le verrou R
 * de l'append est donc CONSERVÉ comme vestige de transition inachevée (PLAN-LOT6 Q7) :
 * l'appel suivant, même d'un autre propriétaire et même après restauration, rencontre
 * C1.10 et son refus `RUN_TRANSITION_LOCKED`, jusqu'à une réconciliation opérateur.
 */
export class ViolationNotRecordedError extends RecoveryError {}

/**
 * Enregistre une VIOLATION (C3.1, C3.2).
 *
 * Bail perdu : `assertOwner` refuse, le verrou est libéré, rien n'est écrit — le nouveau
 * propriétaire recalculera. Bail tenu et écriture en échec : le verrou reste, et l'erreur
 * le dit (`ViolationNotRecordedError`).
 */
export function appendViolationEvent(
  dir: string,
  event: Extract<LaneWrite, { event: "VIOLATION" }>,
  lease: Lease,
): void {
  withRunGuard(dir, lease.runId, () => {
    assertOwner(dir, lease, `enregistrer VIOLATION sur ${event.work_unit}`);
    try {
      ajouterSousR(dir, event, lease);
    } catch (err) {
      throw new ViolationNotRecordedError(
        `VIOLATION ${event.kind} sur ${event.lane} observée sous bail valide et non enregistrée : ` +
          `${messageOf(err)}. Le verrou ${guardPath(dir, lease.runId)} est conservé comme vestige ; ` +
          "réconcilier le registre, le tree et la cause avant de le lever.",
      );
    }
  });
}

/**
 * Un gel refusé avant tout octet, sous R et bail vérifié (PLAN-LOT8 Q6, classe 1).
 *
 * Le registre n'a rien reçu, et l'appel possédait le run au moment du refus : c'est le
 * seul cas où le runtime peut défaire le commit de gel qu'il vient de créer.
 */
export class FrozenRefusedError extends RecoveryError {}

/**
 * Un gel dont l'append a été tenté et dont l'issue est incertaine (PLAN-LOT8 Q6, classe 3).
 *
 * Aucun octet ne se reprend : le verrou R reste comme vestige de transition (C1.10), la
 * branche reste sur le commit de gel, et rien n'est mergé. L'appel suivant rencontre
 * `RUN_TRANSITION_LOCKED` jusqu'à la réconciliation opérateur.
 */
export class FrozenNotRecordedError extends RecoveryError {}

/**
 * Enregistre le gel d'une lane (C2.4, § F, PLAN-LOT8 Q5 et Q6).
 *
 * Trois issues d'échec, que l'appelant ne confond pas :
 *   - `NotOwnerError` (ou toute erreur avant la vérification du bail) : l'appel ne possède
 *     plus le run ; il ne mute plus la lane — C2.5, aucun reset ;
 *   - `FrozenRefusedError` : bail vérifié sous R, rien n'est écrit — le gel se défait ;
 *   - `FrozenNotRecordedError` : l'append a été tenté — vestige, aucun reset.
 *
 * Le registre des intégrations n'est lu qu'ici, sous le même R que ses propres ajouts
 * (`appendIntegrationEvent`) : c'est une dépendance de preuve pour un second gel, pas un
 * verrou de plus.
 */
export function appendFrozenEvent(dir: string, event: FrozenWrite, lease: Lease): void {
  withRunGuard(dir, lease.runId, () => {
    assertOwner(dir, lease, `enregistrer FROZEN sur ${event.work_unit}`);
    const path = laneLedgerPath(dir, lease.runId);
    let ligne: string;
    try {
      if (!existsSync(path)) {
        throw new RecoveryError(`registre ${lease.runId} absent : aucune lane à geler`);
      }
      const lu = readLaneEvents(dir, lease.runId);
      if (lu.malformedLines.length > 0) {
        throw new RecoveryError(`registre ${lease.runId} illisible ligne(s) ${lu.malformedLines.join(", ")}`);
      }
      if (lu.version !== LANE_LEDGER_V2) {
        throw new RecoveryError(
          `registre ${lease.runId} en version ${String(lu.version)} : FROZEN n'existe qu'en v2`,
        );
      }
      /*
       * Q5 : les deux registres lus, puis les témoins relus UNE fois, puis les deux états
       * établis — lanes d'abord, intégrations ensuite. Aucun événement d'intégration n'est
       * consommé avant. EMPTY est un constat d'absence, jamais la preuve qu'un gel a été
       * consommé ; tout autre état qu'un état exploitable refuse avant l'append.
       */
      const integ = readIntegrationEvents(dir, lease.runId);
      const temoins = readWitnesses(dir, lease.runId);
      const etatLanes = laneState(temoins, { ...lu, version: lu.version }, lease.runId);
      if (etatLanes !== "KNOWN") {
        throw new RecoveryError(
          `registre ${lease.runId} ${etatLanes} : un registre v2 qui n'est pas KNOWN ne reçoit aucun FROZEN ; rien n'est écrit`,
        );
      }
      const etatIntegrations = integrationLedgerState(temoins, integ, etatLanes);
      if (etatIntegrations !== "KNOWN" && etatIntegrations !== "EMPTY") {
        throw new RecoveryError(
          `registre des intégrations ${lease.runId} ${etatIntegrations} : la consommation d'un gel ne s'y ` +
            "prouve pas ; rien n'est écrit",
        );
      }
      const prouvees = etatIntegrations === "KNOWN" ? integ.events : [];
      ligne = JSON.stringify(evenementV2(lu, event, lease.runId, prouvees));
    } catch (err) {
      throw new FrozenRefusedError(`FROZEN refusé avant tout octet : ${messageOf(err)}`);
    }
    try {
      appendFileSync(path, `${ligne}\n`);
    } catch (err) {
      throw new FrozenNotRecordedError(
        `FROZEN de ${event.lane} tenté et non confirmé : ${messageOf(err)}. Le verrou ` +
          `${guardPath(dir, lease.runId)} est conservé comme vestige ; réconcilier le registre ` +
          "et la branche avant de le lever.",
      );
    }
  });
}

/** Un MERGED refusé avant tout octet, sous R et bail vérifié (PLAN-LOT9 § 2). */
export class MergedRefusedError extends RecoveryError {}
/** Un MERGED dont l'append a été tenté et dont l'issue est incertaine : vestige R, rien de repris. */
export class MergedNotRecordedError extends RecoveryError {}
/** Un INTEGRATED final refusé avant tout octet, sous R et bail vérifié (PLAN-LOT9 § 2). */
export class IntegratedRefusedError extends RecoveryError {}
/** Un INTEGRATED final dont l'append a été tenté et dont l'issue est incertaine : vestige R. */
export class IntegratedNotRecordedError extends RecoveryError {}

/**
 * Enregistre le MERGED d'une lane (C0 § F, PLAN-LOT9 L9-Q3 et L9-Q18).
 *
 * Les issues d'échec sont celles de FROZEN, et l'appelant ne les confond pas :
 *   - `NotOwnerError` : l'appel ne possède plus le run ; rien n'est écrit ;
 *   - `MergedRefusedError` : bail vérifié sous R, rien n'est écrit ;
 *   - `MergedNotRecordedError` : l'append a été tenté — vestige, aucune reprise.
 *
 * Un merge réel précède toujours cet appel : aucun refus ici ne défait ce merge.
 */
export function appendMergedEvent(dir: string, event: MergedWrite, lease: Lease): void {
  ecrireTransitionDIntegration(dir, event, lease, MergedRefusedError, MergedNotRecordedError);
}

/**
 * Enregistre l'INTEGRATED final d'une lane (C0 § F, PLAN-LOT9 § 2 et L9-Q18) : après son
 * MERGED exact, avec l'issue du Statut. Mêmes trois issues d'échec que `appendMergedEvent`.
 */
export function appendIntegratedEvent(
  dir: string,
  event: Extract<LaneWrite, { event: "INTEGRATED" }> & { lane: string; integration_commit: string; status: IntegrationStatus },
  lease: Lease,
): void {
  // Le type l'exige déjà ; un appelant non typé n'écrit pas par ici la forme historique.
  if (event.status === undefined) {
    throw new IntegratedRefusedError(`INTEGRATED refusé avant tout octet : ${event.work_unit} sans status`);
  }
  ecrireTransitionDIntegration(dir, event, lease, IntegratedRefusedError, IntegratedNotRecordedError);
}

/**
 * Le corps commun des écrivains de la transition d'intégration (L9-Q18).
 *
 * Même ordre que FROZEN : les deux registres lus, les témoins relus une fois, puis les deux
 * états — lanes d'abord, KNOWN v2 exigé ; intégrations ensuite, KNOWN ou EMPTY. LOST,
 * UNKNOWN, MIGRATION_REQUIRED et RUN_WITHOUT_WITNESS refusent avant tout octet. EMPTY est
 * un constat d'absence de tentative, jamais le substitut d'un registre attendu et illisible :
 * le chemin tentative, qui a besoin de sa tentative, l'exige de son côté.
 */
function ecrireTransitionDIntegration(
  dir: string,
  event: LaneWrite & { lane?: string },
  lease: Lease,
  Refus: new (message: string) => RecoveryError,
  NonConfirme: new (message: string) => RecoveryError,
): void {
  withRunGuard(dir, lease.runId, () => {
    assertOwner(dir, lease, `enregistrer ${event.event} sur ${event.work_unit}`);
    const path = laneLedgerPath(dir, lease.runId);
    let ligne: string;
    try {
      if (!existsSync(path)) {
        throw new RecoveryError(`registre ${lease.runId} absent : aucune lane à intégrer`);
      }
      const lu = readLaneEvents(dir, lease.runId);
      if (lu.malformedLines.length > 0) {
        throw new RecoveryError(`registre ${lease.runId} illisible ligne(s) ${lu.malformedLines.join(", ")}`);
      }
      if (lu.version !== LANE_LEDGER_V2) {
        throw new RecoveryError(
          `registre ${lease.runId} en version ${String(lu.version)} : ${event.event} n'existe qu'en v2`,
        );
      }
      const integ = readIntegrationEvents(dir, lease.runId);
      const temoins = readWitnesses(dir, lease.runId);
      const etatLanes = laneState(temoins, { ...lu, version: lu.version }, lease.runId);
      if (etatLanes !== "KNOWN") {
        throw new RecoveryError(
          `registre ${lease.runId} ${etatLanes} : un registre v2 qui n'est pas KNOWN ne reçoit aucun ` +
            `${event.event} ; rien n'est écrit`,
        );
      }
      const etatIntegrations = integrationLedgerState(temoins, integ, etatLanes);
      if (etatIntegrations !== "KNOWN" && etatIntegrations !== "EMPTY") {
        throw new RecoveryError(
          `registre des intégrations ${lease.runId} ${etatIntegrations} : ${event.event} ne s'y ` +
            "fonde pas ; rien n'est écrit",
        );
      }
      ligne = JSON.stringify(evenementV2(lu, event, lease.runId, etatIntegrations === "KNOWN" ? integ.events : []));
    } catch (err) {
      throw new Refus(`${event.event} refusé avant tout octet : ${messageOf(err)}`);
    }
    try {
      appendFileSync(path, `${ligne}\n`);
    } catch (err) {
      throw new NonConfirme(
        `${event.event} de ${String(event.lane)} tenté et non confirmé : ${messageOf(err)}. Le verrou ` +
          `${guardPath(dir, lease.runId)} est conservé comme vestige ; réconcilier le registre ` +
          "et la racine avant de le lever.",
      );
    }
  });
}

// ================================================================== LOT 9 — le gel et sa consommation

/** Un FROZEN tel que le registre le porte. */
export interface GelEnregistre {
  event_seq: number;
  commit: string;
  parent: string;
  tree: string;
  reviewed_event_seq: number;
}

/** Un MERGED tel que le registre le porte. */
export interface FusionEnregistree {
  event_seq: number;
  integration_commit: string;
  frozen_event_seq: number;
}

/**
 * Où en est le dernier gel d'une lane (PLAN-LOT9 L9-Q3).
 *
 *   aucun                  la lane n'a jamais été gelée
 *   vivant                 le dernier FROZEN n'est consommé ni par une tentative close
 *                          `returned-to-lane`, ni par un MERGED : il se réutilise tel quel
 *   rendu                  consommé sans intégration (LOT 8, inchangé) : un regel est possible
 *   fusionne               consommé par le MERGED exact qui le désigne ; `integre` dit si
 *                          l'INTEGRATED de la lane suit. Ni réutilisation ni regel.
 *   integree-historique    la lane porte un INTEGRATED sans MERGED : la forme transitoire des
 *                          LOTS 3 à 8, fermée, sans MERGED rétroactif (L9-Q12)
 *   contradictoire         deux MERGED, ou un MERGED qui ne désigne pas le dernier gel
 *
 * Pure : les deux registres sont ceux qu'un lecteur autoritaire a déjà jugés exploitables.
 * La règle `returned-to-lane` est celle de l'écrivain FROZEN et de `gelConsomme`.
 */
export type EtatDuGel =
  | { etat: "aucun" }
  | { etat: "vivant"; gel: GelEnregistre }
  | { etat: "rendu"; gel: GelEnregistre }
  | { etat: "fusionne"; gel: GelEnregistre; merged: FusionEnregistree; integre: boolean }
  | { etat: "integree-historique"; gel?: GelEnregistre }
  | { etat: "contradictoire"; raison: string };

export function classerGel(
  events: readonly LaneEvent[],
  laneId: string,
  workUnit: string,
  integrations: readonly IntegrationEvent[],
): EtatDuGel {
  const gels: GelEnregistre[] = [];
  const fusions: FusionEnregistree[] = [];
  let integre = false;
  for (const e of events) {
    if (!("lane" in e) || e.lane !== laneId) continue;
    if (e.event === "FROZEN") {
      gels.push({
        event_seq: e.event_seq, commit: e.commit, parent: e.parent, tree: e.tree, reviewed_event_seq: e.reviewed_event_seq,
      });
    } else if (e.event === "MERGED") {
      fusions.push({ event_seq: e.event_seq, integration_commit: e.integration_commit, frozen_event_seq: e.frozen_event_seq });
    } else if (e.event === "INTEGRATED") {
      integre = true;
    }
  }
  const gel = gels.at(-1);
  if (fusions.length > 1) return { etat: "contradictoire", raison: `${laneId} porte ${fusions.length} MERGED` };
  if (fusions.length === 1) {
    const [merged] = fusions;
    if (gel === undefined || merged.frozen_event_seq !== gel.event_seq) {
      return {
        etat: "contradictoire",
        raison: `le MERGED ${merged.event_seq} de ${laneId} ne désigne pas son dernier gel ` +
          `(${gel === undefined ? "aucun" : gel.event_seq})`,
      };
    }
    return { etat: "fusionne", gel, merged, integre };
  }
  if (integre) return gel === undefined ? { etat: "integree-historique" } : { etat: "integree-historique", gel };
  if (gel === undefined) return { etat: "aucun" };
  const tentatives = new Map<string, { p2: string; ferme?: string; remplacee: boolean }>();
  for (const i of integrations) {
    if (i.event === "ATTEMPT_OPENED") {
      if (i.work_unit === workUnit) tentatives.set(i.id, { p2: i.p2, remplacee: false });
    } else if (i.event === "CLOSED") {
      const t = tentatives.get(i.id);
      if (t) t.ferme = i.outcome;
    } else if (i.event === "SUPERSEDED") {
      const t = tentatives.get(i.id);
      if (t) t.remplacee = true;
    }
  }
  const surCeGel = [...tentatives.values()].filter((t) => t.p2 === gel.commit);
  const rendu = surCeGel.some((t) => t.ferme === "returned-to-lane") &&
    !surCeGel.some((t) => (t.ferme === undefined && !t.remplacee) || t.ferme === "integrated");
  return rendu ? { etat: "rendu", gel } : { etat: "vivant", gel };
}

/**
 * Une transition d'intégration que le registre montre inachevée (L9-Q5, étape 1 ; L9-Q6-Q8).
 *
 *   gel-vivant      candidate seulement : un gel vivant n'est une fenêtre « après merge » que
 *                   si git montre ce gel intégré — c'est `fenetreDeReprise` qui le dit
 *   merged          MERGED sans INTEGRATED : fenêtre « après MERGED » ou « après commit de
 *                   Statut », selon git
 *   contradiction   l'histoire de la lane ne se classe pas : les intégrations suivantes se
 *                   bloquent, rien ne s'infère
 *
 * Sur la génération courante de chaque unité, hors lane abandonnée. Pure.
 */
export type TransitionEnCours =
  | { fenetre: "gel-vivant"; work_unit: string; lane: string; gel: GelEnregistre }
  | { fenetre: "merged"; work_unit: string; lane: string; gel: GelEnregistre; merged: FusionEnregistree }
  | { fenetre: "contradiction"; work_unit: string; lane: string; raison: string };

export function transitionsEnCours(
  events: readonly LaneEvent[],
  integrations: readonly IntegrationEvent[],
): TransitionEnCours[] {
  // Toutes les lanes ouvertes au registre, pas seulement la génération courante : une
  // transition inachevée d'une génération antérieure ne doit pas disparaître derrière la suivante.
  const lanes = new Map<string, string>();
  const abandonnees = new Set<string>();
  for (const e of events) {
    if (!("lane" in e)) continue;
    if (e.event === "OPENED") lanes.set(e.lane, e.work_unit);
    else if (e.event === "ABANDONED") abandonnees.add(e.lane);
  }
  const trouvees: TransitionEnCours[] = [];
  for (const [lane, unite] of lanes) {
    if (abandonnees.has(lane)) {
      // B-2 : MERGED puis ABANDONED ne se produit pas ; rencontré, ce n'est jamais « ignoré ».
      const merge = events.some((e) => e.event === "MERGED" && "lane" in e && e.lane === lane);
      const fin = events.some((e) => e.event === "INTEGRATED" && "lane" in e && e.lane === lane);
      if (merge && !fin) {
        trouvees.push({
          fenetre: "contradiction", work_unit: unite, lane,
          raison: `${lane} porte MERGED sans INTEGRATED, puis ABANDONED`,
        });
      }
      continue;
    }
    const etat = classerGel(events, lane, unite, integrations);
    if (etat.etat === "vivant") trouvees.push({ fenetre: "gel-vivant", work_unit: unite, lane, gel: etat.gel });
    else if (etat.etat === "fusionne" && !etat.integre) {
      trouvees.push({ fenetre: "merged", work_unit: unite, lane, gel: etat.gel, merged: etat.merged });
    } else if (etat.etat === "contradictoire") {
      trouvees.push({ fenetre: "contradiction", work_unit: unite, lane, raison: etat.raison });
    }
  }
  return trouvees;
}

/**
 * Une lane dont l'artefact existe et dont l'ouverture n'a pas pu être enregistrée.
 *
 * C0 la classe inconnue : un worktree sans `OPENED`, que la lecture suivante nommera
 * « worktree-orphelin » et qu'un opérateur tranchera. Distincte d'un échec de création,
 * parce que ce que l'opérateur doit faire n'est pas le même.
 */
export class LaneOpeningNotRecordedError extends RecoveryError {}

/** Une décision d'allocation : l'ouverture à enregistrer s'il y en a une, et ce qu'elle rend. */
export interface LaneAllocation<T> {
  opened?: Extract<LaneWrite, { event: "OPENED" }>;
  value: T;
}

/**
 * Allouer des lanes sous l'exclusion R du run, en une seule section critique.
 *
 * L'ordre est celui de PLAN-LOT3 § 4 et il n'est pas décoratif :
 *
 *   acquérir R → relire le registre → décider et créer les artefacts → écrire les OPENED
 *   (et le témoin d'un registre neuf) → relâcher R
 *
 * Relire AVANT d'avoir R laisserait deux processus décider sur le même instantané ; relâcher
 * R entre l'artefact et son `OPENED` laisserait un second décider sans voir le premier. Un
 * lot passe par UNE acquisition : ses décisions voient toutes le même état, et personne ne
 * s'intercale entre elles.
 *
 * `decide` reçoit la relecture faite sous R, crée ce qu'il faut et rend ses décisions. Une
 * erreur de `decide` ou d'un enregistrement laisse au pire un artefact sans preuve — ni
 * réutilisé en silence, ni alloué deux fois.
 */
export function allocateLanes<T>(
  dir: string,
  lease: Lease,
  decide: (lu: LedgerRead) => ReadonlyArray<LaneAllocation<T>>,
): T[] {
  SECTIONS_D_ALLOCATION += 1;
  return withRunGuard(dir, lease.runId, () => {
    assertOwner(dir, lease, "allouer des lanes");
    /*
     * L'état C4, relu sous R, avant `decide` (PLAN-CORRECTIF-PRE-PILOTE-C4 § 3.3) : `decide` crée
     * worktrees et branches. Sur un registre ni KNOWN ni EMPTY, il n'est pas appelé — rien ne
     * s'ouvre ni ne se rejoint, et l'écrivain n'a pas à refuser après coup une ouverture déjà faite.
     * Défense contre un écart entre la reconstruction du runtime et ce disque, relu maintenant.
     */
    const lu = readLaneEvents(dir, lease.runId);
    const etat = laneState(readWitnesses(dir, lease.runId), { ...lu, version: lu.version }, lease.runId);
    if (etat !== "KNOWN" && etat !== "EMPTY") {
      throw new RecoveryError(
        `registre ${lease.runId} ${etat} : aucune lane ne s'alloue sur un registre ni KNOWN ni EMPTY ; ` +
          "rien n'est ouvert, rejoint ni écrit",
      );
    }
    const decisions = decide(lu);
    for (const d of decisions) {
      if (!d.opened) continue;
      try {
        ajouterSousR(dir, d.opened, lease);
      } catch (err) {
        throw new LaneOpeningNotRecordedError(
          `${d.opened.lane ?? d.opened.work_unit} : ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return decisions.map((d) => d.value);
  });
}

/**
 * Le nombre de sections critiques d'allocation ouvertes par ce processus.
 *
 * « Un lot, une acquisition » est une propriété de structure : deux acquisitions
 * successives rendent le même état final tant que personne ne s'intercale, et un
 * intercalage se provoque mal. Le compte la rend observable, comme
 * `readGitInvocationCount` rend observable le coût d'une reconstruction. Lu par
 * différence, jamais remis à zéro.
 */
let SECTIONS_D_ALLOCATION = 0;
export function laneAllocationSections(): number {
  return SECTIONS_D_ALLOCATION;
}

/**
 * Un registre des lanes présent ne reçoit rien s'il n'est pas KNOWN (PLAN-LOT7 Q2), qu'il
 * soit v2 ou v1 (PLAN-CORRECTIF-UNKNOWN-LEGACY).
 *
 * Lisible ne suffit pas : un `event_seq` dupliqué ou décroissant, une lane qu'aucune
 * ouverture ne porte, un témoin qui contredit le fichier laissent chaque ligne analysable
 * et l'histoire inconnue. Ajouter un fait à une histoire inconnue la rend plus inconnue
 * encore. L'état se juge ici comme les observateurs le jugent — témoins relus sous R et
 * même fonction —, avant la séquence et avant le premier octet. Un seul lieu, pour toutes
 * les entrées de l'écrivain.
 *
 * Le v1 n'y échappe pas : un en-tête v1 sous un manifeste qui témoigne `lanes: 2` est
 * UNKNOWN (C4.9), même si chacune de ses lignes legacy se lit. Sous KNOWN, sa grammaire
 * historique décide ensuite seule de ce qu'il accepte.
 */
function exigerRegistreConnu(dir: string, runId: string, lu: LedgerRead, quoi: string): void {
  const etat = laneState(readWitnesses(dir, runId), { ...lu, version: lu.version }, runId);
  if (etat !== "KNOWN") {
    throw new RecoveryError(
      `registre ${runId} ${etat} : un registre v${String(lu.version)} qui n'est pas KNOWN ne reçoit aucun ` +
        `${quoi} ; rien n'est écrit`,
    );
  }
}

/** Le corps de `appendLaneEvent`, R déjà tenu et le bail déjà vérifié. */
function ajouterSousR(dir: string, event: LaneWrite, lease: Lease): void {
  const path = laneLedgerPath(dir, lease.runId);
  if (!existsSync(path)) {
    /*
     * L'état C4 avant toute création (ADDENDUM-R10-R15 § 2) : seul EMPTY crée. Sous LOST, le
     * manifeste atteste un registre qui n'est plus là ; en créer un neuf effacerait l'histoire
     * que le témoin promet, et le rendrait KNOWN pour l'append qui suit. Il reste absent.
     */
    const absent = readLaneEvents(dir, lease.runId);
    const etat = laneState(readWitnesses(dir, lease.runId), { ...absent, version: absent.version }, lease.runId);
    if (etat !== "EMPTY") {
      throw new RecoveryError(
        `registre ${lease.runId} ${etat} : un registre des lanes absent ne se crée que sous EMPTY ; ` +
          `aucun ${event.event}, rien n'est écrit`,
      );
    }
    creerRegistreV2(dir, lease, path);
  }
  const lu = readLaneEvents(dir, lease.runId);
  if (lu.malformedLines.length > 0) {
    throw new RecoveryError(
      `registre ${lease.runId} illisible ligne(s) ${lu.malformedLines.join(", ")}`,
    );
  }
  if (lu.version !== LANE_LEDGER_V2 && lu.version !== LANE_LEDGER_VERSION) {
    const trouve = lu.version === undefined ? "sans version" : `version ${lu.version}`;
    throw new RecoveryError(
      `registre ${lease.runId} ${trouve} : migration requise avant toute écriture`,
    );
  }
  // L'état C4, une fois, sur ce qui vient d'être relu — pour les deux versions, avant que la
  // grammaire ne décide. Une continuation legacy n'est permise que sous KNOWN.
  exigerRegistreConnu(dir, lease.runId, lu, event.event);
  if (lu.version === LANE_LEDGER_V2) {
    appendFileSync(path, `${JSON.stringify(evenementV2(lu, event, lease.runId))}\n`);
    return;
  }
  if (event.event === "REVIEWED" || event.event === "VIOLATION" || event.event === "RISK" || event.event === "FROZEN" ||
    event.event === "MERGED" || (event.event === "INTEGRATED" && event.status !== undefined)) {
    throw new RecoveryError(
      `registre ${lease.runId} en version ${LANE_LEDGER_VERSION} : sa grammaire ne porte ni ` +
        `revue, ni violation, ni risque, ni gel durable, ni merge, ni Statut ; ${event.event} ` +
        "sous cette forme n'existe qu'en v2",
    );
  }
  if (event.event === "OPENED") {
    throw new LegacyLaneLedgerError(
      `registre ${lease.runId} en version ${LANE_LEDGER_VERSION} : aucune nouvelle lane ne ` +
        "s'ouvre dans un run legacy ; le terminer ou l'abandonner, puis ouvrir un nouveau run",
    );
  }
  const legacy: LaneEventV1 = event.event === "INTEGRATED"
    ? {
      event: "INTEGRATED", work_unit: event.work_unit, at: event.at,
      ...(event.integration_commit ? { integration_commit: event.integration_commit } : {}),
    }
    : {
      event: "ABANDONED", work_unit: event.work_unit, at: event.at,
      ...(event.reason ? { reason: event.reason } : {}),
    };
  appendFileSync(path, `${JSON.stringify(legacy)}\n`);
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
  /**
   * Le fichier a-t-il été observé ? `false` : absence observée. `true` : un fichier,
   * même vide, réduit à son en-tête ou illisible. Même snapshot que le contenu (C4.9).
   */
  present: boolean;
}

export function readLaneEvents(dir: string, runId: string): LedgerRead {
  const path = laneLedgerPath(dir, runId);
  const contenu = lireSiPresent(path);
  if (contenu === null) {
    return { events: [], malformed: 0, malformedLines: [], version: LANE_LEDGER_VERSION, present: false };
  }
  const events: LaneEvent[] = [];
  let version: number | undefined;
  // Les numéros, pas seulement le compte : une procédure de récupération qui
  // sait qu'elle doit agir mais pas où n'est pas une procédure.
  const malformedLines: number[] = [];
  let malformed = 0;
  let numero = 0;
  for (const ligne of contenu.split("\n")) {
    numero += 1;
    if (!ligne.trim()) continue;
    try {
      const doc = JSON.parse(ligne) as Record<string, unknown>;
      // L'en-tête, s'il est là, est la première ligne physique.
      if (typeof doc.ledger === "number" && numero === 1) {
        version = doc.ledger;
        continue;
      }
      /*
       * Deux grammaires séparées, choisies par l'en-tête et par lui seul. Une ligne v2 ne
       * se lit jamais avec les règles v1 : elle y passerait pour peu qu'elle porte
       * OPENED, INTEGRATED ou ABANDONED, et les cinq autres natures y seraient comptées
       * abîmées. Une ligne que la grammaire v2 refuse est comptée, jamais ignorée.
       */
      if (version === LANE_LEDGER_V2) {
        const lu = parseLaneEventV2(doc);
        if (lu) {
          events.push(lu);
        } else {
          malformed += 1;
          malformedLines.push(numero);
        }
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
  return { events, malformed, malformedLines, version, present: true };
}

// ================================================================ états C4 (C4.2, C4.9)

/** Les six issues d'une lecture de registre. Une décision teste celle-ci, rien d'autre. */
export type LedgerState =
  | "EMPTY"
  | "LOST"
  | "UNKNOWN"
  | "MIGRATION_REQUIRED"
  | "KNOWN"
  | "RUN_WITHOUT_WITNESS";

/** Les deux issues exploitables. Tout autre état refuse et ne devient jamais un tableau vide. */
export type UsableLedgerState = "KNOWN" | "EMPTY";

/** L'espace de runs d'une racine : là où vit `active-run.json`. */
export const RUNS_DIR = ".pi-subagent-runs";

/** Ce que le manifeste atteste des registres : sa version, et sa table partielle de témoins. */
export interface LedgerWitnesses {
  manifestVersion: ManifestVersion;
  ledgers: Readonly<Record<string, number>>;
}

/**
 * Les témoins du run `runId`, relus maintenant, ou `null`.
 *
 * `null` couvre les trois cas de la ligne 0 de C4.9 : manifeste absent, illisible, ou
 * d'un autre run. Aucun cache : l'appelant a lu le registre AVANT, et cet ordre est
 * conservateur par C4.1 — un témoin apparu entre-temps donne au pire un faux LOST.
 */
export function readWitnesses(dir: string, runId: string): LedgerWitnesses | null {
  let m: RunManifest | undefined;
  try {
    m = readManifest(dir);
  } catch {
    return null;
  }
  if (!m || m.runId !== runId) return null;
  return { manifestVersion: m.version, ledgers: m.ledgers ?? {} };
}

/** Ce qu'une décision d'état lit d'un snapshot de registre. */
export interface LedgerShape {
  present: boolean;
  version: number | undefined;
  events: readonly unknown[];
  malformedLines: readonly number[];
}

/**
 * Absent, vide, sans en-tête, ou avec en-tête — observé, jamais déduit d'un second regard.
 *
 * « Vide » : aucune ligne non blanche. « Sans en-tête » : au moins une ligne, et la
 * première n'est pas un en-tête. Un fichier réduit à son en-tête a une version.
 */
function formeDe(lu: LedgerShape): "absent" | "vide" | "sans-en-tete" | "en-tete" {
  if (!lu.present) return "absent";
  if (lu.version !== undefined) return "en-tete";
  return lu.events.length === 0 && lu.malformedLines.length === 0 ? "vide" : "sans-en-tete";
}

/**
 * L'état du registre des lanes, ligne par ligne de C4.9.
 *
 * Un snapshot sans `present` booléen est incomplet : UNKNOWN, jamais « absent ».
 */
export function laneLedgerState(temoins: LedgerWitnesses | null, lu: LedgerShape): LedgerState {
  if (typeof lu.present !== "boolean") return "UNKNOWN";
  if (temoins === null) return "UNKNOWN"; // 0
  const forme = formeDe(lu);
  const lisible = lu.malformedLines.length === 0;
  if (temoins.manifestVersion === 2) {
    const temoin = temoins.ledgers.lanes;
    if (forme === "absent") return temoin === undefined ? "EMPTY" : "LOST"; // 2, 1
    if (forme === "vide") return "UNKNOWN"; // 3
    if (forme === "sans-en-tete") return "MIGRATION_REQUIRED"; // 4
    if (lu.version !== LANE_LEDGER_VERSION && lu.version !== LANE_LEDGER_V2) return "UNKNOWN"; // 9
    if (!lisible) return "UNKNOWN"; // 8
    return temoin === undefined || temoin === lu.version ? "KNOWN" : "UNKNOWN"; // 5, 6, 7
  }
  if (forme === "absent") return "RUN_WITHOUT_WITNESS"; // 10
  if (forme === "vide") return "UNKNOWN"; // 11
  if (forme === "sans-en-tete") return "MIGRATION_REQUIRED"; // 12
  if (lu.version !== LANE_LEDGER_VERSION) return "RUN_WITHOUT_WITNESS"; // 15
  return lisible ? "KNOWN" : "UNKNOWN"; // 13, 14
}

/**
 * L'état du registre des lanes d'un run : la matrice, puis la cohérence de P4.
 *
 * « Lisible » inclut, en v2, les contrôles de § F qui portent sur plusieurs lignes : un
 * registre v2 à l'état KNOWN par sa forme, mais incohérent, est UNKNOWN (ligne 8). Le v1
 * suit sa grammaire legacy et n'est jamais jugé sur l'enveloppe v2. C'est cette fonction,
 * et elle seule, que les deux observateurs appellent.
 */
export function laneState(temoins: LedgerWitnesses | null, lu: LaneLedgerShape, runId: string): LedgerState {
  const state = laneLedgerState(temoins, lu);
  if (state !== "KNOWN" || lu.version !== LANE_LEDGER_V2) return state;
  return laneLedgerIncoherences(lu.events, runId).length === 0 ? state : "UNKNOWN";
}

/** Un snapshot du registre des lanes, dont les événements sont typés. */
export interface LaneLedgerShape extends LedgerShape {
  events: readonly LaneEvent[];
}

/**
 * L'état du registre des intégrations, ligne par ligne de C4.9.
 *
 * `lanes` est l'état du registre des lanes lu dans le même snapshot : la reconstruction
 * des tentatives le consomme, et un registre des lanes non exploitable la rend inconnue.
 */
export function integrationLedgerState(
  temoins: LedgerWitnesses | null,
  lu: LedgerShape,
  lanes: LedgerState,
): LedgerState {
  if (typeof lu.present !== "boolean") return "UNKNOWN";
  if (temoins === null) return "UNKNOWN"; // 0
  if (lanes !== "KNOWN" && lanes !== "EMPTY") return "UNKNOWN"; // 1
  const forme = formeDe(lu);
  const lisible = lu.malformedLines.length === 0;
  if (temoins.manifestVersion === 2) {
    const temoin = temoins.ledgers.integrations;
    if (forme === "absent") return temoin === undefined ? "EMPTY" : "LOST"; // 3, 2
    if (forme === "vide") return "UNKNOWN"; // 4
    if (forme === "sans-en-tete") return "MIGRATION_REQUIRED"; // 5
    if (lu.version !== INTEGRATION_LEDGER_VERSION || !lisible) return "UNKNOWN"; // 8
    return temoin === undefined || temoin === INTEGRATION_LEDGER_VERSION ? "KNOWN" : "UNKNOWN"; // 6, 7
  }
  if (forme === "absent") return "RUN_WITHOUT_WITNESS"; // 9
  if (forme === "vide") return "UNKNOWN"; // 10
  if (forme === "sans-en-tete") return "MIGRATION_REQUIRED"; // 11
  if (!lisible) return "UNKNOWN"; // 13
  return lu.version === INTEGRATION_LEDGER_VERSION ? "KNOWN" : "RUN_WITHOUT_WITNESS"; // 12, 14
}

/**
 * Une observation de registre : exploitable avec son snapshot, ou refusée avec sa raison.
 *
 * `usable` n'est jamais fixé à part : il découle de `state`, ici et nulle part ailleurs,
 * pour qu'aucun objet ne porte un couple contradictoire (P5). Une décision nouvelle teste
 * `state` ; `usable` reste pour les consommateurs historiques.
 */
export type LedgerObservation<S> =
  | { state: UsableLedgerState; usable: true; snapshot: S }
  | { state: Exclude<LedgerState, UsableLedgerState>; usable: false; reason: string };

export function ledgerObservation<S>(
  state: LedgerState,
  snapshot: () => S,
  reason: () => string,
): LedgerObservation<S> {
  if (state === "KNOWN" || state === "EMPTY") return { state, usable: true, snapshot: snapshot() };
  return { state, usable: false, reason: reason() };
}

/**
 * Les faits qui expliquent un refus, pour l'opérateur. La décision, elle, a été prise
 * sur `state` : cette prose n'en fonde aucune.
 */
export function ledgerFacts(
  temoins: LedgerWitnesses | null,
  lu: LedgerShape,
  cle: "lanes" | "integrations",
  ecrite: number,
  incoherences: readonly string[] = [],
): string {
  const faits: string[] = [];
  if (typeof lu.present !== "boolean") faits.push("snapshot sans présence observée");
  if (temoins === null) faits.push(`${MANIFEST} absent, illisible ou d'un autre run`);
  else if (temoins.manifestVersion === 1) faits.push("manifeste v1, qui ne peut attester aucun registre");
  const temoin = temoins?.ledgers[cle];
  if (lu.present === false) {
    faits.push(temoin === undefined ? "registre absent" : `registre absent, alors que le manifeste l'atteste (${cle}: ${temoin})`);
  } else if (lu.version === undefined) {
    faits.push(lu.events.length === 0 && lu.malformedLines.length === 0
      ? "fichier présent et vide"
      : "version absente : registre sans en-tête, à migrer");
  } else {
    if (lu.version !== ecrite) faits.push(`version ${lu.version} au lieu de ${ecrite}, la seule que ce runtime écrit`);
    if (temoin !== undefined && temoin !== lu.version) faits.push(`témoin ${cle}: ${temoin} face à un en-tête de version ${lu.version}`);
  }
  if (lu.malformedLines.length > 0) faits.push(`ligne(s) ${lu.malformedLines.join(", ")} illisible(s)`);
  faits.push(...incoherences);
  return faits.join(" ; ");
}

export type LaneLedgerMigration =
  | { status: "missing" }
  | { status: "current"; events: number }
  | { status: "unsupported"; version: number }
  | { status: "malformed"; lines: number[] }
  | { status: "migrated"; events: number }
  | { status: "refused"; state: LedgerState; reason: string };

/**
 * Pose l'en-tête courant sur un registre legacy, sous la même capability et la
 * même clôture que les autres mutations durables du run.
 *
 * Le remplacement est atomique : un crash pendant l'écriture du fichier
 * temporaire ne peut pas tronquer la provenance existante.
 *
 * Seul un registre que C4 classe MIGRATION_REQUIRED se migre (ADDENDUM-C2 § 2). La décision
 * est prise ici, sur l'état relu sous la garde, avant tout octet : un registre vide ou blanc
 * est UNKNOWN, et lui poser un en-tête fabriquerait une histoire KNOWN à partir de rien — la
 * continuation legacy qu'on vient de fermer passerait alors par ce détour. Il est refusé et
 * conservé tel quel ; LOST de même. Le binaire opérateur présente le refus, il ne rejuge pas.
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
    const lu = readLaneEvents(dir, runId);
    const etat = laneState(readWitnesses(dir, runId), { ...lu, version: lu.version }, runId);
    const refus = (postImage?: LedgerState): LaneLedgerMigration => ({
      status: "refused",
      state: etat,
      reason: `registre ${runId} ${etat} : seul un registre MIGRATION_REQUIRED dont la post-image v1 serait ` +
        `KNOWN se migre${postImage === undefined ? "" : ` (post-image ${postImage})`} ; il est conservé tel quel, ` +
        "rien n'est écrit",
    });
    if (!existsSync(path)) return etat === "LOST" ? refus() : { status: "missing" };

    if (lu.version === LANE_LEDGER_VERSION) {
      return etat === "KNOWN" ? { status: "current", events: lu.events.length } : refus();
    }
    if (lu.version !== undefined) {
      return { status: "unsupported", version: lu.version };
    }
    if (lu.malformedLines.length > 0) {
      return { status: "malformed", lines: [...lu.malformedLines] };
    }
    /*
     * La post-image, jugée avant le premier octet (ADDENDUM-R10-R15 § 5) : l'en-tête v1 posé sur
     * ces lignes, relues par la même grammaire v1, face aux témoins inchangés. Sous un témoin
     * lanes: 2, l'étiquette v1 contredirait le manifeste et rendrait le registre UNKNOWN ; il
     * n'est ni réétiqueté, ni reconstruit en v2, ni amputé : il est refusé tel quel.
     */
    const postImage = laneState(readWitnesses(dir, runId), { ...lu, version: LANE_LEDGER_VERSION }, runId);
    if (etat !== "MIGRATION_REQUIRED" || postImage !== "KNOWN") return refus(postImage);

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
 * Les capacités révoquées, par identité complète de bail.
 *
 * En MÉMOIRE, et pas sur le disque : une révocation n'est pas une libération. Le bail
 * reste celui qu'il était — c'est la session qui cesse de pouvoir s'en servir, parce
 * qu'elle ne sait plus prouver qu'elle le tient. Toucher au bail ferait le contraire de
 * ce qu'on veut : il serait repris par un tiers alors que son propriétaire est peut-être
 * encore vivant.
 *
 * La clé porte R ET leaseId : le contrat identifie la capacité par ce couple, et une
 * collision d'identifiant entre deux runs ne doit pas révoquer le second par accident.
 */
const CAPACITES_REVOQUEES = new Set<string>();

function cleCapacite(lease: Pick<Lease, "runId" | "leaseId">): string {
  return `${lease.runId}\0${lease.leaseId}`;
}

function capaciteRevoquee(lease: Pick<Lease, "runId" | "leaseId">): boolean {
  return CAPACITES_REVOQUEES.has(cleCapacite(lease));
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
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * La sortie de garde, commune aux deux exclusions.
 *
 * Un `finally` qui lève écrase silencieusement l'erreur du corps : la panne réelle
 * disparaît derrière un incident de nettoyage, et le diagnostic porte sur le mauvais
 * objet. La priorité est donc explicite.
 *
 * corps abouti, retrait impossible    échec explicite — un faux vestige derrière un
 *                                     travail abouti ferait refuser la transition
 *                                     suivante pour une raison qui n'existe pas
 * corps en échec, retrait impossible  l'erreur du corps demeure prioritaire, et le
 *                                     verrou resté sur disque rend l'échec de
 *                                     libération durablement observable
 */
function sousGuardAcquis<T>(path: string, label: string, fn: () => T): T {
  let sortieNormale = false;
  // Les seuls échecs qui gardent le verrou : une violation constatée et non écrite (LOT 6
  // Q7), une séquence de risques commencée et non achevée (LOT 7 Q6), un gel dont l'append
  // a été tenté (LOT 8 Q6), un MERGED ou un INTEGRATED final dont l'append a été tenté
  // (LOT 9 § 2).
  let vestige = false;
  try {
    const resultat = fn();
    sortieNormale = true;
    return resultat;
  } catch (err) {
    vestige = err instanceof ViolationNotRecordedError || err instanceof RiskNotRecordedError ||
      err instanceof FrozenNotRecordedError || err instanceof MergedNotRecordedError ||
      err instanceof IntegratedNotRecordedError;
    throw err;
  } finally {
    if (!vestige) try {
      rmSync(path, { recursive: true, force: true });
    } catch (err) {
      if (sortieNormale) {
        throw new RecoveryError(`${label} non libéré (${path}) : ${messageOf(err)}`);
      }
      /*
       * Rien ici, et c'est délibéré : l'erreur du corps continue de se propager.
       */
    }
  }
}

/**
 * L'exclusion de l'espace de runs — clé N, et non R.
 *
 * Une succession met en jeu DEUX runs : celui qui finit et celui qui naît. Un verrou
 * nommé par l'un d'eux ne les exclut pas l'un de l'autre, et c'est exactement
 * A-P1-F01. Le verrou porte donc l'espace, pas le run, et toute transition terminale
 * passera par lui.
 *
 * Le vestige s'y reconnaît comme ailleurs : nommé, jamais levé.
 */
const N_GUARD = ".espace.guard";

/*
 * C1.2 — « l'exclusion de N englobe celle de R, jamais l'inverse » — n'est PAS gardée
 * par un mécanisme ici.
 *
 * Un compteur global de profondeur rendrait l'inversion impossible, mais `withRunGuard`
 * est privé : aucune preuve publique ne pourrait l'atteindre, et une garde qu'aucune
 * preuve n'atteint est décorative. Un compteur global mesurerait par ailleurs une
 * profondeur d'appel interne, pas l'ordre effectivement tenu entre deux processus ; il
 * ne prouverait donc pas C1.2 et pourrait créer des refus sans rapport avec la
 * possession réelle des verrous.
 *
 * L'ordre est imposé là où il se joue — la primitive terminale de l'étape 3 écrit
 * `withSpaceGuard(dir, () => withRunGuard(dir, runId, …))` — et il est ÉPROUVÉ par la
 * concurrence publique `A-P1-F01-concurrence`, dont le mutant inverse les deux gardes.
 * L'invariant se mesure ainsi au lieu de se décréter.
 */
export function withSpaceGuard<T>(dir: string, fn: () => T): T {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, N_GUARD);
  const limite = Date.now() + GUARD_WAIT_MS;
  for (;;) {
    try {
      mkdirSync(path);
      break;
    } catch (err) {
      if ((err as { code?: string })?.code !== "EEXIST") throw err;
      const depuis = ageOf(path);
      if (depuis > GUARD_STALE_MS) {
        throw new TransitionLockedError(
          `${RUN_TRANSITION_LOCKED} : une transition de l'espace de runs est restée ` +
            `inachevée (${path}, ${Math.round(depuis / 1000)} s) : réconcilier avant de ` +
            `reprendre. Ce refus ne lève rien — ni le verrou, ni une lane, ni un registre.`,
          { path, ageMs: Math.round(depuis) },
        );
      }
      if (Date.now() > limite) {
        throw new RunBusyError(
          `une transition de l'espace de runs est en cours depuis ${Math.round(depuis)} ms : ` +
            `réessayer`,
        );
      }
      pause(2);
    }
  }
  return sousGuardAcquis(path, "verrou d'espace", fn);
}

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
        throw new TransitionLockedError(
          `${RUN_TRANSITION_LOCKED} : une transition de ${runId} est restée inachevée ` +
            `(${path}, ${Math.round(depuis / 1000)} s) : réconcilier avant de reprendre. ` +
            `Ce refus ne lève rien — ni le verrou, ni une lane, ni un registre.`,
          { path, ageMs: Math.round(depuis) },
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
  return sousGuardAcquis(path, "verrou de run", fn);
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
  /*
   * La même session ne réacquiert jamais implicitement une capacité qu'elle a révoquée.
   * Sinon `acquireUnguarded` rebattrait avant de rendre exactement le même leaseId : une
   * panne transitoire maintiendrait alors vivant, indéfiniment, un bail inutilisable.
   */
  if (capaciteRevoquee(owner)) {
    return {
      kind: "recovery-required",
      reason:
        `la capacité ${owner.leaseId} de ${runId} a été révoquée après une perte de bail : ` +
        `réconciliation explicite requise`,
      lease: owner,
    };
  }
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
  // Après révocation, même un battement serait une mutation : il pourrait maintenir
  // artificiellement vivant un bail que cette session ne sait plus prouver.
  if (capaciteRevoquee(lease)) return false;
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
  // Une capacité révoquée n'a plus le droit de rendre le bail supprimable par un tiers.
  // La réconciliation explicite est le seul chemin qui puisse désormais le déplacer.
  if (capaciteRevoquee(lease)) return false;
  return withRunGuard(dir, lease.runId, () => {
    // Sous le verrou : une reprise ne peut plus s'intercaler entre la
    // vérification et la suppression, donc on n'efface plus le bail d'autrui.
    if (!ownsRun(dir, lease)) return false;
    rmSync(leaseDir(dir, lease.runId), { recursive: true, force: true });
    return true;
  });
}

function assertOwner(dir: string, lease: Lease, quoi: string): void {
  /*
   * Une capacité révoquée ne mute plus rien. Le disque peut encore désigner ce bail
   * comme propriétaire — c'est précisément le cas quand le maintien a échoué sans que
   * personne l'ait repris. Ce que la session ne sait plus prouver, elle ne s'en sert plus.
   */
  if (capaciteRevoquee(lease)) {
    throw new NotOwnerError(
      `${quoi} : la capacité de ${lease.runId} a été révoquée après une perte de bail. ` +
        `Lire reste possible, muter non.`,
    );
  }
  if (!ownsRun(dir, lease)) {
    throw new NotOwnerError(
      `${quoi} demande le bail courant de ${lease.runId} ; celui présenté ne l'est plus. ` +
        `Lire reste possible, muter non.`,
    );
  }

  /*
   * La capacité prouve QUI peut muter ; elle ne prouve pas que le run est encore
   * mutable. Un terminal peut rester actif après une coupure entre sa publication et
   * l'unlink, et un ancien manifeste v1 a pu être rendu terminal par le setter
   * historique. Dans les deux cas, C4.6 interdit toute nouvelle écriture de registre.
   *
   * Cette garde vit au point commun des mutateurs autoritaires, pas dans un dispatcher :
   * `appendLaneEvent`, `appendIntegrationEvent`, la migration et les mutateurs du
   * manifeste passent tous par `assertOwner`. Un nouvel appelant ne peut donc pas la
   * contourner en évitant `bin/subagent-recover`.
   */
  const courant = readManifest(dir);
  if (!courant || courant.runId !== lease.runId) {
    throw new RecoveryError(
      `${quoi} : le manifeste courant de ${lease.runId} est absent ou différent. ` +
        `L'état mutable n'est pas reconstructible ; aucune écriture n'est autorisée.`,
    );
  }
  if (courant.status === "completed" || courant.status === "abandoned") {
    throw new RecoveryError(
      `${quoi} : le run ${lease.runId} est terminal (${courant.status}) ; ` +
        `C4.6 interdit toute mutation de registre après terminaison.`,
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
/**
 * Révoque une capacité une seule fois.
 *
 * Le booléen désigne la transition : `true` pour le premier révocateur, `false` pour les
 * contrôleurs qui constatent ensuite la même perte. Il porte donc l'unicité du signal
 * sans ajouter un second drapeau susceptible de diverger de l'état de révocation.
 */
export function revoquerCapacite(lease: Lease): boolean {
  const cle = cleCapacite(lease);
  if (CAPACITES_REVOQUEES.has(cle)) return false;
  CAPACITES_REVOQUEES.add(cle);
  return true;
}

export function startHeartbeat(
  dir: string,
  lease: Lease,
  onLost?: (runId: string) => void,
  everyMs: number = LEASE_HEARTBEAT_MS,
): Heartbeat {
  /*
   * Un signal, une seule fois, et la capacité révoquée AVANT lui.
   *
   * L'ORDRE N'EST PAS COSMÉTIQUE. Signaler d'abord, c'est laisser le gestionnaire —
   * qui arrête des enfants, écrit un journal, remonte un refus — s'exécuter pendant que
   * la capacité mute encore. Révoquer d'abord ferme la fenêtre : ce qui suit le signal
   * ne peut plus rien écrire.
   *
   * Et le signal reste unique MÊME SI SON ÉCRITURE ÉCHOUE. L'intervalle est arrêté AVANT
   * l'appel, donc ce contrôleur ne réessaie pas ; entre plusieurs contrôleurs, la
   * transition de révocation choisit l'unique émetteur. Un drapeau `signale` séparé
   * créerait un second état susceptible de diverger de la révocation.
   */
  const timer = setInterval(() => {
    /*
     * Une panne de MAINTIEN n'est pas une preuve de possession. `heartbeatRun` lève sur
     * tout ce qui n'est pas ENOENT — un fichier de battement devenu répertoire, un
     * disque plein, une permission retirée. Laissée remonter, cette exception sort du
     * timer : sans gestionnaire, node meurt, et une session qui meurt n'a rien signalé
     * du tout.
     *
     * Ne pas savoir si on tient encore le bail, c'est ne plus le tenir.
     */
    let tenu: boolean;
    try {
      tenu = heartbeatRun(dir, lease);
    } catch {
      tenu = false;
    }
    if (tenu) return;

    clearInterval(timer);
    // Plusieurs contrôleurs peuvent observer la même perte. Tous s'arrêtent, mais seul
    // celui qui effectue la transition de révocation émet le signal.
    if (!revoquerCapacite(lease)) return;
    try {
      onLost?.(lease.runId);
    } catch {
      /* Le signal a eu lieu ; son écriture a échoué. Il ne se rejoue pas. */
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
