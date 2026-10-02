/**
 * injection.ts — LOT-EFFICACITÉ, E2 : le reviewer d'une revue initiale reçoit, au spawn, les
 * fichiers qu'il lit d'ordinaire (plan des leviers v2 complétée, § 3).
 *
 * Le constat (D4) : dans QD-RC-a et QD-RC-b, le reviewer lit 8 fichiers sur 6 tours, 1 ou 2 par
 * tour, et chaque tour relit tout le contexte — 324 433 et 281 889 tokens de lectures. Tous ces
 * fichiers étaient connus du runtime au spawn. Mais injecter toute l'union sur une petite revue
 * coûte plus qu'il ne rapporte (QD-P1b #06 et #08, gains D4 négatifs) : la règle ne s'applique
 * qu'à la revue INITIALE d'une unité, sous un budget.
 *
 * La règle — tout est connu au spawn, rien ne dépend de ce que le reviewer lira :
 *
 *   éligible   reviewer d'une unité dotée d'une lane ; paquet non dégradé ; aucun REVIEWED de
 *              l'unité au registre ; aucun `for_risks`
 *   candidats  1. les kept_consumers de l'unité ; 2. les fichiers du scope présents à T_L, sauf
 *              les nouveaux (le diff les montre déjà en entier) ; 3. les chemins suivis à T_L
 *              cités dans la tâche de l'orchestrateur (définition de D4). Dédupliqués par chemin,
 *              dans cet ordre de priorité ; à priorité égale, chemin croissant en octets UTF-8
 *   exclus     supprimé à T_L, généré, lien symbolique ou objet non ordinaire, contenu non
 *              représentable sans perte (octet nul, UTF-8 qui ne se relit pas à l'identique,
 *              délimiteur de fin dans le contenu), plus de 64 Kio, lecture impossible, budget
 *   budget     160 000 octets de contenus injectés ; un fichier qui le dépasserait est sauté et le
 *              suivant essayé ; aucun fichier n'est tronqué. Délimiteurs et instructions : surcoût
 *              distinct, publié
 *
 * La provenance (sémantique RC A) : `PI_SUBAGENT_INJECTED` = { run, planHash, unit, seq, tree,
 * files: [{ path, blob, size }] }, construite à partir des fichiers effectivement sérialisés dans
 * la tâche. L'enfant la capture à son initialisation, la valide contre sa délégation
 * (`PI_SUBAGENT_DELEGATION`) et contre le tree de son propre worktree, puis, au `submit`, compare
 * le blob Git des octets bruts lus à celui transmis — sans filtre Git ni normalisation.
 *
 * Fonctions pures, plus deux lecteurs git injectables : les preuves atteignent la production.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { recordGitInvocation } from "./git-probe-counter.ts";
import { inScope } from "./work-units.ts";

export const BUDGET_OCTETS = 160_000;
export const MAX_FICHIER_OCTETS = 64 * 1024;
const FIN = "</file>";

/** Le texte exact adjugé (correction 4), placé avant les fichiers. */
export const PHRASE_INJECTION =
  "These files are given whole, at the tree under review T_L. A read of the\n" +
  "corresponding unchanged file in this lane returns the same content.\n" +
  "A read outside the lane or after a file changes may return other content.";

/** Les fichiers générés, comme le paquet de revue les reconnaît (`GENERATED` d'index.ts). */
export const GENERES =
  /(^|\/)(uv\.lock|poetry\.lock|Cargo\.lock|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|go\.sum|composer\.lock|Gemfile\.lock)$|\.min\.(js|css)$|\.(snap|lock)$/i;

export type Categorie = "kept" | "scope" | "cite";

export interface EntreeArbre { mode: string; type: string; blob: string }

export interface Injecte { path: string; blob: string; size: number; categorie: Categorie; contenu: string }
export interface Exclu { path: string; categorie: Categorie; raison: string }

export interface Selection {
  injectes: Injecte[];
  exclus: Exclu[];
  octetsInjectes: number;
}

export interface Provenance {
  run: string;
  planHash: string;
  unit: string;
  seq: number;
  tree: string;
  files: { path: string; blob: string; size: number }[];
}

export interface Delegation { run: string; planHash: string; unit: string; seq: number }

