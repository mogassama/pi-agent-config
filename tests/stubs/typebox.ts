/**
 * Un `typebox` de substitution, pour le harnais de `execute`.
 *
 * Le harnais n'éprouve pas la validation de schéma : il éprouve le trajet
 * d'`execute` — validations, propriété, séquence, worktree, dispatch, barrière.
 * Le stub doit donc seulement permettre à `index.ts` de construire ses schémas.
 *
 * Les constructeurs sont **listés explicitement**, jamais un proxy permissif.
 * Si `index.ts` se met à en utiliser un nouveau, le harnais doit casser plutôt
 * que d'accepter silencieusement : un harnais qui absorbe tout finit par ne
 * plus rien garantir.
 */

export interface Schema {
  kind: string;
  [k: string]: unknown;
}

export const Type = {
  Object: (properties: Record<string, Schema>, options?: Record<string, unknown>): Schema => ({
    kind: "object", properties, ...options,
  }),
  String: (options?: Record<string, unknown>): Schema => ({ kind: "string", ...options }),
  Array: (items: Schema, options?: Record<string, unknown>): Schema => ({
    kind: "array", items, ...options,
  }),
  Optional: (schema: Schema): Schema => ({ ...schema, optional: true }),
  Literal: (value: unknown): Schema => ({ kind: "literal", value }),
  Union: (variants: Schema[], options?: Record<string, unknown>): Schema => ({
    kind: "union", variants, ...options,
  }),
};

/** `Static<T>` est purement statique ; à l'exécution il n'existe pas. */
export type Static<T> = T extends { __static: infer S } ? S : Record<string, unknown>;
