import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROMPT_VERSION } from "@/lib/prompt";
import type { TriageRecord } from "@/lib/schema";
import { message, VALID_RESULT } from "./helpers";

let dir: string;

const record = (id: string): TriageRecord => ({
  id,
  status: "ok",
  result: VALID_RESULT,
  source: "llm",
  model: "fake-model",
  triaged_at: "2026-07-20T15:00:00.000Z",
});

async function loadStore() {
  vi.spyOn(process, "cwd").mockReturnValue(dir);
  vi.resetModules();
  return import("@/lib/store");
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "triage-store-"));
  mkdirSync(path.join(dir, "data"));
});

describe("store", () => {
  it("validates the inbound file", async () => {
    writeFileSync(path.join(dir, "data/inbound.json"), JSON.stringify([message()]));
    const store = await loadStore();
    await expect(store.loadInbound()).resolves.toEqual([message()]);

    writeFileSync(path.join(dir, "data/inbound.json"), JSON.stringify([{ id: 1 }]));
    await expect(store.loadInbound()).rejects.toThrow(/does not match the expected shape/);
  });

  it("merges saved records into the cache", async () => {
    const store = await loadStore();
    await store.saveTriage([record("a")]);
    const merged = await store.saveTriage([record("b")]);

    expect(Object.keys(merged)).toEqual(["a", "b"]);
    const onDisk = JSON.parse(readFileSync(path.join(dir, "data/triage.json"), "utf8"));
    expect(onDisk.prompt_version).toBe(PROMPT_VERSION);
    await expect(store.loadTriage()).resolves.toEqual(merged);
  });

  it("ignores a cache written by another prompt version", async () => {
    writeFileSync(
      path.join(dir, "data/triage.json"),
      JSON.stringify({ prompt_version: PROMPT_VERSION - 1, records: { a: record("a") } }),
    );
    const store = await loadStore();
    await expect(store.loadTriage()).resolves.toEqual({});
  });

  it("starts clean when the cache is missing or corrupt", async () => {
    const store = await loadStore();
    await expect(store.loadTriage()).resolves.toEqual({});
    writeFileSync(path.join(dir, "data/triage.json"), "{not json");
    await expect(store.loadTriage()).resolves.toEqual({});
  });
});
