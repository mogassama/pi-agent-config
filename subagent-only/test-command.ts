/**
 * test-command — la commande de test établie dans un run (lot ITE, P1-A ; plan P1 v2 gelé, `fbf65045`).
 *
 * Le constat, mesuré sur QD-P0 (`ec276ba9`) : W#3 a passé six tours à retrouver l'invocation des tests
 * que W#1 avait établie trois délégations plus tôt ; sur QD, chaque worker de reprise y a passé deux à
 * trois tours. Chaque tour relit tout le contexte accumulé : quarante mille tokens par tâtonnement.
 *
 * La valeur est dérivée de l'EXÉCUTION observée dans la transcription de l'enfant — l'appel `bash`
 * apparié à sa fin par `toolCallId` —, jamais d'un champ que le modèle remplit. Et elle n'est portée
 * que si trois choses sont établies (adjudication de Sol, 29-09) :
 *
 *   succès réel     l'appel est sorti sans erreur ET sa sortie montre le résumé de succès de
 *                   l'exécuteur reconnu, sans échec ni erreur comptés ;
 *   rien de masqué  aucun opérateur de premier niveau ne peut rendre 0 sur un échec : ni `;`, ni
 *                   saut de ligne, ni `||`, ni tube, ni arrière-plan, ni sous-shell, ni `set +e`.
 *                   Seul `&&` chaîne, et une substitution `$( … )` n'affecte que sa variable ;
 *   rien de caduc   la commande ne nomme aucun chemin de lane ni de contexte d'intégration : ces
 *                   répertoires appartiennent à une délégation et disparaissent avec elle ;
 *   lancé pour de vrai  l'exécuteur est la commande même du DERNIER segment — après les affectations
 *                   d'environnement, `env`, un lanceur (`uv run`, `poetry run`…) ou un interpréteur
 *                   `python -m pytest` —, pas un mot quelconque de la ligne : `echo '… passed …' # pytest`
 *                   ne prouve aucune exécution (adjudication P1, Q1). Un commentaire de premier niveau
 *                   est retiré avant l'analyse ; s'il est suivi d'un saut de ligne, la commande est
 *                   refusée : ce qui suit s'exécute et peut afficher un faux résumé (adjudication P1b).
 *
 * Et la portée (même adjudication) : une commande n'est « complète » que si sa portée est établie — un
 * sélecteur (`-k`, `-m`, `--lf`, `--deselect`, `-run`, `-t`, `-Dtest=`…), une cible nommée ou un
 * résumé qui compte des tests désélectionnés la rendent « partielle » ; une option inconnue la laisse
 * « indéterminée ». Une indéterminée ne supplante pas une complète établie, une partielle ne supplante
 * ni l'une ni l'autre.
 *
 * Dans le doute, rien : une note absente coûte des tours, une note fausse enverrait un worker sur une
 * commande qui ne prouve rien. Une transcription illisible, ou un journal dont une ligne ne se lit
 * pas, ne produit rien.
 *
 * Pur : ni pi, ni git. Le câblage est dans `extensions/subagent/index.ts`.
 */
import { readFileSync } from "node:fs";

/** La phrase ajoutée à la tâche des writers suivants du même run (plan P1 v2 §2, P1-A). */
export const NOTE_COMMANDE_DE_TEST = "Commande de test établie dans ce run : ";

/** Au-delà, ce n'est plus une invocation qu'on recopie : c'est un script. */
const LONGUEUR_MAX = 500;

export type Portee = "complete" | "partielle" | "indeterminee";

interface Executeur {
  nom: string;
  /** Le résumé de succès, exigé dans la sortie. */
  succes: RegExp;
  /** Ce qui annule le succès, même en présence du résumé. */
  echec: RegExp;
}

const PYTEST_RESUME = /^=+ (.*) in [\d.]+s(?: \([^)]*\))? =+\s*$/m;

