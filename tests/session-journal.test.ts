/**
 * session-journal.test.ts — l'extension se charge, extrait, se tait sur reprise,
 * et dit quand elle ne peut pas écrire.
 *
 * Elle est arrivée au dépôt le 2026-09-08, après avoir vécu hors git : active sur
 * la machine, absente de tout clone. Ces quatre tests sont sa première couverture,
 * et le quatrième existe parce que ses écritures échouaient en silence — un
 * journal muet et un journal absent se ressemblaient.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODULE = "../extensions/pi-session-journal/index.ts";

interface Notification { texte: string; genre?: string }

/**
 * Un faux `pi` réduit à ce que l'extension utilise, et un `ctx` de session.
 *
 * `branche` décide de ce que rend `git branch --show-current` : l'extension ne
 * lance jamais git ici, ce qui est le point — le nommage se teste sans dépôt.
 */
function monter(over: { branche?: string; entrees?: unknown[]; entreesJettent?: boolean } = {}) {
  const evenements = new Map<string, (...a: unknown[]) => unknown>();
  const dits: Notification[] = [];
  const statuts: [string, string][] = [];
  let nomme: string | undefined;

  const pi = {
    on: (nom: string, h: (...a: unknown[]) => unknown) => evenements.set(nom, h),
    setSessionName: (n: string) => { nomme = n; },
    exec: async () => ({ stdout: over.branche ?? "", stderr: "", code: over.branche ? 0 : 1 }),
  };
  const ctx = {
    cwd: "/tmp",
    hasUI: true,
    ui: {
      notify: (texte: string, genre?: string) => dits.push({ texte, genre }),
      setStatus: (k: string, v: string) => statuts.push([k, v]),
    },
    sessionManager: {
      getEntries: () => {
        if (over.entreesJettent) throw new Error("registre de session illisible");
        return over.entrees ?? [];
      },
    },
  };
  return { pi, ctx, evenements, dits, statuts, nom: () => nomme };
}

const messageUtilisateur = (texte: string) => ({
  type: "message",
  message: { role: "user", content: [{ type: "text", text: texte }] },
});
const messageAssistant = (blocs: unknown[]) => ({
  type: "message",
  message: { role: "assistant", content: blocs },
});

// ------------------------------------------------------------- le chargement

test("l'extension se charge et enregistre ses trois événements", async () => {
  const module = await import(MODULE);
  const h = monter();
  module.default(h.pi);
  assert.deepEqual(
    [...h.evenements.keys()].sort(),
    ["before_agent_start", "session_shutdown", "session_start"],
  );
});

test("le nommage prend la branche et le premier prompt", async () => {
  const module = await import(MODULE);
  const h = monter({ branche: "feat/subagent-extension" });
  module.default(h.pi);

  await h.evenements.get("session_start")!({ reason: "startup" }, h.ctx);
  h.evenements.get("before_agent_start")!({ prompt: "corriger la reprise des lanes" }, h.ctx);

  assert.equal(h.nom(), "feat/subagent-extension — corriger la reprise des lanes");
  assert.deepEqual(h.statuts, [["journal", "📓 feat/subagent-extension — corriger la reprise des lanes"]]);
});

// ------------------------------------------------------------- l'extraction

