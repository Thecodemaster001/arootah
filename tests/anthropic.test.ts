import { describe, expect, it, vi } from "vitest";
import { RetryableError } from "@/lib/providers";
import { anthropicProvider } from "@/lib/providers/anthropic";
import { TRIAGE_JSON_SCHEMA } from "@/lib/schema";
import { fakeFetch, rejection, VALID_RESULT } from "./helpers";

const PROMPT = { id: "inb-002", system: "system text", user: "user text" };

function message(content: unknown[], stop_reason = "end_turn") {
  return {
    status: 200,
    body: {
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-test",
      content,
      stop_reason,
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  };
}

const errorBody = (type: string, text: string) => ({ type: "error", error: { type, message: text } });

function provider(...responses: Parameters<typeof fakeFetch>) {
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-not-a-real-key");
  vi.stubEnv("ANTHROPIC_MODEL", "claude-test");
  const fake = fakeFetch(...responses);
  return { ...fake, provider: anthropicProvider({ fetch: fake.fetch }) };
}

describe("anthropicProvider", () => {
  it("refuses to start without a key", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(() => anthropicProvider()).toThrow(/ANTHROPIC_API_KEY is not set/);
  });

  it("constrains output with output_config and parses the text block", async () => {
    const { provider: anthropic, requests } = provider(
      message([
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "text", text: JSON.stringify(VALID_RESULT) },
      ]),
    );

    await expect(anthropic.complete(PROMPT)).resolves.toEqual(VALID_RESULT);
    expect(anthropic).toMatchObject({ name: "anthropic", model: "claude-test" });

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toMatch(/\/v1\/messages$/);
    expect(requests[0].body).toEqual({
      model: "claude-test",
      max_tokens: 4096,
      system: "system text",
      messages: [{ role: "user", content: "user text" }],
      output_config: { effort: "low", format: { type: "json_schema", schema: TRIAGE_JSON_SCHEMA } },
    });
    expect(requests[0].body).not.toHaveProperty("temperature");
  });

  it.each([
    ["a refusal", message([], "refusal"), /declined to classify/],
    ["a max_tokens stop", message([{ type: "text", text: '{"summary":' }], "max_tokens"), /truncated/],
    ["a response with no text block", message([{ type: "thinking", thinking: "", signature: "sig" }]), /No text block/],
  ])("rejects %s", async (_, response, pattern) => {
    const { provider: anthropic } = provider(response);
    await expect(anthropic.complete(PROMPT)).rejects.toThrow(pattern);
  });

  it.each([
    [429, "rate_limit_error"],
    [529, "overloaded_error"],
  ])("surfaces %i %s as retryable after a single request", async (status, type) => {
    const { provider: anthropic, requests } = provider({ status, body: errorBody(type, "slow down") });

    const error = await rejection(anthropic.complete(PROMPT));
    expect(error).toBeInstanceOf(RetryableError);
    expect(error.message).toMatch(new RegExp(`^Anthropic ${status}: `));
    expect(requests).toHaveLength(1);
  });

  it("treats an exhausted credit balance as permanent even on 429", async () => {
    const { provider: anthropic } = provider({
      status: 429,
      body: errorBody("credit_balance_exhausted", "Your credit balance is too low"),
    });
    const error = await rejection(anthropic.complete(PROMPT));
    expect(error).not.toBeInstanceOf(RetryableError);
  });

  it("does not retry a bad request", async () => {
    const { provider: anthropic } = provider({ status: 400, body: errorBody("invalid_request_error", "bad schema") });
    const error = await rejection(anthropic.complete(PROMPT));
    expect(error).not.toBeInstanceOf(RetryableError);
    expect(error.message).toMatch(/bad schema/);
  });

  it("marks a dropped connection as retryable", async () => {
    const { provider: anthropic, requests } = provider(new TypeError("fetch failed"));
    await expect(anthropic.complete(PROMPT)).rejects.toBeInstanceOf(RetryableError);
    expect(requests).toHaveLength(1);
  });
});
