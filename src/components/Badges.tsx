import { CATEGORIES, PRIORITIES, type Category, type Priority } from "@/lib/taxonomy";

const PRIORITY_STYLES: Record<Priority, string> = {
  high: "bg-red-50 text-red-800 ring-red-300",
  medium: "bg-amber-50 text-amber-900 ring-amber-300",
  low: "bg-stone-100 text-stone-700 ring-stone-300",
};

export const PRIORITY_EDGE: Record<Priority, string> = {
  high: "border-l-red-700",
  medium: "border-l-amber-500",
  low: "border-l-stone-300",
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span
      title={PRIORITIES[priority]}
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ring-1 ring-inset ${PRIORITY_STYLES[priority]}`}
    >
      <span className="sr-only">Priority: </span>
      {priority}
    </span>
  );
}

export function CategoryBadge({ category }: { category: Category }) {
  return (
    <span
      title={CATEGORIES[category]}
      className="inline-flex items-center rounded bg-white px-2 py-0.5 text-xs font-medium text-stone-700 ring-1 ring-inset ring-stone-300"
    >
      <span className="sr-only">Category: </span>
      {category.replace(/_/g, " ")}
    </span>
  );
}

export function ConfidenceNote({ confidence }: { confidence: "high" | "medium" | "low" }) {
  if (confidence === "high") return null;
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-medium ${
        confidence === "low" ? "bg-amber-100 text-amber-950" : "text-stone-600"
      }`}
      title="The model flagged this classification as uncertain. Review it regardless of priority."
    >
      {confidence} confidence
    </span>
  );
}
