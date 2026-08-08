import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Configuration keys that `.env.local` owns outright.
 *
 * Next.js gives an already-exported shell variable precedence over `.env.local`,
 * so a stale `OPENAI_API_KEY` left in someone's shell silently shadows the key
 * they actually put in the file — and every message comes back 429 with nothing
 * pointing at the cause. For credentials that failure mode is expensive and
 * genuinely hard to diagnose, so this app inverts the precedence: the file wins.
 *
 * Deliberately narrow. Runtime flags (TRIAGE_*) keep normal precedence, because
 * the demo scripts set them inline on the command line and expect that to work.
 */
const FILE_OWNED_KEYS = [
  "LLM_PROVIDER",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
] as const;

export type EnvOverride = { key: string; shadowed: boolean };

let applied: EnvOverride[] | null = null;

const LINE = /^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*?)\s*$/;
const QUOTED = /^(["'`])(.*?)\1\s*(?:#.*)?$/;

/**
 * Reads values the way @next/env (dotenv) does, so this override never applies
 * a different value from the one Next itself would have loaded: optional
 * `export`, matching quotes kept verbatim, and `#` ending an unquoted value.
 * scripts/preflight.mjs carries a copy of this parser and must stay in step.
 */
export function parseEnvFile(contents: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(LINE);
    if (!match) continue;
    const quoted = match[2].match(QUOTED);
    values.set(match[1], quoted ? quoted[2] : match[2].split("#")[0].trim());
  }
  return values;
}

/**
 * Applies `.env.local` over the ambient environment for the keys above.
 * Idempotent — safe to call on every request; the file is read once.
 *
 * Server-only: this module must never be imported from a client component.
 */
export function loadLocalEnv(): EnvOverride[] {
  if (applied) return applied;

  let values: Map<string, string>;
  try {
    values = parseEnvFile(readFileSync(path.join(process.cwd(), ".env.local"), "utf8"));
  } catch {
    applied = [];
    return applied;
  }

  const overrides: EnvOverride[] = [];
  for (const key of FILE_OWNED_KEYS) {
    const value = values.get(key);
    if (value === undefined) continue;

    const ambient = process.env[key];
    if (ambient !== undefined && ambient !== value) {
      overrides.push({ key, shadowed: true });
    }
    process.env[key] = value;
  }

  for (const { key } of overrides) {
    console.warn(`[env] ${key} from .env.local took precedence over the value exported by your shell.`);
  }

  applied = overrides;
  return applied;
}
