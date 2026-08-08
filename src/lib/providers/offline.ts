import { readFileSync } from "node:fs";
import path from "node:path";
import type { Prompt, Provider } from "./types";

export const OFFLINE_MODEL = "offline-demo";

/**
 * Keyless provider for demos, screenshots and first-run checks. It answers
 * from hand-written results in data/offline-triage.json, keyed by message id,
 * so the whole pipeline (prescreen, validation, cache, UI) runs without an API
 * key and without network. It classifies nothing: an id with no entry fails
 * like a provider error would.
 */
export function offlineProvider(): Provider {
  const file = path.join(process.cwd(), "data", "offline-triage.json");
  const results: Record<string, unknown> = JSON.parse(readFileSync(file, "utf8"));

  return {
    name: "offline",
    model: OFFLINE_MODEL,
    async complete(prompt: Prompt): Promise<unknown> {
      if (!(prompt.id in results)) {
        throw new Error(`No offline result for ${prompt.id} in data/offline-triage.json`);
      }
      return structuredClone(results[prompt.id]);
    },
  };
}
