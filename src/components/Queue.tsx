"use client";

import { useMemo, useState, useTransition } from "react";
import { MessageCard } from "./MessageCard";
import type { InboundMessage, TriageRecord } from "@/lib/schema";
import { PRIORITY_KEYS, PRIORITY_RANK, type Priority } from "@/lib/taxonomy";

type TriageMap = Record<string, TriageRecord>;

type Props = {
  messages: InboundMessage[];
  initialTriage: TriageMap;
};

export function Queue({ messages, initialTriage }: Props) {
  const [triage, setTriage] = useState<TriageMap>(initialTriage);
  const [filter, setFilter] = useState<Priority | "all">("all");
  const [busy, setBusy] = useState<Set<string> | "all" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const untriaged = messages.filter((message) => !triage[message.id]).length;

  async function run(ids: string[] | undefined, force: boolean) {
    setBusy(ids ? new Set(ids) : "all");
    setNotice(null);
    try {
      const response = await fetch("/api/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, force }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        // A setup failure (missing key, unknown provider) is surfaced once at
        // the top rather than duplicated onto every row.
        setNotice(payload.error ?? `Request failed with ${response.status}`);
        return;
      }
      startTransition(() => setTriage(payload.records));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Network error");
    } finally {
      setBusy(null);
    }
  }

  const ordered = useMemo(() => {
    const rows = messages.map((message) => ({ message, record: triage[message.id] }));
    const visible =
      filter === "all" ? rows : rows.filter(({ record }) => record?.result.priority === filter);

    return visible.sort((a, b) => {
      // Untriaged rows sink below triaged ones so the ranked queue stays intact.
      const rankA = a.record ? PRIORITY_RANK[a.record.result.priority] : 3;
      const rankB = b.record ? PRIORITY_RANK[b.record.result.priority] : 3;
      if (rankA !== rankB) return rankA - rankB;
      return a.message.received_at.localeCompare(b.message.received_at);
    });
  }, [messages, triage, filter]);

  const isBusy = (id: string) => busy === "all" || (busy instanceof Set && busy.has(id));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => run(undefined, false)}
          disabled={busy !== null || untriaged === 0}
          className="rounded bg-stone-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy === "all" ? "Triaging…" : `Triage ${untriaged} new`}
        </button>
        <button
          onClick={() => run(undefined, true)}
          disabled={busy !== null}
          className="rounded border border-stone-300 px-3 py-1.5 text-sm font-medium disabled:opacity-40"
        >
          Re-run all
        </button>

        <div className="ml-auto flex items-center gap-1 text-sm">
          <span className="mr-1 text-stone-500">Priority</span>
          {(["all", ...PRIORITY_KEYS] as const).map((value) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`rounded px-2 py-1 capitalize ${
                filter === value ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-200"
              }`}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      {notice && (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          {notice}
        </p>
      )}

      <ul className="space-y-3">
        {ordered.map(({ message, record }) => (
          <MessageCard
            key={message.id}
            message={message}
            record={record}
            busy={isBusy(message.id)}
            onRetry={() => run([message.id], true)}
          />
        ))}
      </ul>

      {ordered.length === 0 && (
        <p className="py-8 text-center text-sm text-stone-500">No messages at this priority.</p>
      )}
    </div>
  );
}
