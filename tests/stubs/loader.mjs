/**
 * Substitue les dépendances externes de l'extension, sans jamais les rendre
 * facultatives.
 *
 * Un harnais qui se sauterait quand un paquet manque serait un test vert qui
 * ne vérifie rien — et cette phase vient justement de trouver deux barrières
 * mal placées que seuls des tests de câblage pouvaient voir. Si la substitution
 * échoue, le chargement échoue et le test est rouge.
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

const ICI = new URL("./", import.meta.url);

register(
  new URL("./resolve-hooks.mjs", ICI),
  { parentURL: ICI, data: { racine: ICI.href } },
);
