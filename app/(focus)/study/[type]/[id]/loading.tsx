export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading Study Mode" className="mx-auto max-w-6xl px-4 pt-6 lg:px-8">
      <div className="skeleton h-5 w-40 rounded" /><div className="skeleton mt-4 h-9 w-3/4 rounded" />
      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_340px]"><div className="space-y-4"><div className="skeleton h-32 rounded-card" /><div className="skeleton h-40 rounded-card" /><div className="skeleton h-40 rounded-card" /></div>
        <div className="space-y-4"><div className="skeleton h-72 rounded-card" /><div className="skeleton h-28 rounded-card" /></div></div>
    </div>
  );
}