const EXECUTEURS: readonly Executeur[] = [
  {
    nom: "pytest",
    succes: PYTEST_RESUME,
    echec: /\b\d+ (failed|errors?)\b|no tests ran|Interrupted/,
  },
  { nom: "go", succes: /^ok\s/m, echec: /^(FAIL|--- FAIL|panic:)/m },
  { nom: "cargo", succes: /test result: ok\./, echec: /test result: FAILED|error(\[|:)/ },
  {
    nom: "js",
    succes: /Tests?:?\s+.*\b\d+ passed\b/,
    echec: /\b\d+ failed\b/,
  },
  {
    nom: "jvm",
    succes: /BUILD SUCCESS(FUL)?/,
    echec: /BUILD FAIL(URE|ED)|Tests in error|FAILED/,
  },
];

/**
 * Découpe au premier niveau : ce qui n'est ni entre guillemets, ni dans une substitution `$( … )`.
 * Rend les segments séparés par `&&`, ou `null` si la commande porte un opérateur qui pourrait
 * masquer un échec, ou une construction que ce lecteur ne sait pas trancher (accent grave,
 * guillemet non fermé, sous-shell nu).
 */
export function segmentsDePremierNiveau(cmd: string): string[] | null {
  type Contexte = "haut" | "simple" | "double" | "substitution" | "parenthese";
  const pile: Contexte[] = ["haut"];
  const segments: string[] = [];
  let courant = "";
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    const suivant = cmd[i + 1];
    const ici = pile[pile.length - 1];
    if (ici === "simple") {
      if (c === "'") pile.pop();
      courant += c;
      continue;
    }
    if (c === "\\") {
      courant += c + (suivant ?? "");
      i++;
      continue;
    }
    if (c === "`") return null;
    if (c === "$" && suivant === "(") {
      pile.push("substitution");
      courant += "$(";
      i++;
      continue;
    }
    if (ici === "double") {
      if (c === '"') pile.pop();
      courant += c;
      continue;
    }
    if (c === "'") {
      pile.push("simple");
      courant += c;
      continue;
    }
    if (c === '"') {
      pile.push("double");
      courant += c;
      continue;
    }
    if (ici === "substitution" || ici === "parenthese") {
      if (c === "(") pile.push("parenthese");
      else if (c === ")") pile.pop();
      courant += c;
      continue;
    }
    // Premier niveau. Un `#` en début de mot ouvre un commentaire : le reste de la ligne n'est pas
    // exécuté, et ne doit pas être lu comme s'il l'était.
    if (c === "#" && (courant === "" || /\s$/.test(courant))) {
      if (/[\r\n]/.test(cmd.slice(i + 1))) return null;
      break;
    }
    if (c === "(" || c === ")" || c === ";" || c === "\n" || c === "\r") return null;
    if (c === "|") return null; // `||` comme tube : les deux peuvent rendre 0 sur un échec
    if (c === "&") {
      if (suivant === "&") {
        segments.push(courant.trim());
        courant = "";
        i++;
        continue;
      }
      const precedent = cmd[i - 1];
      if (precedent === ">" || precedent === "<" || suivant === ">") {
        courant += c; // redirection (`2>&1`, `&>`), pas un arrière-plan
        continue;
      }
      return null; // arrière-plan
    }
    courant += c;
  }
  if (pile.length !== 1) return null;
  segments.push(courant.trim());
  return segments.some((s) => s === "") ? null : segments;
}

/** Les mots d'un segment, guillemets retirés ; une substitution `$( … )` reste un seul mot. */
export function mots(segment: string): string[] {
  const sortie: string[] = [];
  let mot = "";
  let dans = false;
  let quote: "'" | '"' | null = null;
  let profondeur = 0;
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (quote) {
      if (c === quote) quote = null;
      else mot += c;
      continue;
    }
    if (profondeur > 0) {
      if (c === "(") profondeur++;
      else if (c === ")") profondeur--;
      mot += c;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; dans = true; continue; }
    if (c === "$" && segment[i + 1] === "(") { profondeur = 1; mot += "$("; i++; dans = true; continue; }
    if (/\s/.test(c)) {
      if (dans) { sortie.push(mot); mot = ""; dans = false; }
      continue;
    }
    mot += c;
    dans = true;
  }
  if (dans) sortie.push(mot);
  return sortie;
}

