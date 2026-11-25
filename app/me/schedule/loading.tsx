// Shown instantly while the schedule is loading (Next.js loading.js convention).
export default function Loading() {
  return (
    <div role="status" aria-label="Loading schedule" className="animate-pulse space-y-4">
      <div className="h-7 w-40 rounded bg-zinc-200" />
      <div className="grid grid-cols-2 gap-3">
        <div className="h-16 rounded-xl border border-zinc-200 bg-white" />
        <div className="h-16 rounded-xl border border-zinc-200 bg-white" />
      </div>
      <div className="h-28 rounded-xl border border-zinc-200 bg-white" />
      <span className="sr-only">Loading schedule…</span>
    </div>
  );
}
