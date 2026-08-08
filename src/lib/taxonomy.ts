/**
 * The taxonomy is data, not literals scattered through prompts and switch
 * statements. The prompt text, the JSON schema the model is held to, and the
 * UI legend are all generated from these two tables, so adding a category is a
 * one-line change here and nowhere else.
 */

export const CATEGORIES = {
  prospect: "Someone who might become a client — inbound interest in advisory services, at any stage of readiness.",
  existing_client: "Someone who says or strongly implies they are already a client, asking for service on their account.",
  partner: "A firm proposing a two-way business relationship: referral arrangements, co-advisory, introductions.",
  vendor: "Someone selling a product or service to the firm.",
  recruiting: "Job offers, candidate outreach, headhunters — inbound about employment rather than advisory work.",
  noise: "Automated mail, newsletters, marketing blasts, and spam. Real text, but no one needs to act on it.",
  ambiguous: "Readable and coherent, but carries too little context to place — a bare follow-up with no thread, no org, and no stated ask. Someone must look it up before it can be routed.",
  unprocessable: "Content that could not be read at all: empty, truncated, or corrupted. Assigned only by the deterministic prescreen, never by the model.",
} as const;

export type Category = keyof typeof CATEGORIES;

/**
 * The categories the model is allowed to choose from.
 *
 * `unprocessable` is deliberately withheld. The prescreen gate decides what is
 * unreadable before any call is made, so the model is never in a position to
 * need it — and given the option, it reaches for `unprocessable` to mean
 * "readable but I can't place this", which silently merges two failure modes an
 * operator needs to tell apart. `ambiguous` is the category for that case.
 */
export const MODEL_CATEGORY_KEYS = (Object.keys(CATEGORIES) as Category[]).filter(
  (key) => key !== "unprocessable",
);

export type ModelCategory = Exclude<Category, "unprocessable">;

/**
 * Priority is defined by consequence-of-delay rather than by how loud the
 * sender is. An angry email with no deadline is not automatically high; a
 * calm one with a Friday deadline is.
 */
export const PRIORITIES = {
  high: "Money or trust is at risk within roughly 24 hours: an explicit near-term deadline, a complaint from a current client, or a large qualified opportunity that goes cold if ignored.",
  medium: "A genuine opportunity or client request with no stated deadline. Should be handled this week.",
  low: "No action required, or action that can wait indefinitely without cost.",
} as const;

export type Priority = keyof typeof PRIORITIES;

export const CATEGORY_KEYS = Object.keys(CATEGORIES) as Category[];
export const PRIORITY_KEYS = Object.keys(PRIORITIES) as Priority[];

/** Sort order for the queue: most urgent first. */
export const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

/**
 * Rendered into the prompt so the model and the schema never drift apart.
 * Lists only the categories the model may return — describing a category it is
 * then forbidden to emit would just invite invalid output.
 */
export function describeTaxonomy(): string {
  const categories = MODEL_CATEGORY_KEYS.map((key) => `- ${key}: ${CATEGORIES[key]}`).join("\n");
  const priorities = PRIORITY_KEYS.map((key) => `- ${key}: ${PRIORITIES[key]}`).join("\n");
  return `Categories:\n${categories}\n\nPriorities:\n${priorities}`;
}
