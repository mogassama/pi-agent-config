/**
 * consommateurs.ts — LOT-REPRISES, R1-a : le validateur pré-gel des consommateurs Python.
 *
 * Le constat (QD-P1a, QD-P1b) : le plan déclarait quatre chemins écrits, suffisants — QD et
 * QD-P0 l'ont montré —, mais silencieux sur les fichiers qui importent le code déplacé. Les
 * deux premiers workers ont modifié `run.py`, `entries.py` et `test_config.py`, la porte
 * `scope-breach` a refusé l'intégration, et chaque reprise a rejoué un worker complet.
 *
 * Ce module dit, avant le gel, quels fichiers Python suivis importent statiquement un module
 * que l'unité va écrire (`direct_static_consumers`), et exige que le plan classe chacun : dans
 * `expected_write_scope` (l'unité le modifie) ou dans `kept_consumers` (l'unité le laisse
 * intact et préserve l'interface qu'il consomme). Un consommateur non classé refuse le plan ;
 * le refus porte la liste, l'orchestrateur n'a rien à chercher.
 *
 * Ce qu'il couvre, exactement (PLAN-LOT-REPRISES v2 gelé, § 2 et Q2) :
 *   - les nœuds `Import` et `ImportFrom` de l'`ast` Python, à tout niveau du fichier ;
 *   - les formes absolues internes au dépôt et les formes relatives, résolues par l'arbre
 *     (un module se nomme en remontant tant que le répertoire porte un `__init__.py` suivi).
 * Ce qu'il ne couvre pas, et ne prétend jamais couvrir : les imports dynamiques
 * (`importlib`, `__import__`), les réexportations indirectes, et tout chemin non Python.
 *
 * L'interpréteur (Q6) : le `python3` du `PATH`, résolu une fois par tentative, puis cette même
 * identité — exécutable effectif et version — pour toute l'analyse. Absent, inexécutable, ou
 * refusant un fichier : `PLAN_PYTHON_ANALYSIS_IMPOSSIBLE`, sans repli ni « non couvert ».
 *
 * Les fonctions pures (nommage des modules, résolution, classement) sont séparées de l'appel à
 * git et à python pour que les preuves atteignent la production au lieu d'une copie.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { recordGitInvocation } from "./git-probe-counter.ts";
import { inScope, isReserved, type WorkUnit } from "./work-units.ts";

export const PLAN_NON_CLASSES = "PLAN_DIRECT_STATIC_CONSUMERS_UNCLASSIFIED";
export const PLAN_ANALYSE_IMPOSSIBLE = "PLAN_PYTHON_ANALYSIS_IMPOSSIBLE";
export const PLAN_KEPT_INVALIDE = "PLAN_KEPT_CONSUMERS_INVALID";

export interface Interpreteur {
  executable?: string;
  version?: string;
}

export type RefusPlan =
  | { code: typeof PLAN_NON_CLASSES; missing: Record<string, string[]> }
  | { code: typeof PLAN_ANALYSE_IMPOSSIBLE; interpreter?: Interpreteur; file?: string; reason: string }
  | { code: typeof PLAN_KEPT_INVALIDE; unit: string; path?: string; reason: string };

export type VerdictConsommateurs =
  | {
      ok: true;
      /** Par unité, ses consommateurs statiques directs (classés). */
      consumers: Record<string, string[]>;
      /** Par unité, ses `kept_consumers` validés. */
      kept: Record<string, string[]>;
      interpreter?: Interpreteur;
    }
  | { ok: false; refus: RefusPlan; reason: string };

/** Un nœud d'import tel que l'`ast` le donne, sans interprétation. */
export type NoeudImport =
  | { kind: "import"; module: string }
  | { kind: "from"; module: string | null; level: number; names: string[] };

// ------------------------------------------------------------------ fonctions pures

/**
 * Le nom de module d'un fichier `.py` suivi, ou `undefined`.
 *
 * On remonte tant que le répertoire porte un `__init__.py` suivi : `src/pkg/io.py` avec
 * `src/pkg/__init__.py` et sans `src/__init__.py` se nomme `pkg.io`. Un `__init__.py` nomme
 * son paquet.
 */
