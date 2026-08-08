import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  CATEGORY_KEYS,
  MODEL_CATEGORY_KEYS,
  PRIORITIES,
  PRIORITY_KEYS,
  PRIORITY_RANK,
  describeTaxonomy,
} from "@/lib/taxonomy";

describe("taxonomy", () => {
  it("withholds unprocessable from the categories the model may choose", () => {
    expect(CATEGORY_KEYS).toContain("unprocessable");
    expect(MODEL_CATEGORY_KEYS).not.toContain("unprocessable");
    expect(MODEL_CATEGORY_KEYS).toEqual(CATEGORY_KEYS.filter((key) => key !== "unprocessable"));
  });

  it("ranks every priority, most urgent first", () => {
    expect(Object.keys(PRIORITY_RANK).sort()).toEqual([...PRIORITY_KEYS].sort());
    expect(PRIORITY_RANK.high).toBeLessThan(PRIORITY_RANK.medium);
    expect(PRIORITY_RANK.medium).toBeLessThan(PRIORITY_RANK.low);
  });

  it("renders the prompt section from the tables, model categories only", () => {
    const text = describeTaxonomy();
    for (const key of MODEL_CATEGORY_KEYS) expect(text).toContain(`- ${key}: ${CATEGORIES[key]}`);
    for (const key of PRIORITY_KEYS) expect(text).toContain(`- ${key}: ${PRIORITIES[key]}`);
    expect(text).not.toContain("unprocessable");
  });
});
