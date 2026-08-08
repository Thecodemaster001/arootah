import { describe, expect, it } from "vitest";
import { ModelTriageResult, TRIAGE_JSON_SCHEMA, TriageResult } from "@/lib/schema";
import { MODEL_CATEGORY_KEYS } from "@/lib/taxonomy";
import { VALID_RESULT } from "./helpers";

describe("TriageResult", () => {
  it("accepts a complete result", () => {
    expect(TriageResult.parse(VALID_RESULT)).toEqual(VALID_RESULT);
  });

  it("rejects unknown fields, empty strings and out-of-range values", () => {
    expect(TriageResult.safeParse({ ...VALID_RESULT, extra: 1 }).success).toBe(false);
    expect(TriageResult.safeParse({ ...VALID_RESULT, next_action: "" }).success).toBe(false);
    expect(TriageResult.safeParse({ ...VALID_RESULT, summary: "x".repeat(201) }).success).toBe(false);
    expect(TriageResult.safeParse({ ...VALID_RESULT, priority: "critical" }).success).toBe(false);
    expect(TriageResult.safeParse({ ...VALID_RESULT, confidence: "very-high" }).success).toBe(false);
  });

  it("allows unprocessable on records but not from the model", () => {
    const prescreened = { ...VALID_RESULT, category: "unprocessable" };
    expect(TriageResult.safeParse(prescreened).success).toBe(true);
    expect(ModelTriageResult.safeParse(prescreened).success).toBe(false);
  });
});

describe("TRIAGE_JSON_SCHEMA", () => {
  const schema = TRIAGE_JSON_SCHEMA as {
    $schema?: string;
    type: string;
    additionalProperties: boolean;
    required: string[];
    properties: Record<string, { enum?: string[] }>;
  };

  it("is a closed object with every field required, as strict modes demand", () => {
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect([...schema.required].sort()).toEqual(Object.keys(VALID_RESULT).sort());
    expect(schema.$schema).toBeUndefined();
  });

  it("offers the model exactly the model categories", () => {
    expect(schema.properties.category.enum).toEqual(MODEL_CATEGORY_KEYS);
  });
});
