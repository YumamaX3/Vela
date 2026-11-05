"use client";
// ToolsClient — the proxy toolbox on its own page (sealed plan §1/§3.3 ·
// `/proxy/tools`). One room for the verbs that operate on the fleet as a whole:
//
//   §3.3 ·                                                          here as:
//   1. Health sweep (all pools)      auto-disable opt-in, PROVEN-dead only       SweepCard
//   2. Per-pool probe                `[id]/probe` (egress refresh)               ProbeCard
//   3. Batch import                  `parseProxyLine` + createPool per line       ImportCard
//   4. Geo toggle                    `saveGeoToggle`                              GeoCard
//   5. Export                        `/export` (active pools), browser download  ExportCard
//   6. Deploy relay                  the shared per-platform forms               DeployCard
//   7. Pool analytics CSV      ✦ NEW analytics seam → CSV                        ExportCard
//   8. Ledger filter           ✦ NEW routing-ledger, filtered by provider        LedgerFilterCard
//
// THE LAW THAT GOVERNS THIS PAGE: a tool is a thin GESTURE over a seam that already
// exists. Nothing here re-implements the fleet, re-counts a verdict, or fans out a
// second loop — each button calls the SAME facade (`c.bulkHealth`, `c.deploy`, …) or
// the SAME route the owning shore calls. That is what keeps Tools honest: if a tool
// disagrees with Pools, the seam is wrong, not the tool. The two genuinely NEW verbs
// (analytics CSV, ledger filter) are projections over seams W2 already opened — the
// export writes a file the page has already read, and the filter scopes a ring that
// is already whole — so neither mints a new server route.
//
// THE SWEEP OFFERS ONLY PROVEN DEATH. The auto-disable switch is here because the
// plan asks for it, but it is OFF by default, it is explicit, and the three-verdict
// copy names what it will and will not touch: `autoDisable` disables only a
// DETERMINISTIC `dead`; an indeterminate pool is reported and LEFT ACTIVE through
// this control and through every other. The whole fleet once self-liquidated on the
// opposite belief.
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Modal, Select, Toggle } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";
import { useProxyFleet } from "../hooks/useProxyFleet";
import {
  fetchExportResponse,
  loadPoolAnalytics,
  loadRoutingLedger,
  parseExportPayload,
} from "../lib/proxyApi";
import { analyticsCsv, activePoolsCsv, downloadText, stamp } from "../lib/proxyCsv";
import { fmtTime, parseProxyLine, RELAY_PLATFORMS } from "../lib/proxyFormat";
import {
  canDeploy,
  DEFAULT_FORM,
  ProxyShore,
  RelayBlurb,
  RelayForm,
  SectionCard,
} from "../components";

const nf = new Intl.NumberFormat(undefined);

