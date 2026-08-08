import { Queue } from "@/components/Queue";
import { loadInbound, loadTriage } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [messages, triage] = await Promise.all([loadInbound(), loadTriage()]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Inbound Triage</h1>
        <p className="mt-1 text-sm text-stone-600">
          Northwind Advisors shared inbox — {messages.length} messages
        </p>
      </header>
      <Queue messages={messages} initialTriage={triage} />
    </main>
  );
}
