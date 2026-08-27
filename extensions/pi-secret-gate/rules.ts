/**
 * rules — the credential shapes pi-secret-gate refuses, with no pi import.
 *
 * Same reason as `subagent-only/role-rules.ts`: a regex that decides whether a
 * secret reaches git history is exactly the kind of rule that must have a test,
 * and a module importing the extension API cannot have one.
 */

interface Shape {
  label: string;
  pattern: RegExp;
}

export const SHAPES: Shape[] = [
  { label: "Google API key", pattern: /AIza[0-9A-Za-z_-]{35}/ },
  { label: "OpenAI-style key", pattern: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { label: "private key block", pattern: /BEGIN [A-Z ]*PRIVATE KEY/ },
  { label: "AWS access key id", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { label: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { label: "Slack token", pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
  {
    label: "assigned credential literal",
    // A credential-shaped name assigned a literal of some length. The eight-
    // character floor is what keeps `password = ""` and `api_key = None` out.
    pattern: /(?:api[_-]?key|secret|password|passwd|token|credential)\s*[:=]\s*["'][^"']{8,}["']/i,
  },
];

/**
 * Placeholders. A `.env.example` with dummy values is committed on purpose —
 * AGENTS.md says so under Secrets hygiene — and an example file that cannot be
 * written is a rule fighting another rule.
 */
export const PLACEHOLDER =
  /(x{8,}|\.{3,}|<[^>]+>|\$\{[^}]+\}|\byour[_-]|\bdummy\b|\bexample\b|\bplaceholder\b|\bchangeme\b|\bfake\b|\bREDACTED\b|\bTODO\b)/i;

/** Files whose whole purpose is to carry a fake credential. */
export const EXEMPT_PATH = /(^|\/)(\.env\.example|\.env\.sample|.*\.example\.[a-z]+)$/i;

export interface Hit {
  label: string;
  line: number;
  excerpt: string;
}

/** Every credential shape in `content` that is not obviously a placeholder. */
export function scan(content: string): Hit[] {
  const hits: Hit[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (PLACEHOLDER.test(line)) continue;
    for (const shape of SHAPES) {
      if (!shape.pattern.test(line)) continue;
      // The line is not echoed back in full: reporting a secret is one more
      // place it exists. Enough to locate it, not enough to carry it.
      hits.push({ label: shape.label, line: i + 1, excerpt: line.trim().slice(0, 40) + "…" });
      break;
    }
  }
  return hits;
}
