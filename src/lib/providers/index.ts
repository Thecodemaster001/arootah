import { loadLocalEnv } from "../env";
import { anthropicProvider } from "./anthropic";
import { withFaultInjection } from "./fault";
import { offlineProvider } from "./offline";
import { openaiProvider } from "./openai";
import type { Provider } from "./types";

export type { Prompt, Provider } from "./types";
export { RetryableError } from "./types";

/**
 * Provider is chosen once per process from the environment. Adapters are
 * constructed lazily so that running with only one key set does not throw on
 * the other's missing credential.
 */
export function configuredProviderName(): string {
  // .env.local is authoritative for credentials — see lib/env.ts for why.
  loadLocalEnv();
  return (process.env.LLM_PROVIDER || "openai").toLowerCase();
}

export function resolveProvider(): Provider {
  const name = configuredProviderName();
  const provider = (() => {
    switch (name) {
      case "openai":
        return openaiProvider();
      case "anthropic":
        return anthropicProvider();
      case "offline":
        return offlineProvider();
      default:
        throw new Error(`Unknown LLM_PROVIDER "${name}" — expected "openai", "anthropic" or "offline"`);
    }
  })();

  // Inert unless TRIAGE_FAIL_IDS is set; see providers/fault.ts.
  return withFaultInjection(provider);
}
