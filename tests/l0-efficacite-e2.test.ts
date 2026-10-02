/**
 * l0-efficacite-e2.test.ts — LOT-EFFICACITÉ, E2 : la règle d'injection et la sémantique RC A, sans
 * harnais (plan des leviers v2 complétée, § 3).
 *
 *   règle         éligibilité (revue initiale, paquet non dégradé, sans for_risks) ; candidats
 *                 kept → scope → cités, dédupliqués, ordre déterministe ; exclusions publiées avec
 *                 leur raison ; budget sans troncature — E2-regle
 *   provenance    capturée et validée contre la délégation courante et le tree du worktree ;
 *                 illisible, étrangère ou d'un autre tree : jamais une inspection — E2-provenance
 *   octets bruts  le contrôle au submit compare le blob Git des octets bruts lus, sans filtre ni
 *                 conversion de fin de ligne ; une erreur de résolution ou de lecture ne compte
 *                 jamais — E2-octets-bruts
 *   spawn         une provenance héritée du parent n'est jamais transmise — E2-environnement
 *   trace         publication atomique ; jamais un champ ni une identité remplacés ; trace illisible,
 *                 d'une autre délégation ou privée de agent ou de unit : TRANSMIS_INEXPLOITABLE,
 *                 octets inchangés — E2-transmis-ecriture
 *
 * Le chemin complet — vrai runtime, vrai submit — est dans tests/l0-efficacite-e2-harness.test.ts.
 */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  BUDGET_OCTETS, blobDesOctets, candidats, citesDansTache, controlerInjecte, injectionEligible, lireArbre, lireBlob,
  lireInjection, MAX_FICHIER_OCTETS, PHRASE_INJECTION, provenanceDe, sectionInjection, selectionner, type EntreeArbre,
} from "../subagent-only/injection.ts";
import { cheminReelDansWorktree, jugerBloquant, REVIEW_BLOCKING_WITHOUT_KEPT_CONSUMERS } from "../subagent-only/envelope/inspection.ts";
import { workingTree } from "../subagent-only/tree.ts";
import { environnementEnfant } from "../subagent-only/injection.ts";
import { publierTransmis, TransmisError, transmisPath } from "../subagent-only/transmis.ts";
import { readdirSync, readFileSync } from "node:fs";

type Preuve = (t: TestContext) => Promise<void> | void;
function regressionCorrigee(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, fn);
}
function propriete(vrai: boolean, message: string): void {
  assert.ok(vrai, `PROPRIÉTÉ — ${message}`);
}
function precondition(vrai: boolean, message: string): void {
  assert.ok(vrai, `PRÉCONDITION — ${message}`);
}
const jetables: string[] = [];
test.after(() => { for (const d of jetables) rmSync(d, { recursive: true, force: true }); });

function depot(fichiers: Record<string, string | Buffer>, attributs?: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-e2-")));
  jetables.push(root);
  const git = (...a: string[]) => execFileSync("git", a, { cwd: root, stdio: "pipe" });
  git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t"); git("config", "core.autocrlf", "false");
  if (attributs) writeFileSync(join(root, ".gitattributes"), attributs);
  for (const [chemin, contenu] of Object.entries(fichiers)) {
    mkdirSync(join(root, dirname(chemin)), { recursive: true });
    writeFileSync(join(root, chemin), contenu);
  }
  git("add", "-A"); git("commit", "-qm", "base");
  return root;
}

const entree = (blob: string, mode = "100644", type = "blob"): EntreeArbre => ({ mode, type, blob });

