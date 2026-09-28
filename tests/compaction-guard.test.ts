/**
 * compaction-guard.test.ts — le garde de compaction de l'orchestrateur (lot post-pilote B)
 * et la règle `design_update` d'AGENTS.md (lot post-pilote C).
 *
 * Portes adjugées par Sol (27-09) pour le garde, éprouvées ici sur la décision pure ET à
 * travers le câblage réel de l'extension (un `pi` et un `ctx` de substitution, qui
 * comptent les appels à `compact`) :
 *   A  seuil non franchi                          → 0 compaction
 *   B  premier franchissement de 50 %             → exactement 1
 *   C  tour suivant sans nouveau franchissement   → aucune seconde compaction
 *   D  retour sous le seuil puis nouveau franchissement → une nouvelle compaction
 * et les bords qui les rendent vraies : usage inconnu (pas de réarmement), verrou pendant
 * la compaction, échec, lancement qui jette, fenêtre relative au modèle courant.
 * Puis la reprise adjugée le 28-09 (ctx.compact() interrompt le run) :
 *   R1 run actif + onComplete → exactement 1 reprise, type, contenu et triggerTurn exacts
 *   R2 run actif + onError    → exactement 1 reprise
 *   R3/R4 run inactif          → 0 reprise, succès comme erreur
 *   R5 callback répété/réentrant → au plus 1 reprise
 *   R6 lancement qui jette     → 0 reprise
 *   R7 la reprise ne réarme pas le seuil
 * La porte E (run réel avec lane ouverte) se joue chez l'opérateur, avec pi et ses
 * fournisseurs : elle n'est pas simulable ici sans simuler ce qu'elle doit prouver.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import compactionGuard from "../extensions/compaction-guard/index.ts";
import {
  clore,
  decider,
  etatInitial,
  MESSAGE_REPRISE,
  ouvrirTentative,
  SEUIL_RELATIF,
  terminer,
  TYPE_REPRISE,
  type EtatGarde,
  type Usage,
} from "../extensions/compaction-guard/garde.ts";
import { validerDesignUpdates } from "../subagent-only/design-update.ts";

const FENETRE = 272_000;
const u = (tokens: number | null, contextWindow = FENETRE): Usage => ({ tokens, contextWindow });

/** Rejoue une suite d'usages sur la décision pure ; rend le nombre de compactions et l'état final. */
function rejouer(usages: Array<Usage | undefined>, depart: EtatGarde = etatInitial(), finirChaque = true) {
  let etat = depart;
  let compactions = 0;
  for (const us of usages) {
    const d = decider(us, etat);
    etat = d.etat;
    if (d.action === "compacter") {
      compactions++;
      if (finirChaque) etat = terminer(etat);
    }
  }
  return { compactions, etat };
}

// ------------------------------------------------------------------ la décision pure

test("le seuil adjugé est 50 % de la fenêtre", () => {
  assert.equal(SEUIL_RELATIF, 0.5);
});

test("A — PROPRIÉTÉ : sous le seuil, aucune compaction", () => {
  assert.equal(rejouer([u(10_000), u(90_000), u(135_999)]).compactions, 0);
});

test("B — PROPRIÉTÉ : le premier franchissement de 50 % compacte exactement une fois", () => {
  assert.equal(rejouer([u(100_000), u(136_000)]).compactions, 1);
});

test("B — PROPRIÉTÉ : exactement 50 % est un franchissement", () => {
  const d = decider(u(136_000), etatInitial());
  assert.equal(d.action, "compacter");
});

test("C — PROPRIÉTÉ : au-dessus du seuil, les tours suivants ne recompactent pas", () => {
  assert.equal(rejouer([u(100_000), u(140_000), u(150_000), u(200_000), u(260_000)]).compactions, 1);
});

test("C — PROPRIÉTÉ : une mesure stale au-dessus après la compaction ne recompacte pas", () => {
  // La compaction a eu lieu, mais le tour suivant relit encore l'ancien usage.
  assert.equal(rejouer([u(140_000), u(140_000), u(140_000)]).compactions, 1);
});

