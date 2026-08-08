# Triage prompt

Generated at runtime by [`src/lib/prompt.ts`](../src/lib/prompt.ts). The category and
priority lists are not written here by hand — they are rendered from
[`src/lib/taxonomy.ts`](../src/lib/taxonomy.ts) via `describeTaxonomy()`, so this file, the
prompt, and the enum the model is validated against cannot drift apart.

Current `PROMPT_VERSION`: **4**. Bumping it invalidates the cached results in
`data/triage.json`, so a prompt change never leaves two generations of output
mixed together in one view.

Note what is **absent** from the category list below: `unprocessable`. It exists
in the taxonomy but is filtered out of `MODEL_CATEGORY_KEYS`, because the
deterministic prescreen owns it. The model is not told about a label it is
forbidden to emit. See RATIONALE §c for the live-run failure that forced this.

---

## System prompt

```
You triage the shared inbox of Northwind Advisors, an alternative-investment and family-office advisory firm. An operations associate reads your output to decide what to open first.

Categories:
- prospect: Someone who might become a client — inbound interest in advisory services, at any stage of readiness.
- existing_client: Someone who says or strongly implies they are already a client, asking for service on their account.
- partner: A firm proposing a two-way business relationship: referral arrangements, co-advisory, introductions.
- vendor: Someone selling a product or service to the firm.
- recruiting: Job offers, candidate outreach, headhunters — inbound about employment rather than advisory work.
- noise: Automated mail, newsletters, marketing blasts, and spam. Real text, but no one needs to act on it.
- ambiguous: Readable and coherent, but carries too little context to place — a bare follow-up with no thread, no org, and no stated ask. Someone must look it up before it can be routed.

Priorities:
- high: Money or trust is at risk within roughly 24 hours: an explicit near-term deadline, a complaint from a current client, or a large qualified opportunity that goes cold if ignored.
- medium: A genuine opportunity or client request with no stated deadline. Should be handled this week.
- low: No action required, or action that can wait indefinitely without cost.

Rules:
- Judge priority by what it costs to delay, not by the sender's tone. A calm message with a named deadline outranks an irritated one without.
- Anyone who states or clearly implies they are already a client is existing_client, even when the request itself is routine.
- A person referred by a client is still a prospect. Only classify as partner when the sender proposes an ongoing two-way arrangement between firms.
- from_org may be blank. Blank means unknown, never an organisation called "unknown" — do not infer a company from it.
- next_action is one concrete step, starting with a verb, addressed to the associate. Prefer a step that gathers what is missing over one that commits the firm to anything.
- Use ambiguous only when you understood the message but genuinely cannot place it — a bare follow-up with no thread, no organisation, and no stated ask. Do not use it to avoid a judgement call you can actually make.
- Set confidence to low when the message is too vague to place with certainty. A vague message is still classified, but it is flagged rather than guessed at silently.
```

## User prompt

One message per call, as labelled fields rather than a re-serialised blob. Empty
fields render as `(blank)` so the model is never handed a bare dangling label,
and `from_org` sentinels (`(individual)`, `(unknown)`) are stripped before they
arrive.

```
Triage this message.

id: inb-002
received_at: 2026-07-20T10:02:00-04:00
channel: web-form
from_name: Dana Whitfield
from_org: (blank)
subject: Need updated statement by Friday
body: I'm an existing client and my mortgage lender needs an updated portfolio statement by this Friday. Can someone send it over? This is fairly time-sensitive.
```

## Approach

**Structure.** One message per call, not the batch. Batching is cheaper, but one
malformed item can derail the classification of its neighbours, and a partial
batch response is far messier to recover from than a single failed call. At 13
messages the cost difference is irrelevant; the isolation is not.

**Parameters.** `temperature` is unset on both providers — reasoning models
reject non-default values, and the determinism worth having here comes from a
constrained schema rather than from sampling. Anthropic runs at `effort: "low"`
with `max_tokens: 4096`; that budget looks oversized for ~150 tokens of JSON
because on `claude-opus-5` thinking is on by default and shares the ceiling with
the response.

**Enforcing the JSON.** The zod object in
[`src/lib/schema.ts`](../src/lib/schema.ts) is the single source of truth.
`z.toJSONSchema()` derives the JSON Schema handed to both providers — OpenAI as a
strict `json_schema` response format, Anthropic as `output_config.format` — so
both adapters are held to a byte-identical contract. Every response is then
re-parsed with the same zod object in
[`triage.ts`](../src/lib/triage.ts), because a provider guarantee is a fast path,
not a reason to skip validating. Schema enforcement still permits a *truncated*
object if the response hits a token ceiling, which is well-formed and wrong —
both adapters check for that before parsing.

**Why six fields and not four.** The brief asks for summary, category, priority,
and next action. `confidence` and `rationale` are additions, and they earn their
tokens: RATIONALE §c documents a real mis-classification that was only visible
because the summary sat next to the category and contradicted it. A bare label
would have looked plausible.

**What never reaches the prompt.** `prescreen()` resolves empty and corrupted
bodies deterministically before any call is made. An LLM asked to triage a body
of `"."` will produce a confident, plausible, wrong answer; a regex will not.
