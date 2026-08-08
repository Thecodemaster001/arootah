import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import inbound from "../data/inbound.json";
import offlineResults from "../data/offline-triage.json";
import { resolveProvider } from "@/lib/providers";
import { offlineProvider } from "@/lib/providers/offline";
import { prescreen } from "@/lib/prescreen";
import { InboundMessage, ModelTriageResult } from "@/lib/schema";
import { triageAll } from "@/lib/triage";

// A developer's own .env.local must not decide which provider this test sees.
vi.mock("@/lib/env", () => ({ loadLocalEnv: () => [] }));

const DEMO = z.array(InboundMessage).parse(inbound);

describe("offlineProvider", () => {
  it("has a valid result for every demo message that passes prescreen, and no others", () => {
    const passing = DEMO.filter((item) => prescreen(item).verdict === "pass").map((item) => item.id);
    expect(Object.keys(offlineResults).sort()).toEqual(passing.sort());
    for (const result of Object.values(offlineResults)) {
      expect(ModelTriageResult.safeParse(result).success).toBe(true);
    }
  });

  it("runs the whole demo inbox through the real pipeline", async () => {
    const records = await triageAll(DEMO, offlineProvider(), 4);
    const byStatus = records.reduce<Record<string, number>>((counts, record) => {
      counts[record.status] = (counts[record.status] ?? 0) + 1;
      return counts;
    }, {});

    expect(byStatus).toEqual({ ok: 11, unprocessable: 2 });
    expect(records.find((record) => record.id === "inb-009")?.result).toMatchObject({
      category: "ambiguous",
      confidence: "low",
    });
    expect(new Set(records.filter((record) => record.status === "ok").map((record) => record.model))).toEqual(
      new Set(["offline-demo"]),
    );
  });

  it("fails like a provider error for an id it has no result for", async () => {
    await expect(offlineProvider().complete({ id: "inb-999", system: "", user: "" })).rejects.toThrow(
      /No offline result for inb-999/,
    );
  });

  it("is selected by LLM_PROVIDER=offline without any key", () => {
    vi.stubEnv("LLM_PROVIDER", "offline");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("TRIAGE_FAIL_IDS", "");
    expect(resolveProvider()).toMatchObject({ name: "offline", model: "offline-demo" });
  });
});
