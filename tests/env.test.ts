import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseEnvFile } from "@/lib/env";

describe("parseEnvFile", () => {
  it("reads values the way @next/env does", () => {
    const values = parseEnvFile(
      [
        "# a comment",
        "LLM_PROVIDER=anthropic",
        "export OPENAI_MODEL = gpt-5  ",
        "OPENAI_API_KEY=sk-test-unquoted # trailing note",
        'ANTHROPIC_API_KEY="sk-test-with#hash" # note',
        "ANTHROPIC_MODEL='claude-test'",
        "EMPTY=",
        "not a line",
        "WINDOWS=crlf\r",
      ].join("\n"),
    );

    expect(Object.fromEntries(values)).toEqual({
      LLM_PROVIDER: "anthropic",
      OPENAI_MODEL: "gpt-5",
      OPENAI_API_KEY: "sk-test-unquoted",
      ANTHROPIC_API_KEY: "sk-test-with#hash",
      ANTHROPIC_MODEL: "claude-test",
      EMPTY: "",
      WINDOWS: "crlf",
    });
  });
});

describe("loadLocalEnv", () => {
  async function loadFrom(contents: string | null) {
    const dir = mkdtempSync(path.join(tmpdir(), "triage-env-"));
    if (contents !== null) writeFileSync(path.join(dir, ".env.local"), contents);
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    vi.resetModules();
    return (await import("@/lib/env")).loadLocalEnv;
  }

  it("lets .env.local win over the shell for credentials only", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test-from-shell");
    vi.stubEnv("TRIAGE_FAIL_IDS", "from-shell");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const loadLocalEnv = await loadFrom("OPENAI_API_KEY=sk-test-from-file\nTRIAGE_FAIL_IDS=from-file\n");

    expect(loadLocalEnv()).toEqual([{ key: "OPENAI_API_KEY", shadowed: true }]);
    expect(process.env.OPENAI_API_KEY).toBe("sk-test-from-file");
    expect(process.env.TRIAGE_FAIL_IDS).toBe("from-shell");
    expect(warn).toHaveBeenCalledOnce();
  });

  it("reads the file once", async () => {
    vi.stubEnv("OPENAI_MODEL", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const loadLocalEnv = await loadFrom("OPENAI_MODEL=gpt-test\n");
    const first = loadLocalEnv();
    process.env.OPENAI_MODEL = "changed";
    expect(loadLocalEnv()).toBe(first);
    expect(process.env.OPENAI_MODEL).toBe("changed");
  });

  it("is a no-op without a .env.local", async () => {
    const loadLocalEnv = await loadFrom(null);
    expect(loadLocalEnv()).toEqual([]);
  });
});
