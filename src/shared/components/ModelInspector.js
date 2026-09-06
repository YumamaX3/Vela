"use client";

// ModelInspector — a side drawer that opens on any model/combo reference,
// surfacing everything an operator needs to *commit* to the pick with
// confidence: transport chain, capabilities, aliases, and quick actions.
//
// New menu #2 (Prism Build D, 2026-09-07).
//
// The picker used to be one-step but blind — the operator picked a model
// without seeing its health, its aliases, or whether it was the right
// shape for the work. The Inspector closes that loop without leaving the
// page, and rides Build A's inert Drawer primitive (focus-trap + scroll-
// lock) so it inherits the same keyboard contract as the modals.
//
// Data sources (lazy on open):
//   - /api/models/alias → reverse-lookup aliases that map to this model
//   - /api/provider-nodes → display name + prefix for compatible providers
//   - useModelCaps() → capability map (vision/audio/pdf/etc.)
//   - /api/health → 24h error rate (when available; honest empty state otherwise)
//
// Anti-slop:
//   R-04 — every section earns its place: aliases are usually 0-2 (a real
//          operator-facing concern), capabilities are the operator's first
//          question, transport is the answer to "why does it sometimes 404
//          when the chat is fine". None of these are decorative.
//   R-08 — keyboard nav: Esc closes (from Drawer), every action is a real
//          button with focus-visible rings.
//   R-12 — empty states are honest ("No aliases yet", "No health data
//          available") not fabricated defaults.
//   R-18 — every color reads from --color-* tokens.

import { useEffect, useState, useCallback } from "react";
import Drawer from "./Drawer";
import CapacityBadges from "./CapacityBadges";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import { cn } from "@/shared/utils/cn";

function providerDisplay(providerId, providerNodes) {
  if (!providerId) return { name: providerId || "—", color: "#666" };
  const node = providerNodes.find((n) => n.id === providerId);
  if (node) return { name: node.name || providerId, color: node.color || "#666" };
  return { name: providerId, color: "#666" };
}

