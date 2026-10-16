/**
 * l0-pi-surface.test.ts — LOT-PI-ADAPT, item 3: surface registry and drift guard (PLAN § 3, item 3;
 * MATRICES § D and § G; adjudications e6b3abd8 and 38b15981).
 *
 * The test reads, without importing anything from pi, the SDK surfaces this configuration uses:
 *   - extensions/**\/*.ts, subagent-only/**\/*.ts, tests/pi-contrats/**\/*.{ts,mjs}: imports from the three SDK
 *     packages and namespace members (Q2), the default-export receiver and its aliases R-AFF, R-PARAM,
 *     R-CTX (Q3), methods and member reads (Q4), destructuring, computed access (unclassifiable), events,
 *     members of ctx with their static prefixes, `in ctx` (Q4), dynamic loads (Q5), embedded sources (Q6);
 *   - subagent-only/spawn-args.ts and pi-adapt.ts: CLI flag literals;
 *   - subagent-only/dispatch.ts, test-command.ts and pi-adapt.ts: flux type comparisons, direct and
 *     resolved through FLUX, CHAMPS_FLUX and BLOC_TEXTE declared in pi-adapt.ts (précision FLUX);
 *   - bin/run-cost, bin/subagent-trace, bin/subagent-shadow: presence of the declared keys only.
 * It compares them with tests/pi-surface.json, which it never regenerates, and fails in the six cases of
 * § D: a recognized surface not in the registry, an entry no longer recognized, a contract that does not
 * exist, an undeclared alias, an unclassifiable access, an empty scanned list.
 *
 * Each type and each alias rule has its counter-test on a fixture of tests/fixtures/pi-surface/, copied
 * into a really scanned path of a temporary copy, and its M3 mutant (tests/l0-mutants.json).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { test, type TestContext } from "node:test";

// ════════════════════════════════════════════════════════════════════════════════════════════════
// Reconnaisseur — lexer, scopes and surface recognition (MATRICES § D and § G). No SDK import, no
// dependency: TypeScript is reduced to JavaScript by node:module stripTypeScriptTypes in "strip" mode,
// which blanks types in place, so offsets and lines are those of the source file.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export const PAQUETS_SDK = ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui", "@earendil-works/pi-ai"];
const RE_PAQUET_SDK = /^@earendil-works\/pi-(coding-agent|tui|ai)$/;
const RE_CHEMIN_SDK = /@earendil-works\/pi-(coding-agent|tui|ai)(?![\w-])/;
const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

// ── Lexer ──────────────────────────────────────────────────────────────────────────────────────

export type Genre = "id" | "str" | "num" | "p" | "re" | "tpl" | "tplH" | "tplM" | "tplT" | "priv";
export interface Jeton { k: Genre; v: string; s: number; e: number; l: number; nl: boolean }

/** A lexical failure: the file is reported unclassifiable, never half-read. */
export class Illisible extends Error {}

const PONCTUATION = [
  ">>>=", "...", "===", "!==", "**=", "<<=", ">>=", ">>>", "&&=", "||=", "??=",
  "=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "**", "<<", ">>",
  "{", "}", "(", ")", "[", "]", ";", ",", "<", ">", "+", "-", "*", "/", "%", "&", "|", "^", "!", "~", "?", ":", "=", ".", "@",
];
const AVANT_REGEX = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "instanceof", "yield", "await"]);
const RE_IDENT = /[\p{ID_Start}$_][\p{ID_Continue}$\u200c\u200d]*/uy;
const RE_NOMBRE = /(?:0[xXbBoO][0-9a-fA-F_]+n?|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?n?)/y;

export function lexer(src: string): Jeton[] {
  const out: Jeton[] = [];
  let i = 0, ligne = 1, nl = true;
  const pile: number[] = []; // brace depth at which each template expression opened
  let prof = 0;
  const avancer = (j: number) => { for (let x = i; x < j; x++) if (src.charCodeAt(x) === 10) { ligne++; nl = true; } i = j; };
  const pousser = (k: Genre, v: string, s: number, e: number, l: number) => { out.push({ k, v, s, e, l, nl }); nl = false; };
  const regexPermise = () => {
    const p = out[out.length - 1];
    if (!p) return true;
    if (p.k === "num" || p.k === "str" || p.k === "tpl" || p.k === "tplT" || p.k === "re" || p.k === "priv") return false;
    if (p.k === "id") return AVANT_REGEX.has(p.v);
    if (p.k === "tplH" || p.k === "tplM") return true;
    return !(p.v === ")" || p.v === "]" || p.v === "}");
  };
  /** Reads template text from `j` (just after ` or }) to the closing backtick or the next `${`. */
  const gabarit = (j: number): { fin: number; brut: string; ouvert: boolean } => {
    let brut = "";
    while (j < src.length) {
      const c = src[j];
      if (c === "\\") { brut += src.slice(j, j + 2); j += 2; continue; }
      if (c === "`") return { fin: j + 1, brut, ouvert: false };
      if (c === "$" && src[j + 1] === "{") return { fin: j + 2, brut, ouvert: true };
      brut += c; j++;
    }
    throw new Illisible(`gabarit non terminé (ligne ${ligne})`);
  };
  if (src.startsWith("#!")) { const f = src.indexOf("\n"); avancer(f < 0 ? src.length : f); }
  while (i < src.length) {
    const c = src[i];
    // Any Unicode white space: stripTypeScriptTypes blanks non-ASCII characters of removed types with
    // U+2002, so that offsets in UTF-16 code units are preserved.
    if (/\s/u.test(c)) { avancer(i + 1); continue; }
    if (c === "/" && src[i + 1] === "/") { const f = src.indexOf("\n", i); avancer(f < 0 ? src.length : f); continue; }
    if (c === "/" && src[i + 1] === "*") {
      const f = src.indexOf("*/", i + 2);
      if (f < 0) throw new Illisible(`commentaire non terminé (ligne ${ligne})`);
      avancer(f + 2); continue;
    }
    const s = i, l = ligne;
    if (c === "'" || c === '"') {
      let j = i + 1, v = "";
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\") { v += src.slice(j, j + 2); j += 2; continue; }
        if (src[j] === "\n") throw new Illisible(`chaîne non terminée (ligne ${ligne})`);
        v += src[j]; j++;
      }
      if (j >= src.length) throw new Illisible(`chaîne non terminée (ligne ${ligne})`);
      pousser("str", v, s, j + 1, l); avancer(j + 1); continue;
    }
    if (c === "`") {
      const g = gabarit(i + 1);
      if (g.ouvert) { pousser("tplH", g.brut, s, g.fin, l); pile.push(prof); prof++; }
      else pousser("tpl", g.brut, s, g.fin, l);
      avancer(g.fin); continue;
    }
    if (c === "}" && pile.length > 0 && pile[pile.length - 1] === prof - 1) {
      const g = gabarit(i + 1);
      if (g.ouvert) pousser("tplM", g.brut, s, g.fin, l);
      else { pousser("tplT", g.brut, s, g.fin, l); pile.pop(); prof--; }
      avancer(g.fin); continue;
    }
    if (c === "/" && regexPermise()) {
      let j = i + 1, classe = false;
      while (j < src.length) {
        const d = src[j];
        if (d === "\\") { j += 2; continue; }
        if (d === "\n") throw new Illisible(`expression régulière non terminée (ligne ${ligne})`);
        if (d === "[") classe = true;
        else if (d === "]") classe = false;
        else if (d === "/" && !classe) break;
        j++;
      }
      if (j >= src.length) throw new Illisible(`expression régulière non terminée (ligne ${ligne})`);
      j++;
      while (j < src.length && /[a-z]/i.test(src[j])) j++;
      pousser("re", src.slice(i, j), s, j, l); avancer(j); continue;
    }
    RE_IDENT.lastIndex = i;
    const id = RE_IDENT.exec(src);
    if (id) { pousser("id", id[0], s, i + id[0].length, l); avancer(i + id[0].length); continue; }
    if (c === "#") {
      RE_IDENT.lastIndex = i + 1;
      const p = RE_IDENT.exec(src);
      if (p) { pousser("priv", "#" + p[0], s, i + 1 + p[0].length, l); avancer(i + 1 + p[0].length); continue; }
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      RE_NOMBRE.lastIndex = i;
      const n = RE_NOMBRE.exec(src);
      if (!n) throw new Illisible(`nombre illisible (ligne ${ligne})`);
      pousser("num", n[0], s, i + n[0].length, l); avancer(i + n[0].length); continue;
    }
    const p = PONCTUATION.find((x) => src.startsWith(x, i) && !(x === "?." && /[0-9]/.test(src[i + 2] ?? "")));
    if (!p) throw new Illisible(`caractère inattendu ${JSON.stringify(c)} (ligne ${ligne})`);
    if (p === "{") prof++;
    if (p === "}") prof--;
    pousser("p", p, s, i + p.length, l); avancer(i + p.length);
  }
  if (pile.length > 0) throw new Illisible("gabarit ouvert en fin de fichier");
  return out;
}

/** JavaScript of a TypeScript source, offsets preserved; refused if the API is absent or moves offsets. */
export function javascriptDe(chemin: string, src: string): string {
  if (!chemin.endsWith(".ts")) return src;
  const strip = (nodeModule as unknown as { stripTypeScriptTypes?: (s: string, o: { mode: string }) => string }).stripTypeScriptTypes;
  if (typeof strip !== "function") throw new Illisible("node:module stripTypeScriptTypes indisponible");
  let js: string;
  try { js = strip(src, { mode: "strip" }); } catch (e) { throw new Illisible(`retrait des types impossible : ${(e as Error).message.split("\n")[0]}`); }
  if (js.length !== src.length) throw new Illisible("le retrait des types déplace les positions");
  return js;
}

// ── Structure: brackets, braces, functions, scopes ─────────────────────────────────────────────

const OUVRANTS = new Set(["(", "[", "{"]);
const FERMANTS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
const MOTS_TETE = new Set(["if", "for", "while", "switch", "catch", "with", "function", "return", "typeof", "void", "delete", "new", "await", "yield", "case", "in", "of", "instanceof", "throw", "else", "do"]);
const RESERVES = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else", "export", "extends", "finally",
  "for", "function", "if", "import", "in", "instanceof", "new", "return", "super", "switch", "this", "throw", "try", "typeof", "var",
  "void", "while", "with", "yield", "let", "null", "true", "false", "await",
]);

export interface Motif { genre: "id" | "objet" | "tableau"; tok?: number; nom?: string; props?: { cle: string | null; motif: Motif | null; reste: boolean; tokCle: number }[]; elements?: (Motif | null)[] }
interface Param { index: number; motif: Motif; reste: boolean }
export interface Fonction { debut: number; ouvreParams: number; fermeParams: number; ouvreCorps: number; ferme: number; nom: string | null; ancre: string; chemin: string; params: Param[]; declaration: boolean; exportDefault: boolean; tokFunction: number | null }
interface Liaison { id: string; nom: string; genre: "param" | "var" | "import" | "fonction" | "classe" | "catch"; tok: number; portee: Portee; fonction?: Fonction; index?: number; init?: [number, number]; source?: string; importe?: string; typeSeul?: boolean; ambigue?: boolean }
interface Portee { debut: number; fin: number; fonction: boolean; decls: Map<string, Liaison> }

export interface Analyse {
  src: string; js: string; T: Jeton[]; O: Jeton[]; paire: Int32Array; parent: Int32Array; genreAccolade: Map<number, string>;
  fonctions: Fonction[]; portees: Portee[]; liaisons: Liaison[]; declarants: Set<number>; liaisonDe: (nom: string, tok: number) => Liaison | undefined;
  importsOrig: { source: string; importe: string; local: string; typeSeul: boolean; etoile: boolean; tok: number }[];
  typesLocaux: Set<string>; ligne: (tok: number) => string;
}