const LANCEURS = new Set(["uv", "poetry", "pipenv", "hatch", "pdm", "rye"]);
/** Options de lanceur qui prennent une valeur : la sauter aussi. */
const OPTIONS_A_VALEUR = new Set([
  "--extra", "--with", "--group", "--python", "-p", "--package", "--project", "--directory", "--env-file",
  "--index", "--with-requirements", "--only-group", "-e", "--env",
]);
const base = (m: string) => m.split("/").pop() ?? m;
const VARIABLE = /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/;

/** Les redirections ne sont pas des arguments : `2>&1`, `> log.txt`, `&>out`. */
function sansRedirections(w: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < w.length; i++) {
    if (/^(\d*>>?|&>>?|\d*<)$/.test(w[i])) { i++; continue; }
    if (/^(\d*>>?|&>>?|\d*<)\S+$/.test(w[i])) continue;
    out.push(w[i]);
  }
  return out;
}

/** L'exécuteur réellement lancé par le dernier segment, et le reste de ses arguments ; ou `null`. */
function executeurLance(dernier: string): { executeur: Executeur; args: string[] } | null {
  const w = sansRedirections(mots(dernier));
  let i = 0;
  const affectations = () => { while (i < w.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[i])) i++; };
  affectations();
  if (w[i] === "env") { i++; affectations(); }
  if (LANCEURS.has(w[i] ?? "") && w[i + 1] === "run") {
    i += 2;
    while (i < w.length && w[i].startsWith("-")) i += OPTIONS_A_VALEUR.has(w[i]) ? 2 : 1;
  }
  const par = (nom: string) => EXECUTEURS.find((e) => e.nom === nom)!;
  const m = w[i] ?? "";
  const b = base(m);
  if (/^python[\d.]*$/.test(b) || VARIABLE.test(m)) {
    return w[i + 1] === "-m" && (w[i + 2] === "pytest" || w[i + 2] === "py.test")
      ? { executeur: par("pytest"), args: w.slice(i + 3) }
      : null;
  }
  if (b === "pytest" || b === "py.test") return { executeur: par("pytest"), args: w.slice(i + 1) };
  if (m === "go" && w[i + 1] === "test") return { executeur: par("go"), args: w.slice(i + 2) };
  if (m === "cargo" && w[i + 1] === "test") return { executeur: par("cargo"), args: w.slice(i + 2) };
  if (["npm", "pnpm", "yarn"].includes(m)) {
    if (w[i + 1] === "test") return { executeur: par("js"), args: w.slice(i + 2) };
    if (w[i + 1] === "run" && w[i + 2] === "test") return { executeur: par("js"), args: w.slice(i + 3) };
    return null;
  }
  if (m === "npx" && (w[i + 1] === "vitest" || w[i + 1] === "jest")) return { executeur: par("js"), args: w.slice(i + 2) };
  if (b === "vitest" || b === "jest") return { executeur: par("js"), args: w.slice(i + 1) };
  if (["mvn", "mvnw", "gradle", "gradlew"].includes(b) && w.slice(i + 1).includes("test")) {
    return { executeur: par("jvm"), args: w.slice(i + 1) };
  }
  return null;
}

const PYTEST_SELECTEURS = /^(-k|-m|--lf|--last-failed|--deselect|--sw|--stepwise|--stepwise-skip|--sw-skip|--co|--collect-only|--ignore|--ignore-glob|--pyargs|--trace)(=|$)|^-k./;
const PYTEST_NEUTRES_A_VALEUR = new Set(["-p", "-W", "-n", "--tb", "-o", "--rootdir", "--color", "-r", "--durations", "--maxfail", "--basetemp", "--log-level", "--import-mode"]);
const PYTEST_NEUTRES = /^(-q+|-v+|-x|-s|-ra|-rA|-rf|--no-header|--disable-warnings|--strict-markers|--exitfirst|--quiet|--verbose|--capture=\S+|--tb=\S+|--color=\S+|-n\d*|-n=\S+|-p=\S+|--durations=\S+|-W=?\S*|--maxfail=\S+|-o=?\S+|--import-mode=\S+|--basetemp=\S+)$/;

