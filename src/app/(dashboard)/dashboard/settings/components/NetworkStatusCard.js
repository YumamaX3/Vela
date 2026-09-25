"use client";
// NetworkStatusCard — the live truth the engine always held, finally shown.
//
// One read (`/api/network/status`) carries four surfaces the harbor computes
// but never displayed:
//   • Egress identities — what IP each proxy pool actually leaves from, with
//     the flapping classification (≥2 distinct IPs = an unstable egress).
//   • Upstream health — the circuit breaker's states (healthy / cooldown /
//     exhausted) plus each pool's persisted EWMA (latency + success).
//   • Rate limits — each key's sliding-60s window (cap / used / remaining) and
//     its CIDR allowlist.
// Nothing here mutates; it observes.
import { useCallback, useEffect, useState } from "react";
import { Card, Button, Badge } from "@/shared/components";
import { fetchNetworkStatus } from "../lib/settingsApi";

function Section({ title, hint, children }) {
  return (
    <div className="pt-4 border-t border-border-subtle first:pt-0 first:border-t-0">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h4 className="text-sm font-semibold text-text-main">{title}</h4>
        {hint && <span className="text-xs text-text-muted">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

const STATE_VARIANT = { healthy: "success", cooldown: "warning", exhausted: "error" };

function fmtWhen(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "—";
  }
}

export default function NetworkStatusCard({ refreshKey = 0 }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const body = await fetchNetworkStatus();
      setData(body);
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load network status");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, refreshKey]);

  const refresh = async () => {
    setLoading(true);
    try {
      await load();
    } finally {
      setLoading(false);
    }
  };

  const egress = data?.egress;
  const upstream = data?.upstream;
  const rate = data?.rateLimits;

  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-brand-500/10 text-brand-500 shrink-0">
          <span className="material-symbols-outlined text-[20px]">monitoring</span>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base sm:text-lg font-semibold">Live network state</h3>
          <p className="text-xs text-text-muted">Egress identity, upstream breaker, and rate windows — read straight from the running engines.</p>
        </div>
        <Button variant="ghost" size="sm" icon="refresh" loading={loading} onClick={refresh} className="shrink-0">
          Refresh
        </Button>
      </div>

      {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

      <div className="flex flex-col gap-4">
        <Section title="Egress identity" hint={egress?.observedCount != null ? `${egress.observedCount} observed · ${egress.flappingCount} flapping` : null}>
          {egress?.entries?.length ? (
            <div className="flex flex-col gap-2">
              {egress.entries.map((e) => (
                <div key={e.poolId} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-text-main truncate">{e.ip || "—"}</span>
                  <span className="text-xs text-text-muted truncate">
                    {[e.city, e.country, e.org].filter(Boolean).join(" · ") || "—"}
                  </span>
                  {e.isUnstable
                    ? <Badge variant="warning">flapping ({e.ipCount})</Badge>
                    : <Badge variant="success">stable</Badge>}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-muted">No egress observed yet. Run the Doctor above, or enable the geo probe in the Proxy console.</p>
          )}
        </Section>

        <Section title="Upstream breaker" hint={upstream ? `${upstream.openCount} open · ${upstream.healthyCount} healthy` : null}>
          {upstream?.breaker?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-text-muted">
                  <tr className="text-left">
                    <th className="py-1 pr-3 font-medium">Pool</th>
                    <th className="py-1 pr-3 font-medium">Provider</th>
                    <th className="py-1 pr-3 font-medium">Model</th>
                    <th className="py-1 pr-3 font-medium">State</th>
                    <th className="py-1 pr-3 font-medium">Fails</th>
                    <th className="py-1 font-medium">Cooldown until</th>
                  </tr>
                </thead>
                <tbody>
                  {upstream.breaker.map((b, i) => (
                    <tr key={`${b.poolId}-${b.providerId}-${b.model}-${i}`} className="border-t border-border-subtle">
                      <td className="py-1.5 pr-3 text-text-main truncate max-w-[120px]">{b.poolId}</td>
                      <td className="py-1.5 pr-3 text-text-muted truncate max-w-[120px]">{b.providerId || "—"}</td>
                      <td className="py-1.5 pr-3 text-text-muted truncate max-w-[120px]">{b.model || "—"}</td>
                      <td className="py-1.5 pr-3">
                        <Badge variant={STATE_VARIANT[b.state] || "default"}>{b.state}</Badge>
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums">{b.failureCount ?? 0}</td>
                      <td className="py-1.5 text-text-muted tabular-nums">{b.cooldownUntil ? fmtWhen(new Date(b.cooldownUntil).toISOString()) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-text-muted">No breaker state — nothing is in cooldown, or no pool has failed recently.</p>
          )}
        </Section>

        <Section title="Pool fitness (EWMA)" hint={upstream?.pools?.length ? `${upstream.pools.length} pools` : null}>
          {upstream?.pools?.length ? (
            <div className="flex flex-col gap-2">
              {upstream.pools.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-text-main truncate">{p.name}{!p.isActive && <span className="text-text-muted"> · inactive</span>}</span>
                  <span className="text-xs text-text-muted tabular-nums shrink-0">
                    {p.latencyEwmaMs != null ? `${Math.round(p.latencyEwmaMs)}ms` : "—"}
                    {" · "}
                    {p.successEwma != null ? `${Math.round(p.successEwma * 100)}% ok` : "—"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-muted">No proxy pools configured.</p>
          )}
        </Section>

        <Section title="Rate limits & allowlists" hint={rate ? `${rate.limited} limited` : null}>
          {rate?.keys?.length ? (
            <div className="flex flex-col gap-2">
              {rate.keys.map((k) => (
                <div key={k.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-text-main truncate">
                    {k.name}
                    {k.ipRestricted && <Badge variant="info" className="ml-2">{k.ipAllowlist.length} CIDR</Badge>}
                  </span>
                  <span className="text-xs text-text-muted tabular-nums shrink-0">
                    {k.cap ? `${k.used}/${k.cap} rpm${k.remaining === 0 ? " · at limit" : ""}` : "unlimited"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-muted">No API keys, or none rate-limited.</p>
          )}
        </Section>
      </div>
    </Card>
  );
}
