import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Provider } from "@/lib/providers";
import { fakeProvider, message, VALID_RESULT } from "./helpers";

const resolveProvider = vi.fn<() => Provider>();
vi.mock("@/lib/providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/providers")>()),
  resolveProvider: () => resolveProvider(),
}));

async function loadRoute() {
  vi.resetModules();
  return import("@/app/api/triage/route");
}

const post = (body?: unknown) =>
  new Request("http://localhost/api/triage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  const dir = mkdtempSync(path.join(tmpdir(), "triage-route-"));
  mkdirSync(path.join(dir, "data"));
  writeFileSync(
    path.join(dir, "data/inbound.json"),
    JSON.stringify([message({ id: "m1" }), message({ id: "m2" }), message({ id: "m3", subject: "", body: "." })]),
  );
  vi.spyOn(process, "cwd").mockReturnValue(dir);
});

describe("POST /api/triage", () => {
  it("triages everything once, then serves the cache", async () => {
    const { provider, prompts } = fakeProvider(() => VALID_RESULT);
    resolveProvider.mockReturnValue(provider);
    const { POST } = await loadRoute();

    const first = await (await POST(post({}))).json();
    expect(first).toMatchObject({ triaged: 3, provider: "openai", model: "fake-model" });
    expect(first.records.m1.status).toBe("ok");
    expect(first.records.m3.status).toBe("unprocessable");
    expect(prompts).toHaveLength(2);

    const second = await (await POST(post())).json();
    expect(second.triaged).toBe(0);
    expect(Object.keys(second.records)).toEqual(["m1", "m2", "m3"]);
    expect(prompts).toHaveLength(2);
  });

  it("re-triages only the requested id when forced", async () => {
    const { provider, prompts } = fakeProvider(() => VALID_RESULT);
    resolveProvider.mockReturnValue(provider);
    const { POST } = await loadRoute();

    await POST(post({}));
    const retried = await (await POST(post({ ids: ["m2"], force: true }))).json();

    expect(retried.triaged).toBe(1);
    expect(prompts.map((prompt) => prompt.id)).toEqual(["m1", "m2", "m2"]);
  });

  it("reports a setup failure once instead of per message", async () => {
    resolveProvider.mockImplementation(() => {
      throw new Error("OPENAI_API_KEY is not set (see .env.example)");
    });
    const { POST } = await loadRoute();

    const response = await POST(post({}));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "OPENAI_API_KEY is not set (see .env.example)" });
  });

  it("rejects a malformed body", async () => {
    resolveProvider.mockReturnValue(fakeProvider(() => VALID_RESULT).provider);
    const { POST } = await loadRoute();

    const response = await POST(post({ ids: "m1" }));
    expect(response.status).toBe(400);
  });
});
