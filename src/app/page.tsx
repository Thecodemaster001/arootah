import { Queue } from "@/components/Queue";
import { configuredProviderName } from "@/lib/providers";
import { loadInbound, loadTriage } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [messages, triage] = await Promise.all([loadInbound(), loadTriage()]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8 border-b border-stone-300 pb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ledger-700">Northwind Advisors</p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight sm:text-4xl">Inbound triage</h1>
        <p className="mt-2 max-w-2xl text-sm text-stone-600">
          Every message in the shared inbox gets a category, a priority set by the cost of delay, and one next
          step. Ranked so the most consequential item is on top.
        </p>
        {configuredProviderName() === "offline" && (
          <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            <span className="font-semibold">Offline demo provider.</span> Results come from
            data/offline-triage.json. No model is called.
          </p>
        )}
      </header>
      <Queue messages={messages} initialTriage={triage} />
    </main>
  );
}
