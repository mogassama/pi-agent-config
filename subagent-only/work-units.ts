/**
 * Le plan gelé, lu par le runtime plutôt que par le relevé.
 *
 * Jusqu'ici `<runId>-plan.json` n'était que de l'instrumentation : l'orchestrateur
 * l'écrivait, un script python le relisait après coup, et rien dans pi ne le
 * regardait. Il devient l'entrée du scheduler, donc sa validité conditionne une
 * exécution et plus seulement une mesure.
 *
 * Les règles sont celles de `validate_plan` dans `bin/subagent-shadow`, à
 * l'identique et pour la même raison : une faute sur `version`, un id, une
 * dépendance ou un scope peut falsifier la largeur du DAG, la couverture ou les
 * chevauchements. Aucune récupération partielle — un plan est exploitable
 * entier, ou il ne l'est pas.
 *
 * Cette duplication entre TypeScript et python est délibérée mais elle est une
 * dette : deux implémentations d'un même contrat dérivent. Les tests des deux
 * côtés couvrent la même liste de cas invalides, et c'est ce qui rendra la
 * dérive visible plutôt que silencieuse. Si le relevé et le runtime divergent un
 * jour sur ce qu'est un plan valide, c'est là qu'il faudra choisir une seule
 * source.
 */

export interface WorkUnit {
  id: string;
  goal: string | undefined;
  dependsOn: string[];
  expectedWriteScope: string[];
}

export type PlanStatus = "absent" | "invalid" | "usable";

export interface PlanResult {
  status: PlanStatus;
  reason: string;
  units: WorkUnit[];
  /**
   * Unités sans objectif énonçable. Avertissement, jamais une invalidité : le
   * champ ne nourrit aucun calcul, et l'avoir rendu structurel aurait supprimé
   * toute mesure d'un run de quatre-vingt-dix minutes pour une phrase mal
   * tournée. Ce qu'on ne peut pas juger sans lui, c'est si l'unité est un
   * changement cohérent — une question sur la décomposition, pas sur le graphe.
   */
  goalGaps: string[];
  /**
   * Unités ayant déclaré un chemin réservé dans leur scope. Signal sur la
   * qualité du plan, sans conséquence sur sa validité.
   */
  reservedDeclarations: Array<{ unit: string; path: string }>;
}

/**
 * Ce qu'une délégation ne possède jamais, quoi qu'elle déclare.
 *
 * `DESIGN.md` porte une ligne `Statut` que l'orchestrateur écrit lui-même après
 * chaque livrable — le run 15 le montre le faire vingt fois, jamais par un
 * worker. Une sonde de guideline a mesuré ce que vaut l'interdiction en prose :
 * énoncée en toutes lettres, elle a été respectée une fois sur trois, et les
 * deux plans désobéissants déclaraient le fichier dans huit et neuf unités.
 *
 * D'où trois comportements distincts et non un seul : le plan qui le déclare est
 * signalé sans être invalidé, l'ownership de lane l'exclut pour ne pas fabriquer
 * de collision entre deux unités qui n'en sont de toute façon pas
 * propriétaires, et une écriture réelle est une violation. Sans le troisième,
 * les deux premiers seraient dangereux : on déclarerait deux workers
 * indépendants tout en les laissant écrire au même endroit.
 */
export const RESERVED_WRITE_PATHS: readonly string[] = ["DESIGN.md"];

/**
 * Le plan lu depuis un texte. Un JSON illisible est **invalide**, pas absent.
 *
 * La première version enveloppait `JSON.parse` dans un `catch` qui retournait
 * `validatePlan(undefined)`, donc un plan corrompu devenait un plan qu'on n'a
 * jamais écrit. Les deux appellent des réponses opposées : l'absence est une
 * situation normale, la corruption est un défaut à corriger avant d'exécuter
 * quoi que ce soit. Le relevé python les distingue depuis le début.
 */
