/**
 * Le contrat doit être le même quelle que soit la version de node.
 *
 * Chaque cas est joué deux fois : avec `AbortSignal.any` et sans. Un repli qui
 * n'annulerait que sur l'un des deux signaux ferait cesser silencieusement la
 * perte de propriété d'interrompre les enfants dès qu'un signal externe est
 * présent — et seule la barrière post-enfant protégerait, or elle empêche
 * d'intégrer, pas d'écrire.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { anySignal } from "../subagent-only/signals.ts";

/** Joue le cas avec le natif, puis en le masquant pour éprouver le repli. */
function desDeuxFaçons(nom: string, cas: () => void) {
  test(`${nom} · natif`, cas);
  test(`${nom} · repli`, () => {
    const cible = AbortSignal as unknown as { any?: unknown };
    const natif = cible.any;
    delete cible.any;
    try {
      cas();
    } finally {
      if (natif !== undefined) cible.any = natif;
    }
  });
}

desDeuxFaçons("le signal externe abat le signal joint", () => {
  const externe = new AbortController();
  const bail = new AbortController();
  const joint = anySignal([externe.signal, bail.signal]);
  assert.equal(joint.aborted, false);
  externe.abort(new Error("annulation opérateur"));
  assert.equal(joint.aborted, true);
});

desDeuxFaçons("le signal du bail abat le signal joint", () => {
  const externe = new AbortController();
  const bail = new AbortController();
  const joint = anySignal([externe.signal, bail.signal]);
  bail.abort(new Error("propriété perdue"));
  assert.equal(joint.aborted, true);
});

// C'est le cas que le repli incomplet aurait perdu : un signal externe présent
// et une perte de propriété qui n'interrompt plus rien.
desDeuxFaçons("un externe présent n'empêche pas le bail d'abattre", () => {
  const externe = new AbortController();
  const bail = new AbortController();
  const joint = anySignal([externe.signal, bail.signal]);
  bail.abort(new Error("propriété perdue"));
  assert.equal(joint.aborted, true);
  assert.equal(externe.signal.aborted, false);
});

// La raison doit survivre : un run interrompu dont on ignore s'il a été arrêté
// ou repris par une autre session est illisible au moment de le réconcilier.
desDeuxFaçons("la raison de l'annulation est conservée", () => {
  const externe = new AbortController();
  const bail = new AbortController();
  const joint = anySignal([externe.signal, bail.signal]);
  bail.abort(new Error("propriété du run perdue"));
  assert.match(String((joint.reason as Error)?.message), /propriété du run perdue/);
});

desDeuxFaçons("un signal déjà abattu abat immédiatement", () => {
  const dejaFait = new AbortController();
  dejaFait.abort(new Error("trop tard"));
  const joint = anySignal([dejaFait.signal, new AbortController().signal]);
  assert.equal(joint.aborted, true);
  assert.match(String((joint.reason as Error)?.message), /trop tard/);
});

desDeuxFaçons("la première raison gagne, la seconde ne l'écrase pas", () => {
  const un = new AbortController();
  const deux = new AbortController();
  const joint = anySignal([un.signal, deux.signal]);
  un.abort(new Error("première"));
  deux.abort(new Error("seconde"));
  assert.match(String((joint.reason as Error)?.message), /première/);
});

desDeuxFaçons("un seul signal se comporte comme lui-même", () => {
  const seul = new AbortController();
  const joint = anySignal([seul.signal]);
  seul.abort(new Error("x"));
  assert.equal(joint.aborted, true);
});
