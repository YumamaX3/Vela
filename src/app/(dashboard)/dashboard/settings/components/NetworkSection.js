"use client";

import { useState, useEffect, useRef } from "react";
import SettingsSection, { SettingsRow } from "./SettingsSection";
import { Toggle, Button, Input } from "@/shared/components";

export default function NetworkSection({ settings, loading, patch, toggle, setString, setNumber }) {
  // Hooks must be declared unconditionally — the early return below is a
  // runtime guard, not a hook boundary. (react-hooks/rules-of-hooks)
  const [proxyUrl, setProxyUrl] = useState("");
  const [noProxy, setNoProxy] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ type: "", message: "" });
  const [testing, setTesting] = useState(false);
  const seeded = useRef(false);

  // Settings arrive async — seed the form exactly once so an Apply after a
  // partial edit never overwrites a configured proxy with "" (data loss).
  useEffect(() => {
    if (settings && !seeded.current) {
      seeded.current = true;
      setProxyUrl(settings.outboundProxyUrl || "");
      setNoProxy(settings.outboundNoProxy || "");
    }
  }, [settings]);

  if (!settings) return null;

  const apply = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg({ type: "", message: "" });
    try {
      const res = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outboundProxyUrl: proxyUrl, outboundNoProxy: noProxy }) });
      const data = await res.json().catch(() => ({}));
      setMsg(res.ok ? { type: "success", message: "Applied" } : { type: "error", message: data.error || "Failed" });
    } catch { setMsg({ type: "error", message: "An error occurred" }); }
    setBusy(false);
  };

  const testProxy = async () => {
    if (!proxyUrl.trim()) { setMsg({ type: "error", message: "Enter a proxy URL to test" }); return; }
    setTesting(true); setMsg({ type: "", message: "" });
    try {
      const res = await fetch("/api/settings/proxy-test", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proxyUrl: proxyUrl.trim() }) });
      const data = await res.json().catch(() => ({}));
      setMsg(res.ok && data?.ok ? { type: "success", message: `OK (${data.status}) in ${data.elapsedMs}ms` }
        : { type: "error", message: data?.error || "Test failed" });
    } catch { setMsg({ type: "error", message: "An error occurred" }); }
    setTesting(false);
  };

  const px = settings.outboundProxyEnabled === true;

  return (
    <SettingsSection icon="wifi" title="Network" accent="purple">
      <div className="flex flex-col gap-4">
        <SettingsRow label="Outbound Proxy" desc="Proxy OAuth + provider outbound requests">
          <Toggle checked={px} onChange={() => toggle("outboundProxyEnabled")} disabled={loading} />
        </SettingsRow>

        {px && (
          <form onSubmit={apply} className="flex flex-col gap-3 pt-1 border-t border-border/50">
            <div>
              <label className="text-xs font-medium block mb-1">Proxy URL</label>
              <Input placeholder="http://127.0.0.1:7897" value={proxyUrl} onChange={(e) => setProxyUrl(e.target.value)} disabled={loading} />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1">No Proxy</label>
              <Input placeholder="localhost,127.0.0.1" value={noProxy} onChange={(e) => setNoProxy(e.target.value)} disabled={loading} />
              <p className="text-xs text-text-muted mt-1">Comma-separated hosts to bypass the proxy</p>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" loading={testing} onClick={testProxy} size="sm">Test</Button>
              <Button type="submit" variant="primary" loading={busy} size="sm">Apply</Button>
            </div>
          </form>
        )}

        {msg.message && <p className={`text-xs ${msg.type === "error" ? "text-red-500" : "text-green-500"}`}>{msg.message}</p>}

        <hr className="border-border/50" />

        <SettingsRow label="Request timeout" desc="Max seconds a provider request may take">
          <Input type="number" min="5" max="3600" value={settings.requestTimeoutSecs ?? 120}
            onChange={(e) => setNumber("requestTimeoutSecs", e.target.value)} disabled={loading} className="w-20 text-center" />
        </SettingsRow>

        <SettingsRow label="Connect timeout" desc="Max seconds to establish the TCP connection">
          <Input type="number" min="1" max="120" value={settings.connectTimeoutSecs ?? 10}
            onChange={(e) => setNumber("connectTimeoutSecs", e.target.value)} disabled={loading} className="w-20 text-center" />
        </SettingsRow>

        <SettingsRow label="Keep-alive pool" desc="Reuse HTTP connections across requests">
          <Toggle checked={settings.keepAlivePool !== false} onChange={() => toggle("keepAlivePool")} disabled={loading} />
        </SettingsRow>

        <SettingsRow label="DNS prefetch" desc="Pre-resolve provider hostnames">
          <Toggle checked={settings.dnsPrefetch !== false} onChange={() => toggle("dnsPrefetch")} disabled={loading} />
        </SettingsRow>

        <SettingsRow label="Pool geo probe" desc="Detect egress IP / country per proxy pool">
          <Toggle checked={settings.poolGeoProbe !== false} onChange={() => toggle("poolGeoProbe")} disabled={loading} />
        </SettingsRow>

        {settings.poolGeoProbe !== false && (
          <div>
            <label className="text-xs font-medium block mb-1">Geo-probe URL</label>
            <Input value={settings.poolGeoProbeUrl || "https://ipinfo.io/json"}
              onChange={(e) => setString("poolGeoProbeUrl", e.target.value)} disabled={loading} />
          </div>
        )}
      </div>
    </SettingsSection>
  );
}