export function parsePlan(text: string | undefined): PlanResult {
  if (text === undefined) return validatePlan(undefined);
  try {
    return validatePlan(JSON.parse(text));
  } catch (err) {
    return {
      status: "invalid",
      reason: `not JSON: ${err instanceof Error ? err.message : String(err)}`,
      units: [],
      goalGaps: [],
      reservedDeclarations: [],
    };
  }
}

export function validatePlan(doc: unknown): PlanResult {
  const empty: PlanResult = {
    status: "absent",
    reason: "",
    units: [],
    goalGaps: [],
    reservedDeclarations: [],
  };
  if (doc === undefined || doc === null) {
    return { ...empty, reason: "no plan was written" };
  }
  if (typeof doc !== "object" || Array.isArray(doc)) {
    return { ...empty, status: "invalid", reason: "top level is not an object" };
  }
  const plan = doc as Record<string, unknown>;
  if (plan.version !== 1) {
    return {
      ...empty,
      status: "invalid",
      reason: `version is ${JSON.stringify(plan.version)}, expected 1`,
    };
  }
  const raw = plan.work_units;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ...empty, status: "invalid", reason: "work_units is missing or empty" };
  }

  const problems: string[] = [];
  const units: WorkUnit[] = [];
  const ids: string[] = [];

  raw.forEach((entry, i) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      problems.push(`unit ${i} is not an object`);
      return;
    }
    const u = entry as Record<string, unknown>;
    const id = typeof u.id === "string" ? u.id.trim() : "";
    if (!id) {
      problems.push(`unit ${i} has no usable id`);
      return;
    }
    if (ids.includes(id)) {
      problems.push(`${id}: duplicate id`);
      return;
    }
    const deps = strings(u.depends_on);
    if (deps === undefined) problems.push(`${id}: depends_on is not a list of ids`);
    const scope = strings(u.expected_write_scope);
    if (scope === undefined || scope.length === 0) {
      problems.push(`${id}: expected_write_scope is not a non-empty list of paths`);
    }
    if ((deps ?? []).includes(id)) problems.push(`${id}: depends on itself`);
    /*
     * Le langage de scope est petit et le reste : littéral, répertoire, `.`,
     * `*`, `?`, `**`. Une classe de caractères n'apporte presque rien aux plans
     * que pi produit et doublerait la surface des deux matchers.
     *
     * Le pire comportement serait de la laisser passer la validation puis de ne
     * jamais correspondre : un scope qui a l'air de couvrir un fichier et ne le
     * couvre pas est une fausse déclaration d'ownership.
     */
    for (const pat of scope ?? []) {
      if (/[[\]]/.test(pat)) {
        problems.push(`${id}: unsupported scope pattern syntax in ${pat}`);
      }
    }
    ids.push(id);
    units.push({
      id,
      goal: typeof u.goal === "string" ? u.goal : undefined,
      dependsOn: deps ?? [],
      expectedWriteScope: scope ?? [],
    });
  });

  for (const u of units) {
    for (const d of u.dependsOn) {
      if (!ids.includes(d)) problems.push(`${u.id}: depends on ${d}, which the plan does not define`);
    }
  }
  if (problems.length === 0) {
    const cyclic = cycles(units);
    if (cyclic.length > 0) problems.push(`dependency cycle among ${cyclic.join(", ")}`);
  }
  if (problems.length > 0) {
    return { ...empty, status: "invalid", reason: problems.join("; ") };
  }

  const reservedDeclarations: Array<{ unit: string; path: string }> = [];
  for (const u of units) {
    for (const p of u.expectedWriteScope) {
      if (isReserved(p)) reservedDeclarations.push({ unit: u.id, path: p });
    }
  }

  return {
    status: "usable",
    reason: "",
    units,
    goalGaps: units.filter((u) => !u.goal || !u.goal.trim()).map((u) => u.id),
    reservedDeclarations,
  };
}

