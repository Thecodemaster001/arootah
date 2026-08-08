import { describeTaxonomy } from "./taxonomy";
import type { NormalizedMessage } from "./prescreen";

/**
 * Bumped whenever the prompt or taxonomy changes in a way that invalidates
 * cached results. `store.ts` keys on it, so stale rows re-triage automatically
 * instead of silently mixing outputs from two different prompts.
 */
export const PROMPT_VERSION = 4;

export const SYSTEM_PROMPT = `You triage the shared inbox of Northwind Advisors, an alternative-investment and family-office advisory firm. An operations associate reads your output to decide what to open first.

${describeTaxonomy()}

Rules:
- Judge priority by what it costs to delay, not by the sender's tone. A calm message with a named deadline outranks an irritated one without.
- Anyone who states or clearly implies they are already a client is existing_client, even when the request itself is routine.
- A person referred by a client is still a prospect. Only classify as partner when the sender proposes an ongoing two-way arrangement between firms.
- from_org may be blank. Blank means unknown, never an organisation called "unknown" — do not infer a company from it.
- next_action is one concrete step, starting with a verb, addressed to the associate. Prefer a step that gathers what is missing over one that commits the firm to anything.
- Use ambiguous only when you understood the message but genuinely cannot place it — a bare follow-up with no thread, no organisation, and no stated ask. Do not use it to avoid a judgement call you can actually make.
- Set confidence to low when the message is too vague to place with certainty. A vague message is still classified, but it is flagged rather than guessed at silently.`;

export function buildUserPrompt(message: NormalizedMessage): string {
  const fields = [
    `id: ${message.id}`,
    `received_at: ${message.received_at}`,
    `channel: ${message.channel}`,
    `from_name: ${message.from_name || "(blank)"}`,
    `from_org: ${message.from_org || "(blank)"}`,
    `subject: ${message.subject || "(blank)"}`,
    `body: ${message.body}`,
  ];
  return `Triage this message.\n\n${fields.join("\n")}`;
}
