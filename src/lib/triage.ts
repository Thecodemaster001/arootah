import { prescreen } from "./prescreen";
import { buildUserPrompt, SYSTEM_PROMPT } from "./prompt";
import { ModelTriageResult, type InboundMessage, type TriageRecord } from "./schema";
import { RetryableError, type Prompt, type Provider } from "./providers";

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 400;

/**
 * Every unhappy path still produces a row. The queue showing "couldn't
 * classify this, look at it yourself" is useful; a queue with holes in it is
 * not, because nobody can tell a message that was skipped from one that was
 * never received.
 */
function fallbackRecord(
  id: string,
  status: "unprocessable" | "error",
  summary: string,
  next_action: string,
  rationale: string,
  model: string | null,
  error?: string,
): TriageRecord {
  return {
    id,
    status,
    source: status === "error" ? "fallback" : "prescreen",
    model,
    error,
    triaged_at: new Date().toISOString(),
    result: {
      summary,
      category: "unprocessable",
      priority: "low",
      next_action,
      confidence: "low",
      rationale,
    },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function completeWithRetry(
  provider: Provider,
  prompt: Prompt,
  signal?: AbortSignal,
): Promise<unknown> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await provider.complete(prompt, signal);
    } catch (error) {
      lastError = error;
      const retryable = error instanceof RetryableError;
      if (!retryable || attempt === MAX_ATTEMPTS || signal?.aborted) break;
      // Exponential backoff with jitter so a rate-limited batch doesn't
      // resynchronise and hit the limit again in lockstep.
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1) * (0.5 + Math.random());
      await sleep(delay);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * prescreen -> model -> validate -> fallback. The only path that reaches the
 * provider is one where a human could actually have read the message.
 */
export async function triageMessage(
  message: InboundMessage,
  provider: Provider,
  signal?: AbortSignal,
): Promise<TriageRecord> {
  const screened = prescreen(message);

  if (screened.verdict === "unprocessable") {
    return fallbackRecord(
      message.id,
      "unprocessable",
      "Message contains no readable content.",
      "Review the raw message manually, or discard it.",
      screened.reason,
      null,
    );
  }

  const prompt = {
    id: message.id,
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(screened.normalized),
  };

  let raw: unknown;
  try {
    raw = await completeWithRetry(provider, prompt, signal);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return fallbackRecord(
      message.id,
      "error",
      "Automated triage failed for this message.",
      "Triage manually, then retry once the provider recovers.",
      "The model call failed, so no classification was produced.",
      provider.model,
      detail,
    );
  }

  // Both providers claim to enforce the schema. We check anyway — a provider
  // guarantee is a fast path, not a substitute for validating what arrived.
  const parsed = ModelTriageResult.safeParse(raw);
  if (!parsed.success) {
    return fallbackRecord(
      message.id,
      "error",
      "Model returned a result that did not match the schema.",
      "Triage manually and check the prompt or schema for drift.",
      "Response failed validation against the triage schema.",
      provider.model,
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; "),
    );
  }

  return {
    id: message.id,
    status: "ok",
    result: parsed.data,
    source: "llm",
    model: provider.model,
    triaged_at: new Date().toISOString(),
  };
}

/**
 * Bounded concurrency. Unbounded Promise.all over the queue is fine for 13
 * messages and immediately rate-limits at any realistic volume, so the limit
 * is here from the start rather than retrofitted.
 */
export async function triageAll(
  messages: InboundMessage[],
  provider: Provider,
  concurrency: number,
  signal?: AbortSignal,
): Promise<TriageRecord[]> {
  const records = new Array<TriageRecord>(messages.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < messages.length) {
      const index = cursor++;
      records[index] = await triageMessage(messages[index], provider, signal);
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, messages.length) }, worker);
  await Promise.all(workers);
  return records;
}
