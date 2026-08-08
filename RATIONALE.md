# Engineering Rationale

Answers to §4 of the brief, specific to what is in this repo.

---

## a. Data & taxonomy

Eight categories: `prospect`, `existing_client`, `partner`, `vendor`,
`recruiting`, `noise`, `ambiguous`, `unprocessable`. The last two are split
across two layers — see §c, where the first live run is what forced the split.

They are cut along the line that actually changes what an associate does next.
`vendor` and `recruiting` could both be folded into "not business" — I kept them
apart because they route to different people (operations vs. whoever is hiring),
and routing is the point of the exercise. `partner` exists because `inb-007`
(an RIA proposing a referral arrangement) and `inb-001` (a founder with $8M to
place) are both "inbound business" but are not remotely the same job: one is a
BD conversation, the other is a client onboarding.

`unprocessable` is deliberately distinct from `noise`. Noise is understood and
dismissed — a newsletter is correctly classified and correctly ignored.
Unprocessable was never understood at all, and the honest signal to a human is
"I could not read this", not "this is unimportant". Collapsing them would hide
pipeline failures inside a bucket nobody reviews.

`ambiguous` sits between them and did not exist in my first draft. It means
"readable, but not placeable without looking something up" — a real and separate
operational state, because it tells an associate to go check the CRM rather than
to discard. The live run is what proved it was missing (§c).

The categories are also **split by layer**, which is the structural point:
`MODEL_CATEGORY_KEYS` in `taxonomy.ts` is the full list minus `unprocessable`,
and that narrowed list is what generates the model's enum. The model is
*incapable* of returning `unprocessable`; only the deterministic prescreen
assigns it. Enforcing that in the enum rather than with a sentence in the prompt
is the difference between a rule and a hope.

Priority is defined by **consequence of delay**, not by sender tone. This is the
one definition I would defend hardest, because tone is the obvious proxy and it
is wrong. `inb-005` (angry client, "call me back today") and `inb-002` (polite
client, "needs it by Friday") are both high — not because one is annoyed, but
because both have a clock. An irritated message with no deadline would be medium.

**If the taxonomy doubled.** It is data, not literals:
`src/lib/taxonomy.ts` exports two objects, and everything else derives from them.
`describeTaxonomy()` renders the prompt text; `z.enum(CATEGORY_KEYS)` builds the
validator; `z.toJSONSchema()` builds the schema both providers enforce; the UI
filter maps over the same keys. Adding a category is one line in one file, and
the prompt, the schema, the validator, and the UI all move together. The thing
that would *not* survive doubling is the flat single-label model: at ~15
categories you want a two-level taxonomy (`business/prospect`,
`business/partner`) or multi-label, because "vendor who is also a client" is
currently unrepresentable and I force it into one bucket.

## b. Reliable structure

**One schema, two enforcement mechanisms.** The zod object `TriageResult` in
[`src/lib/schema.ts`](src/lib/schema.ts) is the single source of truth.
`z.toJSONSchema()` derives the JSON Schema, which is handed to OpenAI as a
strict `json_schema` response format
([`providers/openai.ts`](src/lib/providers/openai.ts)) and to Anthropic as
`output_config.format` ([`providers/anthropic.ts`](src/lib/providers/anthropic.ts)).
Both vendors are held to a byte-identical contract because it is generated, not
transcribed twice.

**And the guarantee is not trusted.** Every response is re-parsed with the same
zod object in [`triage.ts`](src/lib/triage.ts) (`TriageResult.safeParse`). The
provider's enforcement is a fast path, not a reason to skip checking — schema
enforcement can still hand back a *truncated* object if the response hits a token
ceiling, which is well-formed and wrong. Both adapters check for that explicitly
before parsing (`finish_reason === "length"` on OpenAI, `stop_reason` on
Anthropic).

**When it comes back malformed:** `safeParse` fails, and the message becomes a
record with `status: "error"` carrying the zod issue paths — it does not throw.
That matters because of the type in `schema.ts`: `TriageRecord` is a
discriminated union over `ok | unprocessable | error`, so an API failure is a
*value the UI renders* rather than an exception that takes out the request.
`MessageCard.tsx` renders it as a red card with the reason and a retry button.

