/**
 * Lire un champ d'enveloppe, sans rien importer.
 *
 * Ces lectures vivaient en ligne dans `dispatch.ts`, chacune avec son propre
 * `Array.isArray` et son propre filtre, et aucune n'avait de test : le seul
 * harnais qui les traverse substitue `dispatch` entier, donc retirer la lecture
 * d'un champ ne cassait rien. `deviations` décide maintenant de l'abandon d'une
 * tentative d'intégration, et l'absence de test est devenue chère.
 *
 * Ici plutôt que dans `dispatch.ts` : ce dernier importe des modules que seul le
 * chargeur de substitution sait résoudre, donc il ne peut pas être importé par
 * un test ordinaire. Un fichier sans dépendance le peut.
 */

/** Un tableau de chaînes, ou `undefined` quand le champ n'en est pas un. */
export function envelopeStrings(
  envelope: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = envelope[key];
  if (!Array.isArray(value)) return undefined;
  // Le filtre compte autant que la garde : un tableau mêlant chaînes et objets
  // arrivait tel quel chez un appelant qui le tenait pour homogène.
  return value.filter((v: unknown): v is string => typeof v === "string");
}
