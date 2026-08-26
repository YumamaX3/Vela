"use client";

import SettingsSection, { SettingsRow } from "./SettingsSection";
import { Toggle, Input } from "@/shared/components";

export default function ObservabilitySection({ settings, loading, toggle, setNumber }) {
  if (!settings) return null;

  return (
    <SettingsSection icon="monitoring" title="Observability" accent="teal">
      <div className="flex flex-col gap-4">
        <SettingsRow label="Enable Observability" desc="Record request/response telemetry for debugging">
          <Toggle checked={settings.enableObservability === true}
            onChange={() => toggle("enableObservability")} disabled={loading} />
        </SettingsRow>

        {settings.enableObservability && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-border/50">
              <SettingsRow label="Max records" desc="Cap the telemetry ring buffer">
                <Input type="number" min="100" max="50000" value={settings.observabilityMaxRecords ?? 1000}
                  onChange={(e) => setNumber("observabilityMaxRecords", e.target.value)}
                  disabled={loading} className="w-20 text-center" />
              </SettingsRow>
              <SettingsRow label="Batch size" desc="Rows per flush to the database">
                <Input type="number" min="1" max="500" value={settings.observabilityBatchSize ?? 20}
                  onChange={(e) => setNumber("observabilityBatchSize", e.target.value)}
                  disabled={loading} className="w-20 text-center" />
              </SettingsRow>
              <SettingsRow label="Flush interval (ms)" desc="How often the buffer drains">
                <Input type="number" min="100" max="60000" value={settings.observabilityFlushIntervalMs ?? 5000}
                  onChange={(e) => setNumber("observabilityFlushIntervalMs", e.target.value)}
                  disabled={loading} className="w-24 text-center" />
              </SettingsRow>
              <SettingsRow label="Max JSON size (KB)" desc="Largest payload to record">
                <Input type="number" min="1" max="100" value={settings.observabilityMaxJsonSize ?? 5}
                  onChange={(e) => setNumber("observabilityMaxJsonSize", e.target.value)}
                  disabled={loading} className="w-20 text-center" />
              </SettingsRow>
            </div>
            <p className="text-xs text-text-muted italic">
              Observability records consume disk space proportional to traffic.
              Keep the ring buffer tight unless debugging an active issue.
            </p>
          </>
        )}
      </div>
    </SettingsSection>
  );
}