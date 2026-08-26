"use client";

import SettingsSection, { SettingsRow } from "./SettingsSection";
import { Toggle, Input } from "@/shared/components";

export default function RoutingSection({ settings, loading, toggle, setString, setNumber }) {
  if (!settings) return null;

  const isRR = settings.fallbackStrategy === "round-robin";
  const isComboRR = settings.comboStrategy === "round-robin";

  const setFallbackStrategy = (strategy) => {
    setString("fallbackStrategy", strategy);
  };

  const setComboStrategy = (strategy) => {
    setString("comboStrategy", strategy);
  };

  return (
    <SettingsSection icon="route" title="Routing Strategy" accent="blue">
      <div className="flex flex-col gap-4">
        <SettingsRow label="Round Robin" desc="Cycle through accounts to distribute load">
          <Toggle checked={isRR}
            onChange={() => setFallbackStrategy(isRR ? "fill-first" : "round-robin")}
            disabled={loading} />
        </SettingsRow>

        {isRR && (
          <SettingsRow label="Sticky Limit" desc="Calls per account before switching">
            <Input type="number" min="1" max="10" value={settings.stickyRoundRobinLimit || 3}
              onChange={(e) => setNumber("stickyRoundRobinLimit", e.target.value)} disabled={loading} className="w-20 text-center" />
          </SettingsRow>
        )}

        <hr className="border-border/50" />

        <SettingsRow label="Combo Round Robin" desc="Cycle through providers in combos instead of always starting with first">
          <Toggle checked={isComboRR}
            onChange={() => setComboStrategy(isComboRR ? "fallback" : "round-robin")}
            disabled={loading} />
        </SettingsRow>

        {isComboRR && (
          <SettingsRow label="Combo Sticky Limit" desc="Calls per combo model before switching">
            <Input type="number" min="1" max="100" value={settings.comboStickyRoundRobinLimit || 1}
              onChange={(e) => setNumber("comboStickyRoundRobinLimit", e.target.value)} disabled={loading} className="w-20 text-center" />
          </SettingsRow>
        )}

        <hr className="border-border/50" />

        <SettingsRow label="Max retries" desc="Transient-error retries before giving up">
          <Input type="number" min="0" max="10" value={settings.maxRetries ?? 2}
            onChange={(e) => setNumber("maxRetries", e.target.value)} disabled={loading} className="w-20 text-center" />
        </SettingsRow>

        <p className="text-xs text-text-muted italic pt-1">
          {isRR
            ? `Distributing across accounts with ${settings.stickyRoundRobinLimit || 3} calls per account.`
            : "Using accounts in priority order (Fill First)."}
          {" "}
          {isComboRR
            ? `Combos rotate after ${settings.comboStickyRoundRobinLimit || 1} call(s) per model.`
            : "Combos always start with their first model."}
        </p>
      </div>
    </SettingsSection>
  );
}