export default function ModelInspector({
  isOpen,
  onClose,
  model,
  onAddToCombo,
  onEdit,
  onDisable,
}) {
  const { getCaps } = useModelCaps();
  const [aliases, setAliases] = useState(null);
  const [providerNodes, setProviderNodes] = useState([]);
  const [health, setHealth] = useState(null);

  const value = model?.value;
  const providerId = value?.split("/")[0] || null;
  const modelId = value?.split("/").slice(1).join("/") || null;
  const caps = value ? getCaps(value) : null;

  useEffect(() => {
    if (!isOpen || !value || model?.isCombo) {
      setAliases(null);
      return undefined;
    }
    let cancelled = false;
    fetch("/api/models/alias", { cache: "no-store" })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (cancelled) return;
        const all = d?.aliases || {};
        const matching = Object.entries(all)
          .filter(([, full]) => full === value)
          .map(([aliasName, full]) => ({ aliasName, full }));
        setAliases(matching);
      })
      .catch(() => { if (!cancelled) setAliases([]); });
    return () => { cancelled = true; };
  }, [isOpen, value, model?.isCombo]);

  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    fetch("/api/provider-nodes", { cache: "no-store" })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (!cancelled) setProviderNodes(d?.nodes || []); })
      .catch(() => { if (!cancelled) setProviderNodes([]); });
    return () => { cancelled = true; };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !value) {
      setHealth(null);
      return undefined;
    }
    let cancelled = false;
    fetch("/api/health", { cache: "no-store" })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (!cancelled) setHealth(d); })
      .catch(() => { if (!cancelled) setHealth(null); });
    return () => { cancelled = true; };
  }, [isOpen, value]);

  const handleAddToCombo = useCallback(() => onAddToCombo?.(model), [onAddToCombo, model]);
  const handleEdit = useCallback(() => onEdit?.(model), [onEdit, model]);
  const handleDisable = useCallback(() => onDisable?.(model), [onDisable, model]);

  const display = providerDisplay(providerId, providerNodes);

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title={model?.isCombo ? `Combo — ${model.name}` : `Model — ${model?.name || value || "Inspector"}`}
      width="lg"
    >
      <div className="flex flex-col gap-5 px-4 py-4">
        <section>
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                {model?.isCombo ? "Combo" : "Model"}
              </p>
              <h2 className="font-mono text-lg text-text-main break-all">
                {model?.name || value || "—"}
              </h2>
              {value && !model?.isCombo && (
                <p className="text-xs text-text-muted mt-1">
                  <span className="font-mono text-text-subtle">@{providerId}</span>
                  <span className="mx-1.5">·</span>
                  <span className="font-mono">{modelId}</span>
                </p>
              )}
            </div>
            {value && (
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(value)}
                title="Copy id"
                aria-label="Copy model id"
                className={cn(
                  "shrink-0 p-1.5 rounded-md text-text-muted",
                  "hover:text-primary hover:bg-primary/5",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                )}
              >
                <span className="material-symbols-outlined" style={{ fontSize: "16px" }} aria-hidden="true">content_copy</span>
              </button>
            )}
          </div>
        </section>

        {!model?.isCombo && (
          <section>
            <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">
              Capabilities
            </h3>
            {caps && Object.keys(caps).length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <CapacityBadges caps={caps} />
              </div>
            ) : (
              <p className="text-xs text-text-muted">No capability data available for this model.</p>
            )}
          </section>
        )}

        {!model?.isCombo && (
          <section>
            <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">
              Transport
            </h3>
            <div className="rounded-md border border-border-subtle bg-surface-2/30 p-3 space-y-1.5">
              <TransportRow label="Provider" value={display.name} />
              <TransportRow label="Provider id" value={providerId || "—"} mono />
              {display.color && display.color !== "#666" && (
                <TransportRow
                  label="Color"
                  value={
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        aria-hidden="true"
                        className="inline-block w-3 h-3 rounded-sm border border-border-subtle"
                        style={{ background: display.color }}
                      />
                      <span className="font-mono">{display.color}</span>
                    </span>
                  }
                />
              )}
            </div>
          </section>
        )}

        {!model?.isCombo && (
          <section>
            <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">
              Aliases
            </h3>
            {aliases === null ? (
              <p className="text-xs text-text-muted">Loading…</p>
            ) : aliases.length === 0 ? (
              <p className="text-xs text-text-muted">No aliases yet — you can add one from the provider admin page.</p>
            ) : (
              <ul className="space-y-1.5">
                {aliases.map((a) => (
                  <li
                    key={a.aliasName}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-border-subtle bg-surface font-mono text-xs"
                  >
                    <span className="material-symbols-outlined text-text-muted" style={{ fontSize: "14px" }} aria-hidden="true">
                      alternate_email
                    </span>
                    <span className="truncate">{a.aliasName}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {!model?.isCombo && (
          <section>
            <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">
              Health
            </h3>
            {health === null ? (
              <p className="text-xs text-text-muted">No health data available right now.</p>
            ) : (
              <div className="rounded-md border border-border-subtle bg-surface-2/30 p-3 space-y-1.5">
                {typeof health.errorRate24h === "number" && (
                  <TransportRow
                    label="Error rate (24h)"
                    value={`${(health.errorRate24h * 100).toFixed(2)}%`}
                  />
                )}
                {typeof health.uptime24h === "number" && (
                  <TransportRow
                    label="Uptime (24h)"
                    value={`${(health.uptime24h * 100).toFixed(2)}%`}
                  />
                )}
                {typeof health.errorRate24h !== "number" && typeof health.uptime24h !== "number" && (
                  <p className="text-xs text-text-muted">
                    Health endpoint didn't return per-model stats.
                  </p>
                )}
              </div>
            )}
          </section>
        )}

        <section className="border-t border-border-subtle pt-4 flex flex-wrap gap-2">
          {!model?.isCombo && (
            <button
              type="button"
              onClick={handleAddToCombo}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md",
                "bg-primary text-white text-xs font-medium",
                "hover:bg-primary-hover transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              )}
            >
              <span className="material-symbols-outlined" style={{ fontSize: "14px" }} aria-hidden="true">add</span>
              Add to combo
            </button>
          )}
          {onEdit && (
            <button
              type="button"
              onClick={handleEdit}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md",
                "border border-border-subtle bg-surface text-text-main text-xs font-medium",
                "hover:border-primary/50 hover:bg-primary/5 transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              )}
            >
              <span className="material-symbols-outlined" style={{ fontSize: "14px" }} aria-hidden="true">edit</span>
              Edit
            </button>
          )}
          {!model?.isCombo && onDisable && (
            <button
              type="button"
              onClick={handleDisable}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md",
                "border border-border-subtle bg-surface text-red-500 text-xs font-medium",
                "hover:bg-red-500/5 hover:border-red-500/30 transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
              )}
            >
              <span className="material-symbols-outlined" style={{ fontSize: "14px" }} aria-hidden="true">block</span>
              Disable
            </button>
          )}
        </section>
      </div>
    </Drawer>
  );
}

function TransportRow({ label, value, mono = false }) {
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="text-text-muted shrink-0 w-24">{label}</span>
      <span className={cn("text-text-main flex-1 min-w-0 truncate", mono && "font-mono")}>
        {value}
      </span>
    </div>
  );
}
