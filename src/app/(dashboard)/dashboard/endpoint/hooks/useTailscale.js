"use client";
// useTailscale — the Tailscale/Funnel domain, lifted out of the endpoint
// controller whole.
//
// WHY IT EXISTS (R-31, the reason written down): the room's controller had grown
// to a thousand lines holding keys, settings, Cloudflare Tunnel, Tailscale
// install/connect/funnel, and every modal's draft — five unrelated machines in
// one hook, where a change to the funnel login loop re-rendered the key fleet.
// This is the largest cohesive block lifted out: everything about Tailscale
// (its state, its SSE install stream, its login poll, its funnel enable, its
// reachability debounce) now lives beside itself.
//
// COMPOSITION, NOT FRAGMENTATION: the controller calls `useTailscale()` and
// spreads the result into its own return, so every view reads the SAME flat
// names it always did (`tsEnabled`, `handleConnectTailscale`, …). Nothing was
// renamed and no expression rewritten — only its address changed. The one new
// seam is `applyTailscaleStatus`, which the room's status poll calls instead of
// reaching into Tailscale's refs from outside.
import { useEffect, useRef, useState } from "react";
import { clientPingUrl } from "../lib/ping";
import {
  TUNNEL_PING_INTERVAL_MS,
  TUNNEL_PING_MAX_MS,
  REACHABLE_MISS_THRESHOLD,
} from "../lib/constants";

