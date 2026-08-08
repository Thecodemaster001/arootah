import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RetryableError } from "@/lib/providers";
import { triageAll, triageMessage } from "@/lib/triage";
import { fakeProvider, message, VALID_RESULT } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0.5); // jitter factor of exactly 1
});

afterEach(() => {
  vi.useRealTimers();
});

describe("triageMessage", () => {
  it("returns a validated llm record on success", async () => {
    const { provider, prompts } = fakeProvider(() => VALID_RESULT);
    const record = await triageMessage(message(), provider);

    expect(record).toMatchObject({ id: "msg-1", status: "ok", source: "llm", model: "fake-model", result: VALID_RESULT });
    expect(record.error).toBeUndefined();
    expect(prompts).toHaveLength(1);
    expect(prompts[0].id).toBe("msg-1");
    expect(prompts[0].user).toContain("from_org: (blank)");
  });

  it("never calls the provider for an unreadable message", async () => {
    const { provider, prompts } = fakeProvider(() => VALID_RESULT);
    const record = await triageMessage(message({ subject: "", body: "." }), provider);

    expect(prompts).toHaveLength(0);
    expect(record).toMatchObject({
      status: "unprocessable",
      source: "prescreen",
      model: null,
      result: { category: "unprocessable", priority: "low", confidence: "low" },
    });
  });

  it("backs off exponentially on retryable errors and recovers", async () => {
    const { provider, prompts } = fakeProvider((_, call) => {
      if (call < 3) throw new RetryableError("429 rate limit", 429);
      return VALID_RESULT;
    });

    const pending = triageMessage(message(), provider);
    await vi.advanceTimersByTimeAsync(399);
    expect(prompts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(prompts).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(799);
    expect(prompts).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(prompts).toHaveLength(3);

    await expect(pending).resolves.toMatchObject({ status: "ok" });
  });

  it("gives up after three attempts and renders the last error", async () => {
    const { provider, prompts } = fakeProvider(() => {
      throw new RetryableError("503 overloaded", 503);
    });

    const pending = triageMessage(message(), provider);
    await vi.runAllTimersAsync();
    const record = await pending;

    expect(prompts).toHaveLength(3);
    expect(record).toMatchObject({ status: "error", source: "fallback", error: "503 overloaded" });
    expect(record.result.category).toBe("unprocessable");
  });

  it("does not retry a permanent error", async () => {
    const { provider, prompts } = fakeProvider(() => {
      throw new Error("401 invalid key");
    });

    const record = await triageMessage(message(), provider);

    expect(prompts).toHaveLength(1);
    expect(record).toMatchObject({ status: "error", error: "401 invalid key" });
  });

  it("stops retrying once the request is aborted", async () => {
    const controller = new AbortController();
    const { provider, prompts } = fakeProvider(() => {
      controller.abort();
      throw new RetryableError("429", 429);
    });

    const record = await triageMessage(message(), provider, controller.signal);

    expect(prompts).toHaveLength(1);
    expect(record.status).toBe("error");
  });

  it("names every violated field when the response breaks the contract", async () => {
    const { provider } = fakeProvider(() => ({ ...VALID_RESULT, category: "unprocessable", next_action: "" }));
    const record = await triageMessage(message(), provider);

    expect(record.status).toBe("error");
    expect(record.error).toMatch(/^category: .*; next_action: /);
  });

  it("rejects non-object responses", async () => {
    const { provider } = fakeProvider(() => "not json");
    const record = await triageMessage(message(), provider);
    expect(record.error).toMatch(/^\(root\): /);
  });
});

describe("triageAll", () => {
  it("keeps input order and never exceeds the concurrency limit", async () => {
    vi.useRealTimers();
    let inFlight = 0;
    let peak = 0;
    const { provider } = fakeProvider(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return VALID_RESULT;
    });

    const messages = Array.from({ length: 7 }, (_, index) => message({ id: `msg-${index}` }));
    const records = await triageAll(messages, provider, 3);

    expect(records.map((record) => record.id)).toEqual(messages.map((item) => item.id));
    expect(peak).toBe(3);
  });

  it.each([0, -2, Number.NaN])("still makes progress with a concurrency of %s", async (concurrency) => {
    const { provider } = fakeProvider(() => VALID_RESULT);
    const records = await triageAll([message({ id: "a" }), message({ id: "b" })], provider, concurrency);
    expect(records.map((record) => record.status)).toEqual(["ok", "ok"]);
  });
});
