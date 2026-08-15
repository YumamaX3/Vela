"use client";

import { useState, useEffect, useRef } from "react";

// Pricing Covenant C6: NO import of open-sse/providers/pricing.js here —
// that would ship the whole rate table into the client bundle and render
// stale pre-sync rates as a fallback. Everything flows through the API:
// /api/pricing (merged view) and /api/pricing/defaults (static fallback).

const PRICING_FIELDS = ["input", "output", "cached", "reasoning", "cache_creation"];

export default function PricingModal({ isOpen, onClose, onSave }) {
  const [pricingData, setPricingData] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const initialRef = useRef(null); // snapshot for dirty-row diff

  useEffect(() => {
    if (isOpen) {
      loadPricing();
    }
  }, [isOpen]);

  const loadPricing = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/pricing");
      if (response.ok) {
        const data = await response.json();
        setPricingData(data);
        initialRef.current = data;
        return;
      }
    } catch (error) {
      console.error("Failed to load pricing:", error);
    }
    // Fallback: static defaults via the real endpoint (never the bundled table)
    try {
      const res = await fetch("/api/pricing/defaults");
      if (res.ok) {
        const defaults = await res.json();
        const view = { ...(defaults.providers || {}), _canonical: defaults.canonical || {} };
        setPricingData(view);
        initialRef.current = view;
      }
    } catch { /* leave empty state visible */ }
    finally { setLoading(false); }
  };

  const handlePricingChange = (provider, model, field, value) => {
    const numValue = parseFloat(value);
    if (isNaN(numValue) || numValue < 0) return;

    setPricingData(prev => {
      const newData = { ...prev };
      if (!newData[provider]) newData[provider] = {};
      if (!newData[provider][model]) newData[provider][model] = {};
      newData[provider][model][field] = numValue;
      return newData;
    });
  };

  // Build a PATCH body containing ONLY rows that differ from the snapshot
  // (the old full-table save laundered every rendered default into the user
  // override scope — write amplification and sovereignty confusion).
  const buildDirtyRows = () => {
    const dirty = {};
    const before = initialRef.current || {};
    for (const [provider, models] of Object.entries(pricingData)) {
      if (provider === "_canonical") continue; // canonical table is read-only here
      for (const [model, rates] of Object.entries(models)) {
        const was = before[provider]?.[model] || {};
        const changed = PRICING_FIELDS.some(f => (rates[f] ?? 0) !== (was[f] ?? 0));
        if (changed) {
          if (!dirty[provider]) dirty[provider] = {};
          dirty[provider][model] = rates;
        }
      }
    }
    return dirty;
  };

  const dirtyCount = () => {
    const dirty = buildDirtyRows();
    return Object.values(dirty).reduce((n, models) => n + Object.keys(models).length, 0);
  };

  const handleSave = async () => {
    const dirty = buildDirtyRows();
    if (Object.keys(dirty).length === 0) {
      onSave?.();
      onClose();
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/pricing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dirty)
      });

      if (response.ok) {
        onSave?.();
        onClose();
      } else {
        const error = await response.json();
        alert(`Failed to save pricing: ${error.error}`);
      }
    } catch (error) {
      console.error("Failed to save pricing:", error);
      alert("Failed to save pricing");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!confirm("Reset your pricing overrides to defaults? Synced prices are kept.")) return;

    try {
      const response = await fetch("/api/pricing", { method: "DELETE" });
      if (response.ok) {
        loadPricing();
      }
    } catch (error) {
      console.error("Failed to reset pricing:", error);
      alert("Failed to reset pricing");
    }
  };

  if (!isOpen) return null;

  const allProviders = Object.keys(pricingData).sort();

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-bg-base border border-border rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="text-xl font-semibold">Pricing Configuration</h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text text-2xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="text-center py-8 text-text-muted">Loading pricing data...</div>
          ) : (
            <div className="space-y-6">
              {/* Instructions */}
              <div className="bg-bg-subtle border border-border rounded-lg p-3 text-sm">
                <p className="font-medium mb-1">Pricing Rates Format</p>
                <p className="text-text-muted">
                  All rates are in <strong>dollars per million tokens</strong> ($/1M tokens).
                  Example: Input rate of 2.50 means $2.50 per 1,000,000 input tokens.
                  Your edits override synced and built-in rates.
                </p>
              </div>

              {/* Pricing Tables */}
              {allProviders.map(provider => {
                const models = Object.keys(pricingData[provider]).sort();
                return (
                  <div key={provider} className="border border-border rounded-lg overflow-hidden">
                    <div className="bg-bg-subtle px-4 py-2 font-semibold text-sm">
                      {provider === "_canonical" ? "CANONICAL (built-in)" : provider.toUpperCase()}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-bg-hover text-text-muted uppercase text-xs">
                          <tr>
                            <th className="px-3 py-2 text-left">Model</th>
                            {PRICING_FIELDS.map(f => (
                              <th key={f} className="px-3 py-2 text-right">{f.replace("_", " ")}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {models.map(model => (
                            <tr key={model} className="hover:bg-bg-subtle/50">
                              <td className="px-3 py-2 font-medium">{model}</td>
                              {PRICING_FIELDS.map(field => (
                                <td key={field} className="px-3 py-2">
                                  {provider === "_canonical" ? (
                                    <span className="text-text-muted block text-right px-2">
                                      {pricingData[provider][model]?.[field] ?? 0}
                                    </span>
                                  ) : (
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      value={pricingData[provider][model][field] || 0}
                                      onChange={(e) => handlePricingChange(provider, model, field, e.target.value)}
                                      className="w-20 px-2 py-1 text-right bg-bg-base border border-border rounded focus:outline-none focus:border-primary"
                                    />
                                  )}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}

              {allProviders.length === 0 && (
                <div className="text-center py-8 text-text-muted">
                  No pricing data available
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border flex items-center justify-between gap-2">
          <button
            onClick={handleReset}
            className="px-4 py-2 text-sm text-red-500 hover:bg-red-500/10 rounded border border-red-500/20 transition-colors"
            disabled={saving || loading}
          >
            Reset My Overrides
          </button>
          <div className="flex items-center gap-3">
            {!loading && dirtyCount() > 0 && (
              <span className="text-xs text-text-muted">{dirtyCount()} changed model(s)</span>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-text-muted hover:text-text border border-border rounded transition-colors"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 text-sm bg-primary text-white rounded hover:bg-primary/90 transition-colors disabled:opacity-50"
              disabled={saving}
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
