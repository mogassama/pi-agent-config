/**
 * Résolution du harnais : les substituts, et le `.js` → `.ts` que pi fait à
 * l'exécution.
 *
 * L'extension importe ses modules internes en `.js` — c'est la convention du
 * dépôt, et pi résout vers les sources TypeScript. Node ne le fait pas seul,
 * donc le harnais le reproduit plutôt que de demander au code de production
 * d'être écrit autrement pour être testable.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

let racine;

export function initialize(data) {
  racine = data.racine;
}

const SUBSTITUTS = new Map([
  ["@earendil-works/pi-coding-agent", "pi-coding-agent.ts"],
  ["typebox", "typebox.ts"],
]);

export function resolve(specifier, context, nextResolve) {
  const substitut = SUBSTITUTS.get(specifier);
  if (substitut) return { url: new URL(substitut, racine).href, shortCircuit: true };

  // Le dispatch réel lance des processus : le harnais fournit le sien.
  if (specifier.endsWith("/dispatch.js")) {
    return { url: new URL("dispatch.ts", racine).href, shortCircuit: true };
  }

  if (specifier.startsWith(".") && specifier.endsWith(".js") && context.parentURL) {
    const cible = new URL(specifier.replace(/\.js$/, ".ts"), context.parentURL);
    if (existsSync(fileURLToPath(cible))) return { url: cible.href, shortCircuit: true };
  }

  return nextResolve(specifier, context);
}