export function analyser(chemin: string, src: string): Analyse {
  const js = javascriptDe(chemin, src);
  const T = lexer(js);
  const O = chemin.endsWith(".ts") ? lexer(src) : T;
  const n = T.length;
  const paire = new Int32Array(n).fill(-1), parent = new Int32Array(n).fill(-1);
  const pile: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = T[i];
    parent[i] = pile.length ? pile[pile.length - 1] : -1;
    if (t.k === "tplM") {
      const o = pile.pop();
      if (o === undefined || T[o].k !== "tplH" && T[o].k !== "tplM") throw new Illisible(`gabarit mal apparié (ligne ${t.l})`);
      paire[o] = i; paire[i] = o; pile.push(i); continue;
    }
    if (t.k === "tplT") {
      const o = pile.pop();
      if (o === undefined || T[o].k !== "tplH" && T[o].k !== "tplM") throw new Illisible(`gabarit mal apparié (ligne ${t.l})`);
      paire[o] = i; paire[i] = o; continue;
    }
    if (t.k === "tplH" || (t.k === "p" && OUVRANTS.has(t.v))) { pile.push(i); continue; }
    if (t.k === "p" && FERMANTS[t.v]) {
      const o = pile.pop();
      if (o === undefined || T[o].v !== FERMANTS[t.v] || T[o].k !== "p") throw new Illisible(`${t.v} mal apparié (ligne ${t.l})`);
      paire[o] = i; paire[i] = o; parent[i] = pile.length ? pile[pile.length - 1] : -1;
    }
  }
  if (pile.length) throw new Illisible(`${T[pile[pile.length - 1]].v} non fermé (ligne ${T[pile[pile.length - 1]].l})`);

  // Kind of every `{`: block, object, class, pattern, spec.
  const genreAccolade = new Map<number, string>();
  const enClasse = (i: number) => {
    for (let k = i - 1, c = 0; k >= 0 && c < 12; k--, c++) {
      const v = T[k].v;
      if (T[k].k === "id" && v === "class") return true;
      if (T[k].k === "p" && (v === ";" || v === "{" || v === "}" || v === "=" || v === "=>")) return false;
      if (T[k].k === "p" && v === ")") { k = paire[k]; continue; }
    }
    return false;
  };
  for (let i = 0; i < n; i++) {
    if (!(T[i].k === "p" && T[i].v === "{")) continue;
    const p = T[i - 1];
    let g = "bloc";
    if (!p) g = "bloc";
    else if (p.k === "tplH" || p.k === "tplM") g = "objet";
    else if (p.k === "id") {
      if (p.v === "const" || p.v === "let" || p.v === "var") g = "motif";
      else if ((p.v === "import" || p.v === "export") || (p.v === "type" && (T[i - 2]?.v === "import" || T[i - 2]?.v === "export"))) g = "spec";
      else if (p.v === "return" || p.v === "typeof" || p.v === "in" || p.v === "of" || p.v === "yield" || p.v === "await" || p.v === "default" || p.v === "case" || p.v === "void" || p.v === "delete" || p.v === "throw" || p.v === "new") g = p.v === "case" ? "bloc" : "objet";
      else if (enClasse(i)) g = "classe";
      else g = "bloc";
    } else if (p.k === "p") {
      if (p.v === "=>" || p.v === ")" || p.v === ";" || p.v === "{" || p.v === "}") g = "bloc";
      else if (p.v === ":") {
        // case x: { … } and default: { … } are blocks; everything else here is an object value.
        let k = i - 2; let cas = false;
        while (k >= 0 && !(T[k].k === "p" && (T[k].v === ";" || T[k].v === "{" || T[k].v === "}" || T[k].v === ","))) { if (T[k].v === "case" || T[k].v === "default") { cas = true; break; } k--; }
        g = cas ? "bloc" : "objet";
      } else g = "objet";
    } else g = "objet";
    if (p?.k === "id" && p.v === "class") g = "classe";
    genreAccolade.set(i, g);
  }
  const accoladeDe = (i: number): number => { let o = parent[i]; while (o >= 0 && T[o].v !== "{") o = parent[o]; return o; };

  // Patterns.
  const declarants = new Set<number>();
  const motifDe = (a: number, b: number): Motif | null => {
    if (a > b) return null;
    if (a === b && T[a].k === "id") { declarants.add(a); return { genre: "id", tok: a, nom: T[a].v }; }
    if (T[a].v === "{" && paire[a] === b) {
      const props: NonNullable<Motif["props"]> = [];
      for (const [x, y] of morceaux(a + 1, b - 1)) {
        if (x > y) continue;
        if (T[x].v === "...") { props.push({ cle: null, motif: motifDe(x + 1, y), reste: true, tokCle: x }); continue; }
        const eg = premierAuNiveau(x, y, "=");
        const fin = eg >= 0 ? eg - 1 : y;
        let cle: string | null, tokCle = x, valeur: Motif | null;
        const deux = premierAuNiveau(x, fin, ":");
        if (T[x].v === "[") { cle = null; valeur = deux >= 0 ? motifDe(deux + 1, fin) : null; }
        else {
          cle = T[x].k === "str" || T[x].k === "id" || T[x].k === "num" ? T[x].v : null;
          valeur = deux >= 0 ? motifDe(deux + 1, fin) : motifDe(x, fin);
        }
        props.push({ cle, motif: valeur, reste: false, tokCle });
      }
      return { genre: "objet", props };
    }
    if (T[a].v === "[" && paire[a] === b) {
      const elements: (Motif | null)[] = [];
      for (const [x, y] of morceaux(a + 1, b - 1)) {
        if (x > y) { elements.push(null); continue; }
        const xx = T[x].v === "..." ? x + 1 : x;
        const eg = premierAuNiveau(xx, y, "=");
        elements.push(motifDe(xx, eg >= 0 ? eg - 1 : y));
      }
      return { genre: "tableau", elements };
    }
    return null;
  };
  function morceaux(a: number, b: number): [number, number][] {
    const res: [number, number][] = [];
    let x = a;
    for (let k = a; k <= b; k++) {
      if (paire[k] > k && (OUVRANTS.has(T[k].v) || T[k].k === "tplH")) { k = paire[k]; continue; }
      if (T[k].k === "tplH" || T[k].k === "tplM") { k = paire[k]; continue; }
      if (T[k].v === "," && T[k].k === "p") { res.push([x, k - 1]); x = k + 1; }
    }
    if (x <= b || res.length > 0) res.push([x, b]);
    return res;
  }
  function premierAuNiveau(a: number, b: number, v: string): number {
    for (let k = a; k <= b; k++) {
      if (paire[k] > k) { k = paire[k]; continue; }
      if (T[k].k === "p" && T[k].v === v) return k;
    }
    return -1;
  }
  const nomsDe = (m: Motif | null, acc: { nom: string; tok: number }[] = []) => {
    if (!m) return acc;
    if (m.genre === "id") acc.push({ nom: m.nom!, tok: m.tok! });
    for (const p of m.props ?? []) nomsDe(p.motif, acc);
    for (const e of m.elements ?? []) nomsDe(e, acc);
    return acc;
  };

  // Import and re-export statements: every identifier in them is a declaration or a specifier.
  for (let i = 0; i < n; i++) {
    if (!(T[i].k === "id" && (T[i].v === "import" || T[i].v === "export") && T[i - 1]?.v !== "." && T[i + 1]?.v !== "(" && T[i + 1]?.v !== ".")) continue;
    let k = i + 1, from = -1;
    for (; k < n && k < i + 400; k++) {
      if (T[k].k === "id" && T[k].v === "from" && T[k + 1]?.k === "str") { from = k; break; }
      if (T[k].v === ";" || (k > i + 1 && T[k].nl && T[k].k === "id" && ["import", "export", "const", "let", "var", "function", "class", "async", "default", "type", "interface"].includes(T[k].v) && T[k - 1]?.v !== "," && T[k - 1]?.v !== "{")) break;
      if (T[i].v === "export" && !(T[k].v === "{" || T[k].v === "*" || T[k].v === "}" || T[k].v === "," || T[k].v === "as" || T[k].k === "id")) break;
    }
    if (from < 0) continue;
    for (let x = i + 1; x < from; x++) if (T[x].k === "id") declarants.add(x);
  }

  // Functions.
  const fonctions: Fonction[] = [];
  const paramsDe = (o: number, f: number): Param[] => {
    if (T[o].k === "id") return [{ index: 0, motif: motifDe(o, o)!, reste: false }];
    return morceaux(o + 1, f - 1).filter(([x, y]) => x <= y).map(([x, y], index) => {
      const reste = T[x].v === "...";
      const xx = reste ? x + 1 : x;
      const eg = premierAuNiveau(xx, y, "=");
      return { index, motif: motifDe(xx, eg >= 0 ? eg - 1 : y) ?? { genre: "id" as const }, reste };
    });
  };
  const finExpression = (a: number): number => {
    let k = a;
    for (; k < n; k++) {
      const t = T[k];
      if (paire[k] > k) { k = paire[k]; continue; }
      if (t.k === "p" && (t.v === "," || t.v === ";" || t.v === ")" || t.v === "]" || t.v === "}")) return k - 1;
      if (t.k === "tplM" || t.k === "tplT") return k - 1;
    }
    return n - 1;
  };
  for (let i = 0; i < n; i++) {
    const t = T[i];
    if (t.k === "id" && t.v === "function" && T[i - 1]?.v !== ".") {
      let j = i + 1;
      if (T[j]?.v === "*") j++;
      let nom: string | null = null;
      if (T[j]?.k === "id" && T[j + 1]?.v === "(") { nom = T[j].v; declarants.add(j); j++; }
      if (T[j]?.v !== "(") continue;
      const fp = paire[j];
      if (T[fp + 1]?.v !== "{") continue;
      const avant = T[i - 1]?.v === "async" ? i - 2 : i - 1;
      const pv = T[avant];
      const exportDefault = pv?.v === "default" && T[avant - 1]?.v === "export";
      const declaration = !pv || (pv.k === "p" && (pv.v === ";" || pv.v === "{" || pv.v === "}")) || pv.v === "export" || exportDefault;
      fonctions.push({ debut: avant + 1, ouvreParams: j, fermeParams: fp, ouvreCorps: fp + 1, ferme: paire[fp + 1], nom, ancre: "", chemin: "", params: paramsDe(j, fp), declaration, exportDefault, tokFunction: i });
    } else if (t.k === "p" && t.v === "=>") {
      const p = T[i - 1];
      let o: number, f: number;
      if (p?.v === ")") { o = paire[i - 1]; f = i - 1; }
      else if (p?.k === "id") { o = i - 1; f = i - 1; }
      else continue;
      const debut = T[o - 1]?.v === "async" ? o - 1 : o;
      const ouvre = i + 1;
      const ferme = T[ouvre]?.v === "{" ? paire[ouvre] : finExpression(ouvre);
      fonctions.push({ debut, ouvreParams: o, fermeParams: f, ouvreCorps: ouvre, ferme, nom: null, ancre: "", chemin: "", params: paramsDe(o, f), declaration: false, exportDefault: T[debut - 1]?.v === "default" && T[debut - 2]?.v === "export", tokFunction: null });
    } else if (t.k === "p" && t.v === "(" && T[paire[i] + 1]?.v === "{" && i > 0) {
      const nomTok = T[i - 1];
      const acc = accoladeDe(i);
      const g = acc >= 0 ? genreAccolade.get(acc) : "bloc";
      if (g !== "objet" && g !== "classe") continue;
      if (!(nomTok.k === "id" || nomTok.k === "str" || nomTok.k === "num" || nomTok.v === "]")) continue;
      if (nomTok.k === "id" && MOTS_TETE.has(nomTok.v)) continue;
      if (nomTok.k === "id") declarants.add(i - 1);
      let debut = nomTok.v === "]" ? paire[i - 1] : i - 1;
      while (["async", "get", "set", "static", "*"].includes(T[debut - 1]?.v ?? "") && T[debut - 1]) debut--;
      fonctions.push({ debut, ouvreParams: i, fermeParams: paire[i], ouvreCorps: paire[i] + 1, ferme: paire[paire[i] + 1], nom: nomTok.v === "]" ? null : nomTok.v, ancre: "", chemin: "", params: paramsDe(i, paire[i]), declaration: false, exportDefault: false, tokFunction: null });
    }
  }
  fonctions.sort((a, b) => a.debut - b.debut || b.ferme - a.ferme);
  const texte = (a: number, b: number) => js.slice(T[a].s, T[b].e).replace(/\s+/g, " ").trim();
  for (const f of fonctions) {
    if (f.nom) { f.ancre = f.nom; continue; }
    const p = T[f.debut - 1], pp = T[f.debut - 2];
    if (f.exportDefault) f.ancre = "default";
    else if (p?.v === "=" && pp?.k === "id") f.ancre = pp.v;
    else if (p?.v === ":" && (pp?.k === "id" || pp?.k === "str")) {
      // `handler: (…) => …` inside an object passed to a call: prefixed with that call.
      const acc = accoladeDe(f.debut - 1);
      const avantAcc = acc >= 0 ? T[acc - 1] : undefined;
      const o = avantAcc?.v === "(" ? acc - 1 : avantAcc?.v === "," ? parent[acc] : -1;
      if (o > 0 && T[o].v === "(") {
        let c = o - 1;
        while (c > 0 && (T[c - 1].v === "." || T[c - 1].v === "?.") && T[c - 2]?.k === "id") c -= 2;
        const arg0 = T[o + 1]?.k === "str" ? `(${JSON.stringify(T[o + 1].v)})` : "()";
        f.ancre = `${texte(c, o - 1)}${arg0}.${pp.v}`;
      } else f.ancre = pp.v;
    }
    else if (p && (p.v === "(" || p.v === ",")) {
      let o = p.v === "(" ? f.debut - 1 : parent[f.debut - 1];
      if (o >= 0 && T[o].v === "(" && o > 0) {
        let c = o - 1;
        while (c > 0 && (T[c - 1].v === "." || T[c - 1].v === "?.") && T[c - 2]?.k === "id") c -= 2;
        const arg0 = T[o + 1]?.k === "str" ? `(${JSON.stringify(T[o + 1].v)})` : "()";
        const idx = morceaux(o + 1, paire[o] - 1).findIndex(([x, y]) => x <= f.debut && f.debut <= y);
        f.ancre = `${texte(c, o - 1)}${arg0}#${idx}`;
      } else f.ancre = "anonyme";
    } else f.ancre = "anonyme";
  }
  const vus = new Map<string, number>();
  for (const f of fonctions) {
    const parentsF = fonctions.filter((g) => g !== f && g.ouvreParams <= f.debut && f.debut <= g.ferme).map((g) => g.ancre).join(">");
    const cle = `${parentsF}>${f.ancre}`;
    const k = (vus.get(cle) ?? 0) + 1;
    vus.set(cle, k);
    if (k > 1) f.ancre = `${f.ancre}~${k}`;
  }
  const contenant = (tok: number) => fonctions.filter((f) => f.ouvreParams <= tok && tok <= f.ferme);
  for (const f of fonctions) {
    const chaine = fonctions.filter((g) => g !== f && g.ouvreParams <= f.debut && f.debut <= g.ferme).map((g) => g.ancre);
    f.chemin = [...chaine, f.ancre].join(">");
  }

  // Scopes and declarations.
  const portees: Portee[] = [{ debut: 0, fin: n, fonction: true, decls: new Map() }];
  for (const f of fonctions) portees.push({ debut: f.ouvreParams, fin: f.ferme, fonction: true, decls: new Map() });
  for (const [i, g] of genreAccolade) if (g === "bloc" || g === "classe") portees.push({ debut: i, fin: paire[i], fonction: false, decls: new Map() });
  const porteesTriees = () => portees.slice().sort((a, b) => (a.fin - a.debut) - (b.fin - b.debut));
  let tri = porteesTriees();
  const porteeDe = (tok: number, fonction = false) => tri.find((p) => p.debut <= tok && tok <= p.fin && (!fonction || p.fonction))!;
  const liaisons: Liaison[] = [];
  const cheminA = (tok: number) => { const c = contenant(tok); return c.length ? c[c.length - 1].chemin : "module"; };
  const declarer = (l: Liaison) => {
    const exist = l.portee.decls.get(l.nom);
    if (exist && exist.genre !== "var" && exist.genre !== "fonction") { exist.ambigue = true; l.ambigue = true; }
    l.portee.decls.set(l.nom, l);
    liaisons.push(l);
  };
  // Parameters.
  for (const f of fonctions) {
    const p = portees.find((x) => x.debut === f.ouvreParams && x.fin === f.ferme && x.fonction)!;
    for (const prm of f.params) for (const { nom, tok } of nomsDe(prm.motif)) declarer({ id: `param:${f.chemin}#${prm.index}:${nom}`, nom, genre: "param", tok, portee: p, fonction: f, index: prm.index });
    if (f.nom && f.tokFunction !== null) {
      const tokNom = f.tokFunction + (T[f.tokFunction + 1].v === "*" ? 2 : 1);
      const cible = f.declaration ? porteeDe(f.debut - 1 >= 0 ? f.debut : 0) : p;
      const pc = f.declaration ? tri.find((x) => x.debut <= tokNom && tokNom <= x.fin && x !== p)! : p;
      declarer({ id: `fonction:${cheminA(f.debut)}:${f.nom}`, nom: f.nom, genre: "fonction", tok: tokNom, portee: f.declaration ? pc : cible, fonction: f });
    }
  }
  // Variables, classes, catch.
  for (let i = 0; i < n; i++) {
    const t = T[i];
    if (t.k !== "id") continue;
    if ((t.v === "const" || t.v === "let" || t.v === "var") && T[i - 1]?.v !== ".") {
      const p = T[i - 1];
      if (p && !(p.k === "p" && (p.v === ";" || p.v === "{" || p.v === "}" || p.v === "(")) && p.v !== "export" && !p.nl && p.v !== "default") continue;
      const enTete = p?.v === "(" && T[i - 2]?.v === "for";
      let k = i + 1;
      while (k < n) {
        let fin = k;
        if (T[k].v === "{" || T[k].v === "[") fin = paire[k]; else if (T[k].k !== "id") break;
        const motif = motifDe(k, fin);
        let suite = fin + 1, init: [number, number] | undefined;
        if (T[suite]?.v === "=") { const fe = finDeclarateur(suite + 1); init = [suite + 1, fe]; suite = fe + 1; }
        let portee: Portee;
        if (enTete) { const o = i - 1, fp = paire[o]; const corps = T[fp + 1]?.v === "{" ? paire[fp + 1] : finExpression(fp + 1); portee = { debut: o, fin: corps, fonction: false, decls: new Map() }; portees.push(portee); tri = porteesTriees(); }
        else portee = t.v === "var" ? porteeDe(i, true) : porteeDe(i);
        for (const { nom, tok } of nomsDe(motif)) declarer({ id: `var:${cheminA(i)}:${nom}`, nom, genre: "var", tok, portee, init: motif?.genre === "id" ? init : undefined });
        if (T[suite]?.v === "," && !enTete) { k = suite + 1; continue; }
        break;
      }
    } else if (t.v === "class" && T[i + 1]?.k === "id" && T[i - 1]?.v !== ".") {
      declarants.add(i + 1);
      declarer({ id: `classe:${cheminA(i)}:${T[i + 1].v}`, nom: T[i + 1].v, genre: "classe", tok: i + 1, portee: porteeDe(i) });
    } else if (t.v === "catch" && T[i + 1]?.v === "(") {
      const o = i + 1, fp = paire[o];
      const corps = T[fp + 1]?.v === "{" ? paire[fp + 1] : fp;
      const portee: Portee = { debut: o, fin: corps, fonction: false, decls: new Map() };
      portees.push(portee); tri = porteesTriees();
      for (const { nom, tok } of nomsDe(motifDe(o + 1, fp - 1))) declarer({ id: `catch:${cheminA(i)}:${nom}`, nom, genre: "catch", tok, portee });
    }
  }
  function finDeclarateur(a: number): number {
    for (let k = a; k < n; k++) {
      const t = T[k];
      if (paire[k] > k) { k = paire[k]; continue; }
      if (t.k === "p" && (t.v === "," || t.v === ";" || t.v === ")" || t.v === "]" || t.v === "}")) return k - 1;
      if (t.k === "tplM" || t.k === "tplT") return k - 1;
      if (k > a && t.nl && t.k === "id" && ["const", "let", "var", "function", "class", "return", "if", "for", "while", "export", "import", "throw", "try", "switch", "do"].includes(t.v)) return k - 1;
    }
    return n - 1;
  }

  // Imports, read on the original source (type-only imports included).
  const importsOrig: Analyse["importsOrig"] = [];
  for (let i = 0; i < O.length; i++) {
    if (!(O[i].k === "id" && (O[i].v === "import" || O[i].v === "export") && O[i - 1]?.v !== "." && O[i + 1]?.v !== "(")) continue;
    // Find `from "x"` or a bare string, within the statement.
    let k = i + 1;
    const typeSeulDecl = O[k]?.v === "type" && O[k + 1]?.v !== "from" && O[k + 1]?.v !== ",";
    if (typeSeulDecl) k++;
    if (O[k]?.k === "str" && O[i].v === "import") { importsOrig.push({ source: O[k].v, importe: "(effet)", local: "", typeSeul: false, etoile: false, tok: k }); continue; }
    const specs: { importe: string; local: string; typeSeul: boolean; etoile: boolean }[] = [];
    let ok = false;
    for (; k < O.length; k++) {
      const v = O[k];
      if (v.k === "id" && v.v === "from" && O[k + 1]?.k === "str") { ok = true; break; }
      if (v.v === ";" || (v.k === "id" && v.nl && ["import", "export", "const", "let", "function", "class"].includes(v.v) && k > i + 1)) break;
      if (v.v === "*" && O[k + 1]?.v === "as" && O[k + 2]?.k === "id") { specs.push({ importe: "*", local: O[k + 2].v, typeSeul: typeSeulDecl, etoile: true }); k += 2; continue; }
      if (v.v === "{") {
        const fin = (() => { let d = 0; for (let x = k; x < O.length; x++) { if (O[x].v === "{") d++; if (O[x].v === "}") { d--; if (d === 0) return x; } } return O.length - 1; })();
        let x = k + 1;
        while (x < fin) {
          let ts = typeSeulDecl;
          if (O[x].v === "type" && O[x + 1]?.k === "id" && O[x + 1].v !== "as") { ts = true; x++; }
          if (O[x].k === "id" || O[x].k === "str") {
            const importe = O[x].v;
            let local = O[x].v;
            if (O[x + 1]?.v === "as" && (O[x + 2]?.k === "id" || O[x + 2]?.k === "str")) { local = O[x + 2].v; x += 2; }
            specs.push({ importe, local, typeSeul: ts, etoile: false });
          }
          x++;
          if (O[x]?.v === ",") x++;
        }
        k = fin; continue;
      }
      if (v.k === "id" && O[i].v === "import" && k === (typeSeulDecl ? i + 2 : i + 1) && v.v !== "type") specs.push({ importe: "default", local: v.v, typeSeul: typeSeulDecl, etoile: false });
    }
    if (!ok) continue;
    const source = O[k + 1].v;
    for (const s of specs) importsOrig.push({ source, ...s, tok: k + 1 });
    if (O[i].v === "export" && specs.length === 0) importsOrig.push({ source, importe: "*", local: "", typeSeul: false, etoile: true, tok: k + 1 });
  }
  const module = portees[0];
  for (const im of importsOrig) {
    if (!im.local) continue;
    declarer({ id: `import:${im.local}`, nom: im.local, genre: "import", tok: -1, portee: module, source: im.source, importe: im.importe, typeSeul: im.typeSeul });
  }
  // Locally declared type names (interface, type alias, class): an import is not resolved through them.
  const typesLocaux = new Set<string>();
  for (let i = 0; i < O.length; i++) {
    if (O[i].k === "id" && (O[i].v === "interface" || O[i].v === "type" || O[i].v === "class") && O[i + 1]?.k === "id" && O[i - 1]?.v !== "." && O[i - 1]?.v !== "import" && O[i - 1]?.v !== "{" && O[i - 1]?.v !== ",") {
      if (O[i].v === "type" && O[i + 2]?.v !== "=" && O[i + 2]?.v !== "<") continue;
      typesLocaux.add(O[i + 1].v);
    }
  }

  tri = porteesTriees();
  const liaisonDe = (nom: string, tok: number) => {
    for (const p of tri) if (p.debut <= tok && tok <= p.fin && p.decls.has(nom)) return p.decls.get(nom);
    return undefined;
  };
  const lignes = src.split("\n");
  const ligne = (tok: number) => (lignes[T[tok].l - 1] ?? "").trim();
  return { src, js, T, O, paire, parent, genreAccolade, fonctions, portees, liaisons, declarants, liaisonDe, importsOrig, typesLocaux, ligne };
}

