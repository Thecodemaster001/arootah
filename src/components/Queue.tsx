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

const FILTERS = ["all", ...PRIORITY_KEYS] as const;

/**
 * A failed row carries a placeholder "low" priority, but its real priority is
 * unknown, and it could be the urgent client complaint. It goes to the top
 * and stays out of the priority filters instead of sinking with the lows.
 */
function rankOf(record: TriageRecord | undefined): number {
  if (!record) return PRIORITY_KEYS.length;
  if (record.status === "error") return -1;
  return PRIORITY_RANK[record.result.priority];
}

function priorityOf(record: TriageRecord | undefined): Priority | null {
  return record && record.status !== "error" ? record.result.priority : null;
}

export function Queue({ messages, initialTriage }: Props) {
  const [triage, setTriage] = useState<TriageMap>(initialTriage);
  const [filter, setFilter] = useState<Priority | "all">("all");
  const [busy, setBusy] = useState<Set<string> | "all" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [, startTransition] = useTransition();

  const untriaged = messages.filter((message) => !triage[message.id]).length;

  const counts = useMemo(() => {
    const byPriority: Record<Priority | "all", number> = { all: messages.length, high: 0, medium: 0, low: 0 };
    for (const message of messages) {
      const priority = priorityOf(triage[message.id]);
      if (priority) byPriority[priority]++;
    }
    return byPriority;
  }, [messages, triage]);

  async function run(ids: string[] | undefined, force: boolean) {
    setBusy(ids ? new Set(ids) : "all");
    setNotice(null);
    setStatus(ids ? "Retrying one message…" : "Triaging…");
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
        setStatus("");
        return;
      }
      startTransition(() => setTriage(payload.records));
      setStatus(`Triaged ${payload.triaged} message${payload.triaged === 1 ? "" : "s"}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Network error");
      setStatus("");
    } finally {
      setBusy(null);
    }
  }

  const ordered = useMemo(() => {
    const rows = messages.map((message) => ({ message, record: triage[message.id] }));
    const visible =
      filter === "all" ? rows : rows.filter(({ record }) => priorityOf(record) === filter);

    return visible.sort((a, b) => {
      // Untriaged rows sink below triaged ones so the ranked queue stays intact.
      const rankA = rankOf(a.record);
      const rankB = rankOf(b.record);
      if (rankA !== rankB) return rankA - rankB;
      return a.message.received_at.localeCompare(b.message.received_at);
    });
  }, [messages, triage, filter]);

  const isBusy = (id: string) => busy === "all" || (busy instanceof Set && busy.has(id));

  if (messages.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-stone-300 px-4 py-10 text-center text-sm text-stone-600">
        The inbox is empty. Add messages to data/inbound.json to triage them.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => run(undefined, false)}
            disabled={busy !== null || untriaged === 0}
            className="rounded-md bg-ledger-700 px-4 py-2 text-sm font-semibold text-white hover:bg-ledger-800 disabled:opacity-50"
          >
            {busy === "all" ? "Triaging…" : `Triage ${untriaged} new`}
          </button>
          <button
            type="button"
            onClick={() => run(undefined, true)}
            disabled={busy !== null}
            className="rounded-md border border-stone-400 bg-white px-4 py-2 text-sm font-semibold hover:bg-stone-100 disabled:opacity-50"
          >
            Re-run all
          </button>
        </div>

        <div role="group" aria-label="Filter by priority" className="flex flex-wrap items-center gap-1 text-sm">
          <span aria-hidden="true" className="mr-1 text-stone-600">
            Priority
          </span>
          {FILTERS.map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={`rounded-md px-2.5 py-1 capitalize ${
                filter === value ? "bg-ink text-white" : "text-stone-700 hover:bg-stone-200"
              }`}
            >
              {value} <span className={filter === value ? "text-stone-300" : "text-stone-500"}>{counts[value]}</span>
            </button>
          ))}
        </div>
      </div>

      <p role="status" className="sr-only">
        {status}
      </p>

      {notice && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          {notice}
        </p>
      )}

      <ul className="space-y-3" aria-label="Triage queue">
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
        <p className="rounded-md border border-dashed border-stone-300 py-8 text-center text-sm text-stone-600">
          No messages at this priority yet.
        </p>
      )}
    </div>
  );
}
