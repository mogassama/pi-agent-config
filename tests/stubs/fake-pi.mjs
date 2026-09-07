#!/usr/bin/env node
/**
 * Un faux `pi`, qui écrit sur stdout le flux d'événements que le vrai écrit.
 *
 * `runOnce` lance `opts.piPath ?? "pi"` et lit son stdout ligne à ligne. Passer
 * ce script comme `piPath` donne un vrai processus, un vrai flux, et le vrai
 * parseur — donc le chemin de production complet jusqu'au `RunResult`, sans rien
 * substituer à l'intérieur de `dispatch`.
 *
 * C'est ce qui manquait : le harnais d'`execute` remplace `dispatch` entier,
 * donc la ligne qui transporte `deviations` de l'enveloppe vers le runtime
 * n'était traversée par aucun test. La retirer ne cassait rien, et elle décide
 * depuis 3c.1d.2 de l'abandon d'une tentative d'intégration.
 *
 * L'enveloppe à émettre est lue dans `PI_FAKE_ENVELOPE`. `PI_FAKE_EXTRA` ajoute
 * des lignes brutes avant elle — messages, tours, erreurs de fournisseur — pour
 * les scénarios qui en ont besoin.
 */

const ligne = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

for (const brut of JSON.parse(process.env.PI_FAKE_EXTRA ?? "[]")) ligne(brut);

const enveloppe = process.env.PI_FAKE_ENVELOPE;
if (enveloppe) {
  ligne({
    type: "tool_execution_end",
    toolName: "submit",
    result: { details: JSON.parse(enveloppe) },
  });
}

ligne({ type: "turn_end" });
process.exit(Number(process.env.PI_FAKE_EXIT ?? "0"));
