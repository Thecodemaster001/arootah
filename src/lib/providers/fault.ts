import { RetryableError, type Prompt, type Provider } from "./types";

/**
 * Fault injection for demonstrating error recovery.
 *
 * The unhappy paths are the part of this tool worth showing, and they are
 * awkward to trigger honestly — you cannot ask a provider to fail on cue. This
 * wraps a real provider and makes chosen message ids fail in a chosen way, so
 * the recovery behaviour can be shown against the real pipeline rather than a
 * mock of it.
 *
 * It is inert unless TRIAGE_FAIL_IDS is set, and it refuses to arm in
 * production. A test hook that can fire in production is a liability, not a
 * feature.
 */

export type FaultMode =
  /** Permanent provider error. No retry, straight to a rendered error row. */
  | "api"
  /** Retryable 429. Exercises backoff, then gives up and renders the error. */
  | "rate-limit"
  /** Well-formed JSON that violates the schema. Exercises zod validation. */
  | "malformed";

const MODES: FaultMode[] = ["api", "rate-limit", "malformed"];

function parseMode(raw: string | undefined): FaultMode {
  const mode = (raw || "api").toLowerCase();
  if (!MODES.includes(mode as FaultMode)) {
    throw new Error(`Unknown TRIAGE_FAIL_MODE "${mode}" — expected one of: ${MODES.join(", ")}`);
  }
  return mode as FaultMode;
}

function inject(mode: FaultMode, id: string): unknown {
  switch (mode) {
    case "api":
      throw new Error(`Injected fault (${id}): provider returned 500 Internal Server Error`);
    case "rate-limit":
      throw new RetryableError(`Injected fault (${id}): 429 rate limit exceeded`, 429);
    case "malformed":
      // Valid JSON, wrong shape — the case a provider's own schema enforcement
      // is supposed to prevent, and which zod catches anyway.
      return {
        summary: "Injected fault: this object does not match the triage schema.",
        category: "urgent_client",
        priority: "critical",
        next_action: "",
        confidence: "very-high",
      };
  }
}

export function withFaultInjection(provider: Provider): Provider {
  const raw = process.env.TRIAGE_FAIL_IDS?.trim();
  if (!raw) return provider;

  if (process.env.NODE_ENV === "production") {
    console.warn("[fault-injection] TRIAGE_FAIL_IDS ignored: refusing to arm in production.");
    return provider;
  }

  const ids = new Set(raw.split(",").map((id) => id.trim()).filter(Boolean));
  const mode = parseMode(process.env.TRIAGE_FAIL_MODE);
  console.warn(`[fault-injection] ARMED — mode="${mode}" ids=${[...ids].join(", ")}`);

  return {
    name: provider.name,
    model: provider.model,
    async complete(prompt: Prompt, signal?: AbortSignal) {
      if (ids.has(prompt.id)) return inject(mode, prompt.id);
      return provider.complete(prompt, signal);
    },
  };
}
