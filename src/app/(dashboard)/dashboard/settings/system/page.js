"use client";

export const dynamic = "force-dynamic";

import AccountActionsSection from "../components/AccountActionsSection";

export default function SystemPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">System</h1>
        <p className="text-sm text-text-muted mt-1">
          Shutdown the proxy server, log out, or view application version
          information.
        </p>
      </div>
      <AccountActionsSection />
    </div>
  );
}