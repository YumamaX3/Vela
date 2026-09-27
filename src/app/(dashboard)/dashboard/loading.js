// Dashboard group loading skeleton (v1.0.30 "The Beacon Shore").
//
// Server-component loading file: Next streams this while a segment's data
// resolves. It mirrors the room body's grid shape so the skeleton lands where
// the content will — no layout jump when the real cards arrive. The masthead
// is NOT faked: the page's own PageShell renders with its content, so a
// skeleton masthead would double the headings during the pause.
export default function DashboardLoading() {
  return (
    <div className="w-full" aria-busy="true">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="animate-pulse rounded-[14px] border border-border-subtle bg-surface shadow-[var(--shadow-soft)] p-6"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="h-4 w-24 rounded bg-surface-2" />
              <div className="size-10 rounded-[10px] bg-surface-2" />
            </div>
            <div className="h-8 w-16 rounded bg-surface-2 mb-2" />
            <div className="h-3 w-20 rounded bg-surface-2" />
          </div>
        ))}
      </div>
    </div>
  );
}