export function nomDeModule(fichier: string, suivis: ReadonlySet<string>): { module: string; paquet: boolean } | undefined {
  if (!fichier.endsWith(".py")) return undefined;
  const parties = fichier.split("/");
  const base = parties.pop()!.slice(0, -3);
  const paquets: string[] = [];
  let i = parties.length;
  while (i > 0 && suivis.has([...parties.slice(0, i), "__init__.py"].join("/"))) {
    paquets.unshift(parties[i - 1]);
    i -= 1;
  }
  const paquet = base === "__init__";
  const module = paquet ? paquets.join(".") : [...paquets, base].join(".");
  if (module === "") return undefined;
  return { module, paquet };
}

/** Un module et tous ses parents : importer `a.b.c` exécute `a` et `a.b`. */
function avecParents(module: string): string[] {
  const p = module.split(".");
  return p.map((_, i) => p.slice(0, i + 1).join("."));
}

/**
 * Les noms de modules qu'un fichier atteint statiquement par ses imports.
 *
 * Conservateur : `from X import n` compte `X`, ses parents, et `X.n` au cas où `n` serait un
 * sous-module. Un import relatif qui remonte au-delà du paquet n'est pas résolu.
 */
export function modulesAtteints(
  importeur: { module: string; paquet: boolean },
  noeuds: readonly NoeudImport[],
): string[] {
  const vus = new Set<string>();
  const ajouter = (m: string) => { for (const x of avecParents(m)) vus.add(x); };
  for (const n of noeuds) {
    if (n.kind === "import") {
      if (n.module) ajouter(n.module);
      continue;
    }
    let cible: string[];
    if (n.level === 0) {
      if (!n.module) continue;
      cible = n.module.split(".");
    } else {
      const base = importeur.module.split(".");
      const paquet = importeur.paquet ? base : base.slice(0, -1);
      const remonte = n.level - 1;
      if (remonte > paquet.length || (paquet.length - remonte === 0 && !n.module)) continue;
      cible = [...paquet.slice(0, paquet.length - remonte), ...(n.module ? n.module.split(".") : [])];
      if (cible.length === 0) continue;
    }
    const m = cible.join(".");
    ajouter(m);
    for (const nom of n.names) if (nom !== "*") vus.add(`${m}.${nom}`);
  }
  return [...vus];
}

/**
 * `direct_static_consumers` de chaque unité : les fichiers `.py` suivis, hors de son scope, dont
 * un import atteint un module `.py` suivi de son scope.
 */
export function consommateursDirects(
  unites: readonly WorkUnit[],
  suivis: readonly string[],
  imports: Readonly<Record<string, readonly NoeudImport[]>>,
): Record<string, string[]> {
  const ensemble = new Set(suivis);
  const parModule = new Map<string, string[]>();
  const noms = new Map<string, { module: string; paquet: boolean }>();
  for (const f of suivis) {
    const n = nomDeModule(f, ensemble);
    if (!n) continue;
    noms.set(f, n);
    parModule.set(n.module, [...(parModule.get(n.module) ?? []), f]);
  }
  const atteints = new Map<string, Set<string>>();
  for (const [f, n] of noms) {
    const fichiers = new Set<string>();
    for (const m of modulesAtteints(n, imports[f] ?? [])) {
      for (const g of parModule.get(m) ?? []) if (g !== f) fichiers.add(g);
    }
    atteints.set(f, fichiers);
  }
  const resultat: Record<string, string[]> = {};
  for (const u of unites) {
    const cibles = new Set(suivis.filter((f) => f.endsWith(".py") && inScope(f, u.expectedWriteScope)));
    const conso: string[] = [];
    if (cibles.size > 0) {
      for (const [f, vers] of atteints) {
        if (inScope(f, u.expectedWriteScope)) continue;
        if ([...vers].some((g) => cibles.has(g))) conso.push(f);
      }
    }
    resultat[u.id] = conso.sort();
  }
  return resultat;
}

/** Les modules `.py` suivis qu'au moins une unité va écrire : sans eux, aucune analyse. */
export function ciblesPython(unites: readonly WorkUnit[], suivis: readonly string[]): string[] {
  return suivis.filter((f) => f.endsWith(".py") && unites.some((u) => inScope(f, u.expectedWriteScope)));
}

