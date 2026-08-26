"use client";

export const dynamic = "force-dynamic";

import { useSettingsContext } from "../_context/SettingsContext";
import StorageSection from "../components/StorageSection";
import BackupCard from "../components/BackupCard";

export default function StoragePage() {
  const ctx = useSettingsContext();
  const sp = {
    settings: ctx.settings,
    loading: ctx.loading,
    toggle: ctx.toggle,
    setNumber: ctx.setNumber,
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Storage</h1>
        <p className="text-sm text-text-muted mt-1">
          Usage retention, request payload storage, and backup engine — encrypted
          artifacts with restore and drill testing.
        </p>
      </div>
      <StorageSection {...sp} />
      <BackupCard />
    </div>
  );
}