test("D — PROPRIÉTÉ : retour sous le seuil puis nouveau franchissement → nouvelle compaction", () => {
  assert.equal(rejouer([u(140_000), u(40_000), u(90_000), u(140_000)]).compactions, 2);
});

test("PROPRIÉTÉ : un usage inconnu ne compacte pas et ne réarme pas", () => {
  // Juste après une compaction, pi rend tokens: null. Réarmer là rouvrirait la double compaction.
  const r = rejouer([u(140_000), u(null), undefined, u(140_000)]);
  assert.equal(r.compactions, 1);
  assert.equal(r.etat.arme, false);
});

test("PROPRIÉTÉ : pendant une compaction du garde, aucune autre n'est lancée", () => {
  // Compaction lancée, pas encore terminée ; l'usage oscille autour du seuil.
  const r = rejouer([u(140_000), u(40_000), u(140_000)], etatInitial(), false);
  assert.equal(r.compactions, 1);
  assert.equal(r.etat.enCours, true);
});

test("PROPRIÉTÉ : le seuil suit la fenêtre du modèle courant, sans override", () => {
  // 70 000 : sous 50 % de 272 000, au-dessus de 50 % de 128 000.
  assert.equal(decider(u(70_000, 272_000), etatInitial()).action, "rien");
  assert.equal(decider(u(70_000, 128_000), etatInitial()).action, "compacter");
});

test("PROPRIÉTÉ : une fenêtre inexploitable ne décide rien", () => {
  for (const f of [0, -1, Number.NaN]) assert.equal(decider(u(500_000, f), etatInitial()).action, "rien");
});

test("PROPRIÉTÉ : l'état initial est armé (une session reprise au-dessus compacte une fois)", () => {
  assert.equal(rejouer([u(213_000), u(213_000)]).compactions, 1);
});

// ------------------------------------------------------------------ le câblage réel de l'extension

interface Faux {
  usages: Array<Usage | undefined>;
  compacts: Array<{ onComplete?: (r: unknown) => void; onError?: (e: Error) => void }>;
  reprises: Array<{ message: unknown; options: unknown }>;
  jette?: boolean;
  /** Un run de l'agent est en cours au turn_end (le cas réel) ; false : pi inactif. */
  actif: boolean;
  tour(): void;
}

function monter(): Faux {
  let handler: ((e: unknown, ctx: unknown) => void) | undefined;
  const faux: Faux = {
    usages: [],
    compacts: [],
    reprises: [],
    actif: true,
    tour() {
      assert.ok(handler, "l'extension n'a pas enregistré de handler turn_end");
      handler!({}, ctx);
    },
  };
  const ctx = {
    getContextUsage: () => faux.usages.shift(),
    compact: (o: { onComplete?: (r: unknown) => void; onError?: (e: Error) => void }) => {
      if (faux.jette) throw new Error("pas maintenant");
      faux.compacts.push(o);
    },
    isIdle: () => !faux.actif,
    hasUI: false,
  };
  compactionGuard({
    on: (evenement: string, h: (e: unknown, ctx: unknown) => void) => {
      assert.equal(evenement, "turn_end");
      handler = h;
    },
    sendMessage: (message: unknown, options: unknown) => {
      faux.reprises.push({ message, options });
    },
  } as never);
  return faux;
}

test("câblage — l'extension écoute turn_end et compacte au franchissement, une fois", () => {
  const f = monter();
  f.usages.push(u(100_000), u(140_000), u(150_000));
  f.tour(); f.tour(); f.tour();
  assert.equal(f.compacts.length, 1);
});

test("câblage — PROPRIÉTÉ : tant que onComplete n'est pas revenu, aucune seconde compaction", () => {
  const f = monter();
  f.usages.push(u(140_000), u(40_000), u(140_000));
  f.tour(); f.tour(); f.tour();
  assert.equal(f.compacts.length, 1);
});

