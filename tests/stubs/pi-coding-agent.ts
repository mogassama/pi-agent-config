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
  [k: string]: unknown;
}

/** `defineTool` ne fait que typer : le harnais récupère l'objet tel quel. */
export function defineTool<T>(tool: T): T {
  return tool;
}

/**
 * Le harnais n'émet pas d'événements d'outil, donc ce prédicat n'a rien à
 * reconnaître. Il garde la forme du vrai pour que l'appelant compile.
 */
export function isToolCallEventType(event: unknown, _kind?: string): boolean {
  return typeof event === "object" && event !== null && "type" in event;
}