test("extractSessionInfo ne retient que ce qu'il prétend retenir", async () => {
  const { extractSessionInfo } = await import(MODULE);
  const info = extractSessionInfo([
    // Les préambules injectés par pi ne sont pas le message de l'utilisateur.
    messageUtilisateur("<skill name=strategic-forge>…</skill>"),
    messageUtilisateur("refais la reprise des tentatives"),
    messageAssistant([
      { type: "text", text: "Je commence par relire le registre des lanes avant toute décision." },
      { type: "toolCall", name: "write", arguments: { path: "subagent-only/lane-observe.ts" } },
      { type: "toolCall", name: "read", arguments: { path: "ne-doit-pas-compter.ts" } },
      { type: "toolCall", name: "bash", arguments: { command: "bin/test-guards" } },
    ]),
    messageAssistant([
      { type: "text", text: "J'ai decided to garder la fenêtre synchrone plutôt qu'un verrou." },
    ]),
  ]);

  assert.equal(info.firstUserMessage, "refais la reprise des tentatives");
  assert.deepEqual(
    info.filesTouched,
    ["subagent-only/lane-observe.ts"],
    "seuls write et edit touchent un fichier ; read n'est pas une mutation",
  );
  assert.deepEqual(info.commandsRun, ["bin/test-guards"]);
  assert.equal(info.summaryLines.length, 2);
  assert.ok(
    info.decisionSnippets.some((s: string) => s.includes("decided")),
    "une phrase portant un mot-clé de décision est retenue",
  );
});

// ------------------------------------------------------------- la reprise

test("une session reprise ne se renomme pas et n'écrit rien", async () => {
  /*
   * Deux promesses du README, et il faut les deux : une reprise ne génère **ni**
   * renommage **ni** entrée de journal.
   *
   * La seconde tenait déjà — `session_start` sort tôt, `sessionStartTime` reste
   * à zéro, la fermeture n'a rien à journaliser. La première ne tenait pas : la
   * remise à zéro de `hasNamed` rendait la session renommable au prompt suivant.
   * Ce test était vert parce qu'il ne regardait que la fermeture, ce qui est la
   * façon habituelle dont une garde manquante passe inaperçue.
   */
  const dossier = mkdtempSync(join(tmpdir(), "pi-journal-"));
  const cible = join(dossier, "journal.md");
  process.env["PI_JOURNAL_PATH"] = cible;
  try {
    const module = await import(`${MODULE}?reprise`);
    const h = monter({ entrees: [messageUtilisateur("bonjour")] });
    module.default(h.pi);

    await h.evenements.get("session_start")!({ reason: "resume" }, h.ctx);
    h.evenements.get("before_agent_start")!({ prompt: "message après reprise" }, h.ctx);
    await h.evenements.get("session_shutdown")!({}, h.ctx);

    assert.equal(h.nom(), undefined, "une session reprise garde le nom qu'elle avait");
    assert.deepEqual(h.statuts, [], "et ne repeint pas le statut");
    assert.throws(() => readFileSync(cible, "utf-8"), "aucun journal n'a été écrit");
    assert.deepEqual(h.dits, [], "et rien n'a été dit à l'utilisateur");
  } finally {
    delete process.env["PI_JOURNAL_PATH"];
    rmSync(dossier, { recursive: true, force: true });
  }
});

// --------------------------------------------------- l'échec, rendu visible

test("un journal impossible à écrire avertit une fois, et ne jette pas", async () => {
  /*
   * Le `catch` vide d'origine ne bloquait rien — bonne intention — mais rendait
   * l'indisponibilité invisible. Ici le répertoire parent est un fichier : le
   * `mkdir` échoue, donc l'écriture aussi.
   *
   * Deux propriétés, et il faut les deux : l'extension ne jette pas, et elle le
   * dit **exactement une fois**. Un avertissement répété à chaque fermeture
   * serait aussi inutilisable qu'un silence.
   */
  const dossier = mkdtempSync(join(tmpdir(), "pi-journal-"));
  const obstacle = join(dossier, "obstacle");
  writeFileSync(obstacle, "je suis un fichier, pas un répertoire\n");
  process.env["PI_JOURNAL_PATH"] = join(obstacle, "journal.md");
  try {
    const module = await import(`${MODULE}?echec`);
    const h = monter({ entrees: [messageUtilisateur("bonjour")] });
    module.default(h.pi);

    await h.evenements.get("session_start")!({ reason: "startup" }, h.ctx);
    await h.evenements.get("session_shutdown")!({}, h.ctx);
    await h.evenements.get("session_shutdown")!({}, h.ctx);

    const alertes = h.dits.filter((d) => d.genre === "warning");
    assert.equal(alertes.length, 1, "une seule fois, même sur deux fermetures");
    assert.match(alertes[0]!.texte, /journal indisponible/);
    assert.deepEqual(
      h.dits.filter((d) => d.genre === "info"),
      [],
      "et surtout : aucun « Session logged » quand rien n'a été écrit",
    );
  } finally {
    delete process.env["PI_JOURNAL_PATH"];
    rmSync(dossier, { recursive: true, force: true });
  }
});