test("câblage — PROPRIÉTÉ : après onComplete et retour sous le seuil, un nouveau franchissement recompacte", () => {
  const f = monter();
  f.usages.push(u(140_000));
  f.tour();
  f.compacts[0].onComplete?.({});
  f.usages.push(u(null), u(45_000), u(150_000));
  f.tour(); f.tour(); f.tour();
  assert.equal(f.compacts.length, 2);
});

test("câblage — PROPRIÉTÉ : onError libère le verrou sans réarmer", () => {
  const f = monter();
  f.usages.push(u(140_000));
  f.tour();
  f.compacts[0].onError?.(new Error("fournisseur indisponible"));
  f.usages.push(u(140_000), u(150_000));
  f.tour(); f.tour();
  assert.equal(f.compacts.length, 1, "un échec ne doit pas relancer à chaque tour");
  f.usages.push(u(40_000), u(140_000));
  f.tour(); f.tour();
  assert.equal(f.compacts.length, 2, "le garde se réarme quand l'usage redescend");
});

test("câblage — PROPRIÉTÉ : un lancement qui jette ne bloque pas le garde", () => {
  const f = monter();
  f.jette = true;
  f.usages.push(u(140_000));
  f.tour();
  f.jette = false;
  f.usages.push(u(40_000), u(140_000));
  f.tour(); f.tour();
  assert.equal(f.compacts.length, 1);
});

// ------------------------------------------------------------------ la reprise après ctx.compact()

const REPRISE_ATTENDUE = {
  message: { customType: "compaction-guard", content: "Compaction automatique terminée : reprends exactement là où tu t'étais arrêté.", display: true },
  options: { triggerTurn: true },
};

test("la reprise adjugée : type et message mot pour mot", () => {
  assert.equal(TYPE_REPRISE, "compaction-guard");
  assert.equal(MESSAGE_REPRISE, "Compaction automatique terminée : reprends exactement là où tu t'étais arrêté.");
});

test("R1 — PROPRIÉTÉ : run actif puis onComplete → exactement une reprise, type, contenu et triggerTurn exacts", () => {
  const f = monter();
  f.usages.push(u(140_000));
  f.tour();
  assert.equal(f.reprises.length, 0, "aucune reprise avant la fin de la compaction");
  f.compacts[0].onComplete?.({});
  assert.deepEqual(f.reprises, [REPRISE_ATTENDUE]);
});

test("R2 — PROPRIÉTÉ : run actif puis onError → exactement une reprise", () => {
  const f = monter();
  f.usages.push(u(140_000));
  f.tour();
  f.compacts[0].onError?.(new Error("Nothing to compact (session too small)"));
  assert.deepEqual(f.reprises, [REPRISE_ATTENDUE]);
});

test("R3 — PROPRIÉTÉ : run inactif puis succès → aucune reprise", () => {
  const f = monter();
  f.actif = false;
  f.usages.push(u(140_000));
  f.tour();
  f.compacts[0].onComplete?.({});
  assert.equal(f.reprises.length, 0);
});

test("R4 — PROPRIÉTÉ : run inactif puis erreur → aucune reprise", () => {
  const f = monter();
  f.actif = false;
  f.usages.push(u(140_000));
  f.tour();
  f.compacts[0].onError?.(new Error("fournisseur indisponible"));
  assert.equal(f.reprises.length, 0);
});

test("R5 — PROPRIÉTÉ : callbacks répétés ou croisés → au plus une reprise", () => {
  const f = monter();
  f.usages.push(u(140_000));
  f.tour();
  const o = f.compacts[0];
  o.onComplete?.({});
  o.onComplete?.({});
  o.onError?.(new Error("tardif"));
  assert.equal(f.reprises.length, 1);
});

test("R5 — PROPRIÉTÉ : un callback réentrant (pendant l'envoi de la reprise) n'en ajoute pas", () => {
  const f = monter();
  f.usages.push(u(140_000));
  f.tour();
  const o = f.compacts[0];
  let reentre = false;
  const avant = f.reprises.push.bind(f.reprises);
  f.reprises.push = (...x) => {
    if (!reentre) { reentre = true; o.onError?.(new Error("réentrant")); }
    return avant(...x);
  };
  o.onComplete?.({});
  assert.equal(f.reprises.length, 1);
});