// ── Recognition ────────────────────────────────────────────────────────────────────────────────

export interface Surface { type: string; nom: string; fichier: string }
export interface Site { fichier: string; type: string; liaison: string; forme: string; ancrage: string; ligne: number }
export interface Recepteur { fichier: string; regle: string; nom: string; liaison: string; source?: string; prefixe?: string }
export interface SiteSource { fichier: string; ancrage: string; sha256: string; ligne: number }
export interface Reconnu {
  surfaces: Surface[]; inclassables: Site[]; recepteurs: Recepteur[]; ctx: { fichier: string; liaison: string; refs: number; ambigue: boolean }[];
  sources: SiteSource[]; constantes: Map<string, string>; illisibles: { fichier: string; raison: string }[];
}

const TERMINAUX = new Set([";", ",", ")", "]", "}", ":"]);

/** The flux constants of pi-adapt.ts: `NAME.key` → literal, and `BLOC_TEXTE` → literal. */
export function constantesFlux(a: Analyse): Map<string, string> {
  const res = new Map<string, string>();
  const { T, paire } = a;
  for (let i = 0; i < T.length; i++) {
    if (!(T[i].v === "export" && T[i + 1]?.v === "const" && T[i + 2]?.k === "id" && T[i + 3]?.v === "=")) continue;
    const nom = T[i + 2].v;
    if ((nom === "FLUX" || nom === "CHAMPS_FLUX") && T[i + 4]?.v === "{") {
      const f = paire[i + 4];
      for (let k = i + 5; k < f; k++) {
        if (T[k].k === "id" && T[k + 1]?.v === ":" && T[k + 2]?.k === "str" && (T[k + 3]?.v === "," || k + 3 === f)) { res.set(`${nom}.${T[k].v}`, T[k + 2].v); k += 2; continue; }
        if (T[k].v === ",") continue;
        throw new Illisible(`déclaration de ${nom} non littérale (ligne ${T[k].l})`);
      }
    }
    if (nom === "BLOC_TEXTE") {
      if (T[i + 4]?.k !== "str") throw new Illisible("déclaration de BLOC_TEXTE non littérale");
      res.set("BLOC_TEXTE", T[i + 4].v);
    }
  }
  return res;
}

export interface Contexte {
  fichier: string; a: Analyse; out: Reconnu; constantes: Map<string, string>; recepteursDeclares: Recepteur[]; ctxInternes: Set<string>;
  flux: boolean; drapeau: boolean; testOnly: boolean;
}

