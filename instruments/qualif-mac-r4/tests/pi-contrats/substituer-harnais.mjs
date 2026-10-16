/**
 * Substitution du harnais pour le seul mutant du contrôle de lecteur M6.15/interprete (R3,
 * adjudication a0000800), employée par `falsifier.sh --lecteur-item1` et par rien d'autre.
 *
 *   node --import tests/pi-contrats/substituer-harnais.mjs bin/pi-contrats --lecteur-interprete …
 *
 * Pour l'URL du harnais d'origine (PI_CONTRATS_HARNAIS_CIBLE), le chargeur sert la source de sa
 * copie (PI_CONTRATS_HARNAIS_COPIE), une seule fois ; tout autre module est chargé tel quel.
 * L'analyse garde ainsi la racine d'instrument de l'exécution analysée (racines admises de
 * M2.11) : une copie lancée depuis un autre emplacement relèverait M2.11 pour les extensions
 * d'épreuve de la trace, constat dû à l'emplacement et non à la mutation. Le nombre de
 * substitutions est écrit dans PI_CONTRATS_SUBSTITUTION_TEMOIN à la sortie du processus.
 * Aucun fichier du dépôt n'est écrit.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

const copie = process.env.PI_CONTRATS_HARNAIS_COPIE;
const cible = process.env.PI_CONTRATS_HARNAIS_CIBLE;
const temoin = process.env.PI_CONTRATS_SUBSTITUTION_TEMOIN;
if (!copie || !cible || !temoin) throw new Error("substitution du harnais : PI_CONTRATS_HARNAIS_COPIE, PI_CONTRATS_HARNAIS_CIBLE et PI_CONTRATS_SUBSTITUTION_TEMOIN sont exigées");
const url = pathToFileURL(cible).href;
const source = readFileSync(copie, "utf8");
let substitutions = 0;
registerHooks({
  load(u, contexte, suivant) {
    const r = suivant(u, contexte);
    if (u !== url) return r;
    substitutions++;
    return { ...r, source, shortCircuit: true };
  },
});
process.on("exit", () => writeFileSync(temoin, `${substitutions}\n`));
