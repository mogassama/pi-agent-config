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
  // Listed for tests/pi-contrats/extensions-epreuve.ts (outil `submit` d'épreuve) under the S4 profile,
  // which maps typebox to this stub; typebox 1.3.27 of pi 0.86.0 declares
  // `Number(options?: TNumberOptions): TNumber` (build/type/types/number.d.mts, sha256 4d142fee…).
  Number: (options?: Record<string, unknown>): Schema => ({ kind: "number", ...options }),
  Array: (items: Schema, options?: Record<string, unknown>): Schema => ({
    kind: "array", items, ...options,
  }),
  Optional: (schema: Schema): Schema => ({ ...schema, optional: true }),
  // Listed for subagent-only/envelope/envelope.ts (`Type.Union([Type.String(), Type.Null()])`):
  // without it the S4 programme reports TS2339 « Property 'Null' does not exist », whose message prints
  // this object's type and therefore changes with every listed constructor (stop A4 r3).
  // typebox 1.3.27 of pi 0.86.0 declares `Null(options?: TSchemaOptions): TNull`.
  Null: (options?: Record<string, unknown>): Schema => ({ kind: "null", ...options }),
  Literal: (value: unknown): Schema => ({ kind: "literal", value }),
  Union: (variants: Schema[], options?: Record<string, unknown>): Schema => ({
    kind: "union", variants, ...options,
  }),
};

/** `Static<T>` est purement statique ; à l'exécution il n'existe pas. */
export type Static<T> = T extends { __static: infer S } ? S : Record<string, unknown>;
