"use client";

import { useState, useEffect } from "react";
import Card from "@/shared/components/Card";
import PricingModal from "@/shared/components/PricingModal";

export default function PricingSettingsPage() {
  const [showModal, setShowModal] = useState(false);
  const [currentPricing, setCurrentPricing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncMeta, setSyncMeta] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);

  useEffect(() => {
    loadPricing();
    loadSyncMeta();
  }, []);

  const loadPricing = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/pricing");
      if (response.ok) {
        const data = await response.json();
        setCurrentPricing(data);
      }
    } catch (error) {
      console.error("Failed to load pricing:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadSyncMeta = async () => {
    try {
      const res = await fetch("/api/pricing/sync");
      if (res.ok) {
        const data = await res.json();
        setSyncMeta(data.meta || null);
      }
    } catch { /* non-fatal */ }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/pricing/sync", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setSyncResult({ ok: true, data });
        loadPricing();
        loadSyncMeta();
      } else {
        setSyncResult({ ok: false, data });
      }
    } catch (error) {
      console.error("Sync failed:", error);
      setSyncResult({ ok: false, error: error.message });
    } finally {
      setSyncing(false);
    }
  };

  const handleClearSynced = async () => {
    if (!confirm("Clear synced prices? Your own overrides are not touched.")) return;
    try {
      const res = await fetch("/api/pricing/sync", { method: "DELETE" });
      if (res.ok) {
        setSyncMeta(null);
        setSyncResult(null);
        loadPricing();
      }
    } catch (error) {
      console.error("Failed to clear synced pricing:", error);
    }
  };

  const handlePricingUpdated = () => {
    loadPricing();
  };

  // Count total models with pricing
  const getModelCount = () => {
    if (!currentPricing) return 0;
    let count = 0;
    for (const provider in currentPricing) {
      count += Object.keys(currentPricing[provider]).length;
    }
    return count;
  };

  // Get providers list
  const getProviders = () => {
    if (!currentPricing) return [];
    return Object.keys(currentPricing).sort();
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Pricing Settings</h1>
          <p className="text-text-muted mt-1">
            Configure pricing rates for cost tracking and calculations
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-4 py-2 border border-primary text-primary rounded hover:bg-primary/10 transition-colors disabled:opacity-50"
          >
            {syncing ? "Syncing…" : "Sync Prices"}
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="px-4 py-2 bg-primary text-white rounded hover:bg-primary/90 transition-colors"
          >
            Edit Pricing
          </button>
        </div>
      </div>

      {/* Sync result feedback */}
      {syncResult && (
        <Card className={`p-4 border ${syncResult.ok ? "border-success/40" : "border-red-500/40"}`}>
          {syncResult.ok ? (
            <div className="text-sm">
              <div className="font-semibold text-success">
                Sync complete — {syncResult.data.entryCount} rates refreshed
              </div>
              <div className="text-text-muted mt-1">
                {syncResult.data.diff?.added ?? 0} added · {syncResult.data.diff?.updated ?? 0} updated ·{" "}
                {syncResult.data.diff?.removed ?? 0} removed
                {syncResult.data.crossCheck?.disagreements > 0 &&
                  ` · ${syncResult.data.crossCheck.disagreements} cross-check disagreement(s)`}
                {syncResult.data.failed?.length > 0 &&
                  ` · ${syncResult.data.failed.length} source(s) failed`}
              </div>
            </div>
          ) : (
            <div className="text-sm text-red-500">
              Sync failed: {syncResult.data?.error || syncResult.error || "unknown error"}
            </div>
          )}
        </Card>
      )}

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="text-text-muted text-sm uppercase font-semibold">
            Total Models
          </div>
          <div className="text-2xl font-bold mt-1">
            {loading ? "..." : getModelCount()}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-text-muted text-sm uppercase font-semibold">
            Providers
          </div>
          <div className="text-2xl font-bold mt-1">
            {loading ? "..." : getProviders().length}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-text-muted text-sm uppercase font-semibold">
            Last Synced
          </div>
          <div className="text-lg font-bold mt-1">
            {syncMeta?.syncedAt ? new Date(syncMeta.syncedAt).toLocaleString() : "Never"}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-text-muted text-sm uppercase font-semibold">
            Status
          </div>
          <div className="text-2xl font-bold mt-1 text-success">
            {loading ? "..." : "Active"}
          </div>
        </Card>
      </div>

      {/* Synced pricing management */}
      {syncMeta && (
        <Card className="p-4 flex items-center justify-between">
          <div className="text-sm text-text-muted">
            <span className="font-semibold text-text">{syncMeta.entryCount ?? "?"} synced rates</span>{" "}
            from {syncMeta.sources?.length ?? 0} source(s) · these never override your own edits
          </div>
          <button
            onClick={handleClearSynced}
            className="text-sm text-red-500 hover:bg-red-500/10 border border-red-500/20 rounded px-3 py-1.5 transition-colors"
          >
            Clear Synced Prices
          </button>
        </Card>
      )}

      {/* Info Section */}
      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">How Pricing Works</h2>
        <div className="space-y-3 text-sm text-text-muted">
          <p>
            <strong>Cost Calculation:</strong> Costs are calculated based on token usage and pricing rates.
            Each request&apos;s cost is determined by: (input_tokens × input_rate) + (output_tokens × output_rate) + (cached_tokens × cached_rate)
          </p>
          <p>
            <strong>Pricing Format:</strong> All rates are in <strong>dollars per million tokens</strong> ($/1M tokens).
            Example: An input rate of 2.50 means $2.50 per 1,000,000 input tokens.
          </p>
          <p>
            <strong>Sovereignty:</strong> Your own overrides always win, then synced prices, then built-in defaults.
            Free models inherit their paid sibling&apos;s rate automatically.
          </p>
          <p>
            <strong>Token Types:</strong>
          </p>
          <ul className="list-disc list-inside ml-4 space-y-1">
            <li><strong>Input:</strong> Standard prompt tokens</li>
            <li><strong>Output:</strong> Completion/response tokens</li>
            <li><strong>Cached:</strong> Cached input tokens (typically 50% of input rate)</li>
            <li><strong>Reasoning:</strong> Special reasoning/thinking tokens (fallback to output rate)</li>
            <li><strong>Cache Creation:</strong> Tokens used to create cache entries (fallback to input rate)</li>
          </ul>
          <p>
            <strong>Custom Pricing:</strong> You can override default pricing for specific models.
            Reset to defaults anytime to restore standard rates.
          </p>
        </div>
      </Card>

      {/* Current Pricing Preview */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Current Pricing Overview</h2>
          <button
            onClick={() => setShowModal(true)}
            className="text-primary hover:underline text-sm"
          >
            View Full Details
          </button>
        </div>

        {loading ? (
          <div className="text-center py-4 text-text-muted">Loading pricing data...</div>
        ) : currentPricing ? (
          <div className="space-y-3">
            {Object.keys(currentPricing).slice(0, 5).map(provider => (
              <div key={provider} className="text-sm">
                <span className="font-semibold">{provider.toUpperCase()}:</span>{" "}
                <span className="text-text-muted">
                  {Object.keys(currentPricing[provider]).length} models
                </span>
              </div>
            ))}
            {Object.keys(currentPricing).length > 5 && (
              <div className="text-sm text-text-muted">
                + {Object.keys(currentPricing).length - 5} more providers
              </div>
            )}
          </div>
        ) : (
          <div className="text-text-muted">No pricing data available</div>
        )}
      </Card>

      {/* Pricing Modal */}
      {showModal && (
        <PricingModal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          onSave={handlePricingUpdated}
        />
      )}
    </div>
  );
}
