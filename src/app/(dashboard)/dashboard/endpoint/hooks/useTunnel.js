"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  TUNNEL_PING_INTERVAL_MS,
  TUNNEL_PING_MAX_MS,
  STATUS_POLL_FAST_MS,
  REACHABLE_MISS_THRESHOLD,
  CLIENT_PING_FAST_MS,
} from "../endpointConstants";
import { clientPingAny } from "../endpointPing";
import { fetchTunnelStatus, enableTunnel, disableTunnel } from "../lib/tunnelApi";

/**
 * Cloudflare tunnel state machine. Ports the monolith's polling verbatim:
 * status poll + browser-side ping both debounce reachable=false through
 * missRef, and everReachable distinguishes "Checking..." from "Reconnecting...".
 */
export function useTunnel({ isLoginUnsafe, unsafeReason, requireApiKey, setStatus }) {
  const [tunnelChecking, setTunnelChecking] = useState(true);
  const [tunnelEnabled, setTunnelEnabled] = useState(false);
  const [tunnelReachable, setTunnelReachable] = useState(false);
  const [tunnelUrl, setTunnelUrl] = useState("");
  const [tunnelPublicUrl, setTunnelPublicUrl] = useState("");
  const [tunnelLoading, setTunnelLoading] = useState(false);
  const [tunnelProgress, setTunnelProgress] = useState("");
  const [tunnelStatus, setTunnelStatus] = useState(null);
  const [showEnableTunnelModal, setShowEnableTunnelModal] = useState(false);
  const [showDisableTunnelModal, setShowDisableTunnelModal] = useState(false);
  const [tunnelEverReachable, setTunnelEverReachable] = useState(false);

  const tunnelMissRef = useRef(0);
  const tunnelClientReachableRef = useRef(false);
  const tunnelEverReachableRef = useRef(false);

  const updateReachable = useCallback((_unused, clientRef, missRef, setter, everRef, everSetter) => {
    const reachable = clientRef.current;
    if (reachable) {
      missRef.current = 0;
      setter(true);
      if (!everRef.current) {
        everRef.current = true;
        everSetter(true);
      }
    } else {
      missRef.current += 1;
      if (missRef.current >= REACHABLE_MISS_THRESHOLD) setter(false);
    }
  }, []);

  const syncTunnelStatus = useCallback(async () => {
    const data = await fetchTunnelStatus();
    if (!data) return;
    const tEnabled = data.tunnel?.settingsEnabled ?? data.tunnel?.enabled ?? false;
    const tUrl = data.tunnel?.tunnelUrl || "";
    setTunnelUrl(tUrl);
    setTunnelPublicUrl(data.tunnel?.publicUrl || "");
    setTunnelEnabled(tEnabled);
    updateReachable(null, tunnelClientReachableRef, tunnelMissRef, setTunnelReachable, tunnelEverReachableRef, setTunnelEverReachable);
  }, [updateReachable]);

  // Restore live state on mount — a hard reload with an active tunnel must
  // show "Enabled/Connected", not the idle Enable button. syncTunnelStatus
  // populates tunnelEnabled + URL, which unblocks both poll effects below.
  useEffect(() => {
    syncTunnelStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Status poll: only while degraded (not yet reachable). Stop once healthy.
  // Visibility re-check: refresh once when the tab becomes visible.
  useEffect(() => {
    if (!tunnelEnabled) return;
    const healthy = tunnelReachable;
    const onVisible = () => {
      if (!document.hidden) syncTunnelStatus();
    };
    document.addEventListener("visibilitychange", onVisible);
    if (healthy) return () => document.removeEventListener("visibilitychange", onVisible);
    const timer = setInterval(() => {
      if (!document.hidden) syncTunnelStatus();
    }, STATUS_POLL_FAST_MS);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tunnelEnabled, tunnelReachable, syncTunnelStatus]);

  // Browser-side periodic ping — the UI stays "reachable" even when backend
  // DNS hiccups on *.trycloudflare.com. Slow when healthy, fast when degraded.
  useEffect(() => {
    const probe = async () => {
      if (document.hidden || !tunnelEnabled) return;
      if (tunnelUrl || tunnelPublicUrl) {
        const ok = await clientPingAny(tunnelPublicUrl, tunnelUrl);
        tunnelClientReachableRef.current = ok;
        if (ok) {
          tunnelMissRef.current = 0;
          setTunnelReachable(true);
          if (!tunnelEverReachableRef.current) {
            tunnelEverReachableRef.current = true;
            setTunnelEverReachable(true);
          }
        } else {
          tunnelMissRef.current += 1;
          if (tunnelMissRef.current >= REACHABLE_MISS_THRESHOLD) setTunnelReachable(false);
        }
      } else {
        tunnelClientReachableRef.current = false;
      }
    };
    if (!tunnelEnabled || !(tunnelUrl || tunnelPublicUrl)) return;
    probe();
    if (tunnelReachable) return;
    const id = setInterval(probe, CLIENT_PING_FAST_MS);
    return () => clearInterval(id);
  }, [tunnelEnabled, tunnelUrl, tunnelPublicUrl, tunnelReachable]);

  // Ping tunnel health until reachable (races shortlink + direct URLs).
  const pingTunnelHealth = useCallback(async (...urls) => {
    setTunnelLoading(true);
    setTunnelProgress("Waiting for tunnel ready...");
    const targets = urls.filter(Boolean).map((u) => `${u}/api/health`);
    const start = Date.now();
    while (Date.now() - start < TUNNEL_PING_MAX_MS) {
      await new Promise((r) => setTimeout(r, TUNNEL_PING_INTERVAL_MS));
      const ok = await Promise.any(targets.map(async (h) => {
        const p = await fetch(h, { mode: "cors", cache: "no-store" });
        if (p.ok) return true;
        throw new Error("not ready");
      })).catch(() => false);
      if (ok) {
        setTunnelEnabled(true);
        setTunnelLoading(false);
        setTunnelProgress("");
        return true;
      }
      // Every 5 pings (~10s), check if the backend process is still alive.
      if ((Date.now() - start) % 10000 < TUNNEL_PING_INTERVAL_MS) {
        const data = await fetchTunnelStatus();
        if (data && !data.tunnel?.enabled) {
          setTunnelStatus({ type: "error", message: "Tunnel process stopped unexpectedly." });
          setTunnelLoading(false);
          setTunnelProgress("");
          return false;
        }
      }
    }
    setTunnelStatus({ type: "error", message: "Tunnel created but not reachable. Please try again." });
    setTunnelLoading(false);
    setTunnelProgress("");
    return false;
  }, []);

  const handleEnableTunnel = useCallback(async () => {
    setShowEnableTunnelModal(false);
    setTunnelLoading(true);
    setTunnelStatus(null);
    setTunnelProgress("Creating tunnel...");

    // Poll download progress while the enable request is pending.
    let polling = true;
    const pollProgress = async () => {
      while (polling) {
        const data = await fetchTunnelStatus();
        if (data?.download?.downloading) {
          setTunnelProgress(`Downloading cloudflared... ${data.download.progress}%`);
        } else if (polling) {
          setTunnelProgress("Creating tunnel...");
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    };
    pollProgress();

    const { ok, data } = await enableTunnel();
    polling = false;
    if (!ok) {
      setTunnelStatus({ type: "error", message: data.error || "Failed to enable tunnel" });
      setTunnelLoading(false);
      setTunnelProgress("");
      return;
    }
    const url = data.tunnelUrl;
    if (!url) {
      setTunnelStatus({ type: "error", message: "No tunnel URL returned" });
      setTunnelLoading(false);
      setTunnelProgress("");
      return;
    }
    setTunnelUrl(url);
    setTunnelPublicUrl(data.publicUrl || "");
    await pingTunnelHealth(data.publicUrl, url);
    setTunnelLoading(false);
    setTunnelProgress("");
  }, [pingTunnelHealth]);

  const handleDisableTunnel = useCallback(async () => {
    setTunnelLoading(true);
    setTunnelStatus(null);
    const { ok, data } = await disableTunnel();
    if (ok) {
      setTunnelEnabled(false);
      setTunnelUrl("");
      setShowDisableTunnelModal(false);
      setTunnelStatus({ type: "success", message: "Tunnel disabled" });
    } else {
      setTunnelStatus({ type: "error", message: data.error || "Failed to disable tunnel" });
    }
    setTunnelLoading(false);
  }, []);

  const handleEnableClick = useCallback(() => {
    // Security gate: block remote exposure while login/password/API-key unsafe.
    if (isLoginUnsafe) {
      setStatus({ type: "error", message: `Security required: ${unsafeReason}` });
      return;
    }
    if (!requireApiKey) {
      setStatus({ type: "error", message: "Security required: Enable \"Require API key\" before activating the tunnel." });
      return;
    }
    setShowEnableTunnelModal(true);
  }, [isLoginUnsafe, unsafeReason, requireApiKey, setStatus]);

  return {
    tunnelEnabled, tunnelReachable, tunnelUrl, tunnelPublicUrl,
    tunnelLoading, setTunnelLoading, tunnelProgress, setTunnelProgress,
    tunnelStatus, setTunnelStatus, tunnelEverReachable,
    showEnableTunnelModal, setShowEnableTunnelModal,
    showDisableTunnelModal, setShowDisableTunnelModal,
    syncTunnelStatus, handleEnableTunnel, handleDisableTunnel, handleEnableClick,
  };
}
