"use client";
// Routing — how a request picks its account, and how a combo picks its model.
//
// One behavior changed here, deliberately and visibly: the two limit inputs are
// now COMMITTED rather than written on every keystroke. The old room PATCHed on
// `onChange`, so typing "10" over "3" wrote 1 — a real setting an operator never
// chose — before writing 10, and a slow save could leave the wrong value
// persisted if the tab closed between the two. A limit is a number that means
// nothing until you stop typing, so it now waits for blur or Enter.
//
// The italic summary paragraph is kept verbatim: it is the only place the room
// says, in one sentence, what the two strategies currently do.
import { useEffect, useState } from "react";
import { Card, Input, Toggle } from "@/shared/components";
import SettingRow from "../SettingRow";

export default function RoutingTab({ deck }) {
  const { settings, loading, patch } = deck;
  const [sticky, setSticky] = useState(String(settings.stickyRoundRobinLimit || 3));
  const [comboSticky, setComboSticky] = useState(String(settings.comboStickyRoundRobinLimit || 1));

  // Reflect the server's own value whenever it lands (or is written back), but
  // only while the field is not the one being typed into — an external reload
  // must not overwrite a number mid-edit.
  useEffect(() => {
    setSticky(String(settings.stickyRoundRobinLimit || 3));
  }, [settings.stickyRoundRobinLimit]);
  useEffect(() => {
    setComboSticky(String(settings.comboStickyRoundRobinLimit || 1));
  }, [settings.comboStickyRoundRobinLimit]);

  const roundRobin = settings.fallbackStrategy === "round-robin";
  const comboRoundRobin = settings.comboStrategy === "round-robin";
  const stickyLimit = settings.stickyRoundRobinLimit || 3;
  const comboLimit = settings.comboStickyRoundRobinLimit || 1;

  const commitNumber = (raw, key, fallback) => {
    const num = parseInt(raw, 10);
    if (Number.isNaN(num) || num < 1) {
      // Snap the field back to the last good value rather than leaving a blank
      // that reads as "unset" while the server still holds a number.
      if (key === "stickyRoundRobinLimit") setSticky(String(fallback));
      else setComboSticky(String(fallback));
      return;
    }
    if (num === fallback) return;
    patch({ [key]: num }, [key]);
  };

  return (
    <Card>
      <div className="flex items-start gap-3 mb-4">
        <div className="p-2 rounded-[10px] bg-brand-500/10 text-brand-500 shrink-0">
          <span className="material-symbols-outlined text-[20px] leading-none">alt_route</span>
        </div>
        <div>
          <h3 className="text-text-main font-semibold">Routing strategy</h3>
          <p className="text-sm text-text-muted mt-0.5">
            How requests spread across accounts and combos.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <SettingRow
          label="Round robin"
          description="Cycle through accounts to distribute load."
          control={
            <Toggle
              checked={roundRobin}
              onChange={() =>
                patch(
                  { fallbackStrategy: roundRobin ? "fill-first" : "round-robin" },
                  ["fallbackStrategy"]
                )
              }
              disabled={loading || !!deck.pending.fallbackStrategy}
            />
          }
        />

        {roundRobin && (
          <div className="pt-4 border-t border-border-subtle">
            <SettingRow
              label="Sticky limit"
              description="Calls per account before switching."
              control={
                <Input
                  type="number"
                  min="1"
                  max="10"
                  value={sticky}
                  onChange={(e) => setSticky(e.target.value)}
                  onBlur={() => commitNumber(sticky, "stickyRoundRobinLimit", stickyLimit)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  disabled={loading}
                  className="w-20 text-center shrink-0"
                />
              }
            />
          </div>
        )}

        <div className="pt-4 border-t border-border-subtle">
          <SettingRow
            label="Combo round robin"
            description="Cycle through providers in combos instead of always starting with the first."
            control={
              <Toggle
                checked={comboRoundRobin}
                onChange={() =>
                  patch(
                    { comboStrategy: comboRoundRobin ? "fallback" : "round-robin" },
                    ["comboStrategy"]
                  )
                }
                disabled={loading || !!deck.pending.comboStrategy}
              />
            }
          />
        </div>

        {comboRoundRobin && (
          <div className="pt-4 border-t border-border-subtle">
            <SettingRow
              label="Combo sticky limit"
              description="Calls per combo model before switching."
              control={
                <Input
                  type="number"
                  min="1"
                  max="100"
                  value={comboSticky}
                  onChange={(e) => setComboSticky(e.target.value)}
                  onBlur={() => commitNumber(comboSticky, "comboStickyRoundRobinLimit", comboLimit)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  disabled={loading}
                  className="w-20 text-center shrink-0"
                />
              }
            />
          </div>
        )}

        <p className="text-xs text-text-muted italic pt-4 border-t border-border-subtle">
          {roundRobin
            ? `Currently distributing requests across all available accounts with ${stickyLimit} calls per account.`
            : "Currently using accounts in priority order (Fill First)."}
          {comboRoundRobin
            ? ` Combos rotate after ${comboLimit} call${comboLimit === 1 ? "" : "s"} per model.`
            : " Combos always start with their first model."}
        </p>
      </div>
    </Card>
  );
}
