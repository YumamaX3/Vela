"use client";

import { SettingsProvider } from "./_context/SettingsContext";
import SettingsStatusBanner from "./components/shared/SettingsStatusBanner";
import { useSettingsContext } from "./_context/SettingsContext";

function InnerLayout({ children }) {
  const { status, setStatus } = useSettingsContext();
  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 lg:p-8">
      <SettingsStatusBanner
        status={status}
        onDismiss={() => setStatus({ type: "", message: "" })}
      />
      <div className="mt-4">{children}</div>
    </div>
  );
}

export default function SettingsLayout({ children }) {
  return (
    <SettingsProvider>
      <InnerLayout>{children}</InnerLayout>
    </SettingsProvider>
  );
}