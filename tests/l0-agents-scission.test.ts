/**
 * l0-agents-scission.test.ts — phase 2, scission d'AGENTS.md et d'APPEND_SYSTEM.md (S).
 *
 * Plan v3.1 § 12.4. Les textes du dépôt sont comparés à une recomposition faite **ici**, à partir
 * des seules fixtures (`tests/fixtures/scission/` : les deux sources de la base, la table figée
 * `PARTITION.tsv`, les retouches `RETOUCHES.json`), sans importer ni rejouer `partition.py`.
 *
 * Le texte composé du profil sous-agents est celui que pi 0.86.0 rend : `APPEND_SYSTEM.md` en
 * addendum, `AGENTS.md` dans le contexte du projet, puis la section `delegation`
 * (`subagent-only/DELEGATION.md`), qui vient après (F3).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import { validerDesignUpdates } from "../subagent-only/design-update.ts";

type Preuve = (t: TestContext) => Promise<void> | void;
function preservation(id: string, titre: string, fn: Preuve): void {
  test(`L0 PRES ${id} — ${titre}`, fn);
}
function propriete(vrai: boolean, message: string): void {
  assert.ok(vrai, `PROPRIÉTÉ — ${message}`);
}
function precondition(vrai: boolean, message: string): void {
  assert.ok(vrai, `PRÉCONDITION — ${message}`);
}

const REPO = join(import.meta.dirname, "..");
const FIX = join(REPO, "tests", "fixtures", "scission");
const lire = (chemin: string): string => readFileSync(chemin, "utf-8");
const sha = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");

const SOURCES: Record<string, Buffer> = {
  "AGENTS.md": readFileSync(join(FIX, "AGENTS.base.md")),
  "APPEND_SYSTEM.md": readFileSync(join(FIX, "APPEND_SYSTEM.base.md")),
};
const SOCLE = lire(join(REPO, "AGENTS.md"));
const ADDENDUM = lire(join(REPO, "APPEND_SYSTEM.md"));
const DELEGATION = lire(join(REPO, "subagent-only", "DELEGATION.md"));
/** Le texte composé du profil sous-agents, dans l'ordre où pi le rend. */
const COMPOSE = [ADDENDUM, SOCLE, DELEGATION].join("\n");

interface Fragment { id: string; source: string; debut: number; fin: number; destination: "S" | "D"; sha: string }
interface Retouche { cas: string; fragment: string; cote: "S" | "D"; avant: string; apres: string }

const FRAGMENTS: Fragment[] = lire(join(FIX, "PARTITION.tsv")).split("\n").slice(1).filter(Boolean).map((l) => {
  const c = l.split("\t");
  return { id: c[0], source: c[1], debut: Number(c[2]), fin: Number(c[3]), destination: c[7] as "S" | "D", sha: c[9] };
});
const RETOUCHES = JSON.parse(lire(join(FIX, "RETOUCHES.json"))) as Retouche[];

/** Appliquer à un fragment ses retouches d'un côté : remplacements exacts à occurrence unique, ou ajout final. */
function retoucher(f: Fragment, cote: "S" | "D", texte: string): string {
  let t = texte;
  for (const r of RETOUCHES.filter((x) => x.fragment === f.id && x.cote === cote)) {
    if (r.avant === "") { t += r.apres; continue; }
    precondition(t.split(r.avant).length === 2, `${r.cas} : « avant » non unique dans ${f.id}`);
    t = t.replace(r.avant, r.apres);
  }
  return t;
}

/** Retrait de l'espace de coupe initial, des sauts de ligne initiaux et finaux. */
function joindre(u: string): string {
  const sansEspace = u.startsWith(" ") ? u.slice(1) : u;
  return sansEspace.replace(/^\n+/, "").replace(/\n+$/, "");
}

/** Le rang de composition accordé (Q-P2-3) : A avant `## Delegation`, puis P, puis A29. */
const rang = (id: string): number => (id.startsWith("A") && id !== "A29" ? 0 : id.startsWith("P") ? 1 : 2);

function recomposer(): { socles: Record<string, string>; delegation: string; composes: Map<string, string> } {
  const socles: Record<string, string> = { "AGENTS.md": "", "APPEND_SYSTEM.md": "" };
  const delegues: Array<[string, string]> = [];
  for (const f of FRAGMENTS) {
    const texte = SOURCES[f.source].subarray(f.debut, f.fin).toString("utf-8");
    if (f.destination === "S") socles[f.source] += retoucher(f, "S", texte);
    else delegues.push([f.id, joindre(retoucher(f, "D", texte))]);
  }
  delegues.sort((a, b) => rang(a[0]) - rang(b[0]) || (a[0] < b[0] ? -1 : 1));
  return { socles, delegation: `${delegues.map(([, u]) => u).join("\n\n")}\n`, composes: new Map(delegues) };
}