/** `kept_consumers` d'une unité, lu dans le document brut du plan. `undefined` : absent. */
export function keptBrut(doc: unknown, unite: string): { present: boolean; valeur: unknown } {
  const unites = (doc as { work_units?: unknown } | null | undefined)?.work_units;
  if (!Array.isArray(unites)) return { present: false, valeur: undefined };
  for (const u of unites) {
    if (typeof u !== "object" || u === null || Array.isArray(u)) continue;
    const id = (u as { id?: unknown }).id;
    if (typeof id !== "string" || id.trim() !== unite) continue;
    return "kept_consumers" in u
      ? { present: true, valeur: (u as { kept_consumers: unknown }).kept_consumers }
      : { present: false, valeur: undefined };
  }
  return { present: false, valeur: undefined };
}

/**
 * Le classement : chaque `kept_consumers` est valide, puis chaque consommateur est classé.
 *
 * `kept_consumers` : liste de chemins suivis existants, disjoints du scope, jamais réservés ;
 * une entrée Python doit avoir été trouvée par l'analyse. Il n'accorde aucun droit d'écriture.
 */
export function classer(
  doc: unknown,
  unites: readonly WorkUnit[],
  suivis: readonly string[],
  existe: (chemin: string) => boolean,
  consumers: Readonly<Record<string, readonly string[]>>,
): { ok: true; kept: Record<string, string[]> } | { ok: false; refus: RefusPlan; reason: string } {
  const ensemble = new Set(suivis);
  const kept: Record<string, string[]> = {};
  for (const u of unites) {
    const brut = keptBrut(doc, u.id);
    const refus = (path: string | undefined, reason: string) => ({
      ok: false as const,
      refus: { code: PLAN_KEPT_INVALIDE, unit: u.id, ...(path !== undefined ? { path } : {}), reason } as RefusPlan,
      reason: `${u.id} : kept_consumers — ${reason}`,
    });
    if (!brut.present) { kept[u.id] = []; continue; }
    if (!Array.isArray(brut.valeur) || brut.valeur.some((p) => typeof p !== "string" || p.trim() === "")) {
      return refus(undefined, "n'est pas une liste de chemins");
    }
    const liste = (brut.valeur as string[]).map((p) => p.trim().replace(/^\.\//, ""));
    for (const p of liste) {
      if (isReserved(p)) return refus(p, `${p} est un chemin réservé`);
      if (inScope(p, u.expectedWriteScope)) return refus(p, `${p} est aussi dans expected_write_scope`);
      if (!ensemble.has(p) || !existe(p)) return refus(p, `${p} n'est pas un chemin suivi existant`);
      if (p.endsWith(".py") && !(consumers[u.id] ?? []).includes(p)) {
        return refus(p, `${p} n'est pas un consommateur statique direct trouvé par l'analyse`);
      }
    }
    kept[u.id] = liste;
  }
  const missing: Record<string, string[]> = {};
  for (const u of unites) {
    const manque = (consumers[u.id] ?? []).filter((c) => !kept[u.id].includes(c));
    if (manque.length > 0) missing[u.id] = manque;
  }
  if (Object.keys(missing).length > 0) {
    const detail = Object.entries(missing).map(([u, l]) => `${u} : ${l.join(", ")}`).join(" ; ");
    return {
      ok: false,
      refus: { code: PLAN_NON_CLASSES, missing },
      reason:
        `consommateurs statiques directs non classés — ${detail}. Chacun va dans expected_write_scope ` +
        `(l'unité le modifie) ou dans kept_consumers (intact, interface préservée).`,
    };
  }
  return { ok: true, kept };
}

// ------------------------------------------------------------------ git et python

/**
 * Ce que l'interpréteur exécute : lire les fichiers donnés, les passer à `ast.parse`, rendre
 * les nœuds d'import. Le premier fichier refusé arrête tout et est nommé.
 */
const SCRIPT = String.raw`
import ast, json, sys
data = json.load(sys.stdin)
out = {}
for f in data["files"]:
    try:
        with open(data["root"] + "/" + f, "rb") as h:
            tree = ast.parse(h.read(), filename=f)
    except SyntaxError as e:
        print(json.dumps({"ok": False, "file": f, "reason": "SyntaxError: %s (ligne %s)" % (e.msg, e.lineno)}))
        sys.exit(0)
    except Exception as e:
        print(json.dumps({"ok": False, "file": f, "reason": "%s: %s" % (type(e).__name__, e)}))
        sys.exit(0)
    nodes = []
    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            for a in n.names:
                nodes.append({"kind": "import", "module": a.name})
        elif isinstance(n, ast.ImportFrom):
            nodes.append({"kind": "from", "module": n.module, "level": n.level or 0, "names": [a.name for a in n.names]})
    out[f] = nodes
print(json.dumps({"ok": True, "imports": out}))
`;

export interface Executeur {
  /** `git ls-files -z` dans `root`. */
  suivis(root: string): string[];
  /** Résout `python3` une fois : son exécutable effectif et sa version. */
  interpreteur(): Interpreteur;
  /** Exécute le script avec CET exécutable. */
  analyser(executable: string, root: string, fichiers: readonly string[]): string;
}

export const EXECUTEUR_REEL: Executeur = {
  suivis(root) {
    recordGitInvocation();
    const sortie = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
    return sortie.split("\0").filter(Boolean);
  },
  interpreteur() {
    const sortie = execFileSync(
      "python3",
      ["-c", "import json, sys; print(json.dumps([sys.executable, sys.version.split()[0]]))"],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 },
    );
    const [executable, version] = JSON.parse(sortie.trim()) as [string, string];
    return { executable: executable || undefined, version: version || undefined };
  },
  analyser(executable, root, fichiers) {
    return execFileSync(executable, ["-c", SCRIPT], {
      input: JSON.stringify({ root, files: fichiers }),
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120_000,
    });
  },
};

const message = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0] : String(e));