/** La portée d'une invocation, lue dans ses arguments. Dans le doute : indéterminée. */
function porteeDes(e: Executeur, args: readonly string[]): Portee {
  if (e.nom === "pytest") {
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (PYTEST_SELECTEURS.test(a)) return "partielle";
      if (!a.startsWith("-")) return "partielle"; // une cible : fichier, dossier, nœud `::`
      if (PYTEST_NEUTRES_A_VALEUR.has(a)) { i++; continue; }
      if (PYTEST_NEUTRES.test(a)) continue;
      return "indeterminee";
    }
    return "complete";
  }
  if (e.nom === "go") {
    let tout = false;
    for (const a of args) {
      if (/^-(run|skip|short)(=|$)/.test(a)) return "partielle";
      if (a === "./...") { tout = true; continue; }
      if (!a.startsWith("-")) return "partielle";
      if (!/^-(v|race|count=\d+|cover|timeout=\S+)$/.test(a)) return "indeterminee";
    }
    return tout ? "complete" : "indeterminee";
  }
  if (e.nom === "cargo") {
    for (const a of args) {
      if (a === "--") return "indeterminee";
      if (!a.startsWith("-")) return "partielle";
      if (!/^(--workspace|--all|-q|--quiet|--release|--all-features|--locked)$/.test(a)) return "indeterminee";
    }
    return "complete";
  }
  if (e.nom === "js") {
    for (const a of args) {
      if (a === "run" || a === "--run" || a === "--") continue;
      if (/^(-t|--testNamePattern|--testPathPattern|--grep|-g)(=|$)/.test(a)) return "partielle";
      if (!a.startsWith("-")) return "partielle";
      if (!/^(--silent|--ci|--coverage|--reporter=\S+)$/.test(a)) return "indeterminee";
    }
    return "complete";
  }
  // jvm
  return args.some((a) => /^-Dtest=|^--tests(=|$)/.test(a)) ? "partielle" : "complete";
}

/** La commande est-elle portable d'une délégation à la suivante : exécuteur lancé et portée ; ou `null`. */
export function analyse(cmd: string): { executeur: Executeur; portee: Portee } | null {
  if (cmd.length === 0 || cmd.length > LONGUEUR_MAX) return null;
  if (/\bset\s+\+e\b/.test(cmd)) return null;
  if (/pi-lanes|pi-integrations/.test(cmd)) return null;
  const segments = segmentsDePremierNiveau(cmd);
  if (!segments) return null;
  // L'exécuteur doit être la commande même du DERNIER segment : c'est son code qui fait le code de
  // l'appel, et c'est lui qui a produit la sortie qu'on lit.
  const lance = executeurLance(segments[segments.length - 1]);
  return lance ? { executeur: lance.executeur, portee: porteeDes(lance.executeur, lance.args) } : null;
}

const RANG: Record<Portee, number> = { complete: 2, indeterminee: 1, partielle: 0 };

/** La plus récente l'emporte, sauf sur une portée mieux établie. */
function meilleure<T extends { portee: Portee }>(actuelle: T | null, candidate: T): T {
  if (actuelle !== null && RANG[candidate.portee] < RANG[actuelle.portee]) return actuelle;
  return candidate;
}

/** La sortie montre-t-elle un succès réel de cet exécuteur ? */
export function succesReel(e: Executeur, sortie: string): boolean {
  if (!e.succes.test(sortie)) return false;
  if (e.nom === "pytest") {
    const m = PYTEST_RESUME.exec(sortie);
    const resume = m ? m[1] : "";
    return /\b\d+ passed\b/.test(resume) && !e.echec.test(resume);
  }
  return !e.echec.test(sortie);
}

