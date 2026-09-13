/**
 * l0-b3-fixtures.ts — ce que B3 monte, et qui n'existe pas encore dans l'objet.
 *
 * Pas un test : le nom ne finit pas par `.test.ts`, la suite ne le lance pas.
 *
 * Trois familles :
 *   DESIGN.md et son plan   le vocabulaire fermé des statuts, les décisions et le
 *                           `design_update` que C6.1 attache à une unité
 *   hooks                   de vrais `pre-commit`, posés par un `core.hooksPath` propre à
 *                           la lane — dans un worktree, `.git` est un fichier, et
 *                           `<worktree>/.git/hooks` n'existe pas
 *   fenêtres de crash       de vrais états git accordés à un registre arrêté au bon
 *                           événement, jamais un drapeau interne
 */
import { execFileSync } from "node:child_process";
import {
  chmodSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { git, type Harnais } from "./l0-b2-harness.ts";

const jetables: string[] = [];
/** Les répertoires de hooks à effacer en fin de fichier de test. */
export const hooksAJeter = (): readonly string[] => jetables;
export const nettoyerHooks = (): void => {
  for (const d of jetables) rmSync(d, { recursive: true, force: true });
};

/** Le vocabulaire fermé de DESIGN.md, et les transitions qu'il autorise. */
export const STATUTS = ["proposé", "en cours", "terminé"] as const;
export const TRANSITIONS: Array<[string, string]> = [
  ["proposé", "en cours"],
  ["en cours", "terminé"],
];

export interface Decision {
  id: string;
  titre: string;
  statut: string;
}

/**
 * Un DESIGN.md lisible, avec ses décisions identifiées.
 *
 * `avant` permet de déplacer les décisions dans le fichier sans rien changer d'autre :
 * une implémentation qui chercherait par numéro de ligne échouerait sur la seconde
 * disposition, et c'est le but.
 */
export function designMd(decisions: Decision[], avant = ""): string {
  const corps = decisions
    .map((d) => `### ${d.id} — ${d.titre}\n\nStatut : ${d.statut}\n`)
    .join("\n");
  return `# DESIGN\n\n${avant}## Décisions\n\n${corps}`;
}

/** Le statut d'une décision, relu dans un DESIGN.md. */
export function statutDe(contenu: string, id: string): string | undefined {
  const bloc = contenu.split(/^### /m).find((b) => b.startsWith(`${id} `));
  return bloc?.match(/^Statut : (.+)$/m)?.[1]?.trim();
}

/** Un plan dont les unités portent, ou non, un `design_update` (C6.1). */
export function planAvecDesign(
  unites: Array<{ id: string; design_update?: { decision_id: string; from_status: string; to_status: string } }>,
): unknown {
  return {
    version: 1,
    work_units: unites.map((u) => ({
      id: u.id,
      goal: `faire ${u.id}`,
      depends_on: [],
      expected_write_scope: [`src/${u.id === "W03" ? "a" : "b"}.py`],
      ...(u.design_update ? { design_update: u.design_update } : {}),
    })),
  };
}

// ------------------------------------------------------------------ hooks

/**
 * Un `pre-commit` réel sur la lane, et sur elle seule.
 *
 * `<worktree>/.git` est un fichier, pas un répertoire : y poser `hooks/pre-commit` ne
 * ferait rien. On passe donc par `core.hooksPath`, réglé dans la configuration locale du
 * worktree, ce qui limite le hook à cette lane.
 */
export function poserPreCommit(h: Harnais, lane: string, corps: string): string {
  const cwd = join(h.root, ".git", "pi-lanes", lane);
  // Hors de l'arbre de travail : un répertoire de hooks posé DANS la lane serait un
  // fichier non suivi de plus, et la porte refuserait pour dépassement de scope — la
  // preuve serait verte sans jamais parler du hook.
  const dir = mkdtempSync(join(tmpdir(), "pi-l0b3-hooks-"));
  jetables.push(dir);
  const chemin = join(dir, "pre-commit");
  writeFileSync(chemin, `#!/usr/bin/env bash\nset -euo pipefail\n${corps}\n`);
  chmodSync(chemin, 0o755);
  // `--worktree` exige que le dépôt déclare la configuration par worktree ; sans cela,
  // le hook vaudrait pour toutes les lanes et la preuve ne dirait plus laquelle a gelé.
  execFileSync("git", ["config", "extensions.worktreeConfig", "true"], { cwd: h.root, stdio: "ignore" });
  execFileSync("git", ["config", "--worktree", "core.hooksPath", dir], { cwd, stdio: "ignore" });
  return chemin;
}

/** Le marqueur qu'un hook laisse hors du worktree : sans lui, on ignore s'il a tourné. */
export const marqueurHook = (): string => {
  const d = mkdtempSync(join(tmpdir(), "pi-l0b3-marq-"));
  jetables.push(d);
  return join(d, "execute");
};
export const aTourne = (marqueur: string): boolean => existsSync(marqueur);

/** Le même mécanisme, mais sur la racine : c'est là que le commit de Statut a lieu. */
export function poserPreCommitRacine(h: Harnais, corps: string): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-l0b3-hooks-"));
  jetables.push(dir);
  const chemin = join(dir, "pre-commit");
  writeFileSync(chemin, `#!/usr/bin/env bash\nset -uo pipefail\n${corps}\n`);
  chmodSync(chemin, 0o755);
  git(h.root, "config", "core.hooksPath", dir);
  return chemin;
}

/** Un hook qui réécrit un fichier réel et l'indexe : l'arbre de travail change aussi. */
export const HOOK_FICHIERS = (fichier: string, marqueur: string): string =>
  `printf 'tourné\\n' > "${marqueur}"\n` +
  `printf 'transformé par le hook\\n' > "${fichier}"\ngit add "${fichier}"`;

/**
 * Un hook qui n'écrit que dans l'index : l'arbre de travail reste T_L.
 *
 * `hash-object -w` fabrique le blob, `update-index --cacheinfo` l'indexe. Après un
 * `reset --mixed`, l'arbre est exactement celui qui avait été approuvé — et c'est la
 * forme où la boucle menacerait de s'amorcer.
 *
 * Le fichier visé est DANS le scope de l'unité : un fichier hors scope ferait refuser par
 * `scope-breach`, et la preuve serait verte sans rien dire de C2.4.
 */
export const CONTENU_INDEX = "seulement dans l index\n";
export const HOOK_INDEX = (fichier: string, marqueur: string): string =>
  `printf 'tourné\\n' > "${marqueur}"\n` +
  `blob=$(printf '${CONTENU_INDEX.replace(/\n/g, "\\n")}' | git hash-object -w --stdin)\n` +
  `git update-index --add --cacheinfo 100644,"$blob","${fichier}"`;

// ------------------------------------------------------------------ registre et git

export const cheminLanes = (h: Harnais): string => join(h.runDir, `${h.runId}-lanes.jsonl`);

/** Les événements du registre, et rien d'autre : les fixtures de crash s'y arrêtent net. */
export function tronquerRegistre(h: Harnais, apres: (e: Record<string, unknown>) => boolean): void {
  const lignes = readFileSync(cheminLanes(h), "utf-8").split("\n").filter(Boolean);
  const gardees: string[] = [];
  for (const l of lignes) {
    gardees.push(l);
    let e: Record<string, unknown>;
    try { e = JSON.parse(l) as Record<string, unknown>; } catch { continue; }
    if (apres(e)) break;
  }
  writeFileSync(cheminLanes(h), `${gardees.join("\n")}\n`);
}

/** Retirer du registre tous les événements qui satisfont un prédicat. */
export function retirerEvenements(h: Harnais, predicat: (e: Record<string, unknown>) => boolean): void {
  const lignes = readFileSync(cheminLanes(h), "utf-8").split("\n").filter(Boolean);
  const gardees = lignes.filter((l, i) => {
    if (i === 0) return true;
    try { return !predicat(JSON.parse(l) as Record<string, unknown>); } catch { return true; }
  });
  writeFileSync(cheminLanes(h), `${gardees.join("\n")}\n`);
}

/** Ajouter un événement au registre, dans la version que l'en-tête déclare. */
/** Ajouter un événement et rendre le `event_seq` qui lui a été donné. */
export function ajouterEvenement(h: Harnais, evenement: Record<string, unknown>): number {
  // Le registre est créé paresseusement : une fixture canonique v2 le pose elle-même,
  // avec son en-tête, plutôt que d'attendre que le runtime l'écrive en v1.
  if (!existsSync(cheminLanes(h))) writeFileSync(cheminLanes(h), `${JSON.stringify({ ledger: 2 })}\n`);
  const lignes = readFileSync(cheminLanes(h), "utf-8").split("\n").filter(Boolean);
  const corps = lignes.slice(1).map((l) => JSON.parse(l) as Record<string, unknown>);
  const seqs = corps.map((e) => e.event_seq).filter((v): v is number => Number.isInteger(v));
  const entete = JSON.parse(lignes[0]) as { ledger?: number };
  const seq = Math.max(0, ...seqs) + 1;
  const ligne = entete.ledger === 2
    ? JSON.stringify({ event_seq: seq, at: new Date().toISOString(), ...evenement })
    : JSON.stringify({ at: new Date().toISOString(), ...evenement });
  writeFileSync(cheminLanes(h), `${readFileSync(cheminLanes(h), "utf-8")}${ligne}\n`);
  return seq;
}

/**
 * Le résultat structuré d'une intégration réussie (C5.7).
 *
 * `null` dit que la structure n'existe pas — ce qui n'est pas la même chose qu'une
 * intégration refusée. Aujourd'hui la réussite ne se lit que dans une phrase.
 */
export function integration(resultat: unknown): Record<string, unknown> | null {
  const d = (resultat as { details?: { integration?: unknown } })?.details?.integration;
  return d && typeof d === "object" ? (d as Record<string, unknown>) : null;
}
/** Le refus durable de C6.6, tel que la sortie publique doit le porter. */
export function gardeDeRun(resultat: unknown): Record<string, unknown> | null {
  const d = (resultat as { details?: { run_guard?: unknown } })?.details?.run_guard;
  return d && typeof d === "object" ? (d as Record<string, unknown>) : null;
}

/**
 * Un état canonique v2, construit de toutes pièces.
 *
 * La première version fabriquait les fenêtres de crash en laissant l'ancien runtime
 * intégrer, puis en retirant `INTEGRATED`. La fixture dépendait donc de ce que le runtime
 * fait aujourd'hui, et non de ce que § F décrit — elle serait devenue fausse à la
 * première correction. Ici, git et le registre sont écrits ensemble, événement par
 * événement, avec des objets réels et des renvois exacts.
 *
 * `jusqua` dit où l'histoire s'arrête : c'est la fenêtre de crash.
 */
export interface EtatCanonique {
  lane: string;
  base: string;
  gel: string;
  treeGel: string;
  integrationCommit?: string;
  statusCommit?: string;
  seq: { opened: number; reviewed: number; frozen?: number; merged?: number };
}

export function etatCanonique(
  h: Harnais,
  options: {
    unite?: string;
    jusqua: "REVIEWED" | "FROZEN" | "MERGED" | "INTEGRATED";
    /** La transition que le commit de Statut applique, si l'histoire va jusque-là. */
    design?: { decision_id: string; from_status: string; to_status: string };
    /** Fausser le parent du commit de Statut, ou sa transformation. */
    fausser?: "parent" | "transformation";
  },
): EtatCanonique {
  const unite = options.unite ?? "W03";
  const lane = `${h.runId}-${unite}-g1`;
  const cwd = join(h.root, ".git", "pi-lanes", lane);
  git(h.root, "worktree", "add", "-q", "-b", `pi-lane/${lane}`, cwd);
  const base = teteDe(cwd);

  // La lane travaille et gèle : de vrais objets, pas des empreintes inventées.
  writeFileSync(join(cwd, "src", unite === "W03" ? "a.py" : "b.py"), `${unite} = 2\n`);
  git(cwd, "add", "-A");
  git(cwd, "commit", "-qm", `gel ${unite}`);
  const gel = teteDe(cwd);
  const treeGel = treeDe(cwd);

  const ecrire = (reste: Record<string, unknown>): number =>
    ajouterEvenement(h, { work_unit: unite, lane, ...reste });

  const opened = ecrire({ event: "OPENED", base, generation: 1 });
  const reviewed = ecrire({
    event: "REVIEWED",
    from_tree: treeDe(h.root),
    tree: treeGel,
    verdict: "approved",
    reviewer: { delegation_seq: 2, agent: "reviewer", role: "reviewer" },
    proof: { mode: "diff" },
  });
  const etat: EtatCanonique = { lane, base, gel, treeGel, seq: { opened, reviewed } };
  if (options.jusqua === "REVIEWED") return publier(h, etat);

  etat.seq.frozen = ecrire({
    event: "FROZEN", commit: gel, parent: base, tree: treeGel, reviewed_event_seq: reviewed,
  });
  if (options.jusqua === "FROZEN") {
    // Le merge a eu lieu, le registre ne le dit pas encore.
    git(h.root, "merge", "--no-ff", "-q", "-m", `integrate ${unite}`, `pi-lane/${lane}`);
    etat.integrationCommit = teteDe(h.root);
    return publier(h, etat);
  }

  git(h.root, "merge", "--no-ff", "-q", "-m", `integrate ${unite}`, `pi-lane/${lane}`);
  etat.integrationCommit = teteDe(h.root);
  etat.seq.merged = ecrire({
    event: "MERGED", integration_commit: etat.integrationCommit, frozen_event_seq: etat.seq.frozen,
  });
  if (options.jusqua === "MERGED") {
    if (options.design) {
      // Le commit de Statut existe, INTEGRATED manque : la troisième fenêtre.
      if (options.fausser === "parent") {
        git(h.root, "commit", "-q", "--allow-empty", "-m", "commit intercalé");
      }
      const contenu = readFileSync(join(h.root, "DESIGN.md"), "utf-8");
      const transforme = options.fausser === "transformation"
        ? `${contenu}\n<!-- une transformation qui n'est pas la transition -->\n`
        : contenu.replace(
            new RegExp(`(### ${options.design.decision_id} [^]*?Statut : )${options.design.from_status}`),
            `$1${options.design.to_status}`,
          );
      writeFileSync(join(h.root, "DESIGN.md"), transforme);
      git(h.root, "add", "DESIGN.md");
      git(h.root, "commit", "-qm", `statut ${options.design.decision_id}`);
      etat.statusCommit = teteDe(h.root);
    }
    return publier(h, etat);
  }

  ecrire({
    event: "INTEGRATED",
    integration_commit: etat.integrationCommit,
    status: { outcome: "not-applicable" },
  });
  // Une unité intégrée ne conserve pas de lane ouverte.
  git(h.root, "worktree", "remove", "--force", cwd);
  return publier(h, etat);
}

/**
 * Le témoin du registre, publié après lui et jamais avant (C4.1).
 *
 * Sans ce témoin, un registre v2 se lirait RUN_WITHOUT_WITNESS : la fixture ne serait pas
 * conforme à C4, et une implémentation correcte aurait raison de la refuser. La table
 * reste partielle — aucun `integrations`, dont l'en-tête n'existe pas.
 */
function publier(h: Harnais, etat: EtatCanonique): EtatCanonique {
  const chemin = join(h.runDir, "active-run.json");
  const manifeste = JSON.parse(readFileSync(chemin, "utf-8")) as Record<string, unknown>;
  const ledgers = { ...((manifeste.ledgers as Record<string, number>) ?? {}), lanes: 2 };
  const tmp = `${chemin}.l0b3`;
  writeFileSync(tmp, `${JSON.stringify({ ...manifeste, version: 2, ledgers }, null, 2)}\n`);
  renameSync(tmp, chemin);
  return etat;
}

export const teteDe = (cwd: string): string => git(cwd, "rev-parse", "HEAD").trim();
/**
 * La tête d'une branche de lane, lue depuis la RACINE.
 *
 * Le worktree disparaît dès que la lane est intégrée : le lire depuis la lane elle-même
 * ferait échouer la preuve sur un `ENOENT` au lieu de sa propriété.
 */
export const teteDeLane = (root: string, lane: string): string =>
  git(root, "rev-parse", `pi-lane/${lane}`).trim();
export const treeDe = (cwd: string, ref = "HEAD"): string => git(cwd, "rev-parse", `${ref}^{tree}`).trim();
/** Les commits de merge d'une unité dans la racine — un merge, pas une mention. */
export const mergesDe = (root: string, unite: string): number =>
  git(root, "log", "--merges", "--oneline").split("\n").filter((l) => l.includes(unite)).length;

export const racinePropre = (root: string): boolean =>
  git(root, "status", "--porcelain", "--untracked-files=all").trim() === "";
