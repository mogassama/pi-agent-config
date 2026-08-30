/**
 * The attempt machine — the wiring, not the primitives.
 *
 * Every defect in this sequence had one shape: `run-state` could represent the
 * right thing, and the caller did something else. Each was found by review, not
 * by a test, because the caller lived inside a module that imports pi and no
 * test could reach it. `runAttempts` is that caller with the pi parts handed in,
 * so a test can watch what it calls and in what order.
 *
 * What this proves, and the previous tests could not: four delegations with one
 * fallback produce four `finish` calls and five attempts — not five and five,
 * which is what the code did while claiming otherwise.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { runAttempts, type AttemptOutcome } from "../subagent-only/attempts.ts";

const FLASH = "flash";
const GEMINI = "gemini";
const RETRYABLE = new Set(["provider_error", "spawn_error"]);

interface R extends AttemptOutcome {
  model: string;
  summary: string;
}

/** Records every call, so a test asserts on the sequence rather than the result. */
function harness(script: Array<Partial<R>>, opts: { mutates?: boolean; abortAfter?: number } = {}) {
  const attempts: string[] = [];
  const fallbacks: Array<[string, string]> = [];
  const finished: R[] = [];
  let i = 0;
  return {
    attempts,
    fallbacks,
    finished,
    plan: {
      chain: [FLASH, GEMINI],
      mutates: opts.mutates ?? false,
      retryable: RETRYABLE,
      aborted: () => opts.abortAfter !== undefined && attempts.length >= opts.abortAfter,
      attempt: async (model: string): Promise<R> => {
        attempts.push(model);
        const step = script[i++] ?? {};
        return { model, summary: step.summary ?? "ok", ...step };
      },
      onFallback: (from: string, to: string) => void fallbacks.push([from, to]),
      finish: (r: R): R => {
        finished.push(r);
        return r;
      },
      exhausted: (last: R): R => ({ ...last, summary: `all refused. Last — ${last.summary}` }),
    },
  };
}

test("a delegation that succeeds first time is one attempt and one finish", async () => {
  const h = harness([{}]);
  await runAttempts(h.plan);
  assert.deepEqual(h.attempts, [FLASH]);
  assert.equal(h.finished.length, 1);
  assert.deepEqual(h.fallbacks, []);
});

test("a fallback is two attempts and still one finish", async () => {
  // The defect this whole sequence started from: counting attempts made four
  // scouts with one fallback report five delegations.
  const h = harness([{ failure: "provider_error" }, {}]);
  await runAttempts(h.plan);
  assert.deepEqual(h.attempts, [FLASH, GEMINI]);
  assert.equal(h.finished.length, 1, "le repli a compté pour une seconde délégation");
  assert.deepEqual(h.fallbacks, [[FLASH, GEMINI]]);
  assert.equal(h.finished[0].model, GEMINI);
});

test("an empty first turn is retried once on the same model", async () => {
  const h = harness([{ failure: "no_submit" }, {}]);
  await runAttempts(h.plan);
  assert.deepEqual(h.attempts, [FLASH, FLASH], "le retry a changé de modèle");
  assert.equal(h.finished.length, 1);
  assert.deepEqual(h.fallbacks, []);
});

test("a writer that wrote something is never retried", async () => {
  const h = harness([{ failure: "no_submit", changedFiles: ["src/a.py"] }], { mutates: true });
  await runAttempts(h.plan);
  assert.deepEqual(h.attempts, [FLASH], "un writer qui avait écrit a été rejoué");
  assert.equal(h.finished.length, 1);
});

test("a writer that wrote nothing is retried", async () => {
  const h = harness([{ failure: "no_submit" }, {}], { mutates: true });
  await runAttempts(h.plan);
  assert.deepEqual(h.attempts, [FLASH, FLASH]);
});

test("a failure nobody retries stops at the first attempt", async () => {
  const h = harness([{ failure: "max_turns" }]);
  await runAttempts(h.plan);
  assert.deepEqual(h.attempts, [FLASH]);
  assert.deepEqual(h.fallbacks, []);
  assert.equal(h.finished.length, 1);
});

test("an abort stops before announcing a model that will never run", async () => {
  // `markModel` used to fire before the abort check, so the batch counted a
  // model nothing was running on.
  const h = harness([{ failure: "provider_error" }], { abortAfter: 1 });
  await runAttempts(h.plan);
  assert.deepEqual(h.fallbacks, [], "un modèle fantôme a été annoncé");
  assert.equal(h.finished.length, 1, "l'abandon a laissé la délégation ouverte");
});

test("an abort is not reported as the whole chain refusing", async () => {
  // It fell through to `exhausted`, which says every model refused — when the
  // later ones were never tried. `exhausted` has to mean exhausted.
  const h = harness([{ failure: "provider_error", summary: "provider down" }], { abortAfter: 1 });
  const r = await runAttempts(h.plan);
  assert.doesNotMatch(r.summary, /all refused/, "un abandon a été présenté comme un épuisement");
  assert.equal(r.summary, "provider down");
  assert.equal(h.attempts.length, 1, "un modèle a été essayé après l'abandon");
});

test("every model refusing still finishes exactly once", async () => {
  const h = harness([{ failure: "provider_error" }, { failure: "spawn_error" }]);
  const r = await runAttempts(h.plan);
  assert.deepEqual(h.attempts, [FLASH, GEMINI]);
  assert.equal(h.finished.length, 1);
  assert.match(r.summary, /all refused/);
});

test("four children with one fallback: five attempts, four finishes", async () => {
  // The invariant the whole batch accounting rests on, at the scale it failed.
  const runs = await Promise.all([
    harness([{ failure: "provider_error" }, {}]),
    harness([{}]),
    harness([{}]),
    harness([{}]),
  ].map(async (h) => {
    await runAttempts(h.plan);
    return h;
  }));
  const attempts = runs.reduce((n, h) => n + h.attempts.length, 0);
  const finishes = runs.reduce((n, h) => n + h.finished.length, 0);
  assert.equal(attempts, 5);
  assert.equal(finishes, 4, `${finishes} délégations pour quatre enfants`);
});
