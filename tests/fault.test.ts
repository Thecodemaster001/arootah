import { describe, expect, it, vi } from "vitest";
import { withFaultInjection } from "@/lib/providers/fault";
import { RetryableError, type Prompt } from "@/lib/providers";
import { fakeProvider, rejection, VALID_RESULT } from "./helpers";

const prompt = (id: string): Prompt => ({ id, system: "s", user: "u" });

describe("withFaultInjection", () => {
  it("is inert when TRIAGE_FAIL_IDS is unset", () => {
    vi.stubEnv("TRIAGE_FAIL_IDS", "");
    const { provider } = fakeProvider(() => VALID_RESULT);
    expect(withFaultInjection(provider)).toBe(provider);
  });

  it("refuses to arm in production", () => {
    vi.stubEnv("TRIAGE_FAIL_IDS", "inb-005");
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { provider } = fakeProvider(() => VALID_RESULT);
    expect(withFaultInjection(provider)).toBe(provider);
  });

  describe("when armed", () => {
    function armed(mode?: string) {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("TRIAGE_FAIL_IDS", " inb-005 , inb-002 ,");
      if (mode) vi.stubEnv("TRIAGE_FAIL_MODE", mode);
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const fake = fakeProvider(() => VALID_RESULT);
      return { ...fake, wrapped: withFaultInjection(fake.provider) };
    }

    it("passes untargeted ids through to the real provider", async () => {
      const { wrapped, prompts } = armed("api");
      await expect(wrapped.complete(prompt("inb-001"))).resolves.toEqual(VALID_RESULT);
      expect(prompts).toHaveLength(1);
      expect(wrapped.model).toBe("fake-model");
    });

    it("defaults to a permanent api error", async () => {
      const { wrapped, prompts } = armed();
      const error = await rejection(wrapped.complete(prompt("inb-005")));
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(RetryableError);
      expect(prompts).toHaveLength(0);
    });

    it("raises a retryable 429 in rate-limit mode", async () => {
      const { wrapped } = armed("RATE-LIMIT");
      await expect(wrapped.complete(prompt("inb-002"))).rejects.toMatchObject({ name: "RetryableError", status: 429 });
    });

    it("returns schema-breaking JSON in malformed mode", async () => {
      const { wrapped } = armed("malformed");
      await expect(wrapped.complete(prompt("inb-005"))).resolves.toMatchObject({ category: "urgent_client" });
    });

    it("rejects an unknown mode up front", () => {
      expect(() => armed("explode")).toThrow(/Unknown TRIAGE_FAIL_MODE "explode"/);
    });
  });
});
