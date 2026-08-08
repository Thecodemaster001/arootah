import { describe, expect, it, vi } from "vitest";
import { RetryableError } from "@/lib/providers";
import { openaiProvider } from "@/lib/providers/openai";
import { TRIAGE_JSON_SCHEMA } from "@/lib/schema";
import { fakeFetch, rejection, VALID_RESULT } from "./helpers";

const PROMPT = { id: "inb-002", system: "system text", user: "user text" };

function completion(content: string | null, extra: { finish_reason?: string; refusal?: string | null } = {}) {
  return {
    status: 200,
    body: {
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 0,
      model: "gpt-test",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content, refusal: extra.refusal ?? null },
          finish_reason: extra.finish_reason ?? "stop",
        },
      ],
    },
  };
}

function provider(...responses: Parameters<typeof fakeFetch>) {
  vi.stubEnv("OPENAI_API_KEY", "sk-test-not-a-real-key");
  vi.stubEnv("OPENAI_MODEL", "gpt-test");
  const fake = fakeFetch(...responses);
  return { ...fake, provider: openaiProvider({ fetch: fake.fetch }) };
}

describe("openaiProvider", () => {
  it("refuses to start without a key", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(() => openaiProvider()).toThrow(/OPENAI_API_KEY is not set/);
  });

  it("sends a strict json_schema request and returns the parsed object", async () => {
    const { provider: openai, requests } = provider(completion(JSON.stringify(VALID_RESULT)));

    await expect(openai.complete(PROMPT)).resolves.toEqual(VALID_RESULT);
    expect(openai).toMatchObject({ name: "openai", model: "gpt-test" });

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toMatch(/\/chat\/completions$/);
    expect(requests[0].body).toEqual({
      model: "gpt-test",
      messages: [
        { role: "system", content: "system text" },
        { role: "user", content: "user text" },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "triage_result", strict: true, schema: TRIAGE_JSON_SCHEMA },
      },
    });
  });

  it.each([
    ["a length-capped response", completion('{"summary":', { finish_reason: "length" }), /truncated/],
    ["a refusal", completion(null, { refusal: "cannot help" }), /Model refused: cannot help/],
    ["an empty body", completion(""), /Empty response body/],
  ])("rejects %s", async (_, response, pattern) => {
    const { provider: openai } = provider(response);
    await expect(openai.complete(PROMPT)).rejects.toThrow(pattern);
  });

  it("surfaces a rate limit as retryable after a single request", async () => {
    const { provider: openai, requests } = provider({
      status: 429,
      body: { error: { message: "Rate limit reached", type: "requests", code: "rate_limit_exceeded" } },
    });

    const error = await rejection(openai.complete(PROMPT));
    expect(error).toBeInstanceOf(RetryableError);
    expect(error.message).toMatch(/^OpenAI 429: /);
    expect(requests).toHaveLength(1);
  });

  it("treats an exhausted quota as permanent", async () => {
    const { provider: openai } = provider({
      status: 429,
      body: { error: { message: "You exceeded your current quota", type: "insufficient_quota", code: "insufficient_quota" } },
    });

    const error = await rejection(openai.complete(PROMPT));
    expect(error).not.toBeInstanceOf(RetryableError);
    expect(error.message).toMatch(/quota/);
  });

  it("does not retry an authentication failure", async () => {
    const { provider: openai } = provider({
      status: 401,
      body: { error: { message: "Incorrect API key provided", type: "invalid_request_error", code: "invalid_api_key" } },
    });
    const error = await rejection(openai.complete(PROMPT));
    expect(error).not.toBeInstanceOf(RetryableError);
    expect(error.message).toMatch(/^OpenAI 401: /);
  });

  it("marks a dropped connection as retryable", async () => {
    const { provider: openai, requests } = provider(new TypeError("fetch failed"));
    await expect(openai.complete(PROMPT)).rejects.toBeInstanceOf(RetryableError);
    expect(requests).toHaveLength(1);
  });
});