export default function useTailscale() {
  const [tsEnabled, setTsEnabled] = useState(false);
  const [tsReachable, setTsReachable] = useState(false);
  const [tsUrl, setTsUrl] = useState("");
  const [tsLoading, setTsLoading] = useState(false);
  const [tsProgress, setTsProgress] = useState("");
  const [tsStatus, setTsStatus] = useState(null);
  const [tsAuthUrl, setTsAuthUrl] = useState("");
  const [tsAuthLabel, setTsAuthLabel] = useState("");
  const [tsInstalled, setTsInstalled] = useState(null); // null=checking, true/false
  const [tsInstalling, setTsInstalling] = useState(false);
  const [tsInstallLog, setTsInstallLog] = useState([]);
  const [tsSudoPassword, setTsSudoPassword] = useState("");
  const [tsConnecting, setTsConnecting] = useState(false);
  const [showTsModal, setShowTsModal] = useState(false);
  const [showDisableTsModal, setShowDisableTsModal] = useState(false);
  const [tsEverReachable, setTsEverReachable] = useState(false);
  const tsLogRef = useRef(null);
  // Debounce reachable=false: the server may briefly return false during a
  // background refresh. Only flip the UI to "reconnecting" after N misses.
  const tsMissRef = useRef(0);
  // Browser-side reachable cache (independent of backend DNS quirks).
  const tsClientReachableRef = useRef(false);
  // Whether reachable=true was ever observed this session — distinguishes
  // "Checking..." (cold) from "Reconnecting..." (lost).
  const tsEverReachableRef = useRef(false);

  // Auto-scroll the install log as lines arrive.
  useEffect(() => {
    if (tsLogRef.current) tsLogRef.current.scrollTop = tsLogRef.current.scrollHeight;
  }, [tsInstallLog]);

  const requestUserAuth = (url, label) => {
    setTsAuthUrl(url);
    setTsAuthLabel(label);
  };
  const clearUserAuth = () => {
    setTsAuthUrl("");
    setTsAuthLabel("");
  };

  // Ping Tailscale health until reachable.
  const pingTsHealth = async (url) => {
    setTsProgress("Waiting for Tailscale ready...");
    const healthUrl = `${url}/api/health`;
    const start = Date.now();
    while (Date.now() - start < TUNNEL_PING_MAX_MS) {
      await new Promise((r) => setTimeout(r, TUNNEL_PING_INTERVAL_MS));
      try {
        const ping = await fetch(healthUrl, { mode: "no-cors", cache: "no-store" });
        if (ping.ok || ping.type === "opaque") return true;
      } catch { /* not ready yet */ }
    }
    return false;
  };

  const checkTailscaleInstalled = async () => {
    setTsInstalled(null);
    try {
      const res = await fetch("/api/tunnel/tailscale-check");
      if (res.ok) {
        const data = await res.json();
        setTsInstalled(data.installed);
        return data;
      }
    } catch { /* ignore */ }
    setTsInstalled(false);
    return { installed: false };
  };

  const handleInstallTailscale = async () => {
    setTsInstalling(true);
    setTsStatus(null);
    setTsInstallLog([]);
    try {
      const res = await fetch("/api/tunnel/tailscale-install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sudoPassword: tsSudoPassword }),
      });
      setTsSudoPassword("");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        for (const part of parts) {
          const lines = part.split("\n");
          let event = "progress";
          let data = null;
          for (const line of lines) {
            if (line.startsWith("event: ")) event = line.slice(7).trim();
            if (line.startsWith("data: ")) {
              try { data = JSON.parse(line.slice(6)); } catch { /* skip */ }
            }
          }
          if (!data) continue;
          if (event === "progress") {
            setTsInstallLog((prev) => [...prev.slice(-50), data.message]);
          } else if (event === "done") {
            setTsInstalled(true);
            setTsInstalling(false);
            setShowTsModal(false);
            handleConnectTailscale();
            return;
          } else if (event === "error") {
            setTsStatus({ type: "error", message: data.error || "Install failed" });
          }
        }
      }
    } catch (e) {
      setTsStatus({ type: "error", message: e.message });
    } finally {
      setTsInstalling(false);
    }
  };

  const pollFunnelEnable = async (enableUrl) => {
    requestUserAuth(enableUrl, "Open Funnel Settings");
    setTsProgress("Click \"Open Funnel Settings\" to enable Funnel...");
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const res = await fetch("/api/tunnel/tailscale-enable", { method: "POST" });
        const data = await res.json();
        if (res.ok && data.success) {
          clearUserAuth();
          setTsUrl(data.tunnelUrl || "");
          const ok3 = await pingTsHealth(data.tunnelUrl);
          setTsEnabled(true);
          setTsStatus(ok3 ? null : { type: "warning", message: "Connected but not reachable yet." });
          return;
        }
        if (data.funnelNotEnabled) continue;
        if (data.error) {
          clearUserAuth();
          setTsStatus({ type: "error", message: data.error });
          return;
        }
      } catch { /* retry */ }
    }
    clearUserAuth();
    setTsStatus({ type: "error", message: "Timed out waiting for Funnel to be enabled." });
  };

  // Show an inline login button instead of auto-opening a popup (browsers block
  // popups opened after async work because the user gesture is lost).
  const handleConnectTailscale = async () => {
    setShowTsModal(false);
    setTsConnecting(true);
    setTsLoading(true);
    setTsStatus(null);
    setTsProgress("Connecting...");
    clearUserAuth();
    try {
      const res = await fetch("/api/tunnel/tailscale-enable", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.success) {
        setTsUrl(data.tunnelUrl || "");
        const reachable = await pingTsHealth(data.tunnelUrl);
        setTsEnabled(true);
        setTsStatus(reachable ? null : { type: "warning", message: "Connected but not reachable yet." });
        return;
      }
      if (data.needsLogin && data.authUrl) {
        requestUserAuth(data.authUrl, "Open Login Page");
        setTsProgress("Login required — click \"Open Login Page\" to continue");
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          try {
            const r2 = await fetch("/api/tunnel/tailscale-check");
            if (r2.ok) {
              const check = await r2.json();
              if (check.loggedIn) {
                clearUserAuth();
                setTsProgress("Starting funnel...");
                const res2 = await fetch("/api/tunnel/tailscale-enable", { method: "POST" });
                const data2 = await res2.json();
                if (res2.ok && data2.success) {
                  setTsUrl(data2.tunnelUrl || "");
                  const ok2 = await pingTsHealth(data2.tunnelUrl);
                  setTsEnabled(true);
                  setTsStatus(ok2 ? null : { type: "warning", message: "Connected but not reachable yet." });
                } else if (data2.funnelNotEnabled && data2.enableUrl) {
                  await pollFunnelEnable(data2.enableUrl);
                } else {
                  setTsStatus({ type: "error", message: data2.error || "Failed to start funnel" });
                }
                return;
              }
            }
          } catch { /* retry */ }
        }
        clearUserAuth();
        setTsStatus({ type: "error", message: "Login timed out. Please try again." });
        return;
      }
      if (data.funnelNotEnabled && data.enableUrl) {
        await pollFunnelEnable(data.enableUrl);
        return;
      }
      setTsStatus({ type: "error", message: data.error || "Failed to connect" });
    } catch (error) {
      setTsStatus({ type: "error", message: error.message });
    } finally {
      setTsLoading(false);
      setTsConnecting(false);
      setTsProgress("");
      clearUserAuth();
    }
  };

  const handleDisableTailscale = async () => {
    setTsLoading(true);
    setTsStatus(null);
    try {
      const res = await fetch("/api/tunnel/tailscale-disable", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setTsEnabled(false);
        setTsUrl("");
        setShowDisableTsModal(false);
        setTsStatus({ type: "success", message: "Tailscale disabled" });
      } else {
        setTsStatus({ type: "error", message: data.error || "Failed to disable Tailscale" });
      }
    } catch (e) {
      setTsStatus({ type: "error", message: e.message });
    } finally {
      setTsLoading(false);
    }
  };

  const handleOpenTsModal = async () => {
    setTsStatus(null);
    setTsInstallLog([]);
    const data = await checkTailscaleInstalled();
    if (data?.installed && data?.hasCachedPassword) {
      handleConnectTailscale();
    } else {
      setShowTsModal(true);
    }
  };

  /** The room's status poll hands Tailscale's slice here instead of reaching
   *  into these refs from outside. Same reads, same debounce — the reachability
   *  verdict now lives beside the state it mutates. */
  const applyTailscaleStatus = (tailscale) => {
    const enabled = tailscale?.settingsEnabled ?? tailscale?.enabled ?? false;
    setTsUrl(tailscale?.tunnelUrl || "");
    setTsEnabled(enabled);
    const reachable = tsClientReachableRef.current;
    if (reachable) {
      tsMissRef.current = 0;
      setTsReachable(true);
      if (!tsEverReachableRef.current) {
        tsEverReachableRef.current = true;
        setTsEverReachable(true);
      }
    } else {
      tsMissRef.current += 1;
      if (tsMissRef.current >= REACHABLE_MISS_THRESHOLD) setTsReachable(false);
    }
  };

  /** The browser-side probe, called by the room's ping loop. */
  const probeClient = async () => {
    if (tsEnabled && tsUrl) {
      const ok = await clientPingUrl(tsUrl);
      tsClientReachableRef.current = ok;
      if (ok) {
        tsMissRef.current = 0;
        setTsReachable(true);
        if (!tsEverReachableRef.current) {
          tsEverReachableRef.current = true;
          setTsEverReachable(true);
        }
      } else {
        tsMissRef.current += 1;
        if (tsMissRef.current >= REACHABLE_MISS_THRESHOLD) setTsReachable(false);
      }
    } else {
      tsClientReachableRef.current = false;
    }
  };

  return {
    tsEnabled,
    setTsEnabled,
    tsReachable,
    setTsReachable,
    tsUrl,
    setTsUrl,
    tsLoading,
    setTsLoading,
    tsProgress,
    setTsProgress,
    tsStatus,
    setTsStatus,
    tsAuthUrl,
    setTsAuthUrl,
    tsAuthLabel,
    setTsAuthLabel,
    tsInstalled,
    setTsInstalled,
    tsInstalling,
    setTsInstalling,
    tsInstallLog,
    setTsInstallLog,
    tsSudoPassword,
    setTsSudoPassword,
    tsConnecting,
    setTsConnecting,
    showTsModal,
    setShowTsModal,
    showDisableTsModal,
    setShowDisableTsModal,
    tsEverReachable,
    setTsEverReachable,
    tsLogRef,
    clearUserAuth,
    checkTailscaleInstalled,
    handleInstallTailscale,
    handleConnectTailscale,
    handleDisableTailscale,
    handleOpenTsModal,
    applyTailscaleStatus,
    probeClient,
  };
}