**Retry.** `completeWithRetry` in `triage.ts` retries only `RetryableError`, with
exponential backoff plus jitter so a rate-limited batch does not resynchronise
and collide again on the next attempt.

## c. Where the model was wrong

**The case: `inb-009`** ("Hi — just following up on our conversation. Let me
know the next step whenever you get a chance.", `from_org: (unknown)`).

On the first live run, `gpt-5` returned:

```
category: unprocessable    priority: low    confidence: low
summary : Following up on prior conversation; asking for next steps.
```

The summary is the tell. It read the message correctly and paraphrased it
accurately — then filed it as `unprocessable`, a category I had defined as
content that *could not be read*. The classification contradicted the model's
own summary in the same object.

**Why it happened, and why it is my bug rather than the model's.** My taxonomy
had no bucket for "readable but not placeable". Faced with a message it
understood but genuinely could not route, the model picked the nearest available
label. That is reasonable behaviour given the choices I gave it. The damage was
real though: `unprocessable` now meant two different things in one column —
"the intake pipeline is broken" (from prescreen) and "a human needs to check the
CRM" (from the model). Those route to completely different responses, and the
merge would have hidden genuine pipeline failures behind messages that are merely
under-specified. Ironic, since §a is where I argued that exact conflation was
worth avoiding.

**How I detected it.** Not from the category — from the required `summary` and
`rationale` fields sitting next to it. A bare label would have looked fine;
`unprocessable` on a message with a coherent one-line summary is visibly
self-contradictory. That is the concrete argument for making the model explain
itself in-schema: it makes this class of error *legible* at a glance instead of
requiring you to re-read all 13 bodies.

**The fix, and confirmation it worked.** Two changes: added `ambiguous` for
readable-but-unplaceable, and — more importantly — removed `unprocessable` from
the enum the model sees (`MODEL_CATEGORY_KEYS`), so the deterministic layer owns
it exclusively and the model *cannot* reach for it again. Re-running the same
input after the change:

```
inb-009  low  ambiguous      llm        conf=low
inb-010  low  unprocessable  prescreen  conf=low
inb-011  low  unprocessable  prescreen  conf=low
```

Correct classification, correctly low confidence, and the two failure modes now
land in separate buckets with a `source` field recording which layer decided.

**A prediction of mine that was wrong.** Before running it, I expected `inb-013`
(Nathan Brooks, referred by client Dana Whitfield) to drift to `existing_client`,
because the referral makes a client's name salient. It did not — the model
returned `prospect`, reasoning *"Referred by a current client but not yet a
client, so prospect."* The explicit prompt rule held. Worth stating plainly
because it cuts against my instinct: I pre-empted the failure I imagined, and
missed the one that actually occurred one row above it.

## d. Edge cases

Two items are resolved deterministically in
[`src/lib/prescreen.ts`](src/lib/prescreen.ts) and never reach the model.
Verified against the real data: it blocks exactly these two, for two different
reasons.

| Item | What it is | Verdict |
|---|---|---|
| `inb-010` | body is `"."`, all other fields empty | `Only 1 readable character across subject and body — too little to classify.` |
| `inb-011` | NUL bytes, replacement chars, a truncated `=?utf-8?B?` encoded-word, a MIME boundary header | `Body is mail-transport debris (encoding artifacts, MIME headers) with no readable message underneath.` |

They fail different tests on purpose. `inb-010` is *empty* — under the 20-char
signal floor. `inb-011` is not short at all; it is 100+ characters of structural
debris, so length alone would pass it. It is caught by matching MIME/encoding
artifacts, stripping them, and finding no prose underneath.

**Why code and not a prompt instruction.** This is the choice I would most want
to defend. Adding "return unprocessable if the body is empty" to the prompt is
one sentence instead of a module, and it is worse: it still spends a call and a
round-trip on `"."`, and it makes correctness depend on the model declining to
hallucinate under exactly the low-signal conditions where models hallucinate
most. Asked to triage `"."`, an LLM will produce a fluent, confident,
wrong answer. A regex will not. Determinism is the entire product requirement
here.

**Why flag rather than drop.** Both still appear in the queue as
`unprocessable / low` with the reason shown. A silently dropped message is
indistinguishable from one that never arrived, which is how a broken intake form
goes unnoticed for a month. Low priority means nobody is woken up; visible means
somebody eventually notices the pattern.

Smaller ones handled the same way: `from_org` sentinels (`(individual)`,
`(unknown)`) are normalised to empty by `normalizeOrg()` before the prompt is
built, so the model is never told the company is named "unknown". `readableText()`
strips control characters for display too — otherwise `inb-011` renders as
mojibake in the browser.

## e. Scale & risk

**What breaks at 10,000/day.**

1. *Rate limits and cost, first and loudest.* 10k sequential calls is not
   viable. Concurrency is already bounded (`triageAll`, default 4) rather than
   `Promise.all` over the queue, so the shape is right, but at volume I would move
   to a queue with a dead-letter path and use the providers' batch APIs (50% cheaper,
   and this is not latency-sensitive work — nobody needs triage in 800ms).
