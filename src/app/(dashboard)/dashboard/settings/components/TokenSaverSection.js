"use client";

import SettingsSection, { SettingsRow } from "./SettingsSection";
import { Toggle, Input } from "@/shared/components";

/** RTK Token Savers — Caveman, Ponytail, PXPIPE, Headroom. */
export default function TokenSaverSection({ settings, loading, toggle, setString, setNumber }) {
  if (!settings) return null;

  const rtkOn = settings.rtkEnabled !== false;

  return (
    <SettingsSection icon="compress" title="RTK Token Savers" accent="emerald">
      <div className="flex flex-col gap-4">
        <SettingsRow label="RTK enabled" desc="Pre-translate hooks that compress tool_result content">
          <Toggle checked={rtkOn} onChange={() => toggle("rtkEnabled")} disabled={loading} />
        </SettingsRow>

        {rtkOn && (
          <>
            <hr className="border-border/50" />

            {/* Caveman */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="font-medium text-sm">Caveman Mode</p>
                <Toggle checked={settings.cavemanEnabled === true} onChange={() => toggle("cavemanEnabled")} disabled={loading} />
              </div>
              <p className="text-xs text-text-muted mb-2">Terse-reply system injection — drops filler words for token savings</p>
              {settings.cavemanEnabled && (
                <div className="flex flex-wrap gap-2">
                  {["lite", "full", "ultra", "wenyan-lite", "wenyan", "wenyan-ultra"].map((level) => (
                    <button key={level} type="button" onClick={() => setString("cavemanLevel", level)} disabled={loading}
                      className={`text-[10px] px-2 py-1 rounded-full border transition-all ${
                        (settings.cavemanLevel || "full") === level
                          ? "bg-primary/15 text-primary border-primary/40 font-semibold"
                          : "bg-surface-2 text-text-muted border-border-subtle hover:text-primary"
                      }`}>
                      {level}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <hr className="border-border/50" />

            {/* Ponytail */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="font-medium text-sm">Ponytail Mode</p>
                <Toggle checked={settings.ponytailEnabled === true} onChange={() => toggle("ponytailEnabled")} disabled={loading} />
              </div>
              <p className="text-xs text-text-muted mb-2">YAGNI-first lazy-senior prompt — stdlib/native before external deps</p>
              {settings.ponytailEnabled && (
                <div className="flex flex-wrap gap-2">
                  {["lite", "full", "ultra"].map((level) => (
                    <button key={level} type="button" onClick={() => setString("ponytailLevel", level)} disabled={loading}
                      className={`text-[10px] px-2 py-1 rounded-full border transition-all ${
                        (settings.ponytailLevel || "full") === level
                          ? "bg-primary/15 text-primary border-primary/40 font-semibold"
                          : "bg-surface-2 text-text-muted border-border-subtle hover:text-primary"
                      }`}>
                      {level}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <hr className="border-border/50" />

            {/* PXPIPE */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="font-medium text-sm">PXPIPE</p>
                <Toggle checked={settings.pxpipeEnabled === true} onChange={() => toggle("pxpipeEnabled")} disabled={loading} />
              </div>
              <p className="text-xs text-text-muted mb-2">Image bulky-context compression (Claude bodies)</p>
              {settings.pxpipeEnabled && (
                <div className="flex flex-col gap-2">
                  <SettingsRow label="Min chars" desc="Minimum character count to trigger compression">
                    <Input type="number" min="1000" value={settings.pxpipeMinChars ?? 25000}
                      onChange={(e) => setNumber("pxpipeMinChars", e.target.value)} disabled={loading} className="w-24 text-center" />
                  </SettingsRow>
                  <SettingsRow label="Timeout (ms)" desc="Max wait for external pxpipe process">
                    <Input type="number" min="1000" max="60000" value={settings.pxpipeTimeoutMs ?? 15000}
                      onChange={(e) => setNumber("pxpipeTimeoutMs", e.target.value)} disabled={loading} className="w-24 text-center" />
                  </SettingsRow>
                </div>
              )}
            </div>

            <hr className="border-border/50" />

            {/* Headroom */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="font-medium text-sm">Headroom</p>
                <Toggle checked={settings.headroomEnabled === true} onChange={() => toggle("headroomEnabled")} disabled={loading} />
              </div>
              <p className="text-xs text-text-muted mb-2">External compress sidecar for maximum token savings</p>
              {settings.headroomEnabled && (
                <div className="flex flex-col gap-2">
                  <div>
                    <label className="text-xs font-medium block mb-1">Headroom URL</label>
                    <Input value={settings.headroomUrl || "http://localhost:8787"}
                      onChange={(e) => setString("headroomUrl", e.target.value)} disabled={loading} />
                  </div>
                  <SettingsRow label="Compress user messages" desc="Also compress user content through sidecar">
                    <Toggle checked={settings.headroomCompressUserMessages === true}
                      onChange={() => toggle("headroomCompressUserMessages")} disabled={loading} />
                  </SettingsRow>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </SettingsSection>
  );
}