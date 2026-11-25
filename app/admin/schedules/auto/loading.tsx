// Shown while the proposal is being read and calculated (Next.js loading.js convention).
export default function Loading() {
  return (
    <div role="status" aria-label="Calculating the proposal" className="animate-pulse space-y-4">
      <div className="h-7 w-64 rounded bg-zinc-200" />
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="h-20 rounded-xl border border-zinc-200 bg-white" />
        ))}
      </div>
      <div className="h-48 rounded-xl border border-zinc-200 bg-white" />
      <span className="sr-only">Calculating the proposal…</span>
    </div>
  );
}
