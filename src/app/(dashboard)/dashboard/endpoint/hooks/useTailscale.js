"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  TUNNEL_PING_INTERVAL_MS,
  TUNNEL_PING_MAX_MS,
  STATUS_POLL_FAST_MS,
  REACHABLE_MISS_THRESHOLD,
  CLIENT_PING_FAST_MS,
} from "../endpointConstants";
import { clientPingUrl } from "../endpointPing";
import { fetchTunnelStatus, tailscaleCheck, tailscaleEnable, tailscaleDisable, tailscaleInstall } from "../lib/tunnelApi";

/**
 * Tailscale install/login/funnel state machine. Ports the monolith's flows
 * verbatim: SSE install reader, 40×3s login poll, funnel poll, and the same
 * miss-ref/everReachable debounce the tunnel uses.
 */
export function useTailscale() {
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
  const tsMissRef = useRef(0);
  const tsClientReachableRef = useRef(false);
  const tsEverReachableRef = useRef(false);

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

  const syncTsStatus = useCallback(async () => {
    const data = await fetchTunnelStatus();
    if (!data) return;
    const tsEn = data.tailscale?.settingsEnabled ?? data.tailscale?.enabled ?? false;
    const tsUrlVal = data.tailscale?.tunnelUrl || "";
    setTsUrl(tsUrlVal);
    setTsEnabled(tsEn);
    updateReachable(null, tsClientReachableRef, tsMissRef, setTsReachable, tsEverReachableRef, setTsEverReachable);
  }, [updateReachable]);

  // Restore live state on mount — a hard reload with an active funnel must
  // show "Connected", not the idle Enable button.
  useEffect(() => {
    syncTsStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!tsEnabled) return;
    const healthy = tsReachable;
    const onVisible = () => {
      if (!document.hidden) syncTsStatus();
    };
    document.addEventListener("visibilitychange", onVisible);
    if (healthy) return () => document.removeEventListener("visibilitychange", onVisible);
    const timer = setInterval(() => {
      if (!document.hidden) syncTsStatus();
    }, STATUS_POLL_FAST_MS);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tsEnabled, tsReachable, syncTsStatus]);

  // Browser-side ping of the *.ts.net URL with the same miss-debounce.
  useEffect(() => {
    const probe = async () => {
      if (document.hidden || !tsEnabled || !tsUrl) return;
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
    };
    if (!tsEnabled || !tsUrl) return;
    probe();
    if (tsReachable) return;
    const id = setInterval(probe, CLIENT_PING_FAST_MS);
    return () => clearInterval(id);
  }, [tsEnabled, tsUrl, tsReachable]);

  // Auto-scroll the install log.
  useEffect(() => {
    if (tsLogRef.current) tsLogRef.current.scrollTop = tsLogRef.current.scrollHeight;
  }, [tsInstallLog]);

  const checkTailscaleInstalled = useCallback(async () => {
    setTsInstalled(null);
    const data = await tailscaleCheck();
    if (data) {
      setTsInstalled(data.installed);
      return data;
    }
    setTsInstalled(false);
    return { installed: false };
  }, []);

  const handleInstallTailscale = useCallback(async () => {
    setTsInstalling(true);
    setTsStatus(null);
    setTsInstallLog([]);
    await tailscaleInstall(tsSudoPassword, {
      onProgress: (message) => setTsInstallLog((prev) => [...prev.slice(-50), message]),
      onDone: () => {
        setTsInstalled(true);
        setTsInstalling(false);
        setShowTsModal(false);
        handleConnectTailscale();
      },
      onError: (message) => setTsStatus({ type: "error", message }),
    });
    setTsSudoPassword("");
    setTsInstalling(false);
  }, [tsSudoPassword]);

  // Ping Tailscale health until reachable (no-cors: a TS funnel may answer opaque).
  const pingTsHealth = useCallback(async (url) => {
    setTsProgress("Waiting for Tailscale ready...");
    const healthUrl = `${url}/api/health`;
    const start = Date.now();
    while (Date.now() - start < TUNNEL_PING_MAX_MS) {
      await new Promise((r) => setTimeout(r, TUNNEL_PING_INTERVAL_MS));
      try {
        const ping = await fetch(healthUrl, { mode: "no-cors", cache: "no-store" });
        if (ping.ok || ping.type === "opaque") return true;
      } catch {
        /* not ready yet */
      }
    }
    return false;
  }, []);

  const requestUserAuth = useCallback((url, label) => {
    setTsAuthUrl(url);
    setTsAuthLabel(label);
  }, []);

  const clearUserAuth = useCallback(() => {
    setTsAuthUrl("");
    setTsAuthLabel("");
  }, []);

  const finishConnect = useCallback(async (tunnelUrl) => {
    setTsUrl(tunnelUrl || "");
    const reachable = await pingTsHealth(tunnelUrl);
    setTsEnabled(true);
    setTsStatus(reachable ? null : { type: "warning", message: "Connected but not reachable yet." });
  }, [pingTsHealth]);

  const pollFunnelEnable = useCallback(async () => {
    requestUserAuth("", "");
    setTsProgress("Click \"Open Funnel Settings\" to enable Funnel...");
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const { ok, data } = await tailscaleEnable();
      if (ok && data.success) {
        clearUserAuth();
        await finishConnect(data.tunnelUrl);
        return;
      }
      if (data.funnelNotEnabled) continue;
      if (data.error) {
        clearUserAuth();
        setTsStatus({ type: "error", message: data.error });
        return;
      }
    }
    clearUserAuth();
    setTsStatus({ type: "error", message: "Timed out waiting for Funnel to be enabled." });
  }, [clearUserAuth, finishConnect, requestUserAuth]);

  const handleConnectTailscale = useCallback(async () => {
    setShowTsModal(false);
    setTsConnecting(true);
    setTsLoading(true);
    setTsStatus(null);
    setTsProgress("Connecting...");
    clearUserAuth();
    try {
      const { ok, data } = await tailscaleEnable();
      if (ok && data.success) {
        await finishConnect(data.tunnelUrl);
        return;
      }
      if (data.needsLogin && data.authUrl) {
        requestUserAuth(data.authUrl, "Open Login Page");
        setTsProgress("Login required — click \"Open Login Page\" to continue");
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          const check = await tailscaleCheck();
          if (check?.loggedIn) {
            clearUserAuth();
            setTsProgress("Starting funnel...");
            const res2 = await tailscaleEnable();
            if (res2.ok && res2.data.success) {
              await finishConnect(res2.data.tunnelUrl);
            } else if (res2.data.funnelNotEnabled && res2.data.enableUrl) {
              requestUserAuth(res2.data.enableUrl, "Open Funnel Settings");
              await pollFunnelEnable();
            } else {
              setTsStatus({ type: "error", message: res2.data.error || "Failed to start funnel" });
            }
            return;
          }
        }
        clearUserAuth();
        setTsStatus({ type: "error", message: "Login timed out. Please try again." });
        return;
      }
      if (data.funnelNotEnabled && data.enableUrl) {
        requestUserAuth(data.enableUrl, "Open Funnel Settings");
        await pollFunnelEnable();
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
  }, [clearUserAuth, finishConnect, pollFunnelEnable, requestUserAuth]);

  const handleDisableTailscale = useCallback(async () => {
    setTsLoading(true);
    setTsStatus(null);
    const { ok, data } = await tailscaleDisable();
    if (ok) {
      setTsEnabled(false);
      setTsUrl("");
      setShowDisableTsModal(false);
      setTsStatus({ type: "success", message: "Tailscale disabled" });
    } else {
      setTsStatus({ type: "error", message: data.error || "Failed to disable Tailscale" });
    }
    setTsLoading(false);
  }, []);

  const handleOpenTsModal = useCallback(async () => {
    setTsStatus(null);
    setTsInstallLog([]);
    const data = await checkTailscaleInstalled();
    if (data?.installed && data?.hasCachedPassword) {
      handleConnectTailscale();
    } else {
      setShowTsModal(true);
    }
  }, [checkTailscaleInstalled, handleConnectTailscale]);

  return {
    tsEnabled, tsReachable, tsUrl, tsLoading, setTsLoading, tsProgress, setTsProgress,
    tsStatus, setTsStatus, tsAuthUrl, tsAuthLabel, tsInstalled, tsInstalling, tsInstallLog,
    tsSudoPassword, setTsSudoPassword, tsConnecting, setTsConnecting, tsEverReachable,
    showTsModal, setShowTsModal, showDisableTsModal, setShowDisableTsModal,
    tsLogRef,
    syncTsStatus, checkTailscaleInstalled, handleInstallTailscale,
    handleConnectTailscale, handleDisableTailscale, handleOpenTsModal,
    requestUserAuth, clearUserAuth, pingTsHealth,
  };
}
