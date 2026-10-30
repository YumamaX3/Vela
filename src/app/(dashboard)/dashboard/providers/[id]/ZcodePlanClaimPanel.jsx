"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Badge, Toggle } from "@/shared/components";

function relativeTime(value) {
  if (!value) return "";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Math.max(0, Date.now() - then);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function countOf(value) {
  if (Array.isArray(value)) return value.length;
  if (typeof value === "number") return value;
  return 0;
}

async function postJson(url, body) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, ...data, error: data.error || `Request failed (${res.status})` };
    return data;
  } catch (error) {
    return { ok: false, error: error.message || "Network error" };
  }
}

export default function ZcodePlanClaimPanel({ connection, onRefreshConnection }) {
  const [offers, setOffers] = useState(null);
  const [loadingOffers, setLoadingOffers] = useState(false);
  const [claimingPlanId, setClaimingPlanId] = useState(null);
  const [claimingAll, setClaimingAll] = useState(false);
  const [claimAllSummary, setClaimAllSummary] = useState(null);
  const [offerProblems, setOfferProblems] = useState({});
  const [warmState, setWarmState] = useState(null);
  const [autoClaim, setAutoClaim] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(false);

  const quota = connection?.providerSpecificData?.zcodeQuota;
  const lastClaim = connection?.providerSpecificData?.zcodeLastClaimResult;
  const planName = quota?.planName || "ZCode Plan";

  useEffect(() => {
    if (!expanded || autoClaim !== null) return;
    let cancelled = false;
    fetch("/api/providers/zcode-plan/auto-claim", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => { if (!cancelled) setAutoClaim(data?.enabled === true); })
      .catch(() => { if (!cancelled) setAutoClaim(false); });
    return () => { cancelled = true; };
  }, [expanded, autoClaim]);

  const loadOffers = async () => {
    setLoadingOffers(true);
    setError(null);
    const data = await postJson("/api/providers/zcode-plan/offers", { connectionId: connection.id });
    if (Array.isArray(data.offers)) {
      setOffers(data.offers);
    } else {
      setError(data.error || "Could not read offers");
    }
    setLoadingOffers(false);
  };

  const claimPlan = async (planId) => {
    setClaimingPlanId(planId);
    setOfferProblems((prev) => ({ ...prev, [planId]: null }));
    const data = await postJson("/api/providers/zcode-plan/claim", { connectionId: connection.id, planId });
    if (data.ok) {
      await loadOffers();
      if (onRefreshConnection) await onRefreshConnection(connection.id);
    } else {
      setOfferProblems((prev) => ({ ...prev, [planId]: data.problem || data.error || "Claim failed" }));
    }
    setClaimingPlanId(null);
  };

  const claimAll = async () => {
    setClaimingAll(true);
    setClaimAllSummary(null);
    setError(null);
    const data = await postJson("/api/providers/zcode-plan/claim", { connectionId: connection.id, all: true });
    const hasSummary = data.ok === true
      || Array.isArray(data.claimed)
      || Array.isArray(data.skipped)
      || data.claimed != null
      || data.skipped != null;
    if (hasSummary) {
      const claimedCount = countOf(data.claimed);
      const skippedCount = countOf(data.skipped);
      setClaimAllSummary({
        claimed: claimedCount,
        skipped: skippedCount,
        problems: Array.isArray(data.problems) ? data.problems : [],
      });
      await loadOffers();
      if (onRefreshConnection) await onRefreshConnection(connection.id);
    } else {
      setError(data.problem || data.error || "Claim failed");
    }
    setClaimingAll(false);
  };

  const toggleAutoClaim = async (enabled) => {
    setAutoClaim(enabled);
    const data = await postJson("/api/providers/zcode-plan/auto-claim", { enabled });
    if (data.ok === false) {
      setAutoClaim(!enabled);
      setError(data.error || "Could not update auto-claim");
    }
  };

  const sendWarm = async () => {
    setWarmState(null);
    const data = await postJson("/api/providers/zcode-plan/warm", { connectionId: connection.id });
    setWarmState(data.ok ? "done" : (data.problem || data.error || "Warm failed"));
  };

  const claimAllProblems = claimAllSummary?.problems?.length
    ? claimAllSummary.problems.join(" · ")
    : null;
  const lastClaimProblems = Array.isArray(lastClaim?.problems) && lastClaim.problems.length
    ? lastClaim.problems.join(" · ")
    : null;

  return (
    <div className="mt-1 rounded-lg border border-black/[0.04] bg-black/[0.01] px-2 py-1.5 dark:border-white/[0.04] dark:bg-white/[0.01]">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left motion-control hover:bg-black/5 dark:hover:bg-white/5"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="material-symbols-outlined text-base text-text-muted">inventory_2</span>
          <span className="truncate text-xs font-medium">{planName}</span>
          {quota?.fetchedAt && (
            <span className="shrink-0 text-2xs text-text-muted">updated {relativeTime(quota.fetchedAt)}</span>
          )}
        </span>
        <span className="material-symbols-outlined shrink-0 text-base text-text-muted">
          {expanded ? "expand_less" : "expand_more"}
        </span>
      </button>

      {lastClaim && (
        <p
          className="mt-0.5 truncate px-1 text-2xs text-text-muted"
          title={lastClaimProblems || undefined}
        >
          Last auto-claim {relativeTime(lastClaim.at)}: claimed {countOf(lastClaim.claimed)}, skipped {countOf(lastClaim.skipped)}
          {lastClaimProblems ? ` · ${lastClaimProblems}` : ""}
        </p>
      )}

      {expanded && (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={loadOffers}
              disabled={loadingOffers}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-text-muted motion-control hover:bg-black/5 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/5"
            >
              <span className="material-symbols-outlined text-sm">
                {loadingOffers ? "progress_activity" : "search"}
              </span>
              Check offers
            </button>
            <button
              onClick={claimAll}
              disabled={claimingAll}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-text-muted motion-control hover:bg-black/5 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/5"
            >
              <span className="material-symbols-outlined text-sm">
                {claimingAll ? "progress_activity" : "done_all"}
              </span>
              Claim all
            </button>
            <button
              onClick={sendWarm}
              className="flex items-center gap-1 rounded px-2 py-1 text-2xs text-text-muted motion-control hover:bg-black/5 hover:text-primary dark:hover:bg-white/5"
            >
              <span className="material-symbols-outlined text-sm">local_fire_department</span>
              Send warm events
            </button>
            <label className="ml-auto flex items-center gap-1.5 text-2xs text-text-muted">
              Auto-claim
              <Toggle
                size="sm"
                checked={autoClaim === true}
                onChange={toggleAutoClaim}
                title={autoClaim === true ? "Disable auto-claim" : "Enable auto-claim"}
              />
            </label>
          </div>

          {error && (
            <p className="truncate text-2xs text-red-500" title={error}>{error}</p>
          )}

          {warmState && (
            <p className={`truncate text-2xs ${warmState === "done" ? "text-text-muted" : "text-red-500"}`}>
              {warmState === "done" ? "Warm events sent" : warmState}
            </p>
          )}

          {claimAllSummary && (
            <p
              className="truncate text-2xs text-text-muted"
              title={claimAllProblems || undefined}
            >
              Claimed: {claimAllSummary.claimed} · Skipped: {claimAllSummary.skipped}
              {claimAllProblems ? ` · ${claimAllProblems}` : ""}
            </p>
          )}

          {offers && (
            <div className="flex flex-col divide-y divide-black/[0.03] rounded border border-black/[0.04] dark:divide-white/[0.03] dark:border-white/[0.04]">
              {offers.length === 0 && (
                <p className="px-2 py-1.5 text-2xs text-text-muted">No offers returned.</p>
              )}
              {offers.map((offer) => (
                <div
                  key={offer.planId}
                  className="flex items-center justify-between gap-2 px-2 py-1.5 motion-control hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-xs">{offer.name || offer.planId}</span>
                      {offer.priority != null && (
                        <Badge variant="default" size="sm">#{offer.priority}</Badge>
                      )}
                    </span>
                    {offerProblems[offer.planId] && (
                      <span className="truncate text-2xs text-red-500" title={offerProblems[offer.planId]}>
                        {offerProblems[offer.planId]}
                      </span>
                    )}
                  </div>
                  {offer.owned ? (
                    <Badge variant="success" size="sm">owned</Badge>
                  ) : (
                    <button
                      onClick={() => claimPlan(offer.planId)}
                      disabled={claimingPlanId === offer.planId}
                      className="flex items-center gap-1 rounded px-2 py-0.5 text-2xs text-primary motion-control hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {claimingPlanId === offer.planId && (
                        <span className="material-symbols-outlined text-sm">progress_activity</span>
                      )}
                      Claim
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

ZcodePlanClaimPanel.propTypes = {
  connection: PropTypes.shape({
    id: PropTypes.string.isRequired,
    provider: PropTypes.string,
    providerSpecificData: PropTypes.shape({
      zcodeQuota: PropTypes.shape({
        planName: PropTypes.string,
        expiresAt: PropTypes.string,
        entitlements: PropTypes.array,
        fetchedAt: PropTypes.string,
      }),
      zcodeLastClaimResult: PropTypes.shape({
        at: PropTypes.string,
        claimed: PropTypes.oneOfType([PropTypes.number, PropTypes.array]),
        skipped: PropTypes.oneOfType([PropTypes.number, PropTypes.array]),
        problems: PropTypes.array,
      }),
    }),
  }).isRequired,
  onRefreshConnection: PropTypes.func,
};