export function reconnaitreFichier(cx: Contexte): void {
  const { fichier, a, out } = cx;
  const { T, paire, parent, js, liaisonDe } = a;
  const n = T.length;
  const surface = (type: string, nom: string) => out.surfaces.push({ type, nom, fichier });
  const ancrageDe = (tok: number) => a.ligne(tok);
  const formeDe = (x: number, y: number) => a.src.slice(T[x].s, T[y].e);
  const inclassable = (type: string, liaison: string, x: number, y: number) =>
    out.inclassables.push({ fichier, type, liaison, forme: formeDe(x, y), ancrage: ancrageDe(x), ligne: T[x].l });

  // Imports.
  for (const im of a.importsOrig) {
    if (RE_PAQUET_SDK.test(im.source)) surface("import", `${im.source}:${im.importe}`);
  }
  const estReference = (i: number): boolean => {
    const t = T[i];
    if (t.k !== "id" || RESERVES.has(t.v)) return false;
    const p = T[i - 1];
    if (p && p.k === "p" && (p.v === "." || p.v === "?.")) return false;
    if (a.declarants.has(i)) return false;
    const acc = (() => { let o = parent[i]; return o; })();
    if (acc >= 0 && T[acc].v === "{") {
      const g = a.genreAccolade.get(acc);
      if (g === "spec") return false;
      if (g === "objet" || g === "classe" || g === "motif") {
        const debutProp = p && (p === T[acc] || (p.k === "p" && p.v === ","));
        if (debutProp && (T[i + 1]?.v === ":" || T[i + 1]?.v === "(")) return false;
        if (debutProp && ["get", "set", "async", "static"].includes(t.v) && (T[i + 1]?.k === "id" || T[i + 1]?.v === "[")) return false;
        if (g === "classe" && debutProp) return false;
        if (g === "motif") return false;
      }
    }
    return true;
  };
  const appelParen = (o: number) => {
    const c = T[o - 1];
    if (!c) return false;
    if (c.k === "id") return !MOTS_TETE.has(c.v) && !RESERVES.has(c.v) || c.v === "import" || c.v === "super";
    return c.v === ")" || c.v === "]" || c.v === "?." || c.k === "tpl" || c.k === "tplT";
  };
  /** Widest parenthesised group around [x, y] that is not a call. */
  const deballer = (x: number, y: number): [number, number] => {
    while (T[x - 1]?.v === "(" && T[y + 1]?.v === ")" && paire[x - 1] === y + 1 && !appelParen(x - 1)) { x--; y++; }
    return [x, y];
  };
  const chaine = (y: number) => {
    const membres: string[] = [];
    let k = y + 1;
    while ((T[k]?.v === "." || T[k]?.v === "?.") && T[k + 1]?.k === "id") { membres.push(T[k + 1].v); k += 2; }
    const appel = T[k]?.v === "(" || (T[k]?.v === "?." && T[k + 1]?.v === "(");
    const calcule = membres.length === 0 && (T[y + 1]?.v === "[" || (T[y + 1]?.v === "?." && T[y + 2]?.v === "["));
    return { membres, k, appel, calcule };
  };
  const finTerminale = (y: number) => { const s = T[y + 1]; return !s || (s.k === "p" && TERMINAUX.has(s.v)) || (s.nl && s.k === "id"); };
  const finCalcule = (y: number) => { const o = T[y + 1].v === "[" ? y + 1 : y + 2; return paire[o]; };

  // Receivers: default export parameter, R-PARAM parameters; aliases by R-AFF.
  type Suivi = { liaison: Liaison; genre: "recepteur" | "ctx" | "espace"; prefixe?: string; paquet?: string; interne?: boolean };
  const suivis = new Map<Liaison, Suivi>();
  for (const f of a.fonctions) {
    if (f.exportDefault && f.params[0]) {
      const m = f.params[0].motif;
      if (m.genre === "id" && m.tok !== undefined) {
        const l = a.liaisons.find((x) => x.genre === "param" && x.tok === m.tok)!;
        suivis.set(l, { liaison: l, genre: "recepteur" });
        out.recepteurs.push({ fichier, regle: "export-default", nom: l.nom, liaison: l.id });
      } else destructurerRecepteur(m, `param:${f.chemin}#0`);
    }
    for (const prm of f.params) {
      if (prm.motif.genre !== "id" || prm.motif.tok === undefined) continue;
      const tok = prm.motif.tok;
      if (!annoteExtensionAPI(tok)) continue;
      const l = a.liaisons.find((x) => x.genre === "param" && x.tok === tok)!;
      if (suivis.has(l)) continue;
      suivis.set(l, { liaison: l, genre: "recepteur" });
      out.recepteurs.push({ fichier, regle: "R-PARAM", nom: l.nom, liaison: l.id });
    }
  }
  function annoteExtensionAPI(tok: number): boolean {
    const O = a.O;
    const oi = O.findIndex((o) => o.s === T[tok].s);
    if (oi < 0) return false;
    let k = oi + 1;
    if (O[k]?.v === "?") k++;
    if (O[k]?.v !== ":" || O[k + 1]?.k !== "id") return false;
    const nomType = O[k + 1].v;
    if (!(O[k + 2] && [",", ")", "="].includes(O[k + 2].v))) return false;
    if (a.typesLocaux.has(nomType)) return false;
    return a.importsOrig.some((im) => im.local === nomType && im.importe === "ExtensionAPI" && im.source === "@earendil-works/pi-coding-agent");
  }
  function destructurerRecepteur(m: Motif, liaison: string, prefixe = "") {
    for (const p of m.props ?? []) {
      if (p.reste || p.cle === null) { const t = p.tokCle; inclassable("destructuration", liaison, t, t); continue; }
      surface("destructuration", prefixe + p.cle);
      if (p.motif && p.motif.genre === "objet") destructurerRecepteur(p.motif, liaison, `${prefixe}${p.cle}.`);
    }
    if (m.genre === "tableau") inclassable("destructuration", liaison, 0, 0);
  }
  // ctx bindings and namespaces.
  for (const l of a.liaisons) {
    if (l.nom === "ctx" && (l.genre === "param" || l.genre === "var" || l.genre === "catch")) suivis.set(l, { liaison: l, genre: "ctx", prefixe: "ctx", interne: cx.ctxInternes.has(`${fichier}|${l.id}`) });
    if (l.genre === "import" && l.importe === "*" && l.source && RE_PAQUET_SDK.test(l.source)) suivis.set(l, { liaison: l, genre: "espace", paquet: l.source });
  }
  const refsCtx = new Map<Liaison, number>();
  // Fixpoint: aliases discovered while classifying create new tracked bindings.
  const traites = new Set<string>();
  let change = true;
  const classes: Array<() => void> = [];
  while (change) {
    change = false;
    // Only identifiers spelled like a tracked binding are resolved: resolution is by scope, the name
    // only narrows the search.
    const nomsSuivis = new Set([...suivis.keys()].map((l) => l.nom));
    for (let i = 0; i < n; i++) {
      if (T[i].k !== "id" || !nomsSuivis.has(T[i].v)) continue;
      const l0 = liaisonDe(T[i].v, i);
      if (!l0) continue;
      const s = suivis.get(l0);
      if (!s) continue;
      const cle = `${i}`;
      if (traites.has(cle)) continue;
      if (!estReference(i)) {
        // A shorthand property `{ pi }` is not a reference position in a pattern, but it is a stored value.
        continue;
      }
      traites.add(cle);
      const nouveaux = classer(i, s);
      if (nouveaux) change = true;
    }
  }
  for (const f of classes) f();
  for (const [l, s] of suivis) if (s.genre === "ctx" && s.prefixe === "ctx" && l.nom === "ctx") out.ctx.push({ fichier, liaison: l.id, refs: refsCtx.get(l) ?? 0, ambigue: !!l.ambigue });

  /** Classifies one reference of a tracked binding. Returns true if a new tracked binding appeared. */
  function classer(i: number, s: Suivi): boolean {
    const l = s.liaison;
    if (s.genre === "ctx" && s.interne) { refsCtx.set(l, (refsCtx.get(l) ?? 0) + 1); return false; }
    if (s.genre === "ctx") refsCtx.set(l, (refsCtx.get(l) ?? 0) + 1);
    const [x, y] = deballer(i, i);
    const avant = T[x - 1], apres = T[y + 1];
    const c = chaine(y);
    // Proprety shorthand `{ pi }` or `{ k: pi }`: a stored value.
    const acc = parent[x];
    if (acc >= 0 && T[acc].v === "{" && a.genreAccolade.get(acc) === "objet" && (avant === T[acc] || avant?.v === "," || avant?.v === ":") && (apres?.v === "," || apres?.v === "}")) {
      if (s.genre !== "ctx") inclassable("stockage", l.id, x, y);
      return false;
    }
    if (c.calcule) {
      inclassable("acces-calcule", l.id, x, finCalcule(y));
      return false;
    }
    if (c.membres.length > 0) {
      if (s.genre === "recepteur") {
        surface("methode", c.membres[0]);
        if (c.membres[0] === "on" && c.appel && c.membres.length === 1) {
          const o = T[c.k].v === "(" ? c.k : c.k + 1;
          const a0 = T[o + 1];
          if ((a0?.k === "str" || a0?.k === "tpl") && (T[o + 2]?.v === "," || T[o + 2]?.v === ")")) surface("evenement", a0.v);
          else inclassable("evenement", l.id, x, paire[o]);
        }
      } else if (s.genre === "espace") surface("import", `${s.paquet}:${c.membres[0]}`);
      else {
        const base = s.prefixe!.split(".");
        const tout = [...base, ...c.membres];
        for (let k = 2; k <= tout.length; k++) surface("ctx", tout.slice(0, k).join("."));
        // R-CTX: `X = ctx.ui`.
        if (s.prefixe === "ctx" && c.membres.length === 1 && c.membres[0] === "ui" && avant?.v === "=" && finTerminale(c.k - 1)) return alias(x, "R-CTX", s, "ctx.ui");
      }
      return false;
    }
    if (s.genre === "ctx" && avant?.v === "in") {
      const g = T[x - 2];
      if (g?.k === "str") surface("ctx", `${s.prefixe}.${g.v}`);
      else inclassable("in-ctx", l.id, x - 2, y);
      return false;
    }
    if (avant?.v === "=" && finTerminale(y) && T[x - 2]) {
      const cible = T[x - 2];
      if (cible.v === "}" || cible.v === "]") {
        const o = paire[x - 2];
        const motif = (() => { const d = T[o - 1]; return d && (d.v === "const" || d.v === "let" || d.v === "var") ? o : -1; })();
        if (motif < 0) { inclassable("destructuration", l.id, o, y); return false; }
        if (T[o].v === "[") { inclassable("destructuration", l.id, o, y); return false; }
        const props = (motifObjet(o) ?? []);
        if (props.some((p) => p.reste || p.cle === null)) { inclassable("destructuration", l.id, o, y); return false; }
        if (s.genre === "recepteur") destructurerRecepteur({ genre: "objet", props }, l.id);
        else if (s.genre === "espace") { for (const p of props) { if (p.reste || p.cle === null) inclassable("destructuration", l.id, o, y); else surface("import", `${s.paquet}:${p.cle}`); } }
        else destructurerCtx(props, s.prefixe!, l.id, o, y);
        return false;
      }
      if (cible.k === "id") {
        if (s.genre === "recepteur") return alias(x, "R-AFF", s);
        if (s.genre === "ctx") return alias(x, "R-CTX", s, s.prefixe);
        inclassable("residuel", l.id, x, y);
        return false;
      }
    }
    // Assignment target of an alias: `PI_API = pi` is the R-AFF site itself.
    if (apres?.v === "=" && x === y) {
      const [rx, ry] = deballer(y + 2, y + 2);
      const src = liaisonDe(T[rx].v, rx);
      if (rx === ry && T[rx].k === "id" && src && suivis.has(src) && finTerminale(ry)) return false;
      const sc = chaine(ry);
      if (rx === ry && src && suivis.get(src)?.genre === "ctx" && sc.membres.join(".") === "ui" && finTerminale(sc.k - 1)) return false;
      if (s.genre !== "ctx") inclassable("residuel", l.id, x, y);
      return false;
    }
    // Transmission as a call argument.
    if ((avant?.v === "(" || avant?.v === ",") && (apres?.v === "," || apres?.v === ")")) {
      const o = avant.v === "(" ? x - 1 : parent[x];
      if (o >= 0 && T[o].v === "(" && appelParen(o)) {
        if (s.genre === "ctx") return false;
        if (s.genre === "recepteur") {
          const idx = (() => { let c2 = 0; for (let k = o + 1; k < x; k++) { if (paire[k] > k) { k = paire[k]; continue; } if (T[k].v === ",") c2++; } return c2; })();
          const callee = T[o - 1];
          if (callee.k === "id" && T[o - 2]?.v !== "." && T[o - 2]?.v !== "?.") {
            const lf = liaisonDe(callee.v, o - 1);
            const fn = lf?.genre === "fonction" ? lf.fonction : lf?.genre === "var" && lf.init ? a.fonctions.find((f) => f.debut === lf.init![0] && f.ferme === lf.init![1]) : undefined;
            const prm = fn?.params.find((p) => p.index === idx && !p.reste);
            if (fn && prm && prm.motif.genre === "id") {
              const lp = a.liaisons.find((z) => z.genre === "param" && z.tok === prm.motif.tok);
              if (lp && suivis.get(lp)?.genre === "recepteur" && out.recepteurs.some((r) => r.fichier === fichier && r.liaison === lp.id && r.regle === "R-PARAM")) return false;
            }
          }
          inclassable("transmission", l.id, o - 1, paire[o]);
          return false;
        }
        inclassable("residuel", l.id, x, y);
        return false;
      }
    }
    if (s.genre === "ctx") return false;
    inclassable("residuel", l.id, x, y);
    return false;
  }
  /** Keys of an object pattern at `o` (nested objects followed; rest and computed keys flagged). */
  function motifObjet(o: number) {
    const res: NonNullable<Motif["props"]> = [];
    const f = paire[o];
    let k = o + 1;
    while (k < f) {
      if (T[k].v === "...") { res.push({ cle: null, motif: null, reste: true, tokCle: k }); k = sauter(k + 1, f); continue; }
      if (T[k].v === "[") { res.push({ cle: null, motif: null, reste: false, tokCle: k }); k = sauter(k, f); continue; }
      const cle = T[k].v, tokCle = k;
      let motif: Motif | null = null;
      if (T[k + 1]?.v === ":" && T[k + 2]?.v === "{") motif = { genre: "objet", props: motifObjet(k + 2) };
      res.push({ cle, motif, reste: false, tokCle });
      k = sauter(k, f);
    }
    return res;
  }
  function sauter(k: number, f: number) { for (; k < f; k++) { if (paire[k] > k) { k = paire[k]; continue; } if (T[k].v === ",") return k + 1; } return f; }
  function destructurerCtx(props: NonNullable<Motif["props"]>, prefixe: string, liaison: string, x: number, y: number) {
    for (const p of props) {
      if (p.reste || p.cle === null) { inclassable("destructuration", liaison, x, y); continue; }
      surface("ctx", `${prefixe}.${p.cle}`);
      if (p.motif?.genre === "objet") destructurerCtx(p.motif.props ?? [], `${prefixe}.${p.cle}`, liaison, x, y);
    }
  }
  function alias(x: number, regle: string, s: Suivi, prefixe?: string): boolean {
    const cibleTok = x - 2;
    const lc = liaisonDe(T[cibleTok].v, cibleTok);
    if (!lc || lc.ambigue) { inclassable("alias", s.liaison.id, cibleTok, x); return false; }
    if (suivis.has(lc)) return false;
    suivis.set(lc, { liaison: lc, genre: s.genre === "recepteur" ? "recepteur" : "ctx", prefixe });
    out.recepteurs.push({ fichier, regle, nom: lc.nom, liaison: lc.id, source: s.liaison.id, ...(prefixe ? { prefixe } : {}) });
    return true;
  }

  // Dynamic loads (Q5).
  for (let i = 0; i < n; i++) {
    const t = T[i];
    let charge = false;
    if (t.k === "id" && t.v === "import" && T[i + 1]?.v === "(" && T[i - 1]?.v !== ".") charge = true;
    if (t.k === "id" && T[i + 1]?.v === "(" && T[i - 1]?.v !== "." && T[i - 1]?.v !== "?.") {
      const l = liaisonDe(t.v, i);
      if (l?.genre === "var" && l.init) {
        const [x0] = l.init;
        const c0 = T[x0];
        const lc = c0?.k === "id" ? liaisonDe(c0.v, x0) : undefined;
        if (lc?.genre === "import" && lc.importe === "createRequire" && (lc.source === "node:module" || lc.source === "module") && T[x0 + 1]?.v === "(") charge = true;
      }
    }
    if (!charge) continue;
    const o = i + 1, f = paire[o];
    const args = [];
    for (let k = o + 1; k < f; k++) args.push(T[k]);
    const sdk = args.find((x) => (x.k === "str" || x.k === "tpl") && RE_CHEMIN_SDK.test(x.v));
    if (sdk && cx.testOnly) { surface("chargement", sdk.v); continue; }
    if (!sdk && args.length === 1 && (args[0].k === "str" || args[0].k === "tpl")) continue;
    inclassable("chargement", "", i, f);
  }

  // Embedded sources (Q6), test tooling only.
  if (cx.testOnly) {
    for (let i = 0; i < n; i++) {
      const t = T[i];
      if (t.k === "str" || t.k === "tpl") {
        const brut = a.src.slice(t.s, t.e);
        if (brut.includes("export default")) out.sources.push({ fichier, ancrage: ancrageDe(i), sha256: sha256(Buffer.from(brut, "utf8")), ligne: t.l });
      } else if (t.k === "tplH") {
        let k = i, texteBrut = t.v;
        while (T[k].k !== "tplT") { k = paire[k]; texteBrut += T[k].v; }
        if (texteBrut.includes("export default")) out.sources.push({ fichier, ancrage: ancrageDe(i), sha256: sha256(Buffer.from(a.src.slice(t.s, T[k].e), "utf8")), ligne: t.l });
      }
    }
  }

  // Flags (Drapeau).
  if (cx.drapeau) for (const t of T) if (t.k === "str" && (/^--[A-Za-z0-9]/.test(t.v) || t.v === "-e" || t.v === "-p")) surface("drapeau", t.v);

  // Flux forms (direct and resolved), and uses of the flux constants.
  if (cx.flux) {
    const resolue = (nom: string, tok: number) => {
      const l = liaisonDe(nom, tok);
      if (!l) return false;
      if (fichier === "subagent-only/pi-adapt.ts" && l.genre === "var" && l.portee === a.portees[0]) return true;
      return l.genre === "import" && l.importe === nom && /^\.\/pi-adapt\.(ts|js)$/.test(l.source ?? "");
    };
    const valeurDe = (k: number): { v?: string; fin: number; inclassable?: boolean } | null => {
      const t = T[k];
      if (!t) return null;
      if (t.k === "str") return { v: t.v, fin: k };
      if (t.k === "id" && t.v === "FLUX" && (T[k + 1]?.v === "." || T[k + 1]?.v === "?.") && T[k + 2]?.k === "id") {
        const v = cx.constantes.get(`FLUX.${T[k + 2].v}`);
        return resolue("FLUX", k) && v !== undefined ? { v, fin: k + 2 } : { fin: k + 2, inclassable: true };
      }
      if (t.k === "id" && t.v === "BLOC_TEXTE") {
        const v = cx.constantes.get("BLOC_TEXTE");
        return resolue("BLOC_TEXTE", k) && v !== undefined ? { v, fin: k } : { fin: k, inclassable: true };
      }
      if (t.k === "id" && (T[k + 1]?.v === "." || T[k + 1]?.v === "?." || T[k + 1]?.v === "[" || TERMINAUX.has(T[k + 1]?.v ?? ";") || T[k + 1]?.v === "&&" || T[k + 1]?.v === "||" || T[k + 1]?.v === ")")) return { fin: k, inclassable: true };
      return null;
    };
    const OPS = new Set(["===", "!==", "==", "!="]);
    /** First token of the member expression that ends just before `k` (identifiers, `.`, `?.`, `[…]`, `(…)`). */
    const debutReceveur = (k: number): number => {
      let x = k - 1;
      while (x >= 0) {
        const t = T[x];
        if (t.v === "]" || t.v === ")") { x = paire[x] - 1; continue; }
        if (t.k === "id" && (T[x - 1]?.v === "." || T[x - 1]?.v === "?.")) { x -= 2; continue; }
        if (t.k === "id" || t.k === "str") return x;
        if (t.v === "?." && T[x + 1]?.v === "[") { x--; continue; }
        return x + 1;
      }
      return 0;
    };
    for (let i = 0; i < n; i++) {
      // Read forms: `.type`, `?.type`, `[CHAMPS_FLUX.k]`, `?.[CHAMPS_FLUX.k]` with value "type".
      let debut = -1, fin = -1;
      if ((T[i].v === "." || T[i].v === "?.") && T[i + 1]?.k === "id" && T[i + 1].v === "type" && T[i + 2]?.v !== "(") { debut = i; fin = i + 1; }
      else if (T[i].v === "[" && T[i + 1]?.v === "CHAMPS_FLUX" && (T[i + 2]?.v === "." || T[i + 2]?.v === "?.") && T[i + 3]?.k === "id" && paire[i] === i + 4) {
        const v = cx.constantes.get(`CHAMPS_FLUX.${T[i + 3].v}`);
        if (!resolue("CHAMPS_FLUX", i + 1) || v === undefined) { inclassable("flux", "", i, i + 4); continue; }
        if (v !== "type") continue;
        debut = T[i - 1]?.v === "?." ? i - 1 : i; fin = i + 4;
      } else continue;
      if (OPS.has(T[fin + 1]?.v ?? "")) {
        const val = valeurDe(fin + 2);
        if (!val || val.inclassable) { inclassable("flux", "", debutReceveur(debut), val ? val.fin : fin + 1); continue; }
        surface("flux", val.v!);
      } else {
        // Value on the left of the operator: a literal, FLUX.k or BLOC_TEXTE. The read form's own
        // receiver precedes `debut`; the operator is the token before that receiver expression.
        const g = debutReceveur(debut) - 1;
        if (!OPS.has(T[g]?.v ?? "")) continue;
        let x0 = g - 1;
        if (T[x0]?.k === "id" && (T[x0 - 1]?.v === "." || T[x0 - 1]?.v === "?.") && T[x0 - 2]?.v === "FLUX") x0 = x0 - 2;
        const val = valeurDe(x0);
        if (!val || val.inclassable || val.fin !== g - 1) { inclassable("flux", "", x0 >= 0 ? x0 : debut, fin); continue; }
        surface("flux", val.v!);
      }
    }
    // Uses of the constants: every resolved `FLUX.k`, `CHAMPS_FLUX.k` and `BLOC_TEXTE`.
    for (let i = 0; i < n; i++) {
      const t = T[i];
      if (t.k !== "id" || T[i - 1]?.v === "." || T[i - 1]?.v === "?.") continue;
      if ((t.v === "FLUX" || t.v === "CHAMPS_FLUX") && (T[i + 1]?.v === "." || T[i + 1]?.v === "?.") && T[i + 2]?.k === "id" && resolue(t.v, i)) {
        const cle = `${t.v}.${T[i + 2].v}`;
        if (cx.constantes.has(cle)) surface("flux-constante", cle); else inclassable("flux", "", i, i + 2);
      } else if (t.v === "BLOC_TEXTE" && resolue(t.v, i) && !a.declarants.has(i)) surface("flux-constante", "BLOC_TEXTE");
    }
    if (fichier === "subagent-only/pi-adapt.ts") for (const k of cx.constantes.keys()) surface("flux-constante", k);
  }
  void js;
}

// ── Python (declared keys only) ────────────────────────────────────────────────────────────────

