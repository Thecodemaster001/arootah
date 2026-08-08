import { PRIORITIES, type Category, type Priority } from "@/lib/taxonomy";

const PRIORITY_STYLES: Record<Priority, string> = {
  high: "bg-red-100 text-red-900 ring-red-200",
  medium: "bg-amber-100 text-amber-900 ring-amber-200",
  low: "bg-stone-100 text-stone-700 ring-stone-200",
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span
      title={PRIORITIES[priority]}
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium uppercase tracking-wide ring-1 ring-inset ${PRIORITY_STYLES[priority]}`}
    >
      {priority}
    </span>
  );
}

export function CategoryBadge({ category }: { category: Category }) {
  return (
    <span className="inline-flex items-center rounded bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700 ring-1 ring-inset ring-stone-200">
      {category.replace(/_/g, " ")}
    </span>
  );
}

export function ConfidenceNote({ confidence }: { confidence: "high" | "medium" | "low" }) {
  if (confidence === "high") return null;
  return (
    <span className="text-xs text-stone-500" title="The model flagged this classification as uncertain.">
      {confidence} confidence
    </span>
  );
}