function strings(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  if (v.some((x) => typeof x !== "string" || x.trim() === "")) return undefined;
  return v.map((x) => (x as string).trim());
}

/** Ids qui ne peuvent pas être étagés : dans un cycle, ou derrière un cycle. */
export function cycles(units: readonly WorkUnit[]): string[] {
  const known = new Set(units.map((u) => u.id));
  const deps = new Map(units.map((u) => [u.id, u.dependsOn.filter((d) => known.has(d))]));
  const settled = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, ds] of deps) {
      if (settled.has(id)) continue;
      if (ds.every((d) => settled.has(d))) {
        settled.add(id);
        changed = true;
      }
    }
  }
  return [...deps.keys()].filter((id) => !settled.has(id)).sort();
}

/** Un chemin réservé, ou un chemin sous un répertoire réservé. */
export function isReserved(path: string): boolean {
  const p = path.replace(/^\.\//, "");
  return RESERVED_WRITE_PATHS.some((r) => p === r || p.startsWith(`${r.replace(/\/$/, "")}/`));
}

/*
 * `scopeOwned()` vivait ici et est reporté au lot 3, où l'admission sera son
 * premier consommateur.
 *
 * Deux raisons. Aucune fonction ne doit vivre sans appelant — c'est la règle qui
 * avait écarté `summarize()` du registre. Et surtout sa sémantique était trop
 * simple : retirer les chemins réservés par égalité littérale traite `DESIGN.md`
 * mais pas `*.md`, `**` ou `.`, qui le couvrent tout autant. La soustraction
 * `scope − réservé` demande la même sémantique de motifs que l'admission, et
 * figer maintenant une API dont le seul cas testé est le cas littéral aurait
 * fabriqué une fausse sécurité.
 */

/**
 * Un fichier tombe-t-il dans un scope déclaré ?
 *
 * Exact, glob, ou sous un répertoire déclaré. Miroir de `in_scope` dans
 * `bin/subagent-shadow` — la même dette de duplication que le contrat de plan,
 * et le même remède : les deux côtés sont éprouvés sur les mêmes entrées.
 *
 * C'est volontairement la question étroite « ce fichier était-il prévu », et
 * non la soustraction `scope − réservé` que l'ownership demandera au lot 3.
 * Celle-là a besoin d'une sémantique de motifs que le seul cas littéral ne
 * couvre pas, et la figer maintenant fabriquerait une fausse sécurité.
 */
export function inScope(path: string, patterns: readonly string[]): boolean {
  const file = norm(path);
  return patterns.some((raw) => {
    const p = norm(raw).replace(/\/$/, "");
    // `.` désigne la racine du dépôt, donc tout. Les deux implémentations le
    // refusaient, d'un commun accord et à tort : la parité ne dit rien de la
    // justesse, et un scope `.` est un scope large — inutile pour paralléliser,
    // mais parfaitement satisfait par n'importe quel fichier.
    if (p === "" || p === ".") return true;
    if (file === p) return true;
    if (file.startsWith(`${p}/`)) return true;
    return globMatch(file, norm(raw));
  });
}

/** `./src/a.py` et `src/a.py` sont le même fichier. */
function norm(path: string): string {
  return path.replace(/^\.\//, "");
}

/** fnmatch, réduit à ce que les scopes utilisent : `*`, `?`, `**`. */
function globMatch(path: string, pattern: string): boolean {
  const rx = pattern
    .split("")
    .map((c) => {
      if (c === "*") return "\u0000";
      if (c === "?") return ".";
      return /[.+^${}()|[\]\\]/.test(c) ? `\\${c}` : c;
    })
    .join("")
    .replace(/\u0000\u0000/g, ".*")
    .replace(/\u0000/g, "[^/]*");
  try {
    return new RegExp(`^${rx}$`).test(path);
  } catch {
    return false;
  }
}

/**
 * Ce qu'une lane possède : son scope déclaré, moins le réservé.
 *
 * Reporté depuis le lot 1, où il n'avait aucun consommateur et où sa sémantique
 * littérale ne traitait ni `*.md`, ni `**`, ni `.`. L'admission en est le
 * premier consommateur réel, et la comparaison de motifs existe maintenant.
 *
 * Retirer plutôt qu'interdire : deux unités déclarant `DESIGN.md` ne se
 * disputent rien, aucune des deux n'en est propriétaire. Les compter en
 * collision ferait attendre une lane sur une ressource sans propriétaire.
 */
export function ownedScope(unit: WorkUnit): string[] {
  return unit.expectedWriteScope.filter((p) => !isReserved(p));
}

/** Le préfixe littéral d'un motif, c'est-à-dire ce qui précède son premier joker. */
function literalPrefix(pattern: string): string {
  const at = [...pattern].findIndex((c) => c === "*" || c === "?");
  return at === -1 ? pattern : pattern.slice(0, at);
}

/**
 * Deux déclarations peuvent-elles nommer un fichier commun ?
 *
 * Conservative : elle répond oui dès qu'un doute existe. Sur-signaler fait
 * attendre une lane ; sous-signaler laisse deux écrivains dans le même fichier,
 * et la seconde erreur est celle que les worktrees ne rattrapent pas.
 *
 * Un motif ouvrant sur un joker a un préfixe littéral vide, ce qui veut dire
 * « aucune contrainte » et non « aucun terrain commun ». La confusion inverse
 * avait fait déclarer disjoints un motif commençant par une étoile et un motif
 * commençant par un répertoire, alors qu'un même fichier satisfait les deux.
 * Miroir de `patterns_overlap` dans le relevé, éprouvé sur le même corpus.
 */
export function patternsOverlap(a: string, b: string): boolean {
  const x = a.replace(/^\.\//, "").replace(/\/$/, "");
  const y = b.replace(/^\.\//, "").replace(/\/$/, "");
  if (x === y) return true;
  if (x === "" || x === "." || y === "" || y === ".") return true;
  if (inScope(x, [y]) || inScope(y, [x])) return true;
  if (x.startsWith(`${y}/`) || y.startsWith(`${x}/`)) return true;
  const px = literalPrefix(x);
  const py = literalPrefix(y);
  if (px !== x || py !== y) {
    if (!px || !py) return true;
    return px.startsWith(py) || py.startsWith(px);
  }
  return false;
}

/** Deux unités peuvent-elles écrire en même temps sans se marcher dessus ? */
export function scopesCollide(a: WorkUnit, b: WorkUnit): boolean {
  const owned = ownedScope(b);
  return ownedScope(a).some((p) => owned.some((q) => patternsOverlap(p, q)));
}

/**
 * Les fichiers qu'une délégation a écrits hors de ce que son unité déclarait.
 *
 * Constaté, jamais empêché. Le run 15 a mesuré 6 dépassements sur 46 écritures,
 * donc tuer une délégation sur une prédiction imparfaite confondrait une erreur
 * de planning avec une erreur de code. Mais le dépassement rend la lane non
 * intégrable : le worktree empêche la corruption immédiate, la porte de merge
 * empêche d'intégrer une hypothèse devenue fausse.
 */
export function scopeBreach(
  unit: WorkUnit | undefined,
  changedFiles: readonly string[],
): string[] {
  if (!unit) return [];
  return changedFiles.filter((f) => !isReserved(f) && !inScope(f, unit.expectedWriteScope));
}

/**
 * Les chemins réservés qu'une délégation a réellement écrits.
 *
 * Constaté après coup sur `changed_files`, pas empêché à l'écriture : le
 * runtime n'intercepte pas les écritures d'un processus enfant. C'est une
 * observation, et c'est ce qui la rend fiable — elle porte sur ce qui est sur le
 * disque, pas sur ce qui a été déclaré.
 */
export function reservedTouched(changedFiles: readonly string[]): string[] {
  return changedFiles.filter(isReserved);
}
