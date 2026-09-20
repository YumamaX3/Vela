"use client";
// EgressTab — the per-pool egress ledger (NEW; this lens did not exist before).
//
// The Fleet tab showed a single line of egress under a pool row and the Fitness tab
// showed egress only where a block existed — so a pool's egress IP, its country, and
// whether that egress is FLAPPING were facts you could only see by looking at two
// other surfaces. This lens is the one place where egress is the subject: one row per
// pool, its current IP and country, how many distinct IPs have been observed (the
// flapping signal, which matters most for serverless relays whose egress varies per
// colo), the history of prior IPs, and a Probe button to refresh on demand.
//
// Everything here reads the shared poolGeo registry through the controller. The lens
// never invents a number: a pool with no observation yet reads "no probe yet", and a
// probe that fails says so rather than rendering a stale or zero IP.
import { useMemo, useState } from "react";
import { Badge, Button, Card, CardSkeleton, Input } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";
import { formatDateTime, maskProxyUrl } from "../lib/proxyFormat";

function EgressRow({ pool, geo, probing, onProbe }) {
  const history = Array.isArray(geo?.ipHistory) ? geo.ipHistory : [];
  return (
    <tr className="border-b border-border-subtle align-top last:border-0 hover:bg-surface-2/40">
      <td className="px-4 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-medium text-text-main">{pool.name}</span>
          <code className="truncate font-mono text-[11px] text-text-muted">{maskProxyUrl(pool.proxyUrl)}</code>
        </div>
      </td>
      <td className="px-4 py-3">
        {geo ? (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="font-mono text-xs text-text-main">{geo.ip}</span>
            {geo.city || geo.region ? (
              <span className="text-[11px] text-text-muted">
                {[geo.city, geo.region].filter(Boolean).join(", ")}
              </span>
            ) : null}
            {geo.org ? <span className="truncate text-[11px] text-text-muted">{geo.org}</span> : null}
          </div>
        ) : (
          <span className="text-xs text-text-muted">no probe yet</span>
        )}
      </td>
      <td className="px-4 py-3">
        {geo?.country ? <Badge variant="default" size="sm">{geo.country}</Badge> : <span className="text-xs text-text-muted">n/a</span>}
      </td>
      <td className="px-4 py-3">
        {geo ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-text-muted">
              <span className="tabular-nums text-text-main">{geo.ipCount ?? 1}</span> distinct IP
              {(geo.ipCount ?? 1) === 1 ? "" : "s"}
            </span>
            {geo.isUnstable ? (
              <Badge variant="warning" size="sm" title="Serverless relays typically egress from a different colo each time">
                flapping
              </Badge>
            ) : (
              <Badge variant="success" size="sm">stable</Badge>
            )}
          </div>
        ) : (
          <span className="text-xs text-text-muted">n/a</span>
        )}
      </td>
      <td className="px-4 py-3">
        {history.length === 0 ? (
          <span className="text-xs text-text-muted">n/a</span>
        ) : (
          <div className="flex max-w-[16rem] flex-col gap-0.5">
            {history
              .slice()
              .reverse()
              .slice(0, 4)
              .map((h) => (
                <span key={`${h.ip}-${h.ts}`} className="flex items-center gap-1.5 text-[11px] text-text-muted">
                  <span className="material-symbols-outlined text-[12px]">history</span>
                  <span className="font-mono">{h.ip}</span>
                  <span className="opacity-70">{formatDateTime(h.ts)}</span>
                </span>
              ))}
            {history.length > 4 ? (
              <span className="text-[10px] text-text-muted">+{history.length - 4} earlier</span>
            ) : null}
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-text-muted">{geo ? formatDateTime(geo.ts) : "n/a"}</td>
      <td className="px-4 py-3">
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={onProbe} disabled={probing} title="Probe egress now">
            {probing ? "Probing…" : "Probe"}
          </Button>
        </div>
      </td>
    </tr>
  );
}

export default function EgressTab({ c }) {
  const notify = useNotificationStore();
  const [search, setSearch] = useState("");
  const [probingId, setProbingId] = useState(null);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return c.pools.filter((pool) => {
      if (!q) return true;
      const geo = c.geo[pool.id];
      const hay = [pool.name, pool.proxyUrl, geo?.ip, geo?.country].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [c.pools, c.geo, search]);

  const observed = useMemo(() => Object.keys(c.geo).length, [c.geo]);
  const flapping = useMemo(
    () => Object.values(c.geo).filter((g) => g?.isUnstable).length,
    [c.geo]
  );

  const handleProbe = async (poolId) => {
    setProbingId(poolId);
    try {
      const res = await c.probeEgress(poolId);
      if (!res.ok) {
        // The probe route returns {ok:false, error} on failure; surface the reason
        // rather than rendering an unchanged row that looks like success.
        notify.error(res.body?.error || "Egress probe failed");
        return;
      }
      notify.success(`Egress probed: ${res.body?.ip || "no IP returned"}`);
    } catch (err) {
      notify.error(`Egress probe failed: ${err.message}`);
    } finally {
      setProbingId(null);
    }
  };

  if (c.loading) return <CardSkeleton />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-text-main">Egress ledger</h2>
          <Badge variant="default" size="sm">{c.pools.length} pools</Badge>
          <Badge variant="default" size="sm">{observed} observed</Badge>
          {flapping > 0 && (
            <Badge variant="warning" size="sm" title="Pools whose egress IP changes between probes">
              {flapping} flapping
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ToggleOffNote enabled={c.geoEnabled} />
          <Button variant="secondary" size="sm" icon="refresh" onClick={c.reload}>
            Refresh
          </Button>
        </div>
      </div>
      <p className="text-sm text-text-muted">
        Where each pool&apos;s traffic leaves from. The background probe refreshes this every ~30
        minutes when the Geo probe toggle is on; <strong>Probe</strong> refreshes one pool now.
        Flapping is normal for serverless relays: it means the egress IP changes between probes.
      </p>

      {!c.geoEnabled && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          The geo probe is off, so this ledger will not refresh on its own. Turn it on in the
          Fitness tab, or use <strong>Probe</strong> for a one-off reading.
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border-subtle bg-surface p-3">
        <div className="flex min-w-48 flex-1 flex-col">
          <label className="mb-1 text-xs font-medium text-text-muted">IP / Country / Pool</label>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. 104.28, NL, vercel-relay…" />
        </div>
      </div>

      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-left text-xs uppercase tracking-wider text-text-muted">
                <th className="px-4 py-2 font-semibold">Pool</th>
                <th className="px-4 py-2 font-semibold">Egress IP</th>
                <th className="px-4 py-2 font-semibold">Country</th>
                <th className="px-4 py-2 font-semibold">Stability</th>
                <th className="px-4 py-2 font-semibold">IP history</th>
                <th className="px-4 py-2 font-semibold">Last probed</th>
                <th className="px-4 py-2 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-text-muted">
                    {c.pools.length === 0 ? "No proxy pools yet." : "No pools match the current filters."}
                  </td>
                </tr>
              ) : (
                rows.map((pool) => (
                  <EgressRow
                    key={pool.id}
                    pool={pool}
                    geo={c.geo[pool.id]}
                    probing={probingId === pool.id}
                    onProbe={() => handleProbe(pool.id)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function ToggleOffNote({ enabled }) {
  return (
    <Badge variant={enabled ? "success" : "warning"} size="sm" title="Controlled from the Fitness tab">
      geo probe {enabled ? "on" : "off"}
    </Badge>
  );
}
