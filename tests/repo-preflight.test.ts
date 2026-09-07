/**
 * repo-preflight.test.ts — la propriété, pas le mécanisme.
 *
 * Le runtime exige que son instrumentation soit ignorée par git. Il n'exige pas
 * qu'elle le soit par un fichier en particulier : git ignore par `.gitignore`,
 * par `.git/info/exclude` ou par une configuration globale, et imposer l'un des
 * trois serait imposer un mécanisme là où seule la propriété compte.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { instrumentationIgnored } from "../subagent-only/repo-preflight.ts";

const RUNS = ".pi-subagent-runs";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" });
}

function repo(): { root: string; done: () => void } {
  const root = mkdtempSync(join(tmpdir(), "pi-preflight-"));
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  writeFileSync(join(root, "a.txt"), "a\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");
  return { root, done: () => rmSync(root, { recursive: true, force: true }) };
}

test("un dépôt qui n'ignore rien est refusé", () => {
  const { root, done } = repo();
  try {
    const r = instrumentationIgnored(root, RUNS);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /n'est pas ignoré par ce dépôt/);
  } finally {
    done();
  }
});

test("le .gitignore convient", () => {
  const { root, done } = repo();
  try {
    writeFileSync(join(root, ".gitignore"), `${RUNS}/\n`);
    assert.equal(instrumentationIgnored(root, RUNS).ok, true);
  } finally {
    done();
  }
});

test("`.git/info/exclude` convient tout autant", () => {
  // Le mécanisme n'est pas imposé : un opérateur qui ne veut pas toucher au
  // `.gitignore` partagé du dépôt a le droit de l'exclure localement.
  const { root, done } = repo();
  try {
    mkdirSync(join(root, ".git", "info"), { recursive: true });
    writeFileSync(join(root, ".git", "info", "exclude"), `${RUNS}/\n`);
    assert.equal(instrumentationIgnored(root, RUNS).ok, true);
  } finally {
    done();
  }
});

test("une règle qui ne couvre qu'un chemin sonde ne suffit pas", () => {
  /*
   * La garde était plus faible que la propriété annoncée : interroger un chemin
   * sonde sous le répertoire, c'est demander si *ce chemin-là* est ignoré. Une
   * règle qui ne couvre que lui répondait oui pendant que le manifeste, le plan
   * gelé et le registre des lanes restaient suivis.
   */
  const { root, done } = repo();
  try {
    writeFileSync(join(root, ".gitignore"), `${RUNS}/.pi-runtime-probe\n`);
    const r = instrumentationIgnored(root, RUNS);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /n'est pas ignoré/);
  } finally {
    done();
  }
});

test("un artefact futur du même namespace est couvert d'avance", () => {
  const { root, done } = repo();
  try {
    writeFileSync(join(root, ".gitignore"), `${RUNS}/\n`);
    assert.equal(instrumentationIgnored(root, RUNS).ok, true);
    // Ce que la règle couvre, et que le préflight n'a pas eu à énumérer.
    const ignore = (chemin: string) => {
      try {
        execFileSync("git", ["check-ignore", "-q", "--", chemin], { cwd: root });
        return true;
      } catch {
        return false;
      }
    };
    for (const nom of ["active-run.json", "abc-plan.json", "abc-lanes.jsonl", "futur.bin"]) {
      assert.equal(ignore(`${RUNS}/${nom}`), true, nom);
    }
    assert.equal(ignore("src/a.py"), false, "et rien d'autre");
  } finally {
    done();
  }
});

test("rien n'est créé pour poser la question", () => {
  /*
   * `check-ignore` répond sur un chemin qui n'existe pas, ce qui est exactement
   * ce qu'on veut d'une vérification qui doit précéder la première écriture. La
   * faire en créant un fichier ferait ce qu'elle cherche à empêcher.
   */
  const { root, done } = repo();
  try {
    writeFileSync(join(root, ".gitignore"), `${RUNS}/\n`);
    git(root, "add", "-A");
    git(root, "commit", "-qm", "ignore l'instrumentation");
    instrumentationIgnored(root, RUNS);
    assert.equal(existsSync(join(root, RUNS)), false);
    assert.equal(git(root, "status", "--porcelain", "--untracked-files=all").trim(), "");
  } finally {
    done();
  }
});

test("un fichier déjà suivi est refusé malgré la règle d'exclusion", () => {
  /*
   * Une règle d'exclusion ne délivre pas un fichier déjà suivi : il reste dans
   * l'index, et chaque écriture du runtime apparaît comme une modification. La
   * question « est-ce ignoré » ne suffit donc pas seule.
   */
  const { root, done } = repo();
  try {
    mkdirSync(join(root, RUNS), { recursive: true });
    writeFileSync(join(root, RUNS, "vieux-manifest.json"), "{}\n");
    git(root, "add", "-f", `${RUNS}/vieux-manifest.json`);
    git(root, "commit", "-qm", "instrumentation commitée par erreur");
    writeFileSync(join(root, ".gitignore"), `${RUNS}/\n`);

    const r = instrumentationIgnored(root, RUNS);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.reason, /suivis par git/);
      assert.match(r.reason, /git rm --cached/);
    }
  } finally {
    done();
  }
});

test("hors d'un dépôt git, le préflight ne se prononce pas", () => {
  // Il répond sur ce qu'il sait. Décider qu'une session hors dépôt ne peut pas
  // déléguer serait une autre règle, et elle appartient à quelqu'un d'autre.
  const dir = mkdtempSync(join(tmpdir(), "pi-nogit-"));
  try {
    assert.equal(instrumentationIgnored(dir, RUNS).ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
