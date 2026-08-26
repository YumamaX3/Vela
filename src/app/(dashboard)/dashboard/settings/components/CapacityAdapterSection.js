"use client";

import SettingsSection, { SettingsRow } from "./SettingsSection";
import { Toggle, Input, Button } from "@/shared/components";

export default function CapacityAdapterSection({ settings, loading, patchNested }) {
  if (!settings) return null;
  const ca = settings.capacityAdapter || {};

  const updateCA = (key, sub) => {
    const current = ca[key] || {};
    patchNested("capacityAdapter", { [key]: { ...current, ...sub } });
  };

  return (
    <SettingsSection icon="tune" title="Capacity Adapter" accent="cyan">
      <div className="flex flex-col gap-4">
        <p className="text-xs text-text-muted">
          Route media-heavy requests (vision, PDF, audio, video) through dedicated models
          instead of burning costly general-purpose tokens.
        </p>

        {[
          { key: "vision", label: "Vision", icon: "image", desc: "Route image-analysis requests to vision-specialized models" },
          { key: "pdf", label: "PDF", icon: "description", desc: "Route document-reading requests to PDF-capable models" },
          { key: "audioInput", label: "Audio Input", icon: "mic", desc: "Route audio-transcription requests to audio models" },
          { key: "videoInput", label: "Video Input", icon: "videocam", desc: "Route video-analysis requests to video-capable models" },
        ].map(({ key, label, icon, desc }) => {
          const cfg = ca[key] || {};
          return (
            <div key={key} className="pt-2 border-t border-border/50 first:border-0 first:pt-0">
              <div className="flex items-center gap-2 mb-2">
                <span className="material-symbols-outlined text-[18px] text-text-muted">{icon}</span>
                <p className="font-medium text-sm">{label}</p>
              </div>
              <p className="text-xs text-text-muted mb-2">{desc}</p>
              <div className="flex flex-col gap-2 ml-7">
                <div className="flex items-center justify-between">
                  <span className="text-xs">Enabled</span>
                  <Toggle checked={cfg.enabled === true} onChange={() => updateCA(key, { enabled: !cfg.enabled })} disabled={loading} />
                </div>
                {cfg.enabled && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-xs">Round Robin</span>
                      <Toggle checked={cfg.roundRobin === true} onChange={() => updateCA(key, { roundRobin: !cfg.roundRobin })} disabled={loading} />
                    </div>
                    <div>
                      <label className="text-xs font-medium block mb-1">Model Overrides (comma-separated)</label>
                      <Input placeholder="gpt-4o, claude-sonnet-5" value={(cfg.models || []).join(", ")}
                        onChange={(e) => updateCA(key, { models: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                        disabled={loading} />
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </SettingsSection>
  );
}