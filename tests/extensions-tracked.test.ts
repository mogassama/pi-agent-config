/**
 * extensions-tracked.test.ts — une extension active hors git n'existe pas.
 *
 * `pi-session-journal` a vécu cinq mois dans `extensions/`, chargée à chaque
 * session, et absente de tout clone : `.gitignore` l'excluait explicitement, et
 * l'exclusion avait voyagé dans un commit qui parlait d'autre chose. Elle était
 * donc invisible à une réinstallation, à une revue, et à un audit — le système
 * lancé n'était pas le système versionné.
 *
 * `config.test.ts` ne pouvait pas l'attraper : il vérifie que toute extension
 * **déclarée par un agent** existe sur disque, et aucun agent ne déclare
 * celle-ci — elle est activée au niveau de pi. La question posée ici est l'autre
 * moitié : ce qui est sur disque est-il versionné ?
 *
 * La garde exige que chaque **point d'entrée** soit suivi, et pas seulement que
 * le répertoire contienne un fichier suivi : un `package.json` versionné avec un
 * `index.ts` local passerait cette forme faible, et c'est exactement la forme du
 * défaut qu'on vient de payer.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const RACINE = join(import.meta.dirname, "..");

function suivi(chemin: string): boolean {
  try {
    // Une garde de suivi, jamais appelée depuis une reconstruction. Pas
    // d'annotation `git-launch:` ici : les tests ne sont pas inventoriés, et une
    // étiquette que rien ne lit serait décorative.
    execFileSync("git", ["ls-files", "--error-unmatch", "--", chemin], {
      cwd: RACINE,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

test("la garde peut être évaluée : ceci est un dépôt git", () => {
  /*
   * Elle échoue plutôt que de passer à vide. Une archive décompressée ne peut
   * rien prouver sur ce qu'elle suit, et une garde qui devient silencieusement
   * verte hors dépôt serait décorative là où elle compte le plus — sur la
   * machine où l'extension avait disparu.
   */
  let dansUnDepot = true;
  try {
    execFileSync("git", ["rev-parse", "--git-dir"], { cwd: RACINE, stdio: "ignore" });
  } catch {
    dansUnDepot = false;
  }
  assert.ok(
    dansUnDepot,
    "cette garde exige un dépôt git : une archive décompressée ne peut pas prouver " +
      "ce qu'elle suit, et passer à vide vaudrait moins que rien",
  );
});

test("chaque extension présente sur disque a son index.ts suivi", () => {
  const manquants: string[] = [];
  for (const e of readdirSync(join(RACINE, "extensions"), { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const entree = join("extensions", e.name, "index.ts");
    if (!existsSync(join(RACINE, entree))) continue;
    if (!suivi(entree)) manquants.push(entree);
  }
  assert.deepEqual(
    manquants,
    [],
    "une extension est chargée depuis le disque et absente du dépôt : elle ne sera " +
      "dans aucun clone, donc ni auditée ni réinstallée",
  );
});

test("aucun fichier de production d'une extension n'échappe au dépôt", () => {
  /*
   * Le point d'entrée ne suffit pas : un `index.ts` suivi qui importe un module
   * voisin non suivi rejouerait le même défaut d'un cran plus bas.
   */
  const manquants: string[] = [];
  const marcher = (relatif: string) => {
    for (const e of readdirSync(join(RACINE, relatif), { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const sous = join(relatif, e.name);
      if (e.isDirectory()) marcher(sous);
      else if (e.name.endsWith(".ts") && !suivi(sous)) manquants.push(sous);
    }
  };
  marcher("extensions");
  assert.deepEqual(manquants, [], "des sources d'extension ne sont pas versionnées");
});