regressionCorrigee("E2-regle", "la revue initiale reçoit kept, scope et cités, dédupliqués, exclus nommés, sous budget, sans troncature", () => {
  // Éligibilité : tout est connu au spawn.
  const base = { reviewer: true, lane: true, degrade: false, initiale: true, forRisks: 0 };
  propriete(injectionEligible(base), "revue initiale, paquet inliné, sans for_risks : éligible");
  for (const [cas, e] of [
    ["revue non initiale", { ...base, initiale: false }], ["paquet dégradé", { ...base, degrade: true }],
    ["for_risks", { ...base, forRisks: 1 }], ["sans lane", { ...base, lane: false }], ["autre rôle", { ...base, reviewer: false }],
  ] as const) propriete(!injectionEligible(e), `${cas} : aucune injection`);

  // Candidats : kept, puis scope (sans les nouveaux), puis cités ; dédupliqués ; ordre en octets UTF-8.
  const arbre = new Map<string, EntreeArbre>([
    ["src/pkg/io.py", entree("a1")], ["src/pkg/Zeta.py", entree("a2")], ["src/pkg/neuf.py", entree("a3")],
    ["src/pkg/run.py", entree("a4")], ["tests/test_config.py", entree("a5")], ["conf/c.yaml", entree("a6")],
    ["src/pkg/io_test.py", entree("a7")],
  ]);
  const avant = new Set(["src/pkg/io.py", "src/pkg/Zeta.py", "src/pkg/run.py", "tests/test_config.py", "conf/c.yaml", "src/pkg/io_test.py"]);
  const liste = candidats({
    kept: ["tests/test_config.py", "src/pkg/run.py", "src/pkg/run.py"],
    scope: ["src/pkg/io.py", "src/pkg/Zeta.py", "src/pkg/neuf.py"],
    arbre, avant,
    tache: "Lis `conf/c.yaml` et src/pkg/run.py ; pas src/pkg/io.pyc ni src/pkg/io_test.pyx",
  });
  propriete(JSON.stringify(liste) === JSON.stringify([
    { path: "src/pkg/run.py", categorie: "kept" }, { path: "tests/test_config.py", categorie: "kept" },
    { path: "src/pkg/Zeta.py", categorie: "scope" }, { path: "src/pkg/io.py", categorie: "scope" }, { path: "src/pkg/neuf.py", categorie: "scope" },
    { path: "conf/c.yaml", categorie: "cite" },
  ]), `ordre et déduplication (${JSON.stringify(liste)})`);
  propriete(JSON.stringify(citesDansTache("voir src/a.py, et src/a.pyc", ["src/a.py", "src/a.pyc", "a.py"])) === JSON.stringify(["src/a.py", "src/a.pyc"]),
    "citation : chemin entier, frontière de D4");

  // Sélection : exclusions nommées, budget sauté sans troncature, fichiers suivants essayés.
  const contenus: Record<string, Buffer> = {
    k1: Buffer.from("kept 1\n"), big: Buffer.alloc(MAX_FICHIER_OCTETS + 1, 97), bin: Buffer.from([97, 0, 98]),
    latin: Buffer.from([0xe9, 0x0a]), fin: Buffer.from("x\n</file>\ny\n"), p1: Buffer.alloc(60_000, 98),
    p2: Buffer.alloc(60_000, 99), p3: Buffer.alloc(50_000, 100), p4: Buffer.alloc(9_000, 101),
  };
  const a2 = new Map<string, EntreeArbre>([
    ["k1.py", entree("k1")], ["gros.py", entree("big")], ["bin.dat", entree("bin")], ["latin.txt", entree("latin")],
    ["fin.py", entree("fin")], ["lien.py", entree("k1", "120000")], ["sous", entree("t", "160000", "commit")],
    ["uv.lock", entree("k1")], ["neuf.py", entree("k1")], ["p1.py", entree("p1")], ["p2.py", entree("p2")], ["p3.py", entree("p3")], ["p4.py", entree("p4")],
    ["casse.py", entree("casse")],
  ]);
  const av2 = new Set([...a2.keys()].filter((p) => p !== "neuf.py"));
  const ordre = ["k1.py", "absent.py", "gros.py", "bin.dat", "latin.txt", "fin.py", "lien.py", "sous", "uv.lock", "neuf.py", "casse.py", "p1.py", "p2.py", "p3.py", "p4.py"]
    .map((path) => ({ path, categorie: (path === "neuf.py" ? "scope" : "cite") as "scope" | "cite" }));
  const sel = selectionner(ordre, a2, av2, (b) => { if (!(b in contenus)) throw new Error("objet introuvable"); return contenus[b]; });
  const raisons = Object.fromEntries(sel.exclus.map((e) => [e.path, e.raison]));
  propriete(JSON.stringify(sel.injectes.map((f) => f.path)) === JSON.stringify(["k1.py", "p1.py", "p2.py", "p4.py"]),
    `injectés : k1, p1, p2, puis p4 après p3 sauté au budget (${JSON.stringify(sel.injectes.map((f) => f.path))})`);
  for (const [p, motif] of [["absent.py", /absent de T_L/], ["gros.py", /trop gros/], ["bin.dat", /binaire/], ["latin.txt", /UTF-8/],
    ["fin.py", /délimiteur/], ["lien.py", /lien symbolique/], ["sous", /non ordinaire/], ["uv.lock", /généré/], ["neuf.py", /nouveau/],
    ["casse.py", /lecture impossible/], ["p3.py", /budget/]] as const) {
    propriete(motif.test(raisons[p] ?? ""), `${p} exclu avec sa raison (${raisons[p]})`);
  }
  propriete(sel.octetsInjectes === 7 + 60_000 + 60_000 + 9_000 && sel.octetsInjectes <= BUDGET_OCTETS, `budget tenu (${sel.octetsInjectes})`);
  propriete(sel.injectes.every((f) => f.size === contenus[f.blob].length && f.contenu === contenus[f.blob].toString("utf-8")),
    "chaque fichier injecté est entier");

  // La section : le texte adjugé, puis les fichiers ; la provenance en est tirée.
  const section = sectionInjection("t".repeat(40), sel.injectes);
  propriete(section.startsWith(PHRASE_INJECTION) && section.includes('<file path="k1.py" blob="k1">\nkept 1\n</file>'), "texte adjugé, fichiers entiers");
  const d = { run: "r", planHash: "h", unit: "W01", seq: 2 };
  const prov = provenanceDe(d, "t".repeat(40), sel.injectes);
  propriete(JSON.stringify(prov.files) === JSON.stringify(sel.injectes.map((f) => ({ path: f.path, blob: f.blob, size: f.size }))) &&
    prov.seq === 2 && prov.unit === "W01", "provenance = fichiers effectivement sérialisés");
  propriete(sectionInjection("t", []) === "", "rien d'injectable : aucune section");
});

