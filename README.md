# Inbound Triage Assistant

An LLM triages the Northwind Advisors shared inbox: one-line summary, category,
priority, and a next action per message, ranked so the highest-consequence item
is at the top.

**Demo:** https://www.loom.com/share/e52c1720336e4859bc634396c3cdd02c

**Engineering Rationale lives in [RATIONALE.md](./RATIONALE.md)** — that is the
part the brief weighs most.

---

## Quick start

Requires Node 20+ (developed on 25.6) and an API key for one provider.

```bash
npm install
cp .env.example .env.local     # add your key
npm run dev                    # http://localhost:3000
```

Then click **Triage 13 new**. Results are cached to `data/triage.json`, so a
refresh does not re-bill the queue; **Re-run all** forces a fresh pass.

`.env.local` needs, at minimum:

```
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-proj-...
```

Set `LLM_PROVIDER=anthropic` with `ANTHROPIC_API_KEY` to run the other adapter.
The key is read only in `src/lib/providers/*`, which is imported exclusively by
the server route — it is never serialised into a response or bundled into client
JS.

## Verification status

What has actually been executed, against `gpt-5`:

| Checked | Status |
|---|---|
| `npm run build`, `npm run typecheck` | Pass, clean |
| `npm run preflight` | Pass — confirms the configured key reaches the model before you spend a run |
| Full triage of all 13 messages | Pass — `{ ok: 11, unprocessable: 2 }` |
| Prescreen gate | Blocks exactly `inb-010` and `inb-011`, for two different reasons |
| Error path | Verified for real against an out-of-credit key: 11 typed `error` records, no crash |
| Result cache | Second run re-triages 0; `force` re-triages a single row |
| Anthropic adapter | Typechecks and builds; **not exercised against a live key** |

The one honest gap is the Anthropic path — the code is complete but no Anthropic
key was available, so I have not seen it return a classification.

## Preflight

```bash
npm run preflight
```

Resolves configuration exactly as the app does, prints a masked key
fingerprint, and makes one cheap call.

**`.env.local` is authoritative for credentials.** Next.js normally gives an
already-exported shell variable precedence over `.env.local`, which means a stale
`OPENAI_API_KEY` sitting in your shell silently shadows the key you actually put
in the file — every message returns `429`, and nothing points at the cause.
[`src/lib/env.ts`](src/lib/env.ts) inverts that for provider credentials, so the
file wins and logs when it overrides. Runtime flags (`TRIAGE_*`) keep normal
precedence, because the demo scripts set them inline on the command line.

Two bugs from this area are worth knowing about, because both are the same
mistake in different directions:

- The 429s were a stale key in the shell shadowing `.env.local`. Now impossible.
- Preflight originally forced `.env.local` to win while the app let the shell
  win, so it reported a healthy key while every request failed. A preflight that
  doesn't reproduce the app's own resolution is worse than none — it converts a
  visible failure into a confident false pass. It now shares the same key list
  and the same precedence rule as `src/lib/env.ts`.

## Demonstrating error recovery

The unhappy paths are the interesting part and are awkward to trigger honestly —
you cannot ask a provider to fail on cue. `src/lib/providers/fault.ts` wraps the
real provider and forces chosen message ids to fail, so recovery is shown
against the real pipeline rather than a mock of it.

```bash
npm run demo:error       # permanent provider error — fails fast, no retries
npm run demo:ratelimit   # retryable 429 — backoff runs, then gives up
npm run demo:malformed   # schema-valid JSON that violates the contract
```

Each clears the cache and starts the dev server with `inb-005` rigged to fail;
click **Triage 13 new** and that row renders as an error card with the reason and
a retry button. Observed behaviour:

| Mode | Elapsed | Path exercised |
|---|---|---|
| `api` | ~0.0s | Permanent error — no retry |
| `rate-limit` | ~1.1s | `RetryableError` → exponential backoff → give up |
| `malformed` | ~0.0s | zod validation, naming every violated field |