export function litterauxPython(src: string): Set<string> {
  const res = new Set<string>();
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "#") { const f = src.indexOf("\n", i); i = f < 0 ? src.length : f; continue; }
    const m = /^([rRbBuUfF]{0,2})("""|'''|"|')/.exec(src.slice(i, i + 5));
    if (m && (i === 0 || !/[\w]/.test(src[i - 1]) || m[1] !== "")) {
      const q = m[2], deb = i + m[0].length;
      let j = deb;
      while (j < src.length && !src.startsWith(q, j)) { if (src[j] === "\\") j++; if (q.length === 1 && src[j] === "\n") throw new Illisible("chaîne Python non terminée"); j++; }
      if (j >= src.length) throw new Illisible("chaîne Python non terminée");
      if (q.length === 1 && !/[fF]/.test(m[1])) res.add(src.slice(deb, j));
      i = j + q.length; continue;
    }
    i++;
  }
  return res;
}

// ── Files ──────────────────────────────────────────────────────────────────────────────────────

export function fichiersSous(racine: string, dossier: string, re: RegExp): string[] {
  const res: string[] = [];
  const parcourir = (d: string) => {
    if (!existsSync(d)) return;
    for (const nom of readdirSync(d).sort()) {
      const p = join(d, nom);
      const st = statSync(p);
      if (st.isDirectory()) { if (nom !== "node_modules" && nom !== ".git") parcourir(p); }
      else if (re.test(nom)) res.push(relative(racine, p).split("\\").join("/"));
    }
  };
  parcourir(join(racine, dossier));
  return res.sort();
}

/** The one piece of macOS metadata the tooling scan admits (D2): its exact path. */
export const METADONNEE_FINDER = "tests/pi-contrats/.DS_Store";
function lstatOuNul(p: string): boolean {
  try { lstatSync(p); return true; } catch { return false; }
}
/** True only for `tests/pi-contrats/.DS_Store` itself, as a regular file (no link, no directory). */
export function metadonneeFinder(racine: string, f: string): boolean {
  return f === METADONNEE_FINDER && lstatSync(join(racine, f)).isFile();
}

export const FICHIERS_DRAPEAU = ["subagent-only/spawn-args.ts", "subagent-only/pi-adapt.ts"];
export const FICHIERS_FLUX = ["subagent-only/dispatch.ts", "subagent-only/test-command.ts", "subagent-only/pi-adapt.ts"];
export const FICHIERS_PYTHON = ["bin/run-cost", "bin/subagent-trace", "bin/subagent-shadow"];

export function fichiersTs(racine: string): string[] {
  return [
    ...fichiersSous(racine, "extensions", /\.ts$/),
    ...fichiersSous(racine, "subagent-only", /\.ts$/),
    ...fichiersSous(racine, "tests/pi-contrats", /\.(ts|mjs)$/),
  ];
}

const cacheAnalyses = new Map<string, Analyse>();
const cacheReconnus = new Map<string, Reconnu>();
/** Analyses are pure functions of a file's path and bytes: memoized for the many scans of the proofs. */
export function analyseMemo(fichier: string, src: string): Analyse {
  const cle = `${fichier}\0${sha256(src)}`;
  let a = cacheAnalyses.get(cle);
  if (!a) { a = analyser(fichier, src); cacheAnalyses.set(cle, a); }
  return a;
}

export function reconnaitre(racine: string, registre: Registre): Reconnu {
  const out: Reconnu = { surfaces: [], inclassables: [], recepteurs: [], ctx: [], sources: [], constantes: new Map(), illisibles: [] };
  let constantes = new Map<string, string>();
  try { constantes = constantesFlux(analyseMemo("subagent-only/pi-adapt.ts", readFileSync(join(racine, "subagent-only/pi-adapt.ts"), "utf8"))); }
  catch (e) { out.illisibles.push({ fichier: "subagent-only/pi-adapt.ts", raison: `constantes du flux : ${(e as Error).message}` }); }
  out.constantes = constantes;
  const internes = new Set((registre.ctxInternes ?? []).map((c) => `${c.fichier}|${c.liaison}`));
  const signatureConstantes = JSON.stringify([...constantes]);
  for (const fichier of fichiersTs(racine)) {
    const src = readFileSync(join(racine, fichier), "utf8");
    const internesFichier = [...internes].filter((k) => k.startsWith(`${fichier}|`)).sort();
    const cle = `${fichier}\0${sha256(src)}\0${internesFichier.join("\n")}\0${signatureConstantes}`;
    let part = cacheReconnus.get(cle);
    if (!part) {
      part = { surfaces: [], inclassables: [], recepteurs: [], ctx: [], sources: [], constantes, illisibles: [] };
      try {
        reconnaitreFichier({ fichier, a: analyseMemo(fichier, src), out: part, constantes, recepteursDeclares: [], ctxInternes: internes, flux: FICHIERS_FLUX.includes(fichier), drapeau: FICHIERS_DRAPEAU.includes(fichier), testOnly: fichier.startsWith("tests/pi-contrats/") });
      } catch (e) {
        part = { surfaces: [], inclassables: [], recepteurs: [], ctx: [], sources: [], constantes, illisibles: [{ fichier, raison: (e as Error).message }] };
      }
      cacheReconnus.set(cle, part);
    }
    out.surfaces.push(...part.surfaces); out.inclassables.push(...part.inclassables); out.recepteurs.push(...part.recepteurs);
    out.ctx.push(...part.ctx); out.sources.push(...part.sources); out.illisibles.push(...part.illisibles);
  }
  return out;
}

export interface Registre {
  surfaces?: { type: string; nom: string; statut: string; contrats?: string[]; raison?: string; testOnly?: boolean; fichiers: string[]; valeur?: string }[];
  recepteurs?: Recepteur[];
  exclusions?: { fichier: string; type: string; liaison: string; forme: string; ancrage: string; compte: number; raison: string; testOnly: boolean; ligne?: number; contrats?: string[]; liste?: { constante?: string; valeurs: string[] } }[];
  ctxInternes?: { fichier: string; liaison: string; compte: number; raison: string }[];
  sourcesEmbarquees?: { fichier: string; ancrage: string; compte: number; sha256: string; raison: string; testOnly: boolean; ligne?: number }[];
  python?: { fichier: string; cles: { cle: string; statut: string; contrats?: string[]; raison?: string }[] }[];
  outillage?: { fichier: string; role: string; analyse: string }[];
  limites?: { id: string; texte: string; sites?: { fichier: string; ancrage: string }[] }[];
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// Comparison with the registry — the six failure families of MATRICES § D, plus an invalid registry.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export const STATUTS = new Set(["sous-contrat", "dans-la-couche", "hors-couche"]);
export const TYPES_SURFACE = new Set(["import", "methode", "destructuration", "evenement", "ctx", "drapeau", "flux", "flux-constante", "chargement"]);
/** Contract clause identifiers produced by the verdicts of tests/pi-contrats (scenarios.ts, harnais.ts). */
export function contratsExistants(racine: string): Set<string> {
  const res = new Set<string>();
  for (const f of ["tests/pi-contrats/scenarios.ts", "tests/pi-contrats/harnais.ts"]) {
    const p = join(racine, f);
    if (!existsSync(p)) continue;
    for (const t of analyseMemo(f, readFileSync(p, "utf8")).T) {
      if (t.k !== "str") continue;
      const m = /^C([1-8])\.(\d+)(?:-C([1-8])\.(\d+))?(?:\/[\w-]+|\s.*)?$/.exec(t.v);
      if (!m) continue;
      if (m[3] === undefined) { res.add(`C${m[1]}.${m[2]}`); continue; }
      if (m[3] !== m[1]) continue;
      for (let k = Number(m[2]); k <= Number(m[4]); k++) res.add(`C${m[1]}.${k}`);
    }
  }
  return res;
}

/** Literal string array bound to a module-level `const NAME = [ … ]`, or inline before `.map` on a line. */
function listeLitterale(a: Analyse, constante: string | undefined, ligne: number): string[] | null {
  const { T, paire } = a;
  let o = -1;
  if (constante) {
    for (let i = 0; i < T.length; i++) if (T[i].v === "const" && T[i + 1]?.v === constante && T[i + 2]?.v === "=" && T[i + 3]?.v === "[" && a.liaisonDe(constante, i + 1)?.portee === a.portees[0]) { o = i + 3; break; }
  } else {
    for (let i = 0; i < T.length; i++) if (T[i].l === ligne && T[i].v === "[" && T[paire[i] + 1]?.v === "." && T[paire[i] + 2]?.v === "map") { o = i; break; }
  }
  if (o < 0) return null;
  const vals: string[] = [];
  for (let k = o + 1; k < paire[o]; k++) {
    if (T[k].k === "str") { vals.push(T[k].v); continue; }
    if (T[k].v === ",") continue;
    return null;
  }
  return vals;
}

export function validerRegistre(reg: Registre): string[] {
  const res: string[] = [];
  const vus = new Set<string>();
  for (const s of reg.surfaces ?? []) {
    const id = `${s.type} ${s.nom}`;
    if (!TYPES_SURFACE.has(s.type)) res.push(`registre invalide · type inconnu · ${id}`);
    if (!STATUTS.has(s.statut)) res.push(`registre invalide · statut inconnu · ${id}`);
    if (s.statut === "sous-contrat" && !(s.contrats && s.contrats.length)) res.push(`registre invalide · sous contrat sans contrat · ${id}`);
    if (s.statut === "hors-couche" && !s.raison) res.push(`registre invalide · hors couche sans raison · ${id}`);
    if (typeof s.testOnly !== "boolean") res.push(`registre invalide · marquage test-only absent · ${id}`);
    if (!Array.isArray(s.fichiers) || s.fichiers.length === 0) res.push(`registre invalide · aucun fichier · ${id}`);
    if (vus.has(id)) res.push(`registre invalide · entrée en double · ${id}`);
    vus.add(id);
  }
  for (const e of reg.exclusions ?? []) {
    if (!e.raison || typeof e.testOnly !== "boolean" || !Number.isInteger(e.compte) || e.compte < 1 || !e.ancrage || !e.forme) res.push(`registre invalide · exclusion incomplète · ${e.fichier} · ${e.forme}`);
    if (e.type === "chargement" && !e.fichier.startsWith("tests/pi-contrats/")) res.push(`registre invalide · aucune admission de chargement hors de tests/pi-contrats · ${e.fichier}`);
  }
  for (const s of reg.sourcesEmbarquees ?? []) {
    if (!s.raison || typeof s.testOnly !== "boolean" || !Number.isInteger(s.compte) || s.compte < 1 || !/^[0-9a-f]{64}$/.test(s.sha256)) res.push(`registre invalide · source embarquée incomplète · ${s.fichier}`);
  }
  for (const c of reg.ctxInternes ?? []) if (!c.raison || !Number.isInteger(c.compte) || c.compte < 1) res.push(`registre invalide · ctx interne incomplet · ${c.fichier} · ${c.liaison}`);
  return res;
}

export function anomalies(racine: string, reg: Registre): string[] {
  const res: string[] = [...validerRegistre(reg)];
  const r = reconnaitre(racine, reg);
  // 6 — empty scanned lists.
  if (fichiersTs(racine).length === 0) res.push("balayage vide · extensions/**/*.ts, subagent-only/**/*.ts, tests/pi-contrats/**/*.{ts,mjs}");
  if (!FICHIERS_DRAPEAU.some((f) => existsSync(join(racine, f)))) res.push("balayage vide · drapeau");
  if (!FICHIERS_FLUX.some((f) => existsSync(join(racine, f)))) res.push("balayage vide · flux");
  if (!FICHIERS_PYTHON.some((f) => existsSync(join(racine, f)))) res.push("balayage vide · python");
  for (const x of r.illisibles) res.push(`inclassable · ${x.fichier} · fichier illisible · ${x.raison}`);

  // 1, 2 — surfaces and their files.
  const reconnues = new Map<string, Set<string>>();
  for (const s of r.surfaces) { const k = `${s.type} ${s.nom}`; if (!reconnues.has(k)) reconnues.set(k, new Set()); reconnues.get(k)!.add(s.fichier); }
  const declarees = new Map<string, Set<string>>();
  for (const s of reg.surfaces ?? []) declarees.set(`${s.type} ${s.nom}`, new Set(s.fichiers ?? []));
  for (const [k, fs] of reconnues) {
    const d = declarees.get(k);
    for (const f of [...fs].sort()) if (!d || !d.has(f)) res.push(`surface non au registre · ${k} · ${f}`);
  }
  for (const [k, fs] of declarees) {
    const v = reconnues.get(k);
    for (const f of [...fs].sort()) if (!v || !v.has(f)) res.push(`entrée non reconnue · ${k} · ${f}`);
  }
  for (const s of reg.surfaces ?? []) if (s.type === "flux-constante" && s.valeur !== r.constantes.get(s.nom)) res.push(`entrée non reconnue · flux-constante ${s.nom} · valeur ${JSON.stringify(s.valeur)} ≠ ${JSON.stringify(r.constantes.get(s.nom))}`);

  // 3 — contracts.
  const oracle = contratsExistants(racine);
  const verifierContrats = (ids: string[] | undefined, quoi: string) => { for (const id of ids ?? []) if (!oracle.has(id)) res.push(`contrat inexistant · ${id} · ${quoi}`); };
  for (const s of reg.surfaces ?? []) verifierContrats(s.contrats, `${s.type} ${s.nom}`);
  for (const e of reg.exclusions ?? []) verifierContrats(e.contrats, `exclusion ${e.fichier} ${e.forme}`);
  for (const p of reg.python ?? []) for (const c of p.cles) verifierContrats(c.contrats, `clé python ${c.cle} ${p.fichier}`);

  // 4 — receivers and aliases.
  const cleR = (x: Recepteur) => `${x.fichier} · ${x.regle} ${x.nom} · ${x.liaison}${x.source ? ` ← ${x.source}` : ""}${x.prefixe ? ` (${x.prefixe})` : ""}`;
  const rDecl = new Set((reg.recepteurs ?? []).map(cleR));
  const rVus = new Set(r.recepteurs.map(cleR));
  for (const k of [...rVus].sort()) if (!rDecl.has(k)) res.push(`alias non déclaré · ${k}`);
  for (const k of [...rDecl].sort()) if (!rVus.has(k)) res.push(`entrée non reconnue · récepteur ${k}`);

  // 5 — unclassifiable sites against site exclusions.
  const cleS = (x: { fichier: string; type: string; liaison: string; forme: string; ancrage: string }) => `${x.fichier}\0${x.type}\0${x.liaison}\0${x.forme}\0${x.ancrage}`;
  const groupes = new Map<string, Site[]>();
  for (const s of r.inclassables) { const k = cleS(s); if (!groupes.has(k)) groupes.set(k, []); groupes.get(k)!.push(s); }
  const exclusions = new Map<string, NonNullable<Registre["exclusions"]>[number]>();
  for (const e of reg.exclusions ?? []) exclusions.set(cleS(e), e);
  for (const [k, sites] of groupes) {
    const e = exclusions.get(k);
    let motif = "";
    let admis = 0;
    if (e) {
      admis = e.compte;
      if (e.liste) {
        const a = analyseMemo(e.fichier, readFileSync(join(racine, e.fichier), "utf8"));
        const vals = listeLitterale(a, e.liste.constante, sites[0].ligne);
        if (!vals || JSON.stringify(vals) !== JSON.stringify(e.liste.valeurs)) { admis = 0; motif = ` (liste ${e.liste.constante ?? "littérale"} différente de l'exclusion)`; }
      }
    }
    for (const s of sites.slice(admis)) res.push(`inclassable · ${s.fichier}:${s.ligne} · ${s.type} · ${s.liaison} · ${s.forme}${motif}`);
    if (e && !motif && sites.length < e.compte) res.push(`entrée non reconnue · exclusion ${e.fichier} · ${e.forme} · compte ${e.compte}, ${sites.length} site(s)`);
  }
  for (const [k, e] of exclusions) if (!groupes.has(k)) res.push(`entrée non reconnue · exclusion ${e.fichier} · ${e.forme} · aucun site`);

  // Internal objects named ctx.
  for (const c of reg.ctxInternes ?? []) {
    const vus = r.ctx.filter((x) => x.fichier === c.fichier && x.liaison === c.liaison);
    if (vus.length === 0) { res.push(`entrée non reconnue · ctx interne ${c.fichier} · ${c.liaison} · aucune liaison`); continue; }
    if (vus.length > 1 || vus[0].ambigue) { res.push(`inclassable · ${c.fichier} · ctx interne ${c.liaison} · liaison ambiguë`); continue; }
    if (vus[0].refs > c.compte) res.push(`inclassable · ${c.fichier} · ctx interne ${c.liaison} · ${vus[0].refs} utilisations, ${c.compte} déclarées`);
    if (vus[0].refs < c.compte) res.push(`entrée non reconnue · ctx interne ${c.fichier} · ${c.liaison} · ${vus[0].refs} utilisations, ${c.compte} déclarées`);
  }

  // Embedded sources (Q6).
  const cleE = (x: { fichier: string; ancrage: string; sha256: string }) => `${x.fichier}\0${x.ancrage}\0${x.sha256}`;
  const gE = new Map<string, SiteSource[]>();
  for (const s of r.sources) { const k = cleE(s); if (!gE.has(k)) gE.set(k, []); gE.get(k)!.push(s); }
  const dE = new Map((reg.sourcesEmbarquees ?? []).map((s) => [cleE(s), s] as const));
  for (const [k, sites] of gE) {
    const d = dE.get(k);
    for (const s of sites.slice(d ? d.compte : 0)) res.push(`surface non au registre · source embarquée · ${s.fichier}:${s.ligne} · ${s.sha256}`);
    if (d && sites.length < d.compte) res.push(`entrée non reconnue · source embarquée ${d.fichier} · compte ${d.compte}, ${sites.length} site(s)`);
  }
  for (const [k, d] of dE) if (!gE.has(k)) res.push(`entrée non reconnue · source embarquée ${d.fichier} · ${d.sha256} · aucun site`);

  // Python: declared keys only, presence verified.
  for (const p of reg.python ?? []) {
    const chemin = join(racine, p.fichier);
    if (!existsSync(chemin)) { res.push(`entrée non reconnue · lecteur python ${p.fichier} · absent`); continue; }
    let lits: Set<string>;
    try { lits = litterauxPython(readFileSync(chemin, "utf8")); } catch (e) { res.push(`inclassable · ${p.fichier} · fichier illisible · ${(e as Error).message}`); continue; }
    for (const c of p.cles) if (!lits.has(c.cle)) res.push(`entrée non reconnue · clé python ${c.cle} · ${p.fichier}`);
  }

  // Test tooling of item 1 (Q7).
  // D-P3-PI-SURFACE-METADONNEES (phase 3, D2): Finder's `.DS_Store`, as a regular file directly in
  // tests/pi-contrats, is known macOS metadata, not an undeclared source. That exact name, type and
  // place only: `.DS_Store.ts`, any other untracked file, a `.DS_Store` of another type or elsewhere
  // in the surface are still reported. This is not a filter on untracked files in general.
  const reels = new Set([...fichiersSous(racine, "tests/pi-contrats", /./).filter((f) => !metadonneeFinder(racine, f)), ...(existsSync(join(racine, "bin/pi-contrats")) ? ["bin/pi-contrats"] : [])]);
  if (lstatOuNul(join(racine, METADONNEE_FINDER)) && !lstatSync(join(racine, METADONNEE_FINDER)).isFile()) {
    res.push(`surface non au registre · outillage test-only · ${METADONNEE_FINDER} (métadonnée d'un autre type)`);
  }
  const declares = new Set((reg.outillage ?? []).map((o) => o.fichier));
  for (const f of [...reels].sort()) if (!declares.has(f)) res.push(`surface non au registre · outillage test-only · ${f}`);
  for (const f of [...declares].sort()) if (!reels.has(f)) res.push(`entrée non reconnue · outillage test-only · ${f}`);

  // Declared limits keep naming sites that exist.
  for (const l of reg.limites ?? []) for (const s of l.sites ?? []) {
    const p = join(racine, s.fichier);
    if (!existsSync(p) || !readFileSync(p, "utf8").split("\n").some((x) => x.trim() === s.ancrage)) res.push(`entrée non reconnue · limite ${l.id} · ${s.fichier} · ${s.ancrage}`);
  }
  return res.sort();
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// Proofs. Every counter-test copies the relevant part of the repository into a temporary directory and
// places one fixture case in a path the scan really reads (MATRICES § D; § G, Q8):
//   - before: the intact copy gives zero anomaly;
//   - counter-test: with the registry's base declarations for the case, exactly the expected anomaly;
//   - control: with the exact declaration of the added surface or site, zero anomaly.
// The first assertion is always the property the case is about, so that each M3 mutant reds it.
// ════════════════════════════════════════════════════════════════════════════════════════════════

const RACINE = join(import.meta.dirname, "..");
const REGISTRE = "tests/pi-surface.json";
const FIXTURES = "tests/fixtures/pi-surface";
const COPIES = ["extensions", "subagent-only", "tests/pi-contrats", FIXTURES, "bin/run-cost", "bin/subagent-trace", "bin/subagent-shadow", "bin/pi-contrats", REGISTRE];
const NOUVEAU = "extensions/pi-surface-epreuve/index.ts";
const NOUVEAU_SO = "subagent-only/pi-surface-epreuve.ts";
const NOUVEAU_PC = "tests/pi-contrats/pi-surface-epreuve.ts";

type Preuve = (t: TestContext) => Promise<void> | void;
function couverture(id: string, titre: string, fn: Preuve): void {
  test(`L0 COUV ${id} — ${titre}`, { timeout: 120_000 }, fn);
}
function regressionCorrigee(id: string, titre: string, fn: Preuve): void {
  test(`L0 REG ${id} — ${titre}`, { timeout: 120_000 }, fn);
}
function propriete(vrai: boolean, message: string): void {
  assert.ok(vrai, `PROPRIÉTÉ — ${message}`);
}
function precondition(vrai: boolean, message: string): void {
  assert.ok(vrai, `PRÉCONDITION — ${message}`);
}

const jetables: string[] = [];
test.after(() => { for (const d of jetables) rmSync(d, { recursive: true, force: true }); });

function registreDe(racine: string): Registre {
  const p = join(racine, REGISTRE);
  precondition(existsSync(p), `registre absent : ${REGISTRE}`);
  return JSON.parse(readFileSync(p, "utf8")) as Registre;
}

/** A temporary copy of what the scan reads (no .git: the scan never asks git). */
function copie(): string {
  const d = mkdtempSync(join(tmpdir(), "pi-surface-"));
  jetables.push(d);
  for (const rel of COPIES) {
    const src = join(RACINE, rel);
    if (!existsSync(src)) continue;
    mkdirSync(dirname(join(d, rel)), { recursive: true });
    cpSync(src, join(d, rel), { recursive: true, preserveTimestamps: true });
  }
  return d;
}

/** The text of one `// ── case: <name> ──` section of a fixture. */
function cas(fixture: string, nom: string): string {
  const texte = readFileSync(join(RACINE, FIXTURES, fixture), "utf8");
  const marque = /^\/\/ ── case: ([a-z0-9-]+) ──$/gm;
  const debuts: { nom: string; fin: number; debut: number }[] = [];
  for (let m; (m = marque.exec(texte));) debuts.push({ nom: m[1], debut: m.index, fin: m.index + m[0].length + 1 });
  const i = debuts.findIndex((x) => x.nom === nom);
  precondition(i >= 0, `cas ${nom} absent de ${fixture}`);
  return texte.slice(debuts[i].fin, i + 1 < debuts.length ? debuts[i + 1].debut : texte.length).trimEnd() + "\n";
}

function placer(racine: string, dest: string, texte: string, mode: "nouveau" | "ajout" | "remplace"): void {
  const p = join(racine, dest);
  if (mode === "nouveau") { precondition(!existsSync(p), `${dest} existe déjà dans la copie`); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, texte); }
  else if (mode === "ajout") { precondition(existsSync(p), `${dest} absent de la copie`); writeFileSync(p, readFileSync(p, "utf8") + "\n" + texte); }
  else { precondition(existsSync(p), `${dest} absent de la copie`); writeFileSync(p, texte); }
}

/** Line of the first occurrence of `extrait` in a placed file. */
function ligneDe(racine: string, dest: string, extrait: string): number {
  const i = readFileSync(join(racine, dest), "utf8").split("\n").findIndex((l) => l.includes(extrait));
  precondition(i >= 0, `${extrait} absent de ${dest}`);
  return i + 1;
}
function ancrageDe(racine: string, dest: string, extrait: string): string {
  return readFileSync(join(racine, dest), "utf8").split("\n")[ligneDe(racine, dest, extrait) - 1].trim();
}

type Ajout = Partial<{ [K in keyof Registre]: NonNullable<Registre[K]> }>;
/** The registry with declarations added; a surface already present only gains files. */
function etendre(reg: Registre, ...ajouts: Ajout[]): Registre {
  const r = JSON.parse(JSON.stringify(reg)) as Registre;
  for (const a of ajouts) {
    for (const s of a.surfaces ?? []) {
      const e = (r.surfaces ??= []).find((x) => x.type === s.type && x.nom === s.nom);
      if (e) e.fichiers = [...new Set([...e.fichiers, ...s.fichiers])].sort(); else r.surfaces.push(JSON.parse(JSON.stringify(s)));
    }
    for (const k of ["recepteurs", "exclusions", "ctxInternes", "sourcesEmbarquees", "python", "outillage", "limites"] as const) {
      if (a[k]) (r[k] as unknown[]) = [...((r[k] as unknown[]) ?? []), ...JSON.parse(JSON.stringify(a[k]))];
    }
  }
  return r;
}
const surf = (type: string, nom: string, fichier: string) => ({ type, nom, statut: "hors-couche", raison: "épreuve", testOnly: false, fichiers: [fichier] });
const recept = (fichier: string, regle: string, nom: string, liaison: string, source?: string, prefixe?: string): Recepteur =>
  ({ fichier, regle, nom, liaison, ...(source ? { source } : {}), ...(prefixe ? { prefixe } : {}) });
const recepteurDefaut = (fichier = NOUVEAU, nom = "api") => recept(fichier, "export-default", nom, `param:default#0:${nom}`);
const outil = (fichier: string) => ({ fichier, role: "épreuve", analyse: "balaye" });

interface Epreuve {
  fixture: string; cas: string; dest: string; mode?: "nouveau" | "ajout" | "remplace";
  base?: (racine: string) => Ajout; attendu: (racine: string) => string[]; controle: (racine: string) => Ajout;
  texte?: (t: string) => string;
}
/** Runs one case: the counter-test first (the property), then control and intact copy. */
function eprouver(e: Epreuve, propos: string): void {
  const reg = registreDe(RACINE);
  const d = copie();
  const intacte = anomalies(d, reg);
  const brut = cas(e.fixture, e.cas);
  placer(d, e.dest, e.texte ? e.texte(brut) : brut, e.mode ?? "nouveau");
  const base = etendre(reg, e.base ? e.base(d) : {});
  const sans = (x: string[]) => x.filter((a) => !intacte.includes(a));
  const contre = sans(anomalies(d, base));
  const attendu = e.attendu(d).sort();
  propriete(JSON.stringify(contre) === JSON.stringify(attendu), `${propos} — contre-épreuve : ${JSON.stringify(contre)} au lieu de ${JSON.stringify(attendu)}`);
  const controle = sans(anomalies(d, etendre(base, e.controle(d))));
  propriete(controle.length === 0, `${propos} — contrôle non conforme : ${JSON.stringify(controle)}`);
  propriete(intacte.length === 0, `copie intacte non conforme : ${JSON.stringify(intacte.slice(0, 5))}`);
}


// ── The registry describes the repository ─────────────────────────────────────────────────────

couverture("PI-SURF-REGISTRE", "le registre décrit exactement les surfaces du dépôt balayé", () => {
  const a = anomalies(RACINE, registreDe(RACINE));
  propriete(a.length === 0, `${a.length} anomalie(s) : ${JSON.stringify(a.slice(0, 12))}`);
});

// ── Helpers for expected anomalies ──────────────────────────────────────────────────────────────

const SDK = "@earendil-works/pi-coding-agent";
const NR = (type: string, nom: string, f: string) => `surface non au registre · ${type} ${nom} · ${f}`;
const INC = (f: string, l: number, type: string, liaison: string, forme: string) => `inclassable · ${f}:${l} · ${type} · ${liaison} · ${forme}`;
const ALIAS = (r: Recepteur) => `alias non déclaré · ${r.fichier} · ${r.regle} ${r.nom} · ${r.liaison}${r.source ? ` ← ${r.source}` : ""}${r.prefixe ? ` (${r.prefixe})` : ""}`;
const excl = (racine: string, f: string, type: string, liaison: string, forme: string, extrait: string, compte = 1) =>
  ({ fichier: f, type, liaison, forme, ancrage: ancrageDe(racine, f, extrait), compte, raison: "épreuve", testOnly: f.startsWith("tests/pi-contrats/") });
const ON = "param:default>api.on(\"turn_end\")#1#1:ctx";
const baseOn = (evenement: string) => ({ recepteurs: [recepteurDefaut()], surfaces: [surf("methode", "on", NOUVEAU), surf("evenement", evenement, NOUVEAU)] });
/** SHA-256 of the complete literal holding `export default`, delimiters included, as the source has it. */
function shaSource(racine: string, f: string): string {
  const src = readFileSync(join(racine, f), "utf8");
  const T = lexer(javascriptDe(f, src));
  for (let i = 0; i < T.length; i++) {
    if ((T[i].k === "str" || T[i].k === "tpl") && src.slice(T[i].s, T[i].e).includes("export default")) return sha256(Buffer.from(src.slice(T[i].s, T[i].e), "utf8"));
    if (T[i].k === "tplH") { let k = i; while (T[k].k !== "tplT") k++; return sha256(Buffer.from(src.slice(T[i].s, T[k].e), "utf8")); }
  }
  throw new Error(`aucune source embarquée dans ${f}`);
}

// ── Import, namespaces, dynamic loads (§ D Import; Q2, Q5) ────────────────────────────────────

couverture("PI-SURF-IMPORT", "un import SDK non déclaré, copié dans une extension, est signalé", () => eprouver({
  fixture: "import.ts.txt", cas: "import-nomme", dest: NOUVEAU,
  attendu: () => [NR("import", `${SDK}:getSessionStats`, NOUVEAU)],
  controle: () => ({ surfaces: [surf("import", `${SDK}:getSessionStats`, NOUVEAU)] }),
}, "import"));

couverture("PI-SURF-ESPACE", "un membre lu sur un espace de noms importé, à travers parenthèses et casts, est un import du membre", () => eprouver({
  fixture: "import.ts.txt", cas: "espace", dest: NOUVEAU,
  base: () => ({ surfaces: [surf("import", "@earendil-works/pi-tui:*", NOUVEAU)] }),
  attendu: () => [NR("import", "@earendil-works/pi-tui:autreFonction", NOUVEAU)],
  controle: () => ({ surfaces: [surf("import", "@earendil-works/pi-tui:autreFonction", NOUVEAU)] }),
}, "espace de noms"));

couverture("PI-SURF-CHARGEMENT", "un chargement dynamique d'un chemin SDK littéral dans l'outillage est une surface test-only", () => eprouver({
  fixture: "import.ts.txt", cas: "chargement", dest: NOUVEAU_PC,
  base: () => ({ outillage: [outil(NOUVEAU_PC)] }),
  attendu: () => [NR("chargement", "@earendil-works/pi-ai/dist/epreuve.js", NOUVEAU_PC)],
  controle: () => ({ surfaces: [surf("chargement", "@earendil-works/pi-ai/dist/epreuve.js", NOUVEAU_PC)] }),
}, "chargement dynamique"));

couverture("PI-SURF-CHARGEMENT-VARIABLE", "un chargement dynamique sans littéral est inclassable jusqu'à son exclusion exacte", () => eprouver({
  fixture: "import.ts.txt", cas: "chargement-variable", dest: NOUVEAU_PC,
  base: () => ({ outillage: [outil(NOUVEAU_PC)] }),
  attendu: (d) => [INC(NOUVEAU_PC, ligneDe(d, NOUVEAU_PC, "import(cible)"), "chargement", "", "import(cible)")],
  controle: (d) => ({ exclusions: [excl(d, NOUVEAU_PC, "chargement", "", "import(cible)", "import(cible)")] }),
}, "chargement non résolu"));

couverture("PI-SURF-CHARGEMENT-REQUIRE", "l'appel d'un nom lié à createRequire, alias local compris, est un chargement dynamique", () => eprouver({
  fixture: "import.ts.txt", cas: "chargement-require", dest: NOUVEAU_PC,
  base: () => ({ outillage: [outil(NOUVEAU_PC)] }),
  attendu: (d) => [INC(NOUVEAU_PC, ligneDe(d, NOUVEAU_PC, "charge(cible)"), "chargement", "", "charge(cible)")],
  controle: (d) => ({ exclusions: [excl(d, NOUVEAU_PC, "chargement", "", "charge(cible)", "charge(cible)")] }),
}, "createRequire"));

couverture("PI-SURF-CHARGEMENT-PRODUCTION", "un chargement dynamique du SDK hors de l'outillage est inclassable et ne s'admet pas", () => {
  const reg = registreDe(RACINE);
  const d = copie();
  placer(d, NOUVEAU, cas("import.ts.txt", "chargement-production"), "nouveau");
  const forme = 'import("@earendil-works/pi-ai")';
  const contre = anomalies(d, reg);
  propriete(JSON.stringify(contre) === JSON.stringify([INC(NOUVEAU, ligneDe(d, NOUVEAU, forme), "chargement", "", forme)]), `contre-épreuve : ${JSON.stringify(contre)}`);
  const admis = anomalies(d, etendre(reg, { exclusions: [excl(d, NOUVEAU, "chargement", "", forme, forme)] }));
  propriete(admis.includes(`registre invalide · aucune admission de chargement hors de tests/pi-contrats · ${NOUVEAU}`), `admission de production non refusée : ${JSON.stringify(admis)}`);
});

// ── Embedded sources (Q6) and lexical failures (Q8) ─────────────────────────────────────────────

couverture("PI-SURF-SOURCE", "une chaîne portant export default dans l'outillage est un site déclaré par son empreinte", () => eprouver({
  fixture: "import.ts.txt", cas: "source", dest: NOUVEAU_PC,
  base: () => ({ outillage: [outil(NOUVEAU_PC)] }),
  attendu: (d) => [`surface non au registre · source embarquée · ${NOUVEAU_PC}:${ligneDe(d, NOUVEAU_PC, "SOURCE_EPREUVE")} · ${shaSource(d, NOUVEAU_PC)}`],
  controle: (d) => ({ sourcesEmbarquees: [{ fichier: NOUVEAU_PC, ancrage: ancrageDe(d, NOUVEAU_PC, "SOURCE_EPREUVE"), compte: 1, sha256: shaSource(d, NOUVEAU_PC), raison: "épreuve", testOnly: true }] }),
}, "source embarquée"));

couverture("PI-SURF-SOURCE-ALTEREE", "un texte embarqué changé n'est pas admis par le seul maintien de l'ancrage et du compte", () => {
  const reg = etendre(registreDe(RACINE), { outillage: [outil(NOUVEAU_PC)] });
  const avant = copie();
  placer(avant, NOUVEAU_PC, cas("import.ts.txt", "source"), "nouveau");
  const declaree = { fichier: NOUVEAU_PC, ancrage: ancrageDe(avant, NOUVEAU_PC, "SOURCE_EPREUVE"), compte: 1, sha256: shaSource(avant, NOUVEAU_PC), raison: "épreuve", testOnly: true };
  const d = copie();
  placer(d, NOUVEAU_PC, cas("import.ts.txt", "source-alteree"), "nouveau");
  precondition(ancrageDe(d, NOUVEAU_PC, "SOURCE_EPREUVE") === declaree.ancrage, "l'altération doit garder la ligne d'ancrage");
  const contre = anomalies(d, etendre(reg, { sourcesEmbarquees: [declaree] }));
  const attendu = [
    `entrée non reconnue · source embarquée ${NOUVEAU_PC} · ${declaree.sha256} · aucun site`,
    `surface non au registre · source embarquée · ${NOUVEAU_PC}:${ligneDe(d, NOUVEAU_PC, "SOURCE_EPREUVE")} · ${shaSource(d, NOUVEAU_PC)}`,
  ].sort();
  propriete(JSON.stringify(contre) === JSON.stringify(attendu), `contre-épreuve : ${JSON.stringify(contre)}`);
  const controle = anomalies(d, etendre(reg, { sourcesEmbarquees: [{ ...declaree, sha256: shaSource(d, NOUVEAU_PC) }] }));
  propriete(controle.length === 0, `contrôle : ${JSON.stringify(controle)}`);
});

couverture("PI-SURF-GABARIT", "les interpolations d'un gabarit embarqué restent balayées", () => eprouver({
  fixture: "import.ts.txt", cas: "gabarit", dest: NOUVEAU_PC,
  base: (d) => ({ outillage: [outil(NOUVEAU_PC)], recepteurs: [recepteurDefaut(NOUVEAU_PC)],
    sourcesEmbarquees: [{ fichier: NOUVEAU_PC, ancrage: ancrageDe(d, NOUVEAU_PC, "export default ${"), compte: 1, sha256: shaSource(d, NOUVEAU_PC), raison: "épreuve", testOnly: true }] }),
  attendu: () => [NR("methode", "methodeGabarit", NOUVEAU_PC)],
  controle: () => ({ surfaces: [surf("methode", "methodeGabarit", NOUVEAU_PC)] }),
}, "interpolation"));

couverture("PI-SURF-ILLISIBLE", "un fichier que le reconnaisseur ne sait pas lire est inclassable, sans succès silencieux", () => {
  const reg = registreDe(RACINE);
  const d = copie();
  const complet = cas("import.ts.txt", "tronque");
  placer(d, NOUVEAU, complet.slice(0, complet.lastIndexOf('"')) + "\n", "nouveau");
  const contre = anomalies(d, reg);
  propriete(contre.length === 1 && contre[0].startsWith(`inclassable · ${NOUVEAU} · fichier illisible · `), `contre-épreuve : ${JSON.stringify(contre)}`);
  placer(d, NOUVEAU, complet, "remplace");
  const controle = anomalies(d, reg);
  propriete(controle.length === 0, `contrôle : ${JSON.stringify(controle)}`);
});

// ── Receiver and methods (§ D; Q4) ──────────────────────────────────────────────────────────────

couverture("PI-SURF-RECEPTEUR", "le paramètre de l'export par défaut est un récepteur à déclarer", () => eprouver({
  fixture: "methode.ts.txt", cas: "recepteur", dest: NOUVEAU,
  base: () => ({ surfaces: [surf("methode", "registerTool", NOUVEAU)] }),
  attendu: () => [ALIAS(recepteurDefaut())],
  controle: () => ({ recepteurs: [recepteurDefaut()] }),
}, "récepteur"));

const methode = (c: string, membre: string): Epreuve => ({
  fixture: "methode.ts.txt", cas: c, dest: NOUVEAU,
  base: () => ({ recepteurs: [recepteurDefaut()] }),
  attendu: () => [NR("methode", membre, NOUVEAU)],
  controle: () => ({ surfaces: [surf("methode", membre, NOUVEAU)] }),
});
couverture("PI-SURF-METHODE", "une méthode non déclarée appelée sur le récepteur est signalée", () => eprouver(methode("methode", "methodeNonDeclaree"), "méthode"));
couverture("PI-SURF-METHODE-LECTURE", "une lecture de membre du récepteur sans appel est la même surface méthode", () => eprouver(methode("lecture", "membreLu"), "lecture sans appel"));
couverture("PI-SURF-METHODE-OPTIONNELLE", "les formes optionnelles du récepteur sont reconnues", () => eprouver(methode("optionnel", "membreOptionnel"), "forme optionnelle"));

// ── Events (§ D) ────────────────────────────────────────────────────────────────────────────────

couverture("PI-SURF-EVENEMENT", "un événement non déclaré passé à on est signalé", () => eprouver({
  fixture: "evenement.ts.txt", cas: "evenement", dest: NOUVEAU,
  base: () => ({ recepteurs: [recepteurDefaut()], surfaces: [surf("methode", "on", NOUVEAU)] }),
  attendu: () => [NR("evenement", "evenement_inconnu", NOUVEAU)],
  controle: () => ({ surfaces: [surf("evenement", "evenement_inconnu", NOUVEAU)] }),
}, "événement"));

couverture("PI-SURF-EVENEMENT-NON-LITTERAL", "un nom d'événement non littéral est inclassable", () => eprouver({
  fixture: "evenement.ts.txt", cas: "non-litteral", dest: NOUVEAU,
  base: () => ({ recepteurs: [recepteurDefaut()], surfaces: [surf("methode", "on", NOUVEAU)] }),
  attendu: (d) => [INC(NOUVEAU, ligneDe(d, NOUVEAU, "api.on(NOM_EVENEMENT"), "evenement", "param:default#0:api", "api.on(NOM_EVENEMENT, () => {})")],
  controle: (d) => ({ exclusions: [excl(d, NOUVEAU, "evenement", "param:default#0:api", "api.on(NOM_EVENEMENT, () => {})", "api.on(NOM_EVENEMENT")] }),
}, "événement non littéral"));

// ── ctx (§ D; Q4) ───────────────────────────────────────────────────────────────────────────────

const membreCtx = (c: string, prefixes: string[], membre: string): Epreuve => ({
  fixture: "ctx.ts.txt", cas: c, dest: NOUVEAU,
  base: () => { const b = baseOn("turn_end"); b.surfaces.push(...prefixes.map((m) => surf("ctx", m, NOUVEAU))); return b; },
  attendu: () => [NR("ctx", membre, NOUVEAU)],
  controle: () => ({ surfaces: [surf("ctx", membre, NOUVEAU)] }),
});
couverture("PI-SURF-CTX", "un membre de ctx non déclaré est signalé", () => eprouver(membreCtx("membre", [], "ctx.membreInconnu"), "membre de ctx"));
couverture("PI-SURF-CTX-PREFIXE", "chaque préfixe statique d'une lecture de ctx est une surface", () => eprouver(membreCtx("prefixe", ["ctx.ui"], "ctx.ui.membreUiInconnu"), "préfixe de ctx"));
couverture("PI-SURF-CTX-IN", "un littéral à gauche de in ctx vaut le membre nommé", () => eprouver(membreCtx("in-litteral", [], "ctx.membreSonde"), "littéral in ctx"));

couverture("PI-SURF-CTX-IN-VARIABLE", "une variable à gauche de in ctx est inclassable", () => eprouver({
  fixture: "ctx.ts.txt", cas: "in-variable", dest: NOUVEAU,
  base: () => baseOn("turn_end"),
  attendu: (d) => [INC(NOUVEAU, ligneDe(d, NOUVEAU, "NOM_MEMBRE in ctx"), "in-ctx", ON, "NOM_MEMBRE in ctx")],
  controle: (d) => ({ exclusions: [excl(d, NOUVEAU, "in-ctx", ON, "NOM_MEMBRE in ctx", "NOM_MEMBRE in ctx")] }),
}, "in variable"));

couverture("PI-SURF-CTX-INTERNE", "un objet interne nommé ctx n'est admis que par l'exclusion de sa liaison", () => eprouver({
  fixture: "ctx.ts.txt", cas: "interne", dest: NOUVEAU_SO,
  attendu: () => [NR("ctx", "ctx.a", NOUVEAU_SO)],
  controle: () => ({ ctxInternes: [{ fichier: NOUVEAU_SO, liaison: "param:epreuveInterne#0:ctx", compte: 2, raison: "épreuve" }] }),
}, "ctx interne"));

couverture("PI-SURF-CTX-INTERNE-COMPTE", "une exclusion de ctx interne à compte différent ou sans liaison échoue", () => {
  const reg = registreDe(RACINE);
  const d = copie();
  placer(d, NOUVEAU_SO, cas("ctx.ts.txt", "interne"), "nouveau");
  const avec = (compte: number, liaison = "param:epreuveInterne#0:ctx") => anomalies(d, etendre(reg, { ctxInternes: [{ fichier: NOUVEAU_SO, liaison, compte, raison: "épreuve" }] }));
  const trois = avec(3);
  propriete(JSON.stringify(trois) === JSON.stringify([`entrée non reconnue · ctx interne ${NOUVEAU_SO} · param:epreuveInterne#0:ctx · 2 utilisations, 3 déclarées`]), `compte supérieur : ${JSON.stringify(trois)}`);
  const un = avec(1);
  propriete(JSON.stringify(un) === JSON.stringify([`inclassable · ${NOUVEAU_SO} · ctx interne param:epreuveInterne#0:ctx · 2 utilisations, 1 déclarées`]), `compte inférieur : ${JSON.stringify(un)}`);
  const absente = anomalies(d, etendre(reg, { ctxInternes: [{ fichier: NOUVEAU_SO, liaison: "param:epreuveInterne#0:ctx", compte: 2, raison: "épreuve" }, { fichier: NOUVEAU_SO, liaison: "param:autre#0:ctx", compte: 1, raison: "épreuve" }] }));
  propriete(JSON.stringify(absente) === JSON.stringify([`entrée non reconnue · ctx interne ${NOUVEAU_SO} · param:autre#0:ctx · aucune liaison`]), `liaison absente : ${JSON.stringify(absente)}`);
  propriete(avec(2).length === 0, "contrôle : compte exact");
});

// ── Destructuring (§ D; Q4) ─────────────────────────────────────────────────────────────────────

couverture("PI-SURF-DESTRUCTURATION", "un membre obtenu par destructuration du récepteur est signalé", () => eprouver({
  fixture: "destructuration.ts.txt", cas: "recepteur", dest: NOUVEAU,
  base: () => ({ recepteurs: [recepteurDefaut()] }),
  attendu: () => [NR("destructuration", "membreDestructure", NOUVEAU)],
  controle: () => ({ surfaces: [surf("destructuration", "membreDestructure", NOUVEAU)] }),
}, "destructuration"));

couverture("PI-SURF-DESTRUCTURATION-CTX", "la destructuration de ctx vaut ses membres", () => eprouver({
  fixture: "destructuration.ts.txt", cas: "ctx", dest: NOUVEAU,
  base: () => baseOn("turn_end"),
  attendu: () => [NR("ctx", "ctx.membreCtx", NOUVEAU)],
  controle: () => ({ surfaces: [surf("ctx", "ctx.membreCtx", NOUVEAU)] }),
}, "destructuration de ctx"));

couverture("PI-SURF-DESTRUCTURATION-RESTE", "une destructuration non résolue du récepteur est inclassable", () => eprouver({
  fixture: "destructuration.ts.txt", cas: "reste", dest: NOUVEAU,
  base: () => ({ recepteurs: [recepteurDefaut()] }),
  attendu: (d) => [INC(NOUVEAU, ligneDe(d, NOUVEAU, "...tout"), "destructuration", "param:default#0:api", "{ ...tout } = api")],
  controle: (d) => ({ exclusions: [excl(d, NOUVEAU, "destructuration", "param:default#0:api", "{ ...tout } = api", "...tout")] }),
}, "destructuration non résolue"));

// ── Computed access and site exclusions (§ D; Q1) ───────────────────────────────────────────────

const calcule = (c: string, base: "recepteur" | "on" | "espace", liaison: string, forme: string): Epreuve => ({
  fixture: "acces-calcule.ts.txt", cas: c, dest: NOUVEAU,
  base: () => base === "recepteur" ? { recepteurs: [recepteurDefaut()] } : base === "on" ? baseOn("turn_end") : { surfaces: [surf("import", "@earendil-works/pi-tui:*", NOUVEAU)] },
  attendu: (d) => [INC(NOUVEAU, ligneDe(d, NOUVEAU, forme), "acces-calcule", liaison, forme)],
  controle: (d) => ({ exclusions: [excl(d, NOUVEAU, "acces-calcule", liaison, forme, forme)] }),
});
couverture("PI-SURF-ACCES-CALCULE", "un accès calculé au récepteur est inclassable, signalé", () => eprouver(calcule("recepteur", "recepteur", "param:default#0:api", "api[nom]"), "accès calculé"));
couverture("PI-SURF-ACCES-CALCULE-OPTIONNEL", "un accès calculé optionnel au récepteur est inclassable", () => eprouver(calcule("optionnel", "recepteur", "param:default#0:api", "api?.[nom]"), "accès calculé optionnel"));
couverture("PI-SURF-ACCES-CALCULE-CTX", "un accès calculé à ctx est inclassable", () => eprouver(calcule("ctx", "on", ON, "ctx[nom]"), "accès calculé à ctx"));
couverture("PI-SURF-ACCES-CALCULE-ESPACE", "un accès calculé à un espace de noms SDK est inclassable", () => eprouver(calcule("espace", "espace", "import:kit", "(kit as any)[n]"), "accès calculé à un espace de noms"));

const exclusionListe = (d: string, valeurs: string[], compte = 1) => ({ ...excl(d, NOUVEAU, "acces-calcule", "param:default#0:api", "api[k]", "LISTE_EPREUVE.map", compte), liste: { constante: "LISTE_EPREUVE", valeurs } });

couverture("PI-SURF-EXCLUSION", "une exclusion de site exacte, liste vérifiée, admet le seul site identifié", () => eprouver({
  fixture: "acces-calcule.ts.txt", cas: "exclu", dest: NOUVEAU,
  base: () => ({ recepteurs: [recepteurDefaut()] }),
  attendu: (d) => [INC(NOUVEAU, ligneDe(d, NOUVEAU, "api[k]"), "acces-calcule", "param:default#0:api", "api[k]")],
  controle: (d) => ({ exclusions: [exclusionListe(d, ["a", "b"])] }),
}, "exclusion de site"));

couverture("PI-SURF-EXCLUSION-COMPTE", "une occurrence de plus ou de moins que le compte de l'exclusion échoue", () => {
  const reg = etendre(registreDe(RACINE), { recepteurs: [recepteurDefaut()] });
  const d = copie();
  placer(d, NOUVEAU, cas("acces-calcule.ts.txt", "duplique"), "nouveau");
  const l = ligneDe(d, NOUVEAU, "api[k]");
  const duplique = anomalies(d, etendre(reg, { exclusions: [exclusionListe(d, ["a", "b"], 1)] }));
  propriete(JSON.stringify(duplique) === JSON.stringify([INC(NOUVEAU, l, "acces-calcule", "param:default#0:api", "api[k]")]), `site dupliqué : ${JSON.stringify(duplique)}`);
  const d2 = copie();
  placer(d2, NOUVEAU, cas("acces-calcule.ts.txt", "exclu"), "nouveau");
  const deux = anomalies(d2, etendre(reg, { exclusions: [exclusionListe(d2, ["a", "b"], 2)] }));
  propriete(JSON.stringify(deux) === JSON.stringify([`entrée non reconnue · exclusion ${NOUVEAU} · api[k] · compte 2, 1 site(s)`]), `compte supérieur : ${JSON.stringify(deux)}`);
  const absent = anomalies(d2, etendre(reg, { exclusions: [exclusionListe(d2, ["a", "b"]), { ...exclusionListe(d2, ["a", "b"]), ancrage: "siteAbsent(api[k]);" }] }));
  propriete(JSON.stringify(absent) === JSON.stringify([`entrée non reconnue · exclusion ${NOUVEAU} · api[k] · aucun site`]), `site absent : ${JSON.stringify(absent)}`);
  propriete(anomalies(d, etendre(reg, { exclusions: [exclusionListe(d, ["a", "b"], 2)] })).length === 0, "contrôle : compte exact");
});

couverture("PI-SURF-EXCLUSION-LISTE", "une exclusion dont la liste énumérée diffère du source n'admet pas le site", () => {
  const reg = etendre(registreDe(RACINE), { recepteurs: [recepteurDefaut()] });
  const d = copie();
  placer(d, NOUVEAU, cas("acces-calcule.ts.txt", "exclu"), "nouveau");
  const contre = anomalies(d, etendre(reg, { exclusions: [exclusionListe(d, ["a", "c"])] }));
  const attendu = [`${INC(NOUVEAU, ligneDe(d, NOUVEAU, "api[k]"), "acces-calcule", "param:default#0:api", "api[k]")} (liste LISTE_EPREUVE différente de l'exclusion)`];
  propriete(JSON.stringify(contre) === JSON.stringify(attendu), `contre-épreuve : ${JSON.stringify(contre)}`);
  propriete(anomalies(d, etendre(reg, { exclusions: [exclusionListe(d, ["a", "b"])] })).length === 0, "contrôle : liste exacte");
});

// ── Aliases and transmission (§ D; Q3) ──────────────────────────────────────────────────────────

couverture("PI-SURF-ALIAS-AFF", "R-AFF : l'affectation du récepteur à un nom est un alias à déclarer", () => eprouver({
  fixture: "alias.ts.txt", cas: "aff", dest: NOUVEAU,
  base: () => ({ recepteurs: [recepteurDefaut()], surfaces: [surf("methode", "registerTool", NOUVEAU)] }),
  attendu: () => [ALIAS(recept(NOUVEAU, "R-AFF", "API", "var:default:API", "param:default#0:api"))],
  controle: () => ({ recepteurs: [recept(NOUVEAU, "R-AFF", "API", "var:default:API", "param:default#0:api")] }),
}, "R-AFF"));

couverture("PI-SURF-ALIAS-PARAM", "R-PARAM : un paramètre annoté ExtensionAPI importé du SDK est un alias à déclarer", () => eprouver({
  fixture: "alias.ts.txt", cas: "param", dest: NOUVEAU,
  base: () => ({ recepteurs: [recepteurDefaut()], surfaces: [surf("import", `${SDK}:ExtensionAPI`, NOUVEAU), surf("methode", "exec", NOUVEAU)] }),
  attendu: () => [ALIAS(recept(NOUVEAU, "R-PARAM", "x", "param:aide#0:x"))],
  controle: () => ({ recepteurs: [recept(NOUVEAU, "R-PARAM", "x", "param:aide#0:x")] }),
}, "R-PARAM"));

const CTX_SS = "param:default>api.on(\"session_start\")#1#1:ctx";
couverture("PI-SURF-ALIAS-CTX", "R-CTX : l'affectation de ctx.ui à un nom est un alias qui garde son préfixe", () => eprouver({
  fixture: "alias.ts.txt", cas: "ctx", dest: NOUVEAU,
  base: () => ({ recepteurs: [recepteurDefaut()], surfaces: [surf("methode", "on", NOUVEAU), surf("evenement", "session_start", NOUVEAU), surf("ctx", "ctx.ui", NOUVEAU), surf("ctx", "ctx.ui.notify", NOUVEAU)] }),
  attendu: () => [ALIAS(recept(NOUVEAU, "R-CTX", "vue", "var:default>api.on(\"session_start\")#1:vue", CTX_SS, "ctx.ui"))],
  controle: () => ({ recepteurs: [recept(NOUVEAU, "R-CTX", "vue", "var:default>api.on(\"session_start\")#1:vue", CTX_SS, "ctx.ui")] }),
}, "R-CTX"));

couverture("PI-SURF-ALIAS-HOMONYME", "un nom homonyme d'un alias dans une autre portée n'hérite pas de sa liaison", () => {
  const reg = etendre(registreDe(RACINE), { recepteurs: [recepteurDefaut(), recept(NOUVEAU, "R-AFF", "API", "var:default:API", "param:default#0:api")], surfaces: [surf("methode", "registerTool", NOUVEAU)] });
  const d = copie();
  placer(d, NOUVEAU, cas("alias.ts.txt", "homonyme"), "nouveau");
  const masque = anomalies(d, reg);
  propriete(masque.length === 0, `homonyme masquant : ${JSON.stringify(masque)}`);
  placer(d, NOUVEAU, cas("alias.ts.txt", "homonyme-sans-masque"), "remplace");
  const sans = anomalies(d, reg);
  propriete(JSON.stringify(sans) === JSON.stringify([NR("methode", "autre", NOUVEAU)]), `contre-épreuve sans masque : ${JSON.stringify(sans)}`);
});

couverture("PI-SURF-TRANSMISSION", "la transmission du récepteur à un paramètre non annoté est inclassable", () => eprouver({
  fixture: "alias.ts.txt", cas: "transmission-non-annotee", dest: NOUVEAU,
  base: () => ({ recepteurs: [recepteurDefaut()] }),
  attendu: (d) => [INC(NOUVEAU, ligneDe(d, NOUVEAU, "aideLibre(api)"), "transmission", "param:default#0:api", "aideLibre(api)")],
  controle: (d) => ({ exclusions: [excl(d, NOUVEAU, "transmission", "param:default#0:api", "aideLibre(api)", "aideLibre(api)")] }),
}, "transmission non annotée"));

couverture("PI-SURF-TRANSMISSION-POSITION", "la transmission du récepteur à la mauvaise position est inclassable", () => eprouver({
  fixture: "alias.ts.txt", cas: "transmission-position", dest: NOUVEAU,
  base: () => ({ recepteurs: [recepteurDefaut(), recept(NOUVEAU, "R-PARAM", "x", "param:aideDeux#1:x")], surfaces: [surf("import", `${SDK}:ExtensionAPI`, NOUVEAU), surf("methode", "exec", NOUVEAU)] }),
  attendu: (d) => [INC(NOUVEAU, ligneDe(d, NOUVEAU, "aideDeux(api"), "transmission", "param:default#0:api", "aideDeux(api, 1 as any)")],
  controle: (d) => ({ exclusions: [excl(d, NOUVEAU, "transmission", "param:default#0:api", "aideDeux(api, 1 as any)", "aideDeux(api")] }),
}, "transmission à la mauvaise position"));

couverture("PI-SURF-STOCKAGE", "le récepteur stocké dans une propriété d'objet est inclassable", () => eprouver({
  fixture: "alias.ts.txt", cas: "stockage", dest: NOUVEAU,
  base: () => ({ recepteurs: [recepteurDefaut()] }),
  attendu: (d) => [INC(NOUVEAU, ligneDe(d, NOUVEAU, "{ api }"), "stockage", "param:default#0:api", "api")],
  controle: (d) => ({ exclusions: [excl(d, NOUVEAU, "stockage", "param:default#0:api", "api", "{ api }")] }),
}, "stockage"));

couverture("PI-SURF-VALEUR", "le récepteur rendu comme valeur est inclassable", () => eprouver({
  fixture: "alias.ts.txt", cas: "valeur", dest: NOUVEAU,
  base: () => ({ recepteurs: [recepteurDefaut()] }),
  attendu: (d) => [INC(NOUVEAU, ligneDe(d, NOUVEAU, "return api"), "residuel", "param:default#0:api", "api")],
  controle: (d) => ({ exclusions: [excl(d, NOUVEAU, "residuel", "param:default#0:api", "api", "return api")] }),
}, "valeur rendue"));

// ── Flags (§ D) ─────────────────────────────────────────────────────────────────────────────────

couverture("PI-SURF-DRAPEAU", "un drapeau CLI non déclaré ajouté à spawn-args.ts est signalé", () => eprouver({
  fixture: "drapeau.ts.txt", cas: "drapeau", dest: "subagent-only/spawn-args.ts", mode: "ajout",
  attendu: () => [NR("drapeau", "--drapeau-inconnu", "subagent-only/spawn-args.ts")],
  controle: () => ({ surfaces: [surf("drapeau", "--drapeau-inconnu", "subagent-only/spawn-args.ts")] }),
}, "drapeau"));

// ── Flux, direct and resolved forms (§ D; précision FLUX) ───────────────────────────────────────

const TC = "subagent-only/test-command.ts";
const fluxType = (c: string): Epreuve => ({
  fixture: "flux.ts.txt", cas: c, dest: TC, mode: "ajout",
  attendu: () => [NR("flux", "agent_start", TC)],
  controle: () => ({ surfaces: [surf("flux", "agent_start", TC)] }),
});
couverture("PI-SURF-FLUX", "un type d'événement du flux non déclaré comparé à .type est signalé", () => eprouver(fluxType("direct"), "flux direct"));
couverture("PI-SURF-FLUX-OPTIONNEL", "la forme ?.type du flux est reconnue", () => eprouver(fluxType("optionnel"), "flux optionnel"));
couverture("PI-SURF-FLUX-GAUCHE", "un littéral à gauche de la comparaison au type est reconnu", () => eprouver(fluxType("gauche"), "flux à gauche"));
couverture("PI-SURF-FLUX-LECTURE-RESOLUE", "la lecture [CHAMPS_FLUX.type] est résolue et reconnue", () => eprouver(fluxType("lecture-resolue"), "lecture résolue"));
couverture("PI-SURF-FLUX-LECTURE-RESOLUE-OPTIONNELLE", "la lecture ?.[CHAMPS_FLUX.type] est résolue et reconnue", () => eprouver(fluxType("lecture-resolue-optionnelle"), "lecture résolue optionnelle"));

couverture("PI-SURF-FLUX-VALEUR-RESOLUE", "une comparaison à FLUX.<clé> est résolue vers sa valeur déclarée dans pi-adapt.ts", () => eprouver({
  fixture: "flux.ts.txt", cas: "valeur-resolue", dest: TC, mode: "ajout",
  base: () => ({ surfaces: [surf("flux-constante", "FLUX.message", TC)] }),
  attendu: () => [NR("flux", "message", TC)],
  controle: () => ({ surfaces: [surf("flux", "message", TC)] }),
}, "valeur résolue"));

couverture("PI-SURF-FLUX-BLOC", "une comparaison à BLOC_TEXTE importé de pi-adapt.ts est résolue", () => eprouver({
  fixture: "flux.ts.txt", cas: "bloc", dest: TC, mode: "ajout",
  base: () => ({ surfaces: [surf("flux-constante", "BLOC_TEXTE", TC)] }),
  attendu: () => [NR("flux", "text", TC)],
  controle: () => ({ surfaces: [surf("flux", "text", TC)] }),
}, "BLOC_TEXTE"));

couverture("PI-SURF-FLUX-NON-RESOLU", "une constante du flux non déclarée est inclassable, jamais ignorée", () => eprouver({
  fixture: "flux.ts.txt", cas: "non-resolu", dest: TC, mode: "ajout",
  attendu: (d) => [INC(TC, ligneDe(d, TC, "FLUX.inexistant"), "flux", "", "FLUX.inexistant"), INC(TC, ligneDe(d, TC, "FLUX.inexistant"), "flux", "", "e.type === FLUX.inexistant")],
  controle: (d) => ({ exclusions: [excl(d, TC, "flux", "", "FLUX.inexistant", "FLUX.inexistant"), excl(d, TC, "flux", "", "e.type === FLUX.inexistant", "FLUX.inexistant")] }),
}, "flux non résolu"));

// ── Python (declared limit) ─────────────────────────────────────────────────────────────────────

couverture("PI-SURF-PYTHON", "une clé déclarée retirée d'un lecteur Python est signalée", () => {
  const reg = registreDe(RACINE);
  const d = copie();
  const fixture = readFileSync(join(RACINE, FIXTURES, "python-cle.py"), "utf8");
  placer(d, "bin/subagent-trace", fixture, "remplace");
  const contre = anomalies(d, reg);
  propriete(JSON.stringify(contre) === JSON.stringify(["entrée non reconnue · clé python command · bin/subagent-trace"]), `contre-épreuve : ${JSON.stringify(contre)}`);
  placer(d, "bin/subagent-trace", fixture + "\nprint({}.get(\"command\"))\n", "remplace");
  const controle = anomalies(d, reg);
  propriete(controle.length === 0, `contrôle : ${JSON.stringify(controle)}`);
});

// ── Scanned trees, test tooling, contracts, empty scan (§ D; Q7, Q8) ───────────────────────────

couverture("PI-SURF-MJS", "les modules .mjs de tests/pi-contrats sont balayés", () => eprouver({
  fixture: "import.ts.txt", cas: "import-nomme", dest: "tests/pi-contrats/pi-surface-epreuve.mjs",
  base: () => ({ outillage: [outil("tests/pi-contrats/pi-surface-epreuve.mjs")] }),
  attendu: () => [NR("import", `${SDK}:getSessionStats`, "tests/pi-contrats/pi-surface-epreuve.mjs")],
  controle: () => ({ surfaces: [surf("import", `${SDK}:getSessionStats`, "tests/pi-contrats/pi-surface-epreuve.mjs")] }),
}, "module .mjs"));

couverture("PI-SURF-OUTILLAGE", "un fichier d'outillage non nommé au registre est signalé", () => eprouver({
  fixture: "import.ts.txt", cas: "import-nomme", dest: NOUVEAU_PC,
  base: () => ({ surfaces: [surf("import", `${SDK}:getSessionStats`, NOUVEAU_PC)] }),
  attendu: () => [`surface non au registre · outillage test-only · ${NOUVEAU_PC}`],
  controle: () => ({ outillage: [outil(NOUVEAU_PC)] }),
}, "outillage"));

couverture("PI-SURF-CONTRAT", "une entrée sous contrat qui nomme un contrat inexistant échoue", () => {
  const reg = registreDe(RACINE);
  const altere = JSON.parse(JSON.stringify(reg)) as Registre;
  const cible = altere.surfaces!.find((s) => s.type === "methode" && s.nom === "setSessionName")!;
  precondition(!!cible, "entrée setSessionName absente du registre");
  cible.contrats = ["C9.9"];
  const contre = anomalies(RACINE, altere);
  propriete(JSON.stringify(contre) === JSON.stringify(["contrat inexistant · C9.9 · methode setSessionName"]), `contre-épreuve : ${JSON.stringify(contre)}`);
  cible.contrats = ["C2.6"];
  propriete(anomalies(RACINE, altere).length === 0, "contrôle : contrat existant");
});

couverture("PI-SURF-ENTREE-NON-RECONNUE", "une entrée du registre qui n'est plus reconnue échoue", () => {
  const reg = registreDe(RACINE);
  const contre = anomalies(RACINE, etendre(reg, { surfaces: [surf("methode", "methodeFantome", "extensions/bash-guard/index.ts")] }));
  propriete(JSON.stringify(contre) === JSON.stringify(["entrée non reconnue · methode methodeFantome · extensions/bash-guard/index.ts"]), `contre-épreuve : ${JSON.stringify(contre)}`);
});

couverture("PI-SURF-BALAYAGE-VIDE", "une liste de fichiers balayés vide échoue", () => {
  const reg = registreDe(RACINE);
  const d = copie();
  for (const rel of ["extensions", "subagent-only", "tests/pi-contrats"]) rmSync(join(d, rel), { recursive: true, force: true });
  const contre = anomalies(d, reg);
  propriete(contre.includes("balayage vide · extensions/**/*.ts, subagent-only/**/*.ts, tests/pi-contrats/**/*.{ts,mjs}"), `balayage vide non signalé : ${JSON.stringify(contre.slice(0, 5))}`);
});

// ── D-P3-PI-SURFACE-METADONNEES (phase 3, D2) ───────────────────────────────────────────────────

regressionCorrigee("P3-O7", "un .DS_Store ordinaire dans tests/pi-contrats est admis ; toute autre forme, place ou source reste signalée", () => {
  const reg = registreDe(RACINE);
  const OUT = "surface non au registre · outillage test-only · ";
  const avec = (preparer: (d: string) => void) => { const d = copie(); preparer(join(d, "tests/pi-contrats")); return anomalies(d, reg); };
  precondition(anomalies(copie(), reg).length === 0, "la copie intacte est conforme");
  const ordinaire = avec((pc) => writeFileSync(join(pc, ".DS_Store"), "Bud1 métadonnée Finder"));
  propriete(ordinaire.length === 0, `un .DS_Store ordinaire est admis : ${JSON.stringify(ordinaire)}`);
  const cas: Array<[string, (pc: string) => void, string]> = [
    ["nom voisin", (pc) => writeFileSync(join(pc, ".DS_Store.ts"), "export {};\n"), `${OUT}tests/pi-contrats/.DS_Store.ts`],
    ["autre non-suivi", (pc) => writeFileSync(join(pc, "notes.txt"), "n\n"), `${OUT}tests/pi-contrats/notes.txt`],
    ["répertoire vide", (pc) => mkdirSync(join(pc, ".DS_Store")), `${OUT}tests/pi-contrats/.DS_Store (métadonnée d'un autre type)`],
    ["lien", (pc) => { writeFileSync(join(pc, "..", "ds-cible"), "x"); symlinkSync(join(pc, "..", "ds-cible"), join(pc, ".DS_Store")); }, `${OUT}tests/pi-contrats/.DS_Store`],
    ["hors de la place admise", (pc) => { mkdirSync(join(pc, "sous")); writeFileSync(join(pc, "sous", ".DS_Store"), "x"); }, `${OUT}tests/pi-contrats/sous/.DS_Store`],
  ];
  for (const [quoi, preparer, attendu] of cas) {
    const a = avec(preparer);
    propriete(a.includes(attendu), `${quoi} : signalé (${JSON.stringify(a)})`);
  }
});
