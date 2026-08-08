import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveProvider } from "@/lib/providers";
import { loadInbound, loadTriage, saveTriage } from "@/lib/store";
import { triageAll } from "@/lib/triage";

export const runtime = "nodejs";

const Body = z.object({
  /** Omit to triage everything not already cached. */
  ids: z.array(z.string()).optional(),
  /** Re-triage even if a cached record exists (used by the per-row retry button). */
  force: z.boolean().default(false),
});

/**
 * The only place the API key is read. It stays in this server route and is
 * never serialised into any response, so nothing reaches the browser.
 */
export async function POST(request: Request) {
  let provider;
  try {
    provider = resolveProvider();
  } catch (error) {
    // A missing key is a setup problem, not a per-message failure — say so
    // plainly instead of rendering 13 identical error rows.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Provider unavailable" },
      { status: 500 },
    );
  }

  const body = Body.safeParse(await request.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { ids, force } = body.data;
  const [inbound, cached] = await Promise.all([loadInbound(), loadTriage()]);

  const targets = inbound.filter((message) => {
    if (ids && !ids.includes(message.id)) return false;
    return force || !cached[message.id];
  });

  if (targets.length === 0) {
    return NextResponse.json({ records: cached, triaged: 0, provider: provider.name, model: provider.model });
  }

  const concurrency = Number(process.env.TRIAGE_CONCURRENCY) || 4;
  const records = await triageAll(targets, provider, concurrency, request.signal);
  const merged = await saveTriage(records);

  return NextResponse.json({
    records: merged,
    triaged: records.length,
    provider: provider.name,
    model: provider.model,
  });
}
