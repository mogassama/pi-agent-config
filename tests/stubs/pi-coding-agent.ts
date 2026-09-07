/**
 * L'API d'extension de pi, réduite à ce que `extensions/subagent/index.ts`
 * importe réellement.
 *
 * Comme pour le stub de typebox : les exports sont ceux qui sont utilisés, et
 * rien d'autre. Un import nouveau doit faire échouer le chargement.
 */

export interface ExtensionAPI {
  on(event: string, handler: (...args: unknown[]) => unknown): void;
  registerTool(tool: unknown): void;
  /*
   * Typée pour la même raison que `registerTool` : l'index signature en bas rend
   * n'importe quel autre membre `unknown`, et un appel sur `unknown` ne passe
   * pas en strict.
   *
   * `command` reste `unknown` volontairement. Décrire ici la forme du contexte
   * reviendrait à retyper l'API de pi depuis les usages qu'on en fait — les
   * extensions du dépôt lisent `ctx.cwd`, `ctx.hasUI`, `ctx.ui.select` et
   * `ctx.ui.setFooter`, et une forme devinée les aurait toutes fait échouer sur
   * un stub, c'est-à-dire contre le substitut plutôt que contre pi. Chaque
   * appelant annote son propre handler.
   */
  registerCommand(name: string, command: unknown): void;
  [k: string]: unknown;
}

/** `defineTool` ne fait que typer : le harnais récupère l'objet tel quel. */
export function defineTool<T>(tool: T): T {
  return tool;
}

/**
 * `isToolCallEventType(kind, event)` — le genre d'abord, et l'événement porte
 * `toolName`.
 *
 * Deux corrections successives, et la seconde était la vraie. Les paramètres
 * étaient d'abord nommés dans l'autre sens : sans conséquence pour le harnais
 * d'`execute`, qui n'émet pas d'événements d'outil, donc le prédicat rendait
 * toujours `false` sans que personne le voie. Une fois l'ordre remis, le stub
 * lisait `event.type` — un champ inventé ici. Le harnais de `role-guard`
 * prouvait alors le câblage contre le protocole du stub, pas contre celui de pi,
 * ce qui est exactement la classe de défaut pour laquelle il a été écrit.
 *
 * La forme retenue est celle de la documentation de pi : un événement
 * `tool_call` porte `toolName`, `toolCallId` et `input`.
 */
export function isToolCallEventType(kind: string, event: unknown): boolean {
  return (
    typeof event === "object" &&
    event !== null &&
    (event as { toolName?: unknown }).toolName === kind
  );
}
