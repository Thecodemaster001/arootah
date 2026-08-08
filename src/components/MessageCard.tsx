import { CategoryBadge, ConfidenceNote, PRIORITY_EDGE, PriorityBadge } from "./Badges";
import { normalizeOrg, readableText } from "@/lib/prescreen";
import type { InboundMessage, TriageRecord } from "@/lib/schema";

type Props = {
  message: InboundMessage;
  record?: TriageRecord;
  busy: boolean;
  onRetry: () => void;
};

// A fixed zone keeps the server render and the browser hydration identical;
// the runtime's local zone differs between the two and React flags the mismatch.
const RECEIVED_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/New_York",
  timeZoneName: "short",
});

export function formatReceived(iso: string): string {
  return RECEIVED_FORMAT.format(new Date(iso));
}

function Sender({ message }: { message: InboundMessage }) {
  const org = normalizeOrg(message.from_org);
  const name = message.from_name.trim();
  if (name && org) return <>{`${name} · ${org}`}</>;
  return <>{name || org || <span className="italic">unknown sender</span>}</>;
}

function Provenance({ record }: { record: TriageRecord }) {
  if (record.source === "prescreen") return <>Set by prescreen, no model call</>;
  if (record.source === "fallback") return <>Fallback after a failed call to {record.model}</>;
  return <>Classified by {record.model}</>;
}

export function MessageCard({ message, record, busy, onRetry }: Props) {
  const failed = record?.status === "error";
  const unprocessable = record?.status === "unprocessable";
  const edge = record && !failed ? PRIORITY_EDGE[record.result.priority] : "border-l-stone-200";

  return (
    <li
      aria-busy={busy}
      className={`rounded-md border border-l-4 p-4 shadow-sm sm:p-5 ${edge} ${
        failed ? "border-red-300 bg-white" : unprocessable ? "border-stone-300 bg-stone-50" : "border-stone-200 bg-white"
      }`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h2 className="break-words text-base font-semibold leading-snug">
            {message.subject.trim() || <span className="font-normal italic text-stone-500">No subject</span>}
          </h2>
          <p className="mt-0.5 text-xs text-stone-600">
            <Sender message={message} /> · {message.channel} ·{" "}
            <time dateTime={message.received_at}>{formatReceived(message.received_at)}</time>
          </p>
        </div>

        {record && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {failed ? (
              // The placeholder category and priority on a failed row mean nothing.
              <span className="rounded bg-red-700 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-white">
                Needs manual triage
              </span>
            ) : (
              <>
                <CategoryBadge category={record.result.category} />
                <PriorityBadge priority={record.result.priority} />
              </>
            )}
          </div>
        )}
      </div>

      {/* readableText strips the control characters and replacement chars that
          make the corrupted item unrenderable in the browser. */}
      <p className="mt-3 line-clamp-2 text-sm text-stone-700">
        {readableText(message.body) || <span className="italic text-stone-500">Empty body</span>}
      </p>

      {record ? (
        <div className="mt-4 border-t border-stone-200 pt-3">
          <p className="text-sm font-medium">{record.result.summary}</p>
          <p className="mt-1 text-sm">
            <span className="font-semibold text-ledger-700">Next step:</span> {record.result.next_action}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-600">
            <span>{record.result.rationale}</span>
            <ConfidenceNote confidence={record.result.confidence} />
          </div>
          <p className="mt-2 text-xs text-stone-500">
            <Provenance record={record} />
          </p>

          {failed && (
            <div
              role="alert"
              className="mt-3 flex flex-col gap-2 rounded bg-red-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <p className="min-w-0 break-words text-xs text-red-900">
                <span className="font-semibold">Triage failed:</span> {record.error}
              </p>
              <button
                type="button"
                onClick={onRetry}
                disabled={busy}
                className="shrink-0 self-start rounded border border-red-400 bg-white px-3 py-1 text-xs font-semibold text-red-900 hover:bg-red-100 disabled:opacity-50 sm:self-auto"
              >
                {busy ? "Retrying…" : "Retry"}
              </button>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-4 border-t border-stone-200 pt-3 text-sm text-stone-500">
          {busy ? <span className="animate-pulse">Triaging…</span> : "Not triaged yet."}
        </p>
      )}
    </li>
  );
}
