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
