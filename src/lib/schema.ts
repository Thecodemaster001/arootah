import { z } from "zod";
import {
  CATEGORY_KEYS,
  MODEL_CATEGORY_KEYS,
  PRIORITY_KEYS,
  type Category,
  type ModelCategory,
  type Priority,
} from "./taxonomy";

export const InboundMessage = z.object({
  id: z.string(),
  received_at: z.string(),
  channel: z.string(),
  from_name: z.string(),
  from_org: z.string(),
  subject: z.string(),
  body: z.string(),
});

export type InboundMessage = z.infer<typeof InboundMessage>;

/**
 * The single source of truth for the model's output contract. Both providers
 * are handed the JSON Schema derived from this object, and every response is
 * re-validated against it on the way back — provider enforcement is a fast
 * path, not a reason to skip checking.
 */
export const TriageResult = z.strictObject({
  summary: z.string().min(1).max(200).describe("One line, under 20 words, stating what the sender wants."),
  category: z.enum(CATEGORY_KEYS as [Category, ...Category[]]),
  priority: z.enum(PRIORITY_KEYS as [Priority, ...Priority[]]),
  next_action: z.string().min(1).max(200).describe("The single concrete next step, starting with a verb."),
  confidence: z.enum(["high", "medium", "low"]).describe("low when the message is too vague to classify with confidence."),
  rationale: z.string().min(1).max(300).describe("One sentence justifying the category and priority."),
});

export type TriageResult = z.infer<typeof TriageResult>;

/**
 * What the model is held to. Identical to `TriageResult` except that `category`
 * excludes `unprocessable`, which only the deterministic prescreen may assign —
 * the enum, not a prompt sentence, is what makes that unreachable.
 */
export const ModelTriageResult = TriageResult.extend({
  category: z.enum(MODEL_CATEGORY_KEYS as [ModelCategory, ...ModelCategory[]]),
});

export type ModelTriageResult = z.infer<typeof ModelTriageResult>;

/**
 * Draft 2020-12 with `additionalProperties: false`, which both providers
 * require for strict modes. `$schema` is dropped because neither provider
 * expects a dialect declaration on an inline schema.
 */
const { $schema: _dialect, ...triageSchema } = z.toJSONSchema(ModelTriageResult, {
  target: "draft-2020-12",
});

export const TRIAGE_JSON_SCHEMA = triageSchema;

export type TriageStatus = "ok" | "unprocessable" | "error";

/**
 * A discriminated union rather than throw/catch: an API failure is a value the
 * UI renders, not an exception that takes the page down. Every message ends up
 * with one of these three, so the queue is never partially missing rows.
 */
export type TriageRecord = {
  id: string;
  status: TriageStatus;
  result: TriageResult;
  /** Present only when status is "error" — the reason the call failed. */
  error?: string;
  source: "llm" | "prescreen" | "fallback";
  model: string | null;
  triaged_at: string;
};
