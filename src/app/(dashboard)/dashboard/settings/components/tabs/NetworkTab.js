"use client";
// Network — the egress path this gateway takes to the internet.
//
// Every string here is the old room's, verbatim: "Proxy settings applied",
// "Proxy enabled"/"Proxy disabled", "Please enter a Proxy URL to test", and the
// test line's exact `${status} in ${elapsedMs}ms` shape. Those are the sentences
// an operator has learned to grep for in a support thread.
//
// One row is new: a pointer to /dashboard/proxy. Pool management, rotation and
// the fitness ledger live there, and the old room said nothing about it — so an
// operator tuning a single outbound URL never learned the fleet existed.
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Button, Card, Input, Toggle } from "@/shared/components";
import { testProxy } from "../../lib/settingsApi";
import StatusLine from "../StatusLine";
import SettingRow from "../SettingRow";

export default function NetworkTab({ deck }) {
  const { settings, loading, pending, patch } = deck;
  const enabled = settings.outboundProxyEnabled === true;
  const busy = loading || !!pending.outboundProxyEnabled;

  const [url, setUrl] = useState("");
  const [noProxy, setNoProxy] = useState("");
  const [status, setStatus] = useState({ type: "", message: "" });
  const [testing, setTesting] = useState(false);

  // Hydrate ONCE, from the first loaded settings. Without this the form renders
  // empty and Apply writes that emptiness back — so an operator who opened this
  // lens merely to *look* at the stored proxy URL would erase it, and the Test
  // button would refuse with "Please enter a Proxy URL to test" for a URL that
  // is already saved. The `hydrated` ref is what makes it once-only: `deck`
  // replaces `settings` on every successful patch, so an effect keyed on it
  // alone would overwrite whatever the operator is typing the moment any other
  // row in the room saves.
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current || loading) return;
    hydrated.current = true;
    setUrl(settings?.outboundProxyUrl || "");
    setNoProxy(settings?.outboundNoProxy || "");
  }, [loading, settings]);

  const toggle = async (next) => {
    setStatus({ type: "", message: "" });
    const r = await patch({ outboundProxyEnabled: next }, ["outboundProxyEnabled"]);
    setStatus(
      r.ok
        ? { type: "success", message: next ? "Proxy enabled" : "Proxy disabled" }
        : { type: "error", message: r.error }
    );
  };

  const apply = async (e) => {
    e.preventDefault();
    if (!enabled) return;
    setStatus({ type: "", message: "" });
    const r = await patch({ outboundProxyUrl: url, outboundNoProxy: noProxy }, [
      "outboundProxyUrl",
      "outboundNoProxy",
    ]);
    setStatus(
      r.ok
        ? { type: "success", message: "Proxy settings applied" }
        : { type: "error", message: r.error }
    );
  };

  const runTest = async () => {
    if (!enabled) return;
    const proxyUrl = (url || "").trim();
    if (!proxyUrl) {
      setStatus({ type: "error", message: "Please enter a Proxy URL to test" });
      return;
    }
    setTesting(true);
    setStatus({ type: "", message: "" });
    try {
      const data = await testProxy(proxyUrl);
      setStatus({ type: "success", message: `Proxy test OK (${data.status}) in ${data.elapsedMs}ms` });
    } catch (err) {
      setStatus({ type: "error", message: err.message || "Proxy test failed" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card>
      <div className="flex items-start gap-3 mb-4">
        <div className="p-2 rounded-[10px] bg-brand-500/10 text-brand-500 shrink-0">
          <span className="material-symbols-outlined text-[20px] leading-none">wifi</span>
        </div>
        <div>
          <h3 className="text-text-main font-semibold">Outbound proxy</h3>
          <p className="text-sm text-text-muted mt-0.5">
            The path upstream requests take when leaving this machine.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <SettingRow
          label="Enable outbound proxy"
          description="Enable proxy for OAuth and provider outbound requests."
          control={<Toggle checked={enabled} onChange={() => toggle(!enabled)} disabled={busy} />}
        />

        {enabled && (
          <form onSubmit={apply} className="flex flex-col gap-4 pt-4 border-t border-border-subtle">
            <div>
              <label className="font-medium text-sm text-text-main">Proxy URL</label>
              <Input
                placeholder="http://127.0.0.1:7897"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={busy}
                className="mt-2"
              />
              <p className="text-sm text-text-muted mt-1.5">
                Leave empty to inherit the existing environment proxy, if any.
              </p>
            </div>

            <div className="pt-4 border-t border-border-subtle">
              <label className="font-medium text-sm text-text-main">No proxy</label>
              <Input
                placeholder="localhost,127.0.0.1"
                value={noProxy}
                onChange={(e) => setNoProxy(e.target.value)}
                disabled={busy}
                className="mt-2"
              />
              <p className="text-sm text-text-muted mt-1.5">
                Comma-separated hostnames and domains to bypass the proxy.
              </p>
            </div>

            <div className="pt-4 border-t border-border-subtle flex flex-col sm:flex-row gap-2">
              <Button
                type="button"
                variant="secondary"
                loading={testing}
                disabled={busy}
                onClick={runTest}
                className="w-full sm:w-auto"
              >
                Test proxy URL
              </Button>
              <Button type="submit" variant="primary" loading={!!pending.outboundProxyUrl} className="w-full sm:w-auto">
                Apply
              </Button>
            </div>
          </form>
        )}

        <StatusLine status={status} />

        <div className="pt-4 border-t border-border-subtle flex items-center justify-between gap-4 flex-wrap">
          <p className="text-sm text-text-muted">
            Rotating pools, relay deployments and the block ledger live in their own room.
          </p>
          <Link href="/dashboard/proxy" className="text-sm font-medium text-brand-500 hover:underline shrink-0">
            Open Proxy console
          </Link>
        </div>
      </div>
    </Card>
  );
}