const parOctets = (a: string, b: string) => Buffer.compare(Buffer.from(a, "utf-8"), Buffer.from(b, "utf-8"));

/** Éligibilité : connue au spawn, sans rien de ce que le reviewer lira. */
export function injectionEligible(e: {
  reviewer: boolean;
  lane: boolean;
  degrade: boolean;
  initiale: boolean;
  forRisks: number;
}): boolean {
  return e.reviewer && e.lane && !e.degrade && e.initiale && e.forRisks === 0;
}

/** Les chemins suivis à T_L cités dans la tâche, avec la frontière de D4. */
export function citesDansTache(tache: string, chemins: Iterable<string>): string[] {
  const cites: string[] = [];
  for (const p of chemins) {
    const motif = new RegExp(`(?<![\\w/.-])${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w/-])`);
    if (motif.test(tache)) cites.push(p);
  }
  return cites;
}

/**
 * Les candidats, dans l'ordre de priorité, dédupliqués par chemin. `arbre` : les entrées de T_L ;
 * `avant` : les chemins du tree de départ du diff (un chemin absent d'`avant` est nouveau).
 */
export function candidats(e: {
  kept: readonly string[];
  scope: readonly string[];
  arbre: ReadonlyMap<string, EntreeArbre>;
  avant: ReadonlySet<string>;
  tache: string;
}): { path: string; categorie: Categorie }[] {
  const vus = new Set<string>();
  const sortie: { path: string; categorie: Categorie }[] = [];
  const ajouter = (liste: string[], categorie: Categorie) => {
    for (const p of [...new Set(liste)].sort(parOctets)) {
      if (vus.has(p)) continue;
      vus.add(p);
      sortie.push({ path: p, categorie });
    }
  };
  ajouter([...e.kept], "kept");
  ajouter([...e.arbre.keys()].filter((p) => inScope(p, e.scope)), "scope");
  ajouter(citesDansTache(e.tache, e.arbre.keys()), "cite");
  return sortie;
}

/** Un contenu se transmet-il sans perte dans le texte de la tâche ? `null` : oui ; sinon la raison. */
export function nonRepresentable(octets: Buffer): string | null {
  if (octets.includes(0)) return "contenu binaire (octet nul)";
  const texte = octets.toString("utf-8");
  if (!Buffer.from(texte, "utf-8").equals(octets)) return "contenu non représentable sans perte (UTF-8)";
  if (texte.includes(FIN)) return `délimiteur ${FIN} dans le contenu`;
  return null;
}

/**
 * La sélection : exclusions, puis budget, dans l'ordre des candidats. `lire(blob)` rend les octets
 * du blob, ou lève.
 */