/** Un worktree réel, un kept, et la provenance que le parent aurait construite pour lui. */
function worktreeInjecte(attributs?: string, contenu: string | Buffer = "from .io import lire\n") {
  const root = depot({ "src/pkg/run.py": contenu, "src/pkg/io.py": "def lire():\n    return 1\n" }, attributs);
  if (attributs) {
    // Recréé par git depuis l'index : la conversion déclarée s'applique à la copie de travail.
    rmSync(join(root, "src", "pkg", "run.py"));
    execFileSync("git", ["checkout", "--", "src/pkg/run.py"], { cwd: root, stdio: "pipe" });
  }
  const tree = workingTree(root);
  const arbre = lireArbre(root, tree);
  const sel = selectionner([{ path: "src/pkg/run.py", categorie: "kept" }], arbre, new Set(arbre.keys()), lireBlob(root));
  const delegation = { run: "run1", planHash: "ph", unit: "W01", seq: 4 };
  const prov = provenanceDe(delegation, tree, sel.injectes);
  return { root, tree, prov, delegation };
}

regressionCorrigee("E2-provenance", "la provenance n'est retenue que pour la délégation, l'unité, le plan et le tree courants", () => {
  const { root, tree, prov, delegation } = worktreeInjecte();
  precondition(prov.files.length === 1, "le kept doit être injecté");
  const lire = (p: unknown, d: unknown = delegation, t = () => workingTree(root)) =>
    lireInjection(typeof p === "string" ? p : JSON.stringify(p), typeof d === "string" ? d : JSON.stringify(d), t);
  propriete(lire(prov).etat === "valide", "provenance de cette délégation, sur ce tree : valide");
  propriete(lireInjection(undefined, JSON.stringify(delegation), () => tree).etat === "absente", "absente : rien");
  propriete(lire("{illisible").etat === "invalide", "illisible : invalide");
  propriete(lire({ ...prov, files: "x" }).etat === "invalide", "forme invalide : invalide");
  for (const [cas, autre] of [["autre délégation", { ...prov, seq: 5 }], ["autre unité", { ...prov, unit: "W02" }],
    ["autre plan", { ...prov, planHash: "autre" }], ["autre run", { ...prov, run: "run2" }]] as const) {
    propriete(lire(autre).etat === "invalide", `Provenance d'une autre délégation, unité, plan ou tree : ne compte pas. (${cas})`);
  }
  propriete(lire(prov, "{illisible").etat === "invalide", "délégation courante inconnue : invalide");
  propriete(lire({ ...prov, tree: "f".repeat(40) }, { ...delegation }).etat === "invalide", "autre tree : invalide");
  propriete(lire(prov, delegation, () => { throw new Error("git absent"); }).etat === "invalide", "tree inobservable : invalide");
  // Le worktree a changé depuis la construction : le tree courant n'est plus T_L.
  writeFileSync(join(root, "src", "pkg", "io.py"), "def lire():\n    return 2\n");
  propriete(lire(prov).etat === "invalide", "worktree modifié depuis T_L : invalide");
});

const GARDES = { unit: "W01", kept: ["src/pkg/run.py"] };
const verdict = (v: string) => ({ verdict: v });