// ── 1 · the sweep ───────────────────────────────────────────────────────────
function SweepCard({ c, notify }) {
  const [autoDisable, setAutoDisable] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  const run = async () => {
    setRunning(true);
    try {
      const res = await c.bulkHealth({ autoDisable });
      if (res?.ok && res.body) {
        setResult(res.body);
        const dead = res.body.dead ?? 0;
        if (autoDisable && dead > 0) notify.success(`Swept: ${dead} proven-dead pool${dead === 1 ? "" : "s"} disabled.`);
        else notify.success(`Swept: ${res.body.alive ?? 0} ok, ${dead} dead, ${res.body.indeterminate ?? 0} indeterminate.`);
      } else {
        notify.error(res?.body?.error || "Health sweep failed");
      }
    } catch (err) {
      notify.error(`Health sweep failed: ${err.message}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <SectionCard
      title="Health sweep"
      icon="health_and_safety"
      description="One request to the engine, which asks every pool once and answers with three verdicts."
    >
      <div className="flex flex-col gap-3">
        <Toggle
          size="sm"
          checked={autoDisable}
          onChange={setAutoDisable}
          label="Disable proven-dead pools after the sweep"
          description="Off by default. On, only a DETERMINISTIC dead is disabled — an indeterminate pool is never touched."
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" icon="health_and_safety" loading={running} onClick={run} disabled={c.pools.length === 0}>
            {running ? "Sweeping…" : "Sweep all pools"}
          </Button>
          {c.pools.length === 0 ? <span className="text-2xs text-text-muted">No pools to sweep.</span> : null}
        </div>
        {result ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[10px] border border-border-subtle bg-surface-2/30 px-3 py-2 text-2xs">
            <span>
              <span className="tabular-nums text-green-600 dark:text-green-400">{result.alive ?? 0}</span> ok
            </span>
            <span>
              <span className="tabular-nums text-red-500">{result.dead ?? 0}</span> proven dead
            </span>
            <span>
              <span className="tabular-nums text-amber-600 dark:text-amber-400">{result.indeterminate ?? 0}</span>{" "}
              indeterminate, left active
            </span>
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}

// ── 2 · per-pool probe & test ───────────────────────────────────────────────
function ProbeCard({ c, notify }) {
  const [busy, setBusy] = useState(null); // `${kind}:${id}`
  const [outcomes, setOutcomes] = useState({}); // id → { probe?, test? }

  const runProbe = async (pool) => {
    setBusy(`probe:${pool.id}`);
    try {
      const res = await c.probeEgress(pool.id);
      const ok = res.ok;
      const ip = res.body?.geo?.ip || res.body?.ip || null;
      setOutcomes((prev) => ({ ...prev, [pool.id]: { ...prev[pool.id], probe: { ok, ip, at: Date.now() } } }));
      ok ? notify.success(`Probe: ${ip || "egress refreshed"}`) : notify.error(res.body?.error || "Egress probe failed");
    } catch (err) {
      notify.error(`Egress probe failed: ${err.message}`);
    } finally {
      setBusy(null);
    }
  };

  const runTest = async (pool) => {
    setBusy(`test:${pool.id}`);
    try {
      const res = await c.testPool(pool.id);
      const verdict = res.body?.verdict || res.body?.result?.verdict || null;
      setOutcomes((prev) => ({ ...prev, [pool.id]: { ...prev[pool.id], test: { ok: res.ok, verdict, at: Date.now() } } }));
      notify.success(`Test: ${verdict || (res.ok ? "done" : "failed")}`);
    } catch (err) {
      notify.error(`Test failed: ${err.message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <SectionCard
      title="Per-pool probe"
      icon="science"
      description="Refresh one pool's egress IP, or ask the engine to test one pool's health. Both write their verdict through the owning route."
    >
      {c.pools.length === 0 ? (
        <p className="text-xs text-text-muted">No pools to probe.</p>
      ) : (
        <div className="-mx-4 max-h-80 overflow-auto">
          <table className="w-full min-w-[420px] text-left">
            <thead>
              <tr className="sticky top-0 bg-surface text-2xs uppercase tracking-wide text-text-muted">
                <th className="px-4 py-1.5 font-medium">Pool</th>
                <th className="px-4 py-1.5 font-medium">Probe</th>
                <th className="px-4 py-1.5 font-medium">Test</th>
              </tr>
            </thead>
            <tbody>
              {c.pools.map((p) => {
                const o = outcomes[p.id] || {};
                return (
                  <tr key={p.id} className="border-b border-border-subtle last:border-0">
                    <td className="max-w-[220px] truncate px-4 py-1.5 text-xs text-text-main" title={p.name}>
                      {p.name || p.id}
                    </td>
                    <td className="px-4 py-1.5">
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="secondary" onClick={() => runProbe(p)} disabled={busy !== null}>
                          Probe
                        </Button>
                        {o.probe ? <span className="text-2xs text-text-muted">{o.probe.ip || (o.probe.ok ? "ok" : "failed")}</span> : null}
                      </div>
                    </td>
                    <td className="px-4 py-1.5">
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="secondary" onClick={() => runTest(p)} disabled={busy !== null}>
                          Test
                        </Button>
                        {o.test ? <span className="text-2xs text-text-muted">{o.test.verdict || (o.test.ok ? "done" : "failed")}</span> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

// ── 3 · batch import ────────────────────────────────────────────────────────
function ImportCard({ c, notify }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [importing, setImporting] = useState(false);

  const close = () => {
    if (!importing) setOpen(false);
  };

  const runImport = async () => {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const entries = [];
    const invalid = [];
    lines.forEach((line, index) => {
      try {
        const parsed = parseProxyLine(line);
        if (parsed) entries.push({ ...parsed, lineNumber: index + 1 });
      } catch (error) {
        invalid.push(`Line ${index + 1}: ${error.message}`);
      }
    });
    if (invalid.length > 0) {
      notify.error(`Invalid proxy format:\n${invalid.join("\n")}`);
      return;
    }
    if (entries.length === 0) {
      notify.error("Nothing to import.");
      return;
    }
    setImporting(true);
    try {
      // Duplicate detection is SERVER-SIDE (§5.4): reads are masked, so a client-side
      // Set could never match the pasted plaintext — the route answers 409 instead.
      let created = 0;
      let skipped = 0;
      let failed = 0;
      for (const entry of entries) {
        const res = await c.createPool({ name: entry.name, proxyUrl: entry.proxyUrl, noProxy: "", isActive: true });
        if (res.ok) created += 1;
        else if (res.status === 409) skipped += 1;
        else failed += 1;
      }
      setOpen(false);
      setText("");
      notify.success(`Batch import: created ${created}, skipped ${skipped}, failed ${failed}`);
    } catch {
      notify.error("Batch import failed");
    } finally {
      setImporting(false);
    }
  };

  return (
    <SectionCard
      title="Batch import"
      icon="playlist_add"
      description="Paste one proxy per line — host:port:user:pass or a full URL. Duplicates are refused by the server, not guessed here."
    >
      <Button size="sm" variant="secondary" icon="playlist_add" onClick={() => setOpen(true)}>
        Open batch import
      </Button>
      <Modal isOpen={open} onClose={close} title="Batch import proxies" size="lg">
        <div className="flex flex-col gap-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            spellCheck={false}
            aria-label="Proxy lines, one per line"
            placeholder={"host:port:user:pass\nhttp://user:pass@host:port"}
            className="w-full rounded-[10px] border border-border-subtle bg-surface-2/40 p-3 font-mono text-xs text-text-main focus:outline-2 focus:outline-offset-1 focus:outline-brand-500"
          />
          <p className="text-2xs text-text-muted">
            {text.split("\n").filter((l) => l.trim()).length} line(s). Each becomes an active pool; the import reports
            created / skipped (duplicate) / failed per the server&apos;s answer.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button fullWidth onClick={runImport} loading={importing} disabled={!text.trim()}>
              Import
            </Button>
            <Button fullWidth variant="ghost" onClick={close} disabled={importing}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </SectionCard>
  );
}

// ── 4 · geo toggle (read from the shared store) ─────────────────────────────
function GeoCard({ c, notify }) {
  const flip = async (next) => {
    // The store flips optimistically and rolls back on a refused PATCH — the card
    // only narrates the engine's answer.
    const res = await c.saveGeoToggle(next);
    if (!res.ok) notify.error(res.body?.error || "Could not change the geo probe setting");
  };
  return (
    <SectionCard title="Geo probe" icon="public" description="Probe each pool's egress IP and country every ~30 minutes. Uses the geo-API quota.">
      <Toggle size="sm" checked={c.geoEnabled} onChange={flip} label="Egress geo probe enabled" />
    </SectionCard>
  );
}

// ── 5 + 7 · exports (the fleet, and the analytics census as CSV) ────────────
function ExportCard({ c, notify }) {
  const [period, setPeriod] = useState("24h");
  const [busy, setBusy] = useState(null);

  const exportFleet = async () => {
    setBusy("fleet");
    try {
      // The export route answers a JSON body (active pools + a fitness summary).
      // Read it as a Response and refuse to write a file if the server refused.
      const res = await fetchExportResponse("/api/proxy-pools/export");
      const payload = await parseExportPayload(res);
      if (!payload.ok) {
        notify.error(payload.error || "Export failed");
        return;
      }
      const text = activePoolsCsv(payload.body?.pools || []);
      downloadText(`proxy-pools-${stamp()}.csv`, text);
      notify.success(`Exported ${payload.body?.pools?.length || 0} active pool(s)`);
    } catch (err) {
      notify.error(`Export failed: ${err.message}`);
    } finally {
      setBusy(null);
    }
  };

  const exportAnalytics = async () => {
    setBusy("analytics");
    try {
      // ✦ NEW — the analytics seam as CSV. The page reads the SAME census the Usage
      // page reads and writes it out; the file and the screen can never disagree
      // because there is one read.
      const res = await loadPoolAnalytics(period);
      if (!res.ok) {
        notify.error(res.body?.error || "Could not read the analytics census");
        return;
      }
      if (res.body?.wired === false) {
        notify.warning("The poolId seam has not landed here — the CSV would be headers only. Nothing written.");
        return;
      }
      const pools = res.body?.pools || [];
      if (pools.length === 0) {
        notify.warning("No attributed buckets in this window — nothing to write yet.");
        return;
      }
      downloadText(`proxy-analytics-${period}-${stamp()}.csv`, analyticsCsv(pools, period));
      notify.success(`Exported analytics for ${pools.length} pool(s)`);
    } catch (err) {
      notify.error(`Analytics export failed: ${err.message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <SectionCard
      title="Export"
      icon="download"
      description="Identifying fields only — id, name, type, active. No credential is ever in an export (the route's allow-list is the file's allow-list)."
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" icon="download" loading={busy === "fleet"} onClick={exportFleet} disabled={busy !== null}>
            Active pools · CSV
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3">
          <Select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            options={[
              { value: "24h", label: "Last 24 hours" },
              { value: "3d", label: "Last 3 days" },
              { value: "7d", label: "Last 7 days" },
              { value: "30d", label: "Last 30 days" },
            ]}
            selectClassName="h-7 text-xs min-w-32"
            aria-label="Analytics export period"
          />
          <Button size="sm" variant="secondary" icon="query_stats" loading={busy === "analytics"} onClick={exportAnalytics} disabled={busy !== null}>
            Pool analytics · CSV
          </Button>
          <Badge variant="info" size="sm">
            new
          </Badge>
        </div>
      </div>
    </SectionCard>
  );
}

// ── 6 · deploy relay (the shared forms) ─────────────────────────────────────
function DeployCard({ c, notify }) {
  const [openPlatform, setOpenPlatform] = useState(null);
  const [forms, setForms] = useState(DEFAULT_FORM);
  const [deploying, setDeploying] = useState(false);

  const open = (platform) => {
    setForms((prev) => ({ ...prev, [platform]: { ...DEFAULT_FORM[platform] } }));
    setOpenPlatform(platform);
  };
  const close = () => !deploying && setOpenPlatform(null);
  const setField = (platform, key, value) =>
    setForms((prev) => ({ ...prev, [platform]: { ...prev[platform], [key]: value } }));

  const deploy = async () => {
    const platform = openPlatform;
    if (!platform || !canDeploy(platform, forms[platform])) return;
    setDeploying(true);
    try {
      const res = await c.deploy(platform, forms[platform]);
      if (res.ok) {
        notify.success(`Deployed: ${res.body?.deployUrl || "relay"}`);
        setOpenPlatform(null);
      } else {
        notify.error(res.body?.error || "Deploy failed");
      }
    } catch (err) {
      notify.error(`Deploy failed: ${err.message}`);
    } finally {
      setDeploying(false);
    }
  };

  return (
    <SectionCard
      title="Deploy relay"
      icon="cloud_upload"
      description="Deploy an edge relay to Vercel, Cloudflare or Deno. The token is used once and not stored; the response carries no secret."
    >
      <div className="flex flex-wrap items-center gap-2">
        {RELAY_PLATFORMS.map((platform) => (
          <Button key={platform.id} size="sm" variant="secondary" icon={platform.icon} onClick={() => open(platform.id)}>
            {platform.label}
          </Button>
        ))}
      </div>
      {RELAY_PLATFORMS.map((platform) => (
        <Modal key={platform.id} isOpen={openPlatform === platform.id} title={`Deploy ${platform.label}`} onClose={close}>
          <div className="flex flex-col gap-4">
            <RelayBlurb platform={platform.id} />
            <RelayForm platform={platform.id} form={forms[platform.id]} setField={setField} />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button fullWidth onClick={deploy} loading={deploying} disabled={!canDeploy(platform.id, forms[platform.id])}>
                Deploy
              </Button>
              <Button fullWidth variant="ghost" onClick={close} disabled={deploying}>
                Cancel
              </Button>
            </div>
          </div>
        </Modal>
      ))}
    </SectionCard>
  );
}

// ── 8 · ledger filter ───────────────────────────────────────────────────────
function LedgerFilterCard() {
  const [state, setState] = useState({ status: "loading", routes: [], health: {} });
  const [providerId, setProviderId] = useState("all");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await loadRoutingLedger({ limit: 256 });
        if (!alive) return;
        if (res.ok) setState({ status: "ok", routes: res.body?.routes || [], health: res.body?.health || {} });
        else setState({ status: "error", routes: [], health: {} });
      } catch {
        if (alive) setState({ status: "error", routes: [], health: {} });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const providers = useMemo(() => {
    const set = new Set();
    for (const r of state.routes) if (r.providerId) set.add(r.providerId);
    return [...set].sort();
  }, [state.routes]);
  const rows = useMemo(
    () => (providerId === "all" ? state.routes : state.routes.filter((r) => r.providerId === providerId)),
    [state.routes, providerId]
  );

  return (
    <SectionCard
      title="Ledger filter"
      icon="filter_alt"
      description="Scope the routing trace to one provider. Filtering a 256-row ring is done here, not in a second fetch."
      actions={
        <Select
          value={providerId}
          onChange={(e) => setProviderId(e.target.value)}
          options={[{ value: "all", label: "All providers" }, ...providers.map((p) => ({ value: p, label: p }))]}
          selectClassName="h-7 text-xs min-w-40"
        />
      }
    >
      {state.status === "error" ? (
        <p className="text-xs text-text-muted">The ledger could not be read — a failed read, not an empty one.</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-text-muted">
          {state.status === "loading" ? "Reading the routing ring…" : providerId === "all" ? "No routes in the ring yet." : `No routes for ${providerId}.`}
        </p>
      ) : (
        <div className="-mx-4 max-h-72 overflow-auto">
          <table className="w-full min-w-[480px] text-left">
            <thead>
              <tr className="sticky top-0 bg-surface text-2xs uppercase tracking-wide text-text-muted">
                <th className="px-4 py-1.5 font-medium">When</th>
                <th className="px-4 py-1.5 font-medium">Provider</th>
                <th className="px-4 py-2 font-medium">Model</th>
                <th className="px-4 py-2 font-medium">Outcome</th>
                <th className="px-4 py-2 text-right font-medium">ms</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 80).map((r) => (
                <tr key={r.seq} className="border-b border-border-subtle last:border-0">
                  <td className="whitespace-nowrap px-4 py-1.5 text-2xs text-text-muted">{fmtTime(r.ts)}</td>
                  <td className="px-4 py-1.5 text-xs text-text-main">{r.providerId || "—"}</td>
                  <td className="max-w-[200px] truncate px-4 py-2 text-xs text-text-muted" title={r.model || ""}>
                    {r.model || "—"}
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant={r.ok ? "success" : "warning"} size="sm" dot>
                      {r.ok ? "ok" : "halt"}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-right text-2xs tabular-nums text-text-muted">{r.ms ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-2 text-2xs text-text-muted">
            Showing {Math.min(rows.length, 80)} of {nf.format(rows.length)} route(s).{" "}
            {state.routes.length > 0
              ? `Health: ${Object.entries(state.health).map(([p, h]) => `${p} ${h.score ?? "—"}%`).join(" · ")}`
              : ""}
          </p>
        </div>
      )}
    </SectionCard>
  );
}

export default function ToolsClient() {
  const c = useProxyFleet();
  const notify = useNotificationStore();

  return (
    <ProxyShore
      title="Tools"
      subtitle="The toolbox: sweep, probe, import, geo, export, deploy — each a thin gesture over a seam, never a second engine."
      icon="handyman"
      error={c.error}
      onRetry={c.reload}
    >
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <SweepCard c={c} notify={notify} />
        <GeoCard c={c} notify={notify} />
        <ProbeCard c={c} notify={notify} />
        <ImportCard c={c} notify={notify} />
        <ExportCard c={c} notify={notify} />
        <DeployCard c={c} notify={notify} />
        <LedgerFilterCard />
      </div>
    </ProxyShore>
  );
}
