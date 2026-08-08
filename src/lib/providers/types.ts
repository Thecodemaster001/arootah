/**
 * The seam between orchestration and vendor SDKs.
 *
 * Both providers enforce the same JSON Schema, but by different mechanisms:
 * OpenAI takes it as a strict `json_schema` response format, Anthropic as an
 * `output_config.format`. Neither guarantee is trusted — `triage.ts` re-validates
 * every response with zod regardless of which adapter produced it.
 */
export interface Provider {
  readonly name: "openai" | "anthropic";
  readonly model: string;
  /** Returns parsed JSON, still unvalidated. Throws on transport or API failure. */
  complete(prompt: Prompt, signal?: AbortSignal): Promise<unknown>;
}

export type Prompt = {
  /** The message being triaged. Carried for tracing and fault injection. */
  id: string;
  system: string;
  user: string;
};

/** Marks failures worth retrying: rate limits, transient server errors, dropped connections. */
export class RetryableError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "RetryableError";
  }
}

/**
 * Identifiers that arrive as 429 but are permanent: the account is out of
 * credit or over its plan quota. Retrying these burns wall-clock and changes
 * nothing — only a rate-limited 429 is worth backing off for.
 *
 * Providers disagree about which field carries the useful value (OpenAI puts
 * `insufficient_quota` in `type` and `credit_balance_exhausted` in `code`), so
 * callers pass every candidate and any match wins.
 */
const PERMANENT_429 = new Set([
  "insufficient_quota",
  "credit_balance_exhausted",
  "billing_hard_limit_reached",
]);

export function classifyStatus(
  status: number | undefined,
  message: string,
  ...codes: (string | null | undefined)[]
): Error {
  if (codes.some((code) => code && PERMANENT_429.has(code))) return new Error(message);
  if (status === 429 || (status !== undefined && status >= 500)) {
    return new RetryableError(message, status);
  }
  return new Error(message);
}
