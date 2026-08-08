import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { InboundMessage, type TriageRecord } from "./schema";
import { PROMPT_VERSION } from "./prompt";

const DATA_DIR = path.join(process.cwd(), "data");
const INBOUND_PATH = path.join(DATA_DIR, "inbound.json");
const TRIAGE_PATH = path.join(DATA_DIR, "triage.json");

/**
 * The local-store option from the brief. `inbound.json` is the immutable
 * source; `triage.json` is a write-through cache so a page refresh doesn't
 * re-bill every message. Keying on `prompt_version` means editing the prompt
 * or taxonomy invalidates cached rows rather than leaving two prompt
 * generations mixed together in one view.
 */
const Cache = z.object({
  prompt_version: z.number(),
  records: z.record(z.string(), z.custom<TriageRecord>()),
});

type Cache = z.infer<typeof Cache>;

const EMPTY: Cache = { prompt_version: PROMPT_VERSION, records: {} };

export async function loadInbound(): Promise<InboundMessage[]> {
  const raw = await readFile(INBOUND_PATH, "utf8");
  const parsed = z.array(InboundMessage).safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(`data/inbound.json does not match the expected shape: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function loadTriage(): Promise<Record<string, TriageRecord>> {
  try {
    const parsed = Cache.safeParse(JSON.parse(await readFile(TRIAGE_PATH, "utf8")));
    if (!parsed.success || parsed.data.prompt_version !== PROMPT_VERSION) return {};
    return parsed.data.records;
  } catch {
    // No cache yet, or it is unreadable. Either way, start clean rather than
    // failing the page render over a derived file.
    return {};
  }
}

export async function saveTriage(records: TriageRecord[]): Promise<Record<string, TriageRecord>> {
  const existing = await loadTriage();
  for (const record of records) existing[record.id] = record;
  const next: Cache = { prompt_version: PROMPT_VERSION, records: existing };
  await writeFile(TRIAGE_PATH, JSON.stringify(next, null, 2) + "\n");
  return existing;
}

export async function clearTriage(): Promise<void> {
  await writeFile(TRIAGE_PATH, JSON.stringify(EMPTY, null, 2) + "\n");
}