test("une erreur avant l'écriture se dit aussi, et ne jette pas", () => {
  /*
   * Le `catch` extérieur de `session_shutdown` était vide. Une erreur dans
   * `getEntries()`, dans l'extraction ou dans la construction de l'entrée
   * supprimait la trace entière sans un mot — et le correctif précédent, qui ne
   * portait que sur l'écriture, donnait l'illusion que le point était clos.
   */
  return (async () => {
    const module = await import(`${MODULE}?entrees-jettent`);
    const h = monter({ entreesJettent: true });
    module.default(h.pi);

    await h.evenements.get("session_start")!({ reason: "startup" }, h.ctx);
    await h.evenements.get("session_shutdown")!({}, h.ctx);

    const alertes = h.dits.filter((d) => d.genre === "warning");
    assert.equal(alertes.length, 1);
    assert.match(alertes[0]!.texte, /registre de session illisible/);
    assert.deepEqual(h.dits.filter((d) => d.genre === "info"), []);
  })();
});

test("« une fois » veut dire une fois par session, pas par instance", async () => {
  /*
   * Deux cycles complets dans la même instance doivent produire deux
   * avertissements : le drapeau se remet à zéro à `session_start`. Sans ça, la
   * garantie n'était qu'« une fois par processus », et une seconde session
   * héritait du silence de la première.
   */
  const dossier = mkdtempSync(join(tmpdir(), "pi-journal-"));
  const obstacle = join(dossier, "obstacle");
  writeFileSync(obstacle, "fichier, pas répertoire\n");
  process.env["PI_JOURNAL_PATH"] = join(obstacle, "journal.md");
  try {
    const module = await import(`${MODULE}?deux-sessions`);
    const h = monter({ entrees: [messageUtilisateur("bonjour")] });
    module.default(h.pi);

    for (const _ of [1, 2]) {
      await h.evenements.get("session_start")!({ reason: "startup" }, h.ctx);
      await h.evenements.get("session_shutdown")!({}, h.ctx);
    }

    assert.equal(
      h.dits.filter((d) => d.genre === "warning").length,
      2,
      "deux sessions, deux avertissements",
    );
  } finally {
    delete process.env["PI_JOURNAL_PATH"];
    rmSync(dossier, { recursive: true, force: true });
  }
});

test("une seconde fermeture sans session ne rejournalise pas", async () => {
  const dossier = mkdtempSync(join(tmpdir(), "pi-journal-"));
  const cible = join(dossier, "journal.md");
  process.env["PI_JOURNAL_PATH"] = cible;
  try {
    const module = await import(`${MODULE}?double-fermeture`);
    const h = monter({ entrees: [messageUtilisateur("bonjour")] });
    module.default(h.pi);

    await h.evenements.get("session_start")!({ reason: "startup" }, h.ctx);
    await h.evenements.get("session_shutdown")!({}, h.ctx);
    await h.evenements.get("session_shutdown")!({}, h.ctx);

    const entrees = readFileSync(cible, "utf-8").split("\n").filter((l) => l.startsWith("## "));
    assert.equal(entrees.length, 1, "une fermeture consomme la session");
  } finally {
    delete process.env["PI_JOURNAL_PATH"];
    rmSync(dossier, { recursive: true, force: true });
  }
});
