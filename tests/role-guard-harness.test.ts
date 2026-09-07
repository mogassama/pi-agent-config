/**
 * role-guard-harness.test.ts — le guard tel qu'il est réellement branché.
 *
 * `decideRoleGuard` a une centaine de cas contre lui, et aucun ne prouvait que
 * `role-guard.ts` l'appelle. La contre-épreuve le disait : en remplaçant le
 * retour du hook par `undefined`, la suite restait verte. Un guard qui ne bloque
 * rien passait tous les tests de ses propres règles.
 *
 * Ce fichier charge le vrai `role-guard.ts` — donc l'API de pi substituée, donc
 * le chargeur — et lui envoie de vrais événements d'outil. Il ne teste pas les
 * règles : il teste qu'elles sont atteintes, et que le refus remonte.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import roleGuard from "../subagent-only/role-guard.ts";

type Decision = { block: boolean; reason: string } | undefined;

/** Un pi minimal : on garde le handler et on l'appelle à la main. */
function brancher(env: { role?: string; readOnly?: boolean }) {
  const precedent = {
    role: process.env.PI_SUBAGENT_ROLE,
    readOnly: process.env.PI_SUBAGENT_READONLY,
  };
  if (env.role === undefined) delete process.env.PI_SUBAGENT_ROLE;
  else process.env.PI_SUBAGENT_ROLE = env.role;
  process.env.PI_SUBAGENT_READONLY = env.readOnly ? "1" : "0";

  let handler: ((event: unknown) => Promise<Decision>) | undefined;
  const pi = {
    on(_event: string, h: (...args: unknown[]) => unknown) {
      handler = h as (event: unknown) => Promise<Decision>;
    },
    registerTool() {},
  };
  roleGuard(pi as never);

  const restaurer = () => {
    if (precedent.role === undefined) delete process.env.PI_SUBAGENT_ROLE;
    else process.env.PI_SUBAGENT_ROLE = precedent.role;
    if (precedent.readOnly === undefined) delete process.env.PI_SUBAGENT_READONLY;
    else process.env.PI_SUBAGENT_READONLY = precedent.readOnly;
  };
  // Le hook doit exister : un guard qui ne s'abonne à rien est le défaut que
  // ce fichier existe pour attraper.
  assert.ok(handler, "role-guard ne s'est abonné à aucun événement");
  return { appeler: (event: unknown) => handler!(event), restaurer };
}

/**
 * Un événement `tool_call` de la forme de pi : `toolName`, `toolCallId`,
 * `input`. La première version de ce fichier fabriquait `{ type: "bash" }` — un
 * champ qui n'existe pas — et le stub le reconnaissait, si bien que le harnais
 * prouvait le câblage contre un protocole inventé.
 */
const bash = (command: string) => ({
  toolName: "bash",
  toolCallId: "test-call",
  input: { command },
});

test("un worker qui tente d'écrire dans git est bloqué par le guard branché", async () => {
  const { appeler, restaurer } = brancher({ role: "worker", readOnly: false });
  try {
    const decision = await appeler(bash("git commit -m x"));
    assert.equal(decision?.block, true);
    assert.match(decision?.reason ?? "", /Git belongs to the runtime/);
  } finally {
    restaurer();
  }
});

test("un worker qui lance ses tests n'est pas bloqué", async () => {
  const { appeler, restaurer } = brancher({ role: "worker", readOnly: false });
  try {
    assert.equal(await appeler(bash("pytest -q")), undefined);
    assert.equal(await appeler(bash("git diff --stat")), undefined);
  } finally {
    restaurer();
  }
});

test("un rôle en lecture seule reçoit le message de son rôle", async () => {
  const { appeler, restaurer } = brancher({ role: "scout", readOnly: true });
  try {
    const decision = await appeler(bash("rm -rf build"));
    assert.equal(decision?.block, true);
    assert.match(decision?.reason ?? "", /is read-only/);
  } finally {
    restaurer();
  }
});

test("un outil que le guard ne connaît pas passe", async () => {
  const { appeler, restaurer } = brancher({ role: "worker", readOnly: false });
  try {
    assert.equal(
      await appeler({ toolName: "custom_tool", toolCallId: "test-call", input: {} }),
      undefined,
    );
    // Sans `input` du tout : le guard ne doit pas jeter.
    assert.equal(await appeler({ toolName: "bash", toolCallId: "test-call" }), undefined);
  } finally {
    restaurer();
  }
});