function texte(contenu: unknown): string {
  if (typeof contenu === "string") return contenu;
  if (!Array.isArray(contenu)) return "";
  return contenu
    .map((x) => (x && typeof x === "object" && typeof (x as { text?: unknown }).text === "string" ? (x as { text: string }).text : ""))
    .join("");
}

export interface CommandeRetenue {
  commande: string;
  portee: Portee;
}

/**
 * La dernière commande de test réussie d'une transcription d'enfant (`<run>-NN-<rôle>.jsonl`) — sauf
 * sur une portée mieux établie —, avec sa portée ; ou `null`. Une ligne illisible rend `null` : on ne
 * choisit pas « la dernière » dans un fichier qu'on n'a pas lu en entier.
 */
export function commandeDeTestDetail(lignes: readonly string[]): CommandeRetenue | null {
  const commandes = new Map<string, string>();
  let retenue: CommandeRetenue | null = null;
  for (const brute of lignes) {
    const ligne = brute.trim();
    if (!ligne) continue;
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(ligne) as Record<string, unknown>;
    } catch {
      return null;
    }
    if (e.toolName !== "bash" || typeof e.toolCallId !== "string") continue;
    if (e.type === "tool_execution_start") {
      const cmd = (e.args as { command?: unknown } | undefined)?.command;
      if (typeof cmd === "string") commandes.set(e.toolCallId, cmd);
      continue;
    }
    if (e.type !== "tool_execution_end") continue;
    const cmd = commandes.get(e.toolCallId);
    if (cmd === undefined || e.isError !== false) continue;
    const a = analyse(cmd);
    if (!a) continue;
    const executeur = a.executeur;
    const sortie = texte((e.result as { content?: unknown } | undefined)?.content);
    // Un résumé qui compte des tests désélectionnés dit la portée mieux que les arguments.
    const portee: Portee = executeur.nom === "pytest" && /\bdeselected\b/.test(PYTEST_RESUME.exec(sortie)?.[1] ?? "")
      ? "partielle"
      : a.portee;
    if (succesReel(executeur, sortie)) retenue = meilleure(retenue, { commande: cmd, portee });
  }
  return retenue;
}

/** La commande seule. */
export function commandeDeTest(lignes: readonly string[]): string | null {
  return commandeDeTestDetail(lignes)?.commande ?? null;
}

/** Même lecture, depuis le fichier. Absent ou illisible : `null`. */
export function commandeDeTestDuFichierDetail(transcription: string): CommandeRetenue | null {
  try {
    return commandeDeTestDetail(readFileSync(transcription, "utf-8").split("\n"));
  } catch {
    return null;
  }
}
export function commandeDeTestDuFichier(transcription: string): string | null {
  return commandeDeTestDuFichierDetail(transcription)?.commande ?? null;
}

/**
 * La commande à porter au prochain writer : la plus récente inscrite au journal des délégations DE CE
 * RUN (`<runId>-delegations.jsonl`), sauf sur une portée mieux établie. La portée inscrite
 * (`test_command_portee`, qui tient compte de la sortie) et celle que relisent les arguments sont
 * confrontées : la plus faible fait foi. Une ligne illisible et le journal ne dit rien.
 */
export function commandeEtablie(journal: string): string | null {
  let contenu: string;
  try {
    contenu = readFileSync(journal, "utf-8");
  } catch {
    return null;
  }
  let retenue: CommandeRetenue | null = null;
  for (const brute of contenu.split("\n")) {
    const ligne = brute.trim();
    if (!ligne) continue;
    let r: { test_command?: unknown; test_command_portee?: unknown };
    try {
      r = JSON.parse(ligne) as typeof r;
    } catch {
      return null;
    }
    if (typeof r.test_command !== "string") continue;
    const a = analyse(r.test_command);
    if (!a) continue;
    const inscrite = r.test_command_portee;
    const portee: Portee = typeof inscrite === "string" && inscrite in RANG && RANG[inscrite as Portee] < RANG[a.portee]
      ? (inscrite as Portee)
      : a.portee;
    retenue = meilleure(retenue, { commande: r.test_command, portee });
  }
  return retenue?.commande ?? null;
}
