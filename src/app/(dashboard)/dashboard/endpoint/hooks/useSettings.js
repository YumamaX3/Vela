"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchTunnelStatus } from "../lib/tunnelApi";

/**
 * Dashboard settings: requireLogin / hasPassword / requireApiKey /
 * tunnelDashboardAccess + the translator flag. Owns the security gate that
 * guards remote exposure (tunnel/tailscale must not activate while the
 * dashboard is login-unsafe or the endpoint is key-less).
 */
export function useSettings() {
  const [requireApiKey, setRequireApiKey] = useState(false);
  const [requireLogin, setRequireLogin] = useState(true);
  const [hasPassword, setHasPassword] = useState(true);
  const [tunnelDashboardAccess, setTunnelDashboardAccess] = useState(false);
  const [enableTranslator, setEnableTranslator] = useState(false);
  const [tunnelChecking, setTunnelChecking] = useState(true);

  const loadSettings = useCallback(async () => {
    setTunnelChecking(true);
    try {
      const [settingsRes, statusRes] = await Promise.all([
        fetch("/api/settings"),
        fetchTunnelStatus(),
      ]);
      if (settingsRes.ok) {
        const data = await settingsRes.json();
        setRequireApiKey(data.requireApiKey || false);
        setRequireLogin(data.requireLogin !== false);
        setHasPassword(data.hasPassword || false);
        setTunnelDashboardAccess(data.tunnelDashboardAccess || false);
        setEnableTranslator(data.enableTranslator || false);
      }
      // Reachability restore is owned by useTunnel/useTailscale's mount sync
      // (they populate their own enabled/url state from the same fetch).
    } catch {
      /* fail-open: keep defaults */
    } finally {
      setTunnelChecking(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleTunnelDashboardAccess = useCallback(async (value) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tunnelDashboardAccess: value }),
      });
      if (res.ok) setTunnelDashboardAccess(value);
    } catch {
      /* fail-open */
    }
  }, []);

  const handleRequireApiKey = useCallback(async (value) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requireApiKey: value }),
      });
      if (res.ok) setRequireApiKey(value);
    } catch {
      /* fail-open */
    }
  }, []);

  // Security gate: block remote exposure while dashboard login is unsafe.
  const isLoginUnsafe = !requireLogin || !hasPassword;
  const unsafeReason = !requireLogin
    ? "Enable \"Require login\" and set a custom password before activating the tunnel."
    : "Change the default dashboard password before activating the tunnel.";

  return {
    requireApiKey, requireLogin, hasPassword, tunnelDashboardAccess,
    enableTranslator, tunnelChecking, setTunnelChecking,
    handleTunnelDashboardAccess, handleRequireApiKey,
    isLoginUnsafe, unsafeReason,
  };
}