2. *The JSON file store dies immediately.* `data/triage.json` is read-modify-write
   with no locking; two concurrent writers lose data. Correct for one user
   locally, wrong at any real volume — this becomes Postgres or Airtable, keyed on
   message id, with the triage record as a row.
3. *The prescreen gate becomes the cost lever, not a nicety.* If even 15% of real
   inbound is auto-generated bounces and out-of-office replies, that is 1,500
   calls/day saved by rules that cost nothing. At 13 messages it saved two calls;
   at 10k it is the difference in the bill.
4. *The retry bug I actually hit.* My first live run treated every 429 as
   retryable and burned 27 seconds retrying a permanent billing failure 3× per
   message. `classifyStatus()` in
   [`providers/types.ts`](src/lib/providers/types.ts) now separates
   quota-exhausted from rate-limited; the same run drops to 7.8s. At 10k messages
   that class of mistake is a self-inflicted outage, not a slow afternoon.
5. *No observability.* There is no logging of token spend, latency, or category
   distribution. At volume, a prompt change that quietly reclassifies 30% of
   `prospect` as `noise` would be invisible — I would want per-category counts
   tracked over time as the regression alarm.

**The biggest risk in shipping this to a real advisory firm** is not a crash. It
is **a high-priority message confidently classified as low and never seen again**
— specifically, a client complaint or a compliance-relevant request landing in
`noise`. Nothing errors, nothing alerts, and the failure is only discovered when
the client escalates. In an advisory context that is a regulatory and
relationship problem, not a software bug.

Mitigations, in the order I would actually do them:

- **Never auto-archive.** The tool ranks a queue; it does not delete from one. A
  human still scans the `low` bucket, which caps the damage of a wrong call at
  "seen later" rather than "never seen".
- **Make the taxonomy fail safe.** Uncertainty should route *up*, not down —
  anything the model marks `confidence: low` should be reviewed regardless of
  assigned priority, since a low-confidence `low` is exactly the dangerous cell.
- **Keyword floor as a backstop.** A short deterministic rule set that forces
  minimum priority on complaint and compliance language ("complaint", "attorney",
  "SEC", "unauthorized"), applied *after* the model. It is the same reasoning as
  the prescreen gate: for the failure that actually hurts, rules beat judgment.
- **Sample and measure.** Human-label a few hundred messages, and track recall on
  high-priority specifically. Overall accuracy is the wrong metric — missing 2% of
  urgent client issues is far worse than misfiling 10% of vendor spam.

The secondary risk is confidentiality: message bodies contain client financial
details and go to a third-party API. That is a procurement and data-agreement
question (zero-retention terms, and confirming the firm's client agreements
permit it) more than an engineering one, but it should be settled before this
touches a real inbox rather than after.