// ================================================================== S01 — partition

preservation("P2-S01", "la table figée reconstitue les sources ; les textes du dépôt sont la recomposition, retouches comprises", () => {
  const ecarts: string[] = [];
  // Chaque source est couverte exactement, dans l'ordre, par ses fragments.
  for (const [nom, b] of Object.entries(SOURCES)) {
    const frs = FRAGMENTS.filter((f) => f.source === nom);
    let pos = 0;
    for (const f of frs) {
      if (f.debut !== pos) ecarts.push(`${f.id} : début ${f.debut} au lieu de ${pos}`);
      if (sha(b.subarray(f.debut, f.fin)) !== f.sha) ecarts.push(`${f.id} : empreinte du fragment`);
      pos = f.fin;
    }
    if (pos !== b.length) ecarts.push(`${nom} : couverture jusqu'à ${pos} sur ${b.length}`);
    if (Buffer.concat(frs.map((f) => b.subarray(f.debut, f.fin))).compare(b) !== 0) ecarts.push(`${nom} : concaténation`);
  }
  const { socles, delegation, composes } = recomposer();
  if (socles["AGENTS.md"] !== SOCLE) ecarts.push("AGENTS.md du dépôt ≠ recomposition");
  if (socles["APPEND_SYSTEM.md"] !== ADDENDUM) ecarts.push("APPEND_SYSTEM.md du dépôt ≠ recomposition");
  if (delegation !== DELEGATION) ecarts.push("DELEGATION.md du dépôt ≠ recomposition");
  // Témoins littéraux, indépendants de la recomposition, pour chaque retouche appliquée.
  for (const r of RETOUCHES) {
    const f = FRAGMENTS.find((x) => x.id === r.fragment)!;
    const brut = SOURCES[f.source].subarray(f.debut, f.fin).toString("utf-8");
    if (r.cote === "S" && r.cas === "R10" && r.avant === "") {
      if (!retoucher(f, "S", brut).endsWith("stable.")) ecarts.push("R10 côté S : le fragment du socle ne finit pas par « stable. »");
      continue;
    }
    const compose = r.cote === "S" ? retoucher(f, "S", brut) : composes.get(f.id)!;
    if (compose.split(r.apres).length !== 2) ecarts.push(`${r.cas} ${r.cote} : « après » pas une fois dans ${f.id}`);
    const antecedent = r.apres.includes(r.avant.trim()) && r.apres.endsWith(r.avant.trim());
    if (antecedent && r.cote === "D") {
      if (!compose.startsWith(r.apres)) ecarts.push(`${r.cas} : ${f.id} ne commence pas par l'antécédent`);
    } else if (compose.includes(r.avant)) {
      ecarts.push(`${r.cas} ${r.cote} : « avant » encore présent dans ${f.id}`);
    }
  }
  // C2 et R11, dans DELEGATION.md, une fois chacune.
  for (const phrase of [
    "Après `/compact` en régime libre, reconstruire aussi depuis ce que les enveloppes",
    "Its rule is\nstated above and its five",
  ]) {
    if (DELEGATION.split(phrase).length !== 2) ecarts.push(`phrase absente ou répétée : ${JSON.stringify(phrase)}`);
  }
  propriete(ecarts.length === 0, `partition : ${JSON.stringify(ecarts)}`);
});

// ================================================================== S02 — vocabulaire du socle

