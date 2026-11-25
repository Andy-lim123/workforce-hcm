// Shown instantly while a week is loading (Next.js loading.js convention).
export default function Loading() {
  return (
    <div role="status" aria-label="Loading schedule" className="animate-pulse space-y-4">
      <div className="h-7 w-40 rounded bg-zinc-200" />
      <div className="h-10 w-full max-w-xl rounded bg-zinc-200" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="h-48 rounded-xl border border-zinc-200 bg-white" />
        ))}
      </div>
      <span className="sr-only">Loading schedule…</span>
    </div>
  );
}