Target a different message with
`TRIAGE_FAIL_IDS=inb-002 TRIAGE_FAIL_MODE=api npm run dev`.

The hook is inert unless `TRIAGE_FAIL_IDS` is set and refuses to arm when
`NODE_ENV=production`, so it cannot fire in a deployed build. A test hook that
can trigger in production is a liability rather than a feature.

## Design choices & tradeoffs

**Next.js App Router.** One process gives a React front end and a server route in
the same repo, so the key stays server-side with no second server and no CORS to
explain. React is what the role uses. The cost is a heavier dependency than a
single Express file — worth it for the single-process key boundary.

**Local JSON store, not Airtable.** `data/inbound.json` is the immutable source;
`data/triage.json` is a write-through cache keyed by message id plus
`PROMPT_VERSION`. Editing the prompt or taxonomy bumps the version and
invalidates cached rows, so the queue never mixes output from two prompt
generations. The tradeoff is no concurrent writers and no query layer — correct
for a single-user local tool, wrong the moment two people use it.

**Two providers behind one interface.** OpenAI and Anthropic enforce structure
differently — a strict `json_schema` response format versus
`output_config.format`. Both are handed a schema derived from the *same* zod
object, and both responses are re-validated by that same object. About 40 extra
lines. It earns them by making "what if we swap models?" a config change instead
of a rewrite, and by proving the validation is not load-bearing on one vendor's
guarantee. The honest counter-argument is that the brief says don't gold-plate,
and a single provider would have shipped fine.

**A deterministic gate before the model.** `prescreen()` resolves empty and
corrupted bodies in code. Cheaper and faster, but mostly: an LLM asked to triage
a body of `"."` invents a plausible category, and a confident wrong answer is the
failure mode a triage queue can least afford.

**Typed failure, not exceptions.** Every message produces a record —
`ok`, `unprocessable`, or `error`. An API failure renders as a card with the
reason and a retry button. A queue with holes is worse than a queue that says
"this one broke", because nobody can distinguish a skipped message from one that
never arrived.

## How I'd model this in Airtable

Two tables. **Messages** holds the raw inbound fields (`id`, `received_at`,
`channel`, `from_name`, `from_org`, `subject`, `body`) plus the triage output as
single-select fields for `category` and `priority` and long-text for `summary`
and `next_action`. **Contacts** holds one row per sender, keyed on email or
name+org, with the relationship type. A `Messages → Contacts` link field is the
one linked relationship: it turns "Nathan Brooks was referred by Dana Whitfield"
into a real edge, so an associate opening a prospect immediately sees the
referring client and the existing thread history rather than re-deriving it from
message text. Categories as single-selects rather than free text is what makes
the priority view groupable.

## One n8n automation I'd add

**Trigger:** new record in `Messages` where `priority = high` and `status = ok`.
**Action:** post to the `#inbox-urgent` Slack channel with the summary, the next
action, and a deep link to the Airtable row.

High priority is defined as "money or trust is at risk within ~24 hours", so the
alert is only useful if it is rare — that definition is what keeps the channel
from being ignored. I would deliberately *not* auto-reply to senders: the whole
design assumes a human confirms before anything leaves the building.

## How I used AI

Claude Code wrote most of the scaffolding and the first draft of every file. I
directed the architecture — the prescreen-before-spend gate, taxonomy-as-data,
the discriminated-union result type, and the decision to re-validate after the
provider's own enforcement were all specified before any code was generated.

**One example where I overrode the model.** Its first instinct was to handle the
malformed items purely in the prompt — add a line telling the LLM to return
`unprocessable` when the body is empty or garbled. That is the tempting answer
because it is one sentence instead of a module. I rejected it: it still spends a
call on `"."`, and more importantly it makes correctness depend on the model
declining to hallucinate, which is exactly the behaviour that is unreliable under
low-signal input. The deterministic gate in `src/lib/prescreen.ts` is the result.

A second, smaller override: the generated Anthropic adapter initially set
`temperature: 0` for determinism, which current reasoning models reject outright.
Determinism here comes from the schema, not from sampling.