/** Les termes de délégation, et la liste blanche figée des emplois génériques qui restent au socle (§ 3.3). */
const TERMES = /delegat\w*|subagent\w*|runtime|\bworkers?\b|\breviewers?\b|\bscouts?\b|\badvisor\b|orchestrat\w*|\blanes?\b|\bchild(ren)?\b|task\(|\.pi-subagent-runs/gi;
const LISTE_BLANCHE: Array<{ fichier: string; ligne: number; expression: string }> = [
  { fichier: "AGENTS.md", ligne: 3, expression: "delegated" },
  { fichier: "AGENTS.md", ligne: 7, expression: "subagent template" },
  { fichier: "AGENTS.md", ligne: 30, expression: "subagents included" },
  { fichier: "AGENTS.md", ligne: 30, expression: "runtime import assertions" },
  { fichier: "AGENTS.md", ligne: 107, expression: "runtime entry point" },
  { fichier: "AGENTS.md", ligne: 114, expression: "Python runtime" },
];

preservation("P2-S02", "le socle ne porte aucun terme de délégation hors de la liste blanche figée", () => {
  const horsListe: string[] = [];
  for (const [fichier, texte] of [["AGENTS.md", SOCLE], ["APPEND_SYSTEM.md", ADDENDUM]] as const) {
    texte.split("\n").forEach((ligne, i) => {
      const admis = LISTE_BLANCHE.filter((b) => b.fichier === fichier && b.ligne === i + 1);
      for (const m of ligne.matchAll(TERMES)) {
        const couvert = admis.some((b) => {
          const debut = ligne.indexOf(b.expression);
          return debut >= 0 && m.index! >= debut && m.index! + m[0].length <= debut + b.expression.length;
        });
        if (!couvert) horsListe.push(`${fichier}:${i + 1} « ${m[0]} »`);
      }
    });
  }
  const absents = LISTE_BLANCHE.filter((b) => !(b.fichier === "AGENTS.md" ? SOCLE : ADDENDUM).split("\n")[b.ligne - 1]?.includes(b.expression));
  propriete(horsListe.length === 0 && absents.length === 0, `hors liste ${JSON.stringify(horsListe)} ; liste blanche périmée ${JSON.stringify(absents)}`);
});

// ================================================================== S03, S04, S05

preservation("P2-S03", "AGENTS.md:30 commence par le plancher de vérification", () => {
  const l30 = SOCLE.split("\n")[29] ?? "";
  propriete(l30.startsWith("- **Verification floor.**"), `ligne 30 : ${l30.slice(0, 60)}`);
});

/** La lecture de `/check-config` (`skillsDeclaredInAgentsMd`) : le titre, puis les puces `- \`nom\`` jusqu'au titre suivant. */
function skillsDeclares(texte: string): string[] {
  const parties = texte.split("## Skills available (global)");
  if (parties.length < 2) return [];
  const bloc = parties[1].split("\n## ")[0];
  return [...bloc.matchAll(/^-\s+`([^`]+)`/gm)].map((m) => m[1]);
}

preservation("P2-S04", "la liste des skills reste au socle, entière, là où /check-config la lit", () => {
  const base = skillsDeclares(SOURCES["AGENTS.md"].toString("utf-8"));
  const socle = skillsDeclares(SOCLE);
  const absentes = socle.filter((n) => !existsSync(join(REPO, "skills", n, "SKILL.md")));
  propriete(
    base.length > 0 && JSON.stringify(socle) === JSON.stringify(base) && absentes.length === 0 && skillsDeclares(DELEGATION).length === 0,
    `base ${JSON.stringify(base)}, socle ${JSON.stringify(socle)}, sans SKILL.md ${JSON.stringify(absentes)}`,
  );
});

preservation("P2-S05", "le texte composé porte les cinq exigences design_update et l'exemple JSON accepté", () => {
  const manques: string[] = [];
  for (const exigence of [
    "the frozen plan MUST declare a `design_update` for that decision",
    "substantively implements a decision whose current status in `DESIGN.md` is\n`proposé`",
    "MUST be present in the frozen plan before the work unit is\n  dispatched",
    "`from_status` MUST match the decision's current `Statut` in `DESIGN.md` at plan\n  freeze",
    "A\n  status-only unit MUST NOT be created solely to exercise or advance a design\n  decision",
  ]) {
    if (!COMPOSE.includes(exigence)) manques.push(exigence.slice(0, 50));
  }
  const bloc = COMPOSE.match(/\*\*Design decisions — `design_update` is mandatory\.\*\*[\s\S]*?```json\n([\s\S]*?)\n```/);
  if (!bloc) manques.push("exemple JSON");
  else {
    const unite = JSON.parse(bloc[1].replace("\"…\"", "\"exemple\"").replace("[\"…\"]", "[\"src/a.py\"]"));
    const verdict = validerDesignUpdates({ version: 1, work_units: [unite] }, { bundle: true, design: "# Design\n\n### D-001 — Une décision\n\nStatut : proposé\n" });
    if (JSON.stringify(verdict) !== JSON.stringify({ ok: true })) manques.push(`exemple refusé : ${JSON.stringify(verdict)}`);
  }
  if (SOCLE.includes("design_update")) manques.push("design_update encore au socle");
  propriete(manques.length === 0, `texte composé : ${JSON.stringify(manques)}`);
});

// ================================================================== S06 — renvois

/**
 * La table figée des renvois nommés (`tests/fixtures/scission/RENVOIS.json`, 18 entrées, gelée le
 * 17-10-2026 à 12:18:50Z, `f0e3f7c4…`). Le test la lit ; il n'en porte aucune copie.
 *
 * `texte` dit où le renvoi est lu : `socle` (`AGENTS.md`, les deux profils), `simple`
 * (`APPEND_SYSTEM.md` puis `AGENTS.md`) ou `compose` (`APPEND_SYSTEM.md`, `AGENTS.md`,
 * `DELEGATION.md`). `sens` : `above` exige la cible avant le renvoi, `below` après, `aucun`
 * n'importe où. Une cible `titre` est un titre Markdown qui commence par ce texte ; `passage`, un
 * texte littéral ; `externe`, une section `## Review delta` d'un skill ; `skill`, le fichier
 * `skills/<nom>/SKILL.md`, qui doit exister.
 */
const RENVOIS = JSON.parse(lire(join(FIX, "RENVOIS.json"))) as Array<{
  texte: "socle" | "simple" | "compose"; ancre: string; cible: string; nature: "titre" | "passage" | "externe" | "skill"; sens: "above" | "below" | "aucun";
}>;
const SIMPLE = [ADDENDUM, SOCLE].join("\n");

preservation("P2-S06", "chaque renvoi nommé désigne un titre ou un passage présent là où il est lu, avant lui quand il dit above", () => {
  const ecarts: string[] = [];
  for (const r of RENVOIS) {
    const t = r.texte === "socle" ? SOCLE : r.texte === "simple" ? SIMPLE : COMPOSE;
    const p = t.indexOf(r.ancre);
    if (p < 0 || t.indexOf(r.ancre, p + 1) >= 0) { ecarts.push(`ancre absente ou répétée : ${JSON.stringify(r.ancre)}`); continue; }
    if (r.nature === "skill") {
      if (!existsSync(join(REPO, r.cible))) ecarts.push(`skill introuvable : ${r.cible}`);
      continue;
    }
    if (r.nature === "externe") {
      const porteurs = ["code-review", "python-engineering", "sql-engineering"].filter((n) =>
        existsSync(join(REPO, "skills", n, "SKILL.md")) && lire(join(REPO, "skills", n, "SKILL.md")).split("\n").includes(r.cible));
      if (porteurs.length === 0) ecarts.push(`cible externe introuvable : ${r.cible}`);
      continue;
    }
    const positions: number[] = [];
    if (r.nature === "titre") {
      let off = 0;
      for (const l of t.split("\n")) {
        if (l.startsWith(`${r.cible}`) && /^#+ /.test(l) && l.replace(/^#+ /, "").startsWith(r.cible.replace(/^#+ /, ""))) positions.push(off);
        off += l.length + 1;
      }
    } else {
      for (let i = t.indexOf(r.cible); i >= 0; i = t.indexOf(r.cible, i + 1)) positions.push(i);
    }
    const ok = r.sens === "above" ? positions.some((x) => x < p) : r.sens === "below" ? positions.some((x) => x > p) : positions.length > 0;
    if (!ok) ecarts.push(`${r.texte} · ${JSON.stringify(r.ancre)} → ${r.cible} (${r.sens}) : ${JSON.stringify(positions)} pour ${p}`);
  }
  // Tout renvoi d'une forme balayée, dans le socle, l'addendum et la délégation, est dans la table.
  const formes = new RegExp([
    "`## [^`]+`", '"[^"]{3,60}" (?:above|below|section below)', '[Ss]ee "[^"]+"', 'per "[^"]+"',
    "see the [a-z ]+ (?:above|below)", "\\(see [a-z-]+ skill\\)", "see AGENTS\\.md",
  ].join("|"), "g");
  for (const [nom, t] of [["socle", SOCLE], ["addendum", ADDENDUM], ["délégation", DELEGATION]] as const) {
    for (const m of t.matchAll(formes)) {
      const ligne = t.slice(t.lastIndexOf("\n", m.index!) + 1, t.indexOf("\n", m.index!));
      if (!RENVOIS.some((r) => ligne.includes(r.ancre.split("\n")[0]) || r.ancre.includes(m[0]))) ecarts.push(`${nom} : renvoi hors table « ${m[0]} »`);
    }
  }
  propriete(ecarts.length === 0, `renvois : ${JSON.stringify(ecarts)}`);
});
