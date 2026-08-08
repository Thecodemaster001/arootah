import { describe, expect, it } from "vitest";
import { buildUserPrompt, SYSTEM_PROMPT } from "@/lib/prompt";
import { describeTaxonomy } from "@/lib/taxonomy";

describe("prompt", () => {
  it("embeds the generated taxonomy in the system prompt", () => {
    expect(SYSTEM_PROMPT).toContain(describeTaxonomy());
  });

  it("labels every field and marks blanks explicitly", () => {
    const text = buildUserPrompt({
      id: "inb-009",
      received_at: "2026-07-20T15:00:00-04:00",
      channel: "email",
      from_name: "",
      from_org: "",
      subject: "",
      body: "Just following up.",
    });
    expect(text).toBe(
      [
        "Triage this message.",
        "",
        "id: inb-009",
        "received_at: 2026-07-20T15:00:00-04:00",
        "channel: email",
        "from_name: (blank)",
        "from_org: (blank)",
        "subject: (blank)",
        "body: Just following up.",
      ].join("\n"),
    );
  });
});
