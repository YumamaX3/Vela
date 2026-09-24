"use client";
// Billing — the cost ledger's rates.
//
// This was an orphan room at /dashboard/settings/pricing: reachable only by
// knowing the URL, sitting beside a console it had no door to. It is folded in
// here as a lens, and the orphan path becomes a redirect so any bookmark still
// lands.
//
// The body is the orphan's, carried across whole — same four fetches, same
// stat band, same "How Pricing Works" prose. Two changes only: the shell's
// padding and max-width are gone (the panel supplies them), and the native
// `confirm()` on "Clear Synced Prices" is now the room's ConfirmModal. A native
// confirm is a browser dialog with no house voice and no styling; every other
// destructive act in this console asks through the same door.
import { useState, useEffect } from "react";
import { Button, Card, ConfirmModal } from "@/shared/components";
import PricingModal from "@/shared/components/PricingModal";
import StatusLine from "../StatusLine";

export default function BillingTab() {
  const [showModal, setShowModal] = useState(false);
  const [currentPricing, setCurrentPricing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncMeta, setSyncMeta] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);


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
  useEffect(() => {
    loadPricing();
    loadSyncMeta();
  }, []);

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
    setConfirmClear(false);
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
    <>
      <Card>
        <div className="flex items-start gap-3 mb-4">
          <div className="p-2 rounded-[10px] bg-brand-500/10 text-brand-500 shrink-0">
            <span className="material-symbols-outlined text-[20px] leading-none">payments</span>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-text-main font-semibold">Pricing rates</h3>
            <p className="text-sm text-text-muted mt-0.5">
              Configure pricing rates for cost tracking and calculations.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            icon="sync"
            loading={syncing}
            disabled={syncing}
            onClick={handleSync}
            className="w-full sm:w-auto"
          >
            {syncing ? "Syncing…" : "Sync Prices"}
          </Button>
          <Button variant="primary" icon="edit" onClick={() => setShowModal(true)} className="w-full sm:w-auto">
            Edit Pricing
          </Button>
        </div>

        {syncResult && (
          <div
            className={`mt-4 p-3 rounded-[10px] border text-sm ${
              syncResult.ok
                ? "border-success/40 bg-success/5"
                : "border-red-500/40 bg-red-500/5"
            }`}
          >
            {syncResult.ok ? (
              <>
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
              </>
            ) : (
              <div className="text-red-500">
                Sync failed: {syncResult.data?.error || syncResult.error || "unknown error"}
              </div>
            )}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card padding="sm">
          <div className="text-text-muted text-sm uppercase font-semibold">Total Models</div>
          <div className="text-2xl font-bold mt-1">{loading ? "..." : getModelCount()}</div>
        </Card>
        <Card padding="sm">
          <div className="text-text-muted text-sm uppercase font-semibold">Providers</div>
          <div className="text-2xl font-bold mt-1">{loading ? "..." : getProviders().length}</div>
        </Card>
        <Card padding="sm">
          <div className="text-text-muted text-sm uppercase font-semibold">Last Synced</div>
          <div className="text-lg font-bold mt-1">
            {syncMeta?.syncedAt ? new Date(syncMeta.syncedAt).toLocaleString() : "Never"}
          </div>
        </Card>
        <Card padding="sm">
          <div className="text-text-muted text-sm uppercase font-semibold">Status</div>
          <div className="text-2xl font-bold mt-1 text-success">{loading ? "..." : "Active"}</div>
        </Card>
      </div>

      {syncMeta && (
        <Card padding="sm">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="text-sm text-text-muted">
              <span className="font-semibold text-text-main">{syncMeta.entryCount ?? "?"} synced rates</span>{" "}
              from {syncMeta.sources?.length ?? 0} source(s) · these never override your own edits
            </div>
            <Button variant="ghost" size="sm" onClick={() => setConfirmClear(true)}>
              Clear Synced Prices
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <h3 className="text-text-main font-semibold mb-4">How Pricing Works</h3>
        <div className="space-y-3 text-sm text-text-muted">
          <p>
            <strong className="text-text-main">Cost Calculation:</strong> Costs are calculated based on token usage and pricing rates.
            Each request&apos;s cost is determined by: (input_tokens × input_rate) + (output_tokens × output_rate) + (cached_tokens × cached_rate)
          </p>
          <p>
            <strong className="text-text-main">Pricing Format:</strong> All rates are in <strong className="text-text-main">dollars per million tokens</strong> ($/1M tokens).
            Example: An input rate of 2.50 means $2.50 per 1,000,000 input tokens.
          </p>
          <p>
            <strong className="text-text-main">Sovereignty:</strong> Your own overrides always win, then synced prices, then built-in defaults.
            Free models inherit their paid sibling&apos;s rate automatically.
          </p>
          <p>
            <strong className="text-text-main">Token Types:</strong>
          </p>
          <ul className="list-disc list-inside ml-4 space-y-1">
            <li><strong className="text-text-main">Input:</strong> Standard prompt tokens</li>
            <li><strong className="text-text-main">Output:</strong> Completion/response tokens</li>
            <li><strong className="text-text-main">Cached:</strong> Cached input tokens (typically 50% of input rate)</li>
            <li><strong className="text-text-main">Reasoning:</strong> Special reasoning/thinking tokens (fallback to output rate)</li>
            <li><strong className="text-text-main">Cache Creation:</strong> Tokens used to create cache entries (fallback to input rate)</li>
          </ul>
          <p>
            <strong className="text-text-main">Custom Pricing:</strong> You can override default pricing for specific models.
            Reset to defaults anytime to restore standard rates.
          </p>
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between gap-4 mb-4">
          <h3 className="text-text-main font-semibold">Current Pricing Overview</h3>
          <button
            onClick={() => setShowModal(true)}
            className="text-sm font-medium text-brand-500 hover:underline shrink-0"
          >
            View Full Details
          </button>
        </div>

        {loading ? (
          <div className="text-center py-4 text-text-muted">Loading pricing data...</div>
        ) : currentPricing ? (
          <div className="space-y-3">
            {Object.keys(currentPricing).slice(0, 5).map((provider) => (
              <div key={provider} className="text-sm">
                <span className="font-semibold text-text-main">{provider.toUpperCase()}:</span>{" "}
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

      {showModal && (
        <PricingModal isOpen={showModal} onClose={() => setShowModal(false)} onSave={handlePricingUpdated} />
      )}

      <ConfirmModal
        isOpen={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={handleClearSynced}
        title="Clear synced prices"
        message="Clear synced prices? Your own overrides are not touched."
        confirmText="Clear"
      />
    </>
  );
}