/**
 * R1-a, une tentative de validation : suivis, interpréteur résolu une fois, analyse, classement.
 *
 * Aucune unité n'écrit de `.py` suivi : aucun interpréteur n'est requis, et une entrée Python
 * de `kept_consumers` ne peut pas avoir été trouvée — elle est refusée par `classer`.
 */
export function validerConsommateurs(
  root: string,
  doc: unknown,
  unites: readonly WorkUnit[],
  executeur: Executeur = EXECUTEUR_REEL,
): VerdictConsommateurs {
  let suivis: string[];
  try {
    suivis = executeur.suivis(root);
  } catch (e) {
    return {
      ok: false,
      refus: { code: PLAN_ANALYSE_IMPOSSIBLE, reason: `git ls-files impossible : ${message(e)}` },
      reason: `analyse des consommateurs impossible : git ls-files — ${message(e)}`,
    };
  }
  const existe = (p: string) => existsSync(join(root, p));
  let consumers: Record<string, string[]> = Object.fromEntries(unites.map((u) => [u.id, [] as string[]]));
  let interpreter: Interpreteur | undefined;

  if (ciblesPython(unites, suivis).length > 0) {
    const impossible = (reason: string, file?: string): VerdictConsommateurs => ({
      ok: false,
      refus: {
        code: PLAN_ANALYSE_IMPOSSIBLE,
        ...(interpreter ? { interpreter } : {}),
        ...(file !== undefined ? { file } : {}),
        reason,
      },
      reason:
        `analyse Python impossible${file ? ` sur ${file}` : ""} : ${reason}` +
        (interpreter ? ` (interpréteur ${interpreter.executable ?? "?"} ${interpreter.version ?? "?"})` : ""),
    });
    try {
      interpreter = executeur.interpreteur();
    } catch (e) {
      return impossible(`python3 absent ou inexécutable dans le PATH : ${message(e)}`);
    }
    if (!interpreter.executable) return impossible("python3 n'a pas rendu son exécutable effectif");
    const fichiers = suivis.filter((f) => f.endsWith(".py"));
    let brut: string;
    try {
      brut = executeur.analyser(interpreter.executable, root, fichiers);
    } catch (e) {
      return impossible(`exécution de l'analyse : ${message(e)}`);
    }
    let rendu: { ok?: unknown; file?: unknown; reason?: unknown; imports?: unknown };
    try {
      rendu = JSON.parse(brut.trim().split("\n").pop() ?? "");
    } catch {
      return impossible("sortie de l'analyse illisible");
    }
    if (rendu.ok !== true) {
      return impossible(
        typeof rendu.reason === "string" ? rendu.reason : "refus sans raison",
        typeof rendu.file === "string" ? rendu.file : undefined,
      );
    }
    if (typeof rendu.imports !== "object" || rendu.imports === null) return impossible("analyse sans imports");
    consumers = consommateursDirects(unites, suivis, rendu.imports as Record<string, NoeudImport[]>);
  }

  const classement = classer(doc, unites, suivis, existe, consumers);
  if (!classement.ok) return classement;
  return { ok: true, consumers, kept: classement.kept, ...(interpreter ? { interpreter } : {}) };
}
