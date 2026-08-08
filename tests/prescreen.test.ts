import { describe, expect, it } from "vitest";
import { z } from "zod";
import inbound from "../data/inbound.json";
import { normalizeOrg, prescreen, readableText } from "@/lib/prescreen";
import { InboundMessage } from "@/lib/schema";
import { message } from "./helpers";

const DEMO = z.array(InboundMessage).parse(inbound);

describe("prescreen", () => {
  it("blocks exactly the two unreadable demo messages, for different reasons", () => {
    const blocked = DEMO.map((item) => ({ id: item.id, screened: prescreen(item) })).filter(
      ({ screened }) => screened.verdict === "unprocessable",
    );
    expect(blocked.map(({ id }) => id)).toEqual(["inb-010", "inb-011"]);

    const reasons = blocked.map(({ screened }) => (screened.verdict === "unprocessable" ? screened.reason : ""));
    expect(reasons[0]).toMatch(/^Only 1 readable character /);
    expect(reasons[1]).toMatch(/mail-transport debris/);
  });

  it("rejects a message that is empty after normalization", () => {
    expect(prescreen(message({ subject: "  ", body: "\u0000�" }))).toEqual({
      verdict: "unprocessable",
      reason: "Subject and body are empty after normalization.",
    });
  });

  it("lets a short body through when the subject carries the signal", () => {
    const screened = prescreen(message({ subject: "Statement needed for my lender", body: "Thanks" }));
    expect(screened.verdict).toBe("pass");
  });

  it("normalizes whitespace, control characters and org sentinels on pass", () => {
    const screened = prescreen(
      message({ from_name: "  Dana ", from_org: "(unknown)", body: "Hello\u0007  there,\n\nplease call me back today." }),
    );
    expect(screened).toMatchObject({
      verdict: "pass",
      normalized: { from_name: "Dana", from_org: "", body: "Hello there, please call me back today." },
    });
  });
});

describe("normalizeOrg", () => {
  it.each(["(individual)", "(Unknown)", "unknown", "N/A", "-", "  "])("treats %j as no organisation", (raw) => {
    expect(normalizeOrg(raw)).toBe("");
  });

  it("keeps and trims real organisation names", () => {
    expect(normalizeOrg("  Lumen Analytics ")).toBe("Lumen Analytics");
  });
});

describe("readableText", () => {
  it("drops control and replacement characters and collapses whitespace", () => {
    expect(readableText("\u0000a�\t b\r\n")).toBe("a b");
  });
});
