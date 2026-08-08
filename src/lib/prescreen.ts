import type { InboundMessage } from "./schema";

/**
 * Sentinels the brief calls out. These are placeholders the intake form writes,
 * not organisation names, so they must not be fed to the model as if they were.
 */
const ORG_SENTINELS = new Set(["(individual)", "(unknown)", "unknown", "n/a", "-", ""]);

/** Structural debris from a mail pipeline rather than anything a human wrote. */
const MIME_ARTIFACTS = [
  /content-type:\s*\S+/i,
  /boundary=/i,
  /=\?[\w-]+\?[bq]\?/i, // truncated RFC 2047 encoded-word, e.g. "=?utf-8?B?"
  /--- forwarded message truncated ---/i,
];

/** Minimum readable characters before a body is worth spending a model call on. */
const MIN_SIGNAL_CHARS = 20;

export type Prescreen =
  | { verdict: "pass"; normalized: NormalizedMessage }
  | { verdict: "unprocessable"; reason: string };

export type NormalizedMessage = {
  id: string;
  received_at: string;
  channel: string;
  from_name: string;
  /** Empty string when the original was a sentinel — never the sentinel text itself. */
  from_org: string;
  subject: string;
  body: string;
};

export function normalizeOrg(raw: string): string {
  return ORG_SENTINELS.has(raw.trim().toLowerCase()) ? "" : raw.trim();
}

/**
 * Strips control characters and Unicode replacement characters, then collapses
 * whitespace. What survives is the text a human could actually read.
 */
export function readableText(raw: string): string {
  return raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\uFFFD/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countArtifacts(text: string): number {
  return MIME_ARTIFACTS.filter((pattern) => pattern.test(text)).length;
}

/**
 * Deterministic gate that runs before any model call.
 *
 * Two reasons this is code and not a prompt instruction. It is free and
 * instant, so the obviously-empty items cost nothing. More importantly, an LLM
 * asked to triage a body of "." will invent a plausible category rather than
 * admit there is nothing there — a confident wrong answer is worse than a
 * flagged one, and this is the failure mode the queue can least afford.
 */
export function prescreen(message: InboundMessage): Prescreen {
  const body = readableText(message.body);
  const subject = readableText(message.subject);
  const artifacts = countArtifacts(body);

  // Remove the structural debris and see whether any prose is left underneath.
  let prose = body;
  for (const pattern of MIME_ARTIFACTS) prose = prose.replace(pattern, " ");
  prose = prose.replace(/\s+/g, " ").trim();

  const signal = `${subject} ${prose}`.trim();

  if (signal.length === 0) {
    return { verdict: "unprocessable", reason: "Subject and body are empty after normalization." };
  }

  if (artifacts > 0 && prose.length < MIN_SIGNAL_CHARS) {
    return {
      verdict: "unprocessable",
      reason: "Body is mail-transport debris (encoding artifacts, MIME headers) with no readable message underneath.",
    };
  }

  if (signal.length < MIN_SIGNAL_CHARS) {
    return {
      verdict: "unprocessable",
      reason: `Only ${signal.length} readable character${signal.length === 1 ? "" : "s"} across subject and body — too little to classify.`,
    };
  }

  return {
    verdict: "pass",
    normalized: {
      id: message.id,
      received_at: message.received_at,
      channel: message.channel,
      from_name: message.from_name.trim(),
      from_org: normalizeOrg(message.from_org),
      subject,
      body,
    },
  };
}