test("R5 — PROPRIÉTÉ : un callback répété ne libère pas le verrou d'une tentative suivante", () => {
  const f = monter();
  f.usages.push(u(140_000));
  f.tour();
  const premiere = f.compacts[0];
  premiere.onComplete?.({});
  f.usages.push(u(40_000), u(140_000));
  f.tour(); f.tour();                       // seconde tentative, en cours
  assert.equal(f.compacts.length, 2);
  premiere.onComplete?.({});                // écho tardif de la première
  f.usages.push(u(40_000), u(140_000));
  f.tour(); f.tour();
  assert.equal(f.compacts.length, 2, "la seconde tentative doit rester verrouillée");
});

test("R6 — PROPRIÉTÉ : un lancement qui jette → aucune reprise", () => {
  const f = monter();
  f.jette = true;
  f.usages.push(u(140_000));
  f.tour();
  assert.equal(f.reprises.length, 0);
});

test("R7 — PROPRIÉTÉ : la reprise ne réarme pas le seuil", () => {
  const f = monter();
  f.usages.push(u(140_000));
  f.tour();
  f.compacts[0].onComplete?.({});
  f.usages.push(u(null), u(140_000), u(150_000));   // le tour repris, encore au-dessus
  f.tour(); f.tour(); f.tour();
  assert.equal(f.compacts.length, 1);
  assert.equal(f.reprises.length, 1);
});

test("PROPRIÉTÉ : la fin d'une tentative est unique, et ne reprend que si un run était actif", () => {
  const actif = clore(ouvrirTentative(true));
  assert.deepEqual([actif.premiere, actif.reprise], [true, true]);
  assert.deepEqual([clore(actif.tentative).premiere, clore(actif.tentative).reprise], [false, false]);
  const inactif = clore(ouvrirTentative(false));
  assert.deepEqual([inactif.premiere, inactif.reprise], [true, false]);
});

// ------------------------------------------------------------------ C — la règle design_update d'AGENTS.md

const AGENTS = readFileSync(join(import.meta.dirname, "..", "AGENTS.md"), "utf-8");

test("C — PROPRIÉTÉ : AGENTS.md rend design_update obligatoire, avec les cinq propriétés adjugées", () => {
  assert.doesNotMatch(AGENTS, /may declare a `design_update`/, "le « may » facultatif doit avoir disparu");
  for (const exigence of [
    "the frozen plan MUST declare a `design_update` for that decision",
    "substantively implements a decision whose current status in `DESIGN.md` is\n`proposé`",
    "MUST be present in the frozen plan before the work unit is\n  dispatched",
    "`from_status` MUST match the decision's current `Statut` in `DESIGN.md` at plan\n  freeze",
    "A\n  status-only unit MUST NOT be created solely to exercise or advance a design\n  decision",
  ]) {
    assert.ok(AGENTS.includes(exigence), `AGENTS.md ne porte plus : ${exigence}`);
  }
});

test("C — PROPRIÉTÉ : l'exemple d'AGENTS.md est accepté tel quel par le vrai validateur du gel", () => {
  const bloc = AGENTS.match(/\*\*Design decisions — `design_update` is mandatory\.\*\*[\s\S]*?```json\n([\s\S]*?)\n```/);
  assert.ok(bloc, "l'exemple JSON de la règle design_update est introuvable");
  const unite = JSON.parse(bloc![1].replace("\"…\"", "\"exemple\"").replace("[\"…\"]", "[\"src/a.py\"]"));
  const design = "# Design\n\n### D-001 — Une décision\n\nStatut : proposé\n";
  const verdict = validerDesignUpdates({ version: 1, work_units: [unite] }, { bundle: true, design });
  assert.deepEqual(verdict, { ok: true }, "la forme documentée doit être celle que le parseur accepte");
  assert.deepEqual(unite.design_update, { decision_id: "D-001", from_status: "proposé", to_status: "en cours" });
});