regressionCorrigee("E2-octets-bruts", "un kept injecté compte au submit si le blob de ses octets bruts égale le blob transmis, et seulement alors", () => {
  // Sans conversion : les octets du worktree sont ceux de T_L.
  const a = worktreeInjecte();
  const valideA = lireInjection(JSON.stringify(a.prov), JSON.stringify(a.delegation), () => workingTree(a.root));
  precondition(valideA.etat === "valide", "provenance valide");
  for (const v of ["needs_rework", "blocked"]) {
    const j = jugerBloquant(verdict(v), GARDES, new Set(), a.root, valideA);
    propriete(j.refus === null && JSON.stringify(j.observation?.par_injection) === JSON.stringify(["src/pkg/run.py"]),
      `${v} : kept injecté au bon blob, compté sans read (${JSON.stringify(j)})`);
  }
  // Fichier modifié après l'initialisation : blob différent, non compté.
  writeFileSync(join(a.root, "src", "pkg", "run.py"), "from .io import lire  # modifié\n");
  const modifie = jugerBloquant(verdict("needs_rework"), GARDES, new Set(), a.root, valideA);
  propriete(modifie.refus?.code === REVIEW_BLOCKING_WITHOUT_KEPT_CONSUMERS && modifie.observation?.controles[0]?.ok === false,
    `blob différent : refusé, contrôle conservé (${JSON.stringify(modifie)})`);
  // Un read réussi reste une voie indépendante suffisante.
  const lu = jugerBloquant(verdict("blocked"), GARDES, new Set([realpathSync(join(a.root, "src", "pkg", "run.py"))]), a.root, valideA);
  propriete(lu.refus === null && JSON.stringify(lu.observation?.par_read) === JSON.stringify(["src/pkg/run.py"]), "read réussi : suffisant");
  // Kept inconnu avec provenance présente : verdict bloquant refusé.
  const inconnu = jugerBloquant(verdict("blocked"), { inconnu: "kept durable illisible" }, new Set(), a.root, valideA);
  propriete(inconnu.refus !== null && inconnu.refus.kept_inconnu === "kept durable illisible", "État kept inconnu avec provenance présente : verdict bloquant refusé.");
  // Provenance invalide ou absente : read exigé.
  const absente = jugerBloquant(verdict("needs_rework"), GARDES, new Set(), a.root, { etat: "absente" });
  propriete(absente.refus !== null, "sans provenance : read exigé");
  // Erreurs : chemin hors du cwd, lecture impossible — jamais une inspection.
  const dehors = controlerInjecte("../ailleurs.py", "0".repeat(40), (p) => cheminReelDansWorktree(p, a.root));
  propriete(!dehors.ok && dehors.lu === null, "chemin sortant du cwd : ne compte pas");
  const illisible = controlerInjecte("src/pkg/io.py", "0".repeat(40), (p) => cheminReelDansWorktree(p, a.root), () => { throw new Error("EACCES"); });
  propriete(!illisible.ok && /lecture/.test(illisible.erreur ?? ""), "Échec de lecture : ne compte pas comme inspection par injection.");

  // Attributs Git et conversion de fin de ligne : le blob de T_L est normalisé, les octets du
  // worktree ne le sont pas. La comparaison porte sur les octets bruts : non compté.
  const b = worktreeInjecte("*.py text eol=crlf\n", "from .io import lire\n");
  const brut = execFileSync("cat", [join(b.root, "src", "pkg", "run.py")]);
  precondition(brut.includes(Buffer.from("\r\n")), "le worktree porte des CRLF");
  const filtre = execFileSync("git", ["hash-object", "src/pkg/run.py"], { cwd: b.root, encoding: "utf-8" }).trim();
  precondition(filtre === b.prov.files[0]?.blob && blobDesOctets(brut, 40) !== filtre,
    "git hash-object filtré égale le blob de T_L, le blob des octets bruts non");
  const valideB = lireInjection(JSON.stringify(b.prov), JSON.stringify(b.delegation), () => workingTree(b.root));
  const crlf = jugerBloquant(verdict("needs_rework"), GARDES, new Set(), b.root, valideB);
  propriete(crlf.refus !== null && crlf.observation?.controles[0]?.ok === false && crlf.observation.controles[0].lu === blobDesOctets(brut, 40),
    `fin de ligne convertie : les octets bruts ne correspondent pas, read exigé (${JSON.stringify(crlf.observation)})`);
});

