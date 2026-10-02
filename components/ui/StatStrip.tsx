export function StatStrip({ items }: { items: { label: string; value: string; tone?: "red" | "lime" }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-4 border-y border-line py-4 sm:grid-cols-4">
      {items.map((i) => <div key={i.label}><dd className={`text-xl font-semibold tabular-nums ${i.tone === "red" ? "text-red-400" : i.tone === "lime" ? "text-lime" : ""}`}>{i.value}</dd><dt className="text-xs text-mute">{i.label}</dt></div>)}
    </dl>
  );
}
