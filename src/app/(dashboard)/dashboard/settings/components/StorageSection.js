"use client";

import SettingsSection, { SettingsRow } from "./SettingsSection";
import { Toggle, Input } from "@/shared/components";

export default function StorageSection({ settings, loading, toggle, setNumber }) {
  if (!settings) return null;

  return (
    <SettingsSection icon="database" title="Storage & Retention" accent="teal">
      <div className="flex flex-col gap-4">
        <SettingsRow
          label="Usage retention"
          desc="Days to keep usage telemetry before auto-purge"
        >
          <Input
            type="number" min="1" max="36500"
            value={settings.usageRetentionDays ?? 90}
            onChange={(e) => setNumber("usageRetentionDays", e.target.value)}
            disabled={loading} className="w-20 text-center"
          />
        </SettingsRow>

        <SettingsRow
          label="Keep request payloads"
          desc="Store request bodies for debugging (increases DB size)"
        >
          <Toggle
            checked={settings.keepRequestPayloads === true}
            onChange={() => toggle("keepRequestPayloads")}
            disabled={loading}
          />
        </SettingsRow>
      </div>
    </SettingsSection>
  );
}