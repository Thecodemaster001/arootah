import type { InboundMessage } from "@/lib/schema";
import type { Prompt, Provider } from "@/lib/providers";

export const VALID_RESULT = {
  summary: "Existing client needs an updated portfolio statement by Friday.",
  category: "existing_client",
  priority: "high",
  next_action: "Send the client an updated portfolio statement before Friday.",
  confidence: "high",
  rationale: "Self-identified client with a lender deadline this week.",
} as const;

export function message(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    id: "msg-1",
    received_at: "2026-07-20T10:02:00-04:00",
    channel: "web-form",
    from_name: "Dana Whitfield",
    from_org: "(individual)",
    subject: "Need updated statement by Friday",
    body: "I'm an existing client and my mortgage lender needs an updated portfolio statement by this Friday.",
    ...overrides,
  };
}

/** A provider whose every call is answered by `respond`, recording the prompts it saw. */
export function fakeProvider(respond: (prompt: Prompt, call: number) => unknown | Promise<unknown>) {
  const prompts: Prompt[] = [];
  const provider: Provider = {
    name: "openai",
    model: "fake-model",
    async complete(prompt) {
      prompts.push(prompt);
      return respond(prompt, prompts.length);
    },
  };
  return { provider, prompts };
}

export type RecordedRequest = { url: string; body: Record<string, unknown> };

/**
 * Deterministic stand-in for the network layer that both SDKs call through.
 * Each call takes the next queued response; nothing ever leaves the process.
 */
export function fakeFetch(...responses: Array<{ status: number; body: unknown } | Error>) {
  const requests: RecordedRequest[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : {} });
    const next = responses[requests.length - 1];
    if (!next) throw new Error(`fakeFetch: unexpected request #${requests.length} to ${url}`);
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch, requests };
}

/** Awaits a promise that must reject and hands back what it rejected with. */
export async function rejection(promise: Promise<unknown>): Promise<Error & { status?: number }> {
  try {
    await promise;
  } catch (error) {
    return error as Error & { status?: number };
  }
  throw new Error("expected the promise to reject");
}
