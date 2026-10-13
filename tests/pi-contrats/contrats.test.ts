/**
 * C1 à C8 sur le pi réel (PLAN § 3, item 1) : la campagne nominale de `bin/pi-contrats --qualifier`,
 * exécutée une fois. Hors du balayage de `bin/test-guards` (dossier tests/pi-contrats/).
 *
 *   PI_CONTRATS_CONSERVER=<dossier neuf> node --test tests/pi-contrats/contrats.test.ts
 *
 * Le dossier de conservation est exigé : il reçoit les observations de chaque exécution, leurs
 * pièces, N6, et le relevé complet RELEVE-QUALIFICATION.txt. Toute divergence au plan déclaré
 * arrête la campagne (ARRÊT) ; le test échoue alors, avec le relevé conservé.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ICI = dirname(fileURLToPath(import.meta.url));
const DEPOT = resolve(ICI, "..", "..");

test("item 1 : campagne nominale C1 à C8 sur pi 0.86.0, conforme au plan déclaré", () => {
  const conserver = process.env.PI_CONTRATS_CONSERVER;
  assert.ok(conserver, "PI_CONTRATS_CONSERVER absent : la campagne exige un dossier de conservation neuf");
  assert.ok(!existsSync(join(conserver, "plan.txt")), `${conserver} contient déjà une campagne`);
  mkdirSync(conserver, { recursive: true });
  const r = spawnSync(process.execPath, [join(DEPOT, "bin", "pi-contrats"), "--qualifier", "--conserver", conserver], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  writeFileSync(join(conserver, "RELEVE-QUALIFICATION.txt"), r.stdout ?? "");
  writeFileSync(join(conserver, "RELEVE-QUALIFICATION.stderr"), r.stderr ?? "");
  writeFileSync(join(conserver, "RELEVE-QUALIFICATION.rc"), `${r.status}\n`);
  assert.equal(r.status, 0, `qualification non conforme ; relevé : ${join(conserver, "RELEVE-QUALIFICATION.txt")}`);
  assert.match(r.stdout, /QUALIFICATION NOMINALE : toutes les exécutions conformes aux états attendus déclarés/);
  assert.match(r.stdout, /C2 — chargements : 12\/12 points d'entrée/);
  assert.match(r.stdout, /C2 — comportements non-TUI : 11\/11 satisfaits/);
});