export function selectionner(
  liste: readonly { path: string; categorie: Categorie }[],
  arbre: ReadonlyMap<string, EntreeArbre>,
  avant: ReadonlySet<string>,
  lire: (blob: string) => Buffer,
  budget = BUDGET_OCTETS,
  maxFichier = MAX_FICHIER_OCTETS,
): Selection {
  const injectes: Injecte[] = [];
  const exclus: Exclu[] = [];
  let total = 0;
  for (const { path, categorie } of liste) {
    const exclure = (raison: string) => exclus.push({ path, categorie, raison });
    const e = arbre.get(path);
    if (!e) { exclure("absent de T_L (supprimé ou non suivi)"); continue; }
    if (categorie === "scope" && !avant.has(path)) { exclure("nouveau : déjà entier dans le diff"); continue; }
    if (GENERES.test(path)) { exclure("généré"); continue; }
    if (e.mode === "120000") { exclure("lien symbolique"); continue; }
    if (e.type !== "blob" || (e.mode !== "100644" && e.mode !== "100755")) { exclure(`objet non ordinaire (${e.mode} ${e.type})`); continue; }
    let octets: Buffer;
    try {
      octets = lire(e.blob);
    } catch (err) {
      exclure(`lecture impossible : ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
      continue;
    }
    if (octets.length > maxFichier) { exclure(`trop gros (${octets.length} octets > ${maxFichier})`); continue; }
    const perte = nonRepresentable(octets);
    if (perte) { exclure(perte); continue; }
    if (total + octets.length > budget) { exclure(`budget (${total} + ${octets.length} > ${budget} octets)`); continue; }
    total += octets.length;
    injectes.push({ path, blob: e.blob, size: octets.length, categorie, contenu: octets.toString("utf-8") });
  }
  return { injectes, exclus, octetsInjectes: total };
}

/** La section de la tâche : le texte adjugé, puis chaque fichier entier. */
export function sectionInjection(tree: string, injectes: readonly Injecte[]): string {
  if (injectes.length === 0) return "";
  const corps = injectes.map((f) => `<file path="${f.path}" blob="${f.blob}">\n${f.contenu}${f.contenu.endsWith("\n") ? "" : "\n"}${FIN}`);
  return `${PHRASE_INJECTION}\n(T_L: ${tree})\n\n${corps.join("\n\n")}\n\n`;
}

export function provenanceDe(d: Delegation, tree: string, injectes: readonly Injecte[]): Provenance {
  return { ...d, tree, files: injectes.map((f) => ({ path: f.path, blob: f.blob, size: f.size })) };
}

/**
 * LOT-EFFICACITÉ, E2 : l'environnement d'un enfant. Fusionner `process.env` et `plan.env` ne
 * suffisait pas : une variable omise de `plan.env` gardait sa valeur héritée. La provenance
 * d'injection et le contexte de délégation hérités du parent sont SUPPRIMÉS avant chaque spawn ;
 * seule la valeur construite pour ce spawn peut être transmise.
 */
export const VARIABLES_PAR_SPAWN = ["PI_SUBAGENT_INJECTED", "PI_SUBAGENT_DELEGATION"] as const;

export function environnementEnfant(
  herite: Readonly<Record<string, string | undefined>>,
  propre: Readonly<Record<string, string>>,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...herite };
  for (const v of VARIABLES_PAR_SPAWN) delete env[v];
  return { ...env, ...propre };
}

// ------------------------------------------------------------------ git, côté parent

/** Les entrées de T_L : `git ls-tree -r -z`. */
export function lireArbre(root: string, tree: string): Map<string, EntreeArbre> {
  recordGitInvocation();
  const sortie = execFileSync("git", ["ls-tree", "-r", "-z", "--full-tree", tree], {
    cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, timeout: 30_000,
  });
  const m = new Map<string, EntreeArbre>();
  for (const ligne of sortie.split("\0").filter(Boolean)) {
    const tab = ligne.indexOf("\t");
    const [mode, type, blob] = ligne.slice(0, tab).split(" ");
    m.set(ligne.slice(tab + 1), { mode, type, blob });
  }
  return m;
}

/** Les octets d'un blob, sans filtre ni conversion (`git cat-file blob`). */
export function lireBlob(root: string): (blob: string) => Buffer {
  return (blob) => {
    recordGitInvocation();
    return execFileSync("git", ["cat-file", "blob", blob], {
      cwd: root, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, timeout: 30_000,
    });
  };
}

// ------------------------------------------------------------------ côté enfant

/** Le blob Git des octets bruts : `<algo>("blob <taille>\0" + octets)`, sans filtre. */
export function blobDesOctets(octets: Buffer, longueurId: number): string {
  const algo = longueurId === 64 ? "sha256" : "sha1";
  return createHash(algo).update(Buffer.concat([Buffer.from(`blob ${octets.length}\0`), octets])).digest("hex");
}

export type InjectionLue =
  | { etat: "valide"; provenance: Provenance }
  | { etat: "absente" }
  | { etat: "invalide"; raison: string };

const chaine = (v: unknown): v is string => typeof v === "string" && v !== "";

/**
 * La provenance, capturée à l'initialisation de l'enfant et validée contre sa délégation et contre
 * le tree de son propre worktree. Absente : rien. Illisible ou étrangère : invalide — traitée
 * comme absente par RC (read exigé), jamais comme une inspection.
 */
export function lireInjection(
  brut: string | undefined,
  delegationBrute: string | undefined,
  treeCourant: () => string,
): InjectionLue {
  if (brut === undefined || brut === "") return { etat: "absente" };
  let p: Partial<Provenance>;
  let d: Partial<Delegation>;
  try {
    p = JSON.parse(brut) as Partial<Provenance>;
  } catch {
    return { etat: "invalide", raison: "provenance illisible" };
  }
  try {
    d = JSON.parse(delegationBrute ?? "") as Partial<Delegation>;
  } catch {
    return { etat: "invalide", raison: "délégation courante inconnue" };
  }
  if (!chaine(p.run) || !chaine(p.planHash) || !chaine(p.unit) || !Number.isInteger(p.seq) || !chaine(p.tree) ||
    !Array.isArray(p.files) || !p.files.every((f) => f && chaine(f.path) && chaine(f.blob) && Number.isInteger(f.size))) {
    return { etat: "invalide", raison: "provenance de forme invalide" };
  }
  if (p.run !== d.run || p.planHash !== d.planHash || p.unit !== d.unit || p.seq !== d.seq) {
    return { etat: "invalide", raison: "provenance d'une autre délégation, unité ou plan" };
  }
  let tree: string;
  try {
    tree = treeCourant();
  } catch (err) {
    return { etat: "invalide", raison: `tree du worktree inobservable : ${err instanceof Error ? err.message.split("\n")[0] : String(err)}` };
  }
  if (tree !== p.tree) return { etat: "invalide", raison: `provenance d'un autre tree (${p.tree.slice(0, 12)} ≠ ${tree.slice(0, 12)})` };
  return { etat: "valide", provenance: p as Provenance };
}

export interface Controle {
  path: string;
  attendu: string;
  lu: string | null;
  ok: boolean;
  erreur?: string;
}

/**
 * Au `submit` : pour un kept compté par injection, le chemin réel dans le cwd, les octets
 * effectivement lus, leur blob. Une erreur de résolution, de lecture ou de calcul n'est jamais une
 * inspection.
 */
export function controlerInjecte(
  path: string,
  attendu: string,
  resoudre: (p: string) => string | null,
  lireOctets: (reel: string) => Buffer = (reel) => readFileSync(reel),
): Controle {
  const reel = resoudre(path);
  if (reel === null) return { path, attendu, lu: null, ok: false, erreur: "chemin hors du worktree ou introuvable" };
  let octets: Buffer;
  try {
    octets = lireOctets(reel);
  } catch (err) {
    return { path, attendu, lu: null, ok: false, erreur: `lecture : ${err instanceof Error ? err.message.split("\n")[0] : String(err)}` };
  }
  let lu: string;
  try {
    lu = blobDesOctets(octets, attendu.length);
  } catch (err) {
    return { path, attendu, lu: null, ok: false, erreur: `blob : ${err instanceof Error ? err.message : String(err)}` };
  }
  return { path, attendu, lu, ok: lu === attendu };
}

/**
 * Le relevé (§ 6) : l'observation publiée au `submit` correspond-elle à ce que le runtime a
 * transmis à cette délégation ? Lu sur les seules pièces conservées, sans le worktree.
 */
export function verifierObservation(
  transmis: { injection?: { provenance?: Provenance } } | null,
  observation: { injection?: { etat?: string; provenance?: Partial<Provenance> }; controles?: Controle[] } | null,
): { ok: true } | { ok: false; raison: string } {
  if (!observation) return { ok: false, raison: "observation absente" };
  const prov = transmis?.injection?.provenance;
  const controles = observation.controles ?? [];
  if (!prov) {
    return controles.length === 0 ? { ok: true } : { ok: false, raison: "contrôles d'injection sans injection transmise" };
  }
  const vue = observation.injection?.provenance;
  if (observation.injection?.etat === "valide") {
    if (!vue || vue.run !== prov.run || vue.seq !== prov.seq || vue.unit !== prov.unit || vue.tree !== prov.tree || vue.planHash !== prov.planHash) {
      return { ok: false, raison: "provenance observée ≠ provenance transmise" };
    }
  }
  for (const c of controles) {
    const f = prov.files.find((x) => x.path === c.path);
    if (!f) return { ok: false, raison: `contrôle sur ${c.path}, absent de l'injection transmise` };
    if (c.attendu !== f.blob) return { ok: false, raison: `blob attendu de ${c.path} ≠ blob transmis` };
    if (c.ok !== (c.lu === c.attendu)) return { ok: false, raison: `contrôle de ${c.path} incohérent` };
  }
  return { ok: true };
}