regressionCorrigee("E2-environnement", "une provenance héritée de l'environnement du parent n'est jamais transmise à un enfant", () => {
  const herite = { PATH: "/bin", PI_SUBAGENT_INJECTED: '{"vieux":1}', PI_SUBAGENT_DELEGATION: '{"vieux":1}', AUTRE: "x" };
  const sans = environnementEnfant(herite, { PI_SUBAGENT_ROLE: "worker" });
  propriete(!("PI_SUBAGENT_INJECTED" in sans) && !("PI_SUBAGENT_DELEGATION" in sans) && sans.AUTRE === "x" && sans.PI_SUBAGENT_ROLE === "worker",
    `Provenance héritée sans injection par le spawn courant : non transmise. (${JSON.stringify(sans)})`);
  const avec = environnementEnfant(herite, { PI_SUBAGENT_INJECTED: '{"neuf":1}' });
  propriete(avec.PI_SUBAGENT_INJECTED === '{"neuf":1}' && !("PI_SUBAGENT_DELEGATION" in avec), "seule la valeur construite pour ce spawn passe");
});

regressionCorrigee("E2-transmis-ecriture", "la trace se publie atomiquement et ne remplace jamais un champ, une identité ou une trace d'une autre délégation", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pi-e2-transmis-")));
  jetables.push(dir);
  const run = "0123456789abcdef";
  const lire = (seq: number) => JSON.parse(readFileSync(transmisPath(dir, run, seq), "utf-8")) as Record<string, unknown>;
  const refuse = (f: () => void): boolean => { try { f(); return false; } catch (e) { return e instanceof TransmisError; } };
  publierTransmis(dir, run, 1, { agent: "worker", unit: "W01", test_contract: { transmis: "declaree" } });
  propriete(JSON.stringify(lire(1)) === JSON.stringify({ run, seq: 1, agent: "worker", unit: "W01", test_contract: { transmis: "declaree" } }),
    `absente : créée (${JSON.stringify(lire(1))})`);
  publierTransmis(dir, run, 1, { agent: "worker", unit: "W01", test_contract: { transmis: "declaree" } });
  publierTransmis(dir, run, 1, { agent: "worker", unit: "W01", injection: null });
  propriete(JSON.stringify(lire(1).test_contract) === JSON.stringify({ transmis: "declaree" }) && lire(1).injection === null,
    "existante valide : même champ à l'identique accepté, champ nouveau ajouté, rien d'autre ne change");
  const avant = readFileSync(transmisPath(dir, run, 1), "utf-8");
  for (const [nom, champs] of [
    ["champ contradictoire", { agent: "worker", unit: "W01", test_contract: { transmis: "aucune" } }],
    ["unité contradictoire", { agent: "worker", unit: "W02" }],
    ["agent contradictoire", { agent: "reviewer", unit: "W01" }],
  ] as const) {
    propriete(refuse(() => publierTransmis(dir, run, 1, champs)) && readFileSync(transmisPath(dir, run, 1), "utf-8") === avant,
      `${nom} : refus, trace inchangée`);
  }
  for (const [seq, contenu] of [[2, "{tronqué"], [3, "[]"], [4, JSON.stringify({ run: "fedcba9876543210", seq: 4 })], [5, JSON.stringify({ run, seq: 6 })]] as const) {
    writeFileSync(transmisPath(dir, run, seq), contenu);
    propriete(refuse(() => publierTransmis(dir, run, seq, { agent: "reviewer", unit: "W01", injection: null })) &&
      readFileSync(transmisPath(dir, run, seq), "utf-8") === contenu, `trace ${seq} illisible ou d'une autre délégation : refus, trace inchangée`);
  }
  // Une trace existante privée de agent, de unit, ou des deux : inexploitable, ni complétée ni réécrite
  // (correction 1 de l'adjudication de la révision 2).
  for (const [seq, nom, doc] of [
    [6, "agent absent", { run, seq: 6, unit: "W01" }],
    [7, "unit absent", { run, seq: 7, agent: "reviewer" }],
    [8, "agent et unit absents", { run, seq: 8 }],
  ] as const) {
    const contenu = JSON.stringify(doc);
    writeFileSync(transmisPath(dir, run, seq), contenu);
    let err: unknown = null;
    try { publierTransmis(dir, run, seq, { agent: "reviewer", unit: "W01", injection: null }); } catch (e) { err = e; }
    propriete(err instanceof TransmisError && err.code === "TRANSMIS_INEXPLOITABLE" && readFileSync(transmisPath(dir, run, seq), "utf-8") === contenu,
      `${nom} : TRANSMIS_INEXPLOITABLE, octets inchangés (${err instanceof Error ? err.message : String(err)})`);
  }
  propriete(readdirSync(dir).every((f) => !f.endsWith(".tmp")), "aucun temporaire laissé : publication par renommage");
});
