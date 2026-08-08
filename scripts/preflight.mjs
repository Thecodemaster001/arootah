/**
 * Preflight: confirms the configured provider and key actually work before you
 * spend a full triage run finding out they don't.
 *
 *   node scripts/preflight.mjs
 *
 * Reads .env.local the same way `next dev` does, falling back to the ambient
 * environment. Prints a masked key fingerprint so you can tell *which* key was
 * used without it ending up in a terminal transcript.
 */
import { readFileSync } from "node:fs";

/**
 * Must mirror src/lib/env.ts exactly. Keep FILE_OWNED_KEYS in sync with it.
 *
 * The app makes .env.local authoritative for credentials, overriding whatever
 * the shell exports. Preflight has to resolve config the same way or it reports
 * on a different key than the app uses — which is precisely the bug that made
 * an earlier version of this script pass while every request 429'd.
 */
const FILE_OWNED_KEYS = [
  "LLM_PROVIDER",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
];

function loadEnvLocal() {
  const overrides = [];
  let found = false;

  let contents;
  try {
    contents = readFileSync(".env.local", "utf8");
  } catch {
    return { found: false, overrides };
  }

  for (const line of contents.split("\n")) {
    if (line.trimStart().startsWith("#")) continue;
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    found = true;
    const [, key, rawValue] = match;
    const value = rawValue.replace(/^["']|["']$/g, "");

    if (!FILE_OWNED_KEYS.includes(key)) continue;
    if (process.env[key] !== undefined && process.env[key] !== value) {
      overrides.push(key);
    }
    process.env[key] = value;
  }

  return { found, overrides };
}

const { found: usedEnvFile, overrides } = loadEnvLocal();
const provider = (process.env.LLM_PROVIDER || "openai").toLowerCase();

const keyName = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
const key = process.env[keyName];

console.log(`config source : ${usedEnvFile ? ".env.local" : "ambient environment (no .env.local found)"}`);
console.log(`provider      : ${provider}`);

if (overrides.length > 0) {
  console.log(
    `note          : ${overrides.join(", ")} taken from .env.local, ignoring the value your shell exports`,
  );
}

if (!key) {
  console.error(`\n${keyName} is not set. Copy .env.example to .env.local and add it.`);
  process.exit(1);
}
console.log(`${keyName.padEnd(14)}: ${key.slice(0, 8)}…${key.slice(-4)}  (${key.length} chars)`);

const model =
  provider === "anthropic"
    ? process.env.ANTHROPIC_MODEL || "claude-opus-5"
    : process.env.OPENAI_MODEL || "gpt-5";
console.log(`model         : ${model}\n`);

try {
  if (provider === "anthropic") {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: key });
    const response = await client.messages.create({
      model,
      max_tokens: 16,
      messages: [{ role: "user", content: "Reply with the single word: ok" }],
    });
    const text = response.content.find((block) => block.type === "text");
    console.log(`OK — model replied: ${JSON.stringify(text?.text ?? "")}`);
  } else {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: key });
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: "Reply with the single word: ok" }],
    });
    console.log(`OK — model replied: ${JSON.stringify(response.choices[0]?.message.content ?? "")}`);
  }
  console.log("\nPreflight passed. `npm run dev` will work.");
} catch (error) {
  console.error(`\nPreflight FAILED\n  status : ${error?.status}`);
  console.error(`  code   : ${error?.code}`);
  console.error(`  type   : ${error?.type}`);
  console.error(`  message: ${error?.message}`);
  process.exit(1);
}
