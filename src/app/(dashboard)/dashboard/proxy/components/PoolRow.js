"use client";
// PoolRow — the shared row primitive (§3.1: "shared row primitive (fleet +
// relay + usage)").
//
// Fleet, Relay and Usage each show a pool as a row, and each grew its own idea
// of which cell is the name, which is the masked URL, and which is the verdict.
// Three projections of one pool is three chances to show a URL unmasked in one
// of them — the exact failure §5.4 exists to prevent. So the row's IDENTITY
// cell lives here: name on top, the masked URL beneath, the verdict badge beside
// the name. A shore then hands it the cells that are ITS subject (requests, cost,
// platform) and never re-renders the identity.
//
// The row is a `<tr>` because every caller is a table; a card-shaped surface
// that needs the same identity should compose `PoolIdentity` directly, which is
// why that is exported on its own.
import { maskProxyUrl } from "../lib/proxyFormat";
import { PoolVerdictBadge } from "./HealthVerdict";

/** The identity block: name + verdict, masked URL beneath. Never a raw URL. */
export function PoolIdentity({ pool, href = null }) {
  if (!pool) {
    return <span className="text-xs text-text-muted">unknown pool</span>;
  }
  const label = pool.name || pool.id || "pool";
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {href ? (
          <a
            href={href}
            className="truncate text-sm font-medium text-text-main underline decoration-dotted underline-offset-2 hover:text-brand-500"
          >
            {label}
          </a>
        ) : (
          <span className="truncate text-sm font-medium text-text-main">{label}</span>
        )}
        <PoolVerdictBadge pool={pool} />
        {pool.isActive === false ? <span className="text-2xs text-text-muted">disabled</span> : null}
      </div>
      {pool.proxyUrl ? (
        <code className="truncate font-mono text-2xs text-text-muted">{maskProxyUrl(pool.proxyUrl)}</code>
      ) : pool.id ? (
        <code className="truncate font-mono text-2xs text-text-muted">#{pool.id}</code>
      ) : null}
    </div>
  );
}

/** A full table row whose first cell is the pool's identity. `children` are
 *  the shore's own cells, rendered in order after it. */
export default function PoolRow({ pool, poolHref = null, children, className = "" }) {
  return (
    <tr className={`border-b border-border-subtle align-top last:border-0 hover:bg-surface-2/40 ${className}`}>
      <td className="px-4 py-3">
        <PoolIdentity pool={pool} href={poolHref} />
      </td>
      {children}
    </tr>
  );
}
