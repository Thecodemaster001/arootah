import { CategoryBadge, ConfidenceNote, PriorityBadge } from "./Badges";
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
  return <>{name || org || <span className="italic text-stone-400">unknown sender</span>}</>;
}

export function MessageCard({ message, record, busy, onRetry }: Props) {
  const failed = record?.status === "error";
  const unprocessable = record?.status === "unprocessable";

  return (
    <li
      className={`rounded-lg border bg-white p-4 ${
        failed ? "border-red-200" : unprocessable ? "border-stone-300 bg-stone-50" : "border-stone-200"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {message.subject.trim() || <span className="italic text-stone-400">no subject</span>}
          </p>
          <p className="mt-0.5 text-xs text-stone-500">
            <Sender message={message} /> · {message.channel} ·{" "}
            <time dateTime={message.received_at}>{formatReceived(message.received_at)}</time>
          </p>
        </div>

        {record && (
          <div className="flex shrink-0 items-center gap-2">
            <CategoryBadge category={record.result.category} />
            <PriorityBadge priority={record.result.priority} />
          </div>
        )}
      </div>

      {/* readableText strips the control characters and replacement chars that
          make the corrupted item unrenderable in the browser. */}
      <p className="mt-3 line-clamp-2 text-sm text-stone-600">
        {readableText(message.body) || <span className="italic text-stone-400">empty body</span>}
      </p>

      {record ? (
        <div className="mt-3 border-t border-stone-100 pt-3">
          <p className="text-sm font-medium">{record.result.summary}</p>
          <p className="mt-1 text-sm text-stone-700">
            <span className="text-stone-500">Next:</span> {record.result.next_action}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
            <span>{record.result.rationale}</span>
            <ConfidenceNote confidence={record.result.confidence} />
          </div>

          {failed && (
            <div className="mt-3 flex items-center justify-between gap-3 rounded bg-red-50 px-3 py-2">
              <p className="min-w-0 text-xs text-red-900">
                <span className="font-medium">Triage failed:</span> {record.error}
              </p>
              <button
                onClick={onRetry}
                disabled={busy}
                className="shrink-0 rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-900 disabled:opacity-40"
              >
                {busy ? "Retrying…" : "Retry"}
              </button>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-3 border-t border-stone-100 pt-3 text-sm text-stone-400">
          {busy ? "Triaging…" : "Not triaged yet."}
        </p>
      )}
    </li>
  );
}
