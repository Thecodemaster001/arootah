import { loadLocalEnv } from "../env";
import { anthropicProvider } from "./anthropic";
import { withFaultInjection } from "./fault";
import { openaiProvider } from "./openai";
import type { Provider } from "./types";

export type { Prompt, Provider } from "./types";
export { RetryableError } from "./types";

/**
 * Provider is chosen once per process from the environment. Adapters are
 * constructed lazily so that running with only one key set does not throw on
 * the other's missing credential.
 */
export function resolveProvider(): Provider {
  // .env.local is authoritative for credentials — see lib/env.ts for why.
  loadLocalEnv();

  const name = (process.env.LLM_PROVIDER || "openai").toLowerCase();
  const provider = (() => {
    switch (name) {
      case "openai":
        return openaiProvider();
      case "anthropic":
        return anthropicProvider();
      default:
        throw new Error(`Unknown LLM_PROVIDER "${name}" — expected "openai" or "anthropic"`);
    }
  })();

  // Inert unless TRIAGE_FAIL_IDS is set; see providers/fault.ts.
  return withFaultInjection(provider);
}
