"use client";

import { useState } from "react";
import { Card, Button, Modal, ConfirmModal } from "@/shared/components";
import { APP_CONFIG } from "@/shared/constants/config";
export default function AccountActionsSection() {
  const [shutdownOpen, setShutdownOpen] = useState(false);
  const [isShuttingDown, setIsShuttingDown] = useState(false);

  const handleShutdown = async () => {
    setIsShuttingDown(true);
    try {
      await fetch("/api/version/shutdown", { method: "POST" });
    } catch { /* the server may go down before responding */ }
    setIsShuttingDown(false);
    setShutdownOpen(false);
  };

  const handleLogout = async () => {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (res.ok) window.location.assign("/login");
    } catch { /* fail-open */ }
  };

  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-red-500/10 text-red-500 shrink-0">
          <span className="material-symbols-outlined text-[20px]">power_settings_new</span>
        </div>
        <h3 className="text-base sm:text-lg font-semibold">Account &amp; System</h3>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <Button variant="outline" fullWidth icon="power_settings_new" onClick={() => setShutdownOpen(true)}
          className="text-red-500 border-red-200 hover:bg-red-50 hover:border-red-300">
          Shutdown
        </Button>
        <Button variant="outline" fullWidth icon="logout" onClick={handleLogout}>
          Logout
        </Button>
      </div>

      <div className="text-center text-xs sm:text-sm text-text-muted pt-4">
        <p>{APP_CONFIG.name} v{APP_CONFIG.version}</p>
        <p className="mt-1">Local Mode — All data stored on your machine</p>
      </div>

      <ConfirmModal
        isOpen={shutdownOpen}
        onClose={() => setShutdownOpen(false)}
        onConfirm={handleShutdown}
        title="Close Proxy"
        message="Are you sure you want to close the proxy server?"
        confirmText="Close"
        cancelText="Cancel"
        variant="danger"
        loading={isShuttingDown}
      />
    </Card>
  );
}