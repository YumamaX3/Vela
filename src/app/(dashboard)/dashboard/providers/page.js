"use client";
import { useState, useEffect, useMemo } from "react";
import PropTypes from "prop-types";
import { Badge, Button, Toggle, CardSkeleton } from "@/shared/components";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { getProviderIconSrc } from "@/shared/utils/providerIcon";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS } from "@/shared/constants/config";
import {
  FREE_PROVIDERS,
  FREE_TIER_PROVIDERS,
  OPENAI_COMPATIBLE_PREFIX,
  ANTHROPIC_COMPATIBLE_PREFIX,
} from "@/shared/constants/providers";
import Link from "next/link";
import { getErrorCode, getRelativeTime } from "@/shared/utils";
import { useNotificationStore } from "@/store/notificationStore";
import { useHeaderSearchStore } from "@/store/headerSearchStore";
import ModelAvailabilityBadge from "./components/ModelAvailabilityBadge";
import AddCompatibleModal from "./components/AddCompatibleModal";

// ── State vocabulary ───────────────────────────────────────────────────────
// Six states, one order. The order IS the priority: a provider that is down
// outranks one that is merely degraded, which outranks one cooling off. Every
// sort and every count in this file reads this one array, so a new state
// cannot be added in one place and forgotten in another.
//
// "unconfigured" is deliberately NOT "idle": a provider with no connections
// has never been enabled, and calling it "Disabled" would report a state it
// was never in. The old grid conflated the two under "No connections" for
// good reason; they are separated here because the console sorts and counts
// them, and a count of "Disabled: 99" on an empty install is a lie.
const FLEET_STATES = ["down", "degraded", "cooling", "healthy", "idle", "unconfigured"];
const STATE_RANK = Object.fromEntries(FLEET_STATES.map((s, i) => [s, i]));
const STATE_LABEL = {
  healthy: "Healthy",
  degraded: "Degraded",
  cooling: "Cooling",
  down: "Down",
  idle: "Disabled",
  unconfigured: "Not connected",
};
// Each state resolves to a design token, never a literal: the console has to
// re-theme with the rest of the deck, and a hex here would survive a rebrand
// as the one thing that did not move.
const STATE_TOKEN = {
  healthy: "var(--color-success)",
  degraded: "var(--color-warning)",
  cooling: "var(--color-info)",
  down: "var(--color-danger)",
  idle: "var(--color-text-subtle)",
  unconfigured: "var(--color-text-subtle)",
};

function getConnectionErrorTag(connection) {
  if (!connection) return null;
  const explicitType = connection.lastErrorType;
  if (explicitType === "runtime_error") return "RUNTIME";
  if (
    explicitType === "upstream_auth_error" ||
    explicitType === "auth_missing" ||
    explicitType === "token_refresh_failed" ||
    explicitType === "token_expired"
  )
    return "AUTH";
  if (explicitType === "upstream_rate_limited") return "429";
  if (explicitType === "upstream_unavailable") return "5XX";
  if (explicitType === "network_error") return "NET";
  const numericCode = Number(connection.errorCode);
  if (Number.isFinite(numericCode) && numericCode >= 400)
    return String(numericCode);
  const fromMessage = getErrorCode(connection.lastError);
  if (fromMessage === "401" || fromMessage === "403") return "AUTH";
  if (fromMessage && fromMessage !== "ERR") return fromMessage;
  const msg = (connection.lastError || "").toLowerCase();
  if (msg.includes("runtime") || msg.includes("not runnable") || msg.includes("not installed"))
    return "RUNTIME";
  if (
    msg.includes("invalid api key") ||
    msg.includes("token invalid") ||
    msg.includes("revoked") ||
    msg.includes("unauthorized")
  )
    return "AUTH";
  return "ERR";
}

// A connection is "cooling" when a model lock is still in the future. That is
// the one derived state with no column of its own, so it is computed here and
// reused by every caller rather than re-derived per row.
function isCooling(conn) {
  const now = Date.now();
  return Object.entries(conn).some(
    ([k, v]) => k.startsWith("modelLock_") && v && new Date(v).getTime() > now,
  );
}

// Reduce one provider's connections to a single fleet state. Precedence is
// deliberate: any rejected key is "down" even if a sibling key still serves,
// because a provider with a dead credential is a provider you must look at.
//
// `noAuth` is passed in because a provider that needs no credential at all
// (local Ollama, and the other keyless free providers) is usable with zero
// connection records. The page this console replaces called those "Ready";
// reporting them as "Not connected" would be a regression and a lie.
function deriveState(conns, noAuth = false) {
  if (!conns.length) return noAuth ? "healthy" : "unconfigured";
  if (conns.every((c) => c.isActive === false)) return "idle";
  const active = conns.filter((c) => c.isActive !== false);
  if (active.some((c) => isCooling(c))) return "cooling";
  const broken = active.filter((c) => {
    const s = c.testStatus === "unavailable" && !isCooling(c) ? "active" : c.testStatus;
    return s === "error" || s === "expired" || s === "unavailable";
  });
  if (broken.length === active.length) return "down";
  if (broken.length > 0) return "degraded";
  return "healthy";
}

export default function ProvidersPage() {
  const [connections, setConnections] = useState([]);
  const [providerNodes, setProviderNodes] = useState([]);
  const [modelCounts, setModelCounts] = useState({});
  const [activity, setActivity] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [showAddCompatibleModal, setShowAddCompatibleModal] = useState(false);
  const [showAddAnthropicCompatibleModal, setShowAddAnthropicCompatibleModal] =
    useState(false);
  const [stateFilter, setStateFilter] = useState("all");
  const [authFilter, setAuthFilter] = useState("all");
  const [sortBy, setSortBy] = useState("health");
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState(null);
  const notify = useNotificationStore();
  const searchQuery = useHeaderSearchStore((s) => s.query);
  const registerSearch = useHeaderSearchStore((s) => s.register);
  const unregisterSearch = useHeaderSearchStore((s) => s.unregister);

  useEffect(() => {
    registerSearch("Search providers...");
    return () => unregisterSearch();
  }, [registerSearch, unregisterSearch]);

  // The fetch lives INSIDE the effect, which is this codebase's pattern and
  // the one the lint rule wants: setState is reached from the response path,
  // never synchronously from the effect body. Retry bumps a key rather than
  // calling a component-scope function, so there is one fetch path and no
  // second one to keep in sync.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    const fetchData = async () => {
      try {
        const [connRes, nodeRes, modelRes, actRes] = await Promise.all([
          fetch("/api/providers"),
          fetch("/api/provider-nodes"),
          fetch("/api/models"),
          fetch("/api/usage/providers/activity"),
        ]);
        if (!alive) return;
        if (!connRes.ok) throw new Error("provider list unavailable");
        const connData = await connRes.json();
        if (!alive) return;
        setConnections(connData.connections || []);
        if (nodeRes.ok) {
          const nodeData = await nodeRes.json();
          if (alive) setProviderNodes(nodeData.nodes || []);
        }
        if (modelRes.ok) {
          const modelData = await modelRes.json();
          // One request, counted once here: a per-provider fan-out would be
          // fifty requests for a number the page already has in hand.
          const counts = {};
          for (const m of modelData.models || []) {
            counts[m.provider] = (counts[m.provider] || 0) + 1;
          }
          if (alive) setModelCounts(counts);
        }
        if (actRes.ok) {
          const actData = await actRes.json();
          if (alive) setActivity(actData.perProvider || {});
        }
        if (alive) setLoadError(null);
      } catch (err) {
        if (alive) setLoadError(err.message || "Could not load providers");
      } finally {
        if (alive) setLoading(false);
      }
    };
    fetchData();
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const retry = () => {
    setLoading(true);
    setLoadError(null);
    setReloadKey((k) => k + 1);
  };

  // ── Provider registry → one flat list ────────────────────────────────────
  // The old page kept five arrays and rendered five sections. One list with
  // an auth field means one filter, one sort, and one place a state can be
  // wrong. Hidden providers stay hidden; service kind still gates to llm.
  //
  // Deduped by id, because a dual-auth provider (xai, kiro, codebuddy) can be
  // catalogued in more than one registry. Without this the same provider would
  // render twice with the same React key and be counted twice in every total.
  // First registration wins; the order below is deliberate (oauth, free,
  // apikey, then dynamic nodes).
  const providers = useMemo(() => {
    const byId = new Map();
    const push = (key, info, auth) => {
      if (!info || info.hidden || byId.has(key)) return;
      byId.set(key, {
        id: key,
        name: info.name || key,
        color: info.color,
        textIcon: info.textIcon,
        noAuth: !!info.noAuth,
        auth,
      });
    };
    for (const [key, info] of Object.entries(OAUTH_PROVIDERS)) push(key, info, "oauth");
    for (const [key, info] of Object.entries(FREE_PROVIDERS)) push(key, info, "free");
    for (const [key, info] of Object.entries(FREE_TIER_PROVIDERS)) {
      if (!(info.serviceKinds ?? ["llm"]).includes("llm")) continue;
      push(key, info, "free");
    }
    for (const [key, info] of Object.entries(APIKEY_PROVIDERS)) {
      if (!(info.serviceKinds ?? ["llm"]).includes("llm")) continue;
      push(key, info, "apikey");
    }
    for (const node of providerNodes) {
      if (node.type !== "openai-compatible" && node.type !== "anthropic-compatible")
        continue;
      if (byId.has(node.id)) continue;
      byId.set(node.id, {
        id: node.id,
        name: node.name || "Compatible",
        color: node.type === "anthropic-compatible" ? "#D97757" : "#10A37F",
        textIcon: node.type === "anthropic-compatible" ? "AC" : "OC",
        apiType: node.apiType,
        isCompatible: true,
        auth: "custom",
      });
    }
    return [...byId.values()];
  }, [providerNodes]);

  const rows = useMemo(() => {
    return providers.map((p) => {
      const conns = connections.filter((c) => c.provider === p.id);
      const state = deriveState(conns, p.noAuth);
      const latestError = conns
        .filter((c) => c.lastError)
        .sort((a, b) => new Date(b.lastErrorAt || 0) - new Date(a.lastErrorAt || 0))[0];
      const act = activity[p.id] || {};
      return {
        ...p,
        state,
        connections: conns,
        connectionCount: conns.length,
        modelCount: modelCounts[p.id] ?? 0,
        errorTag: latestError ? getConnectionErrorTag(latestError) : null,
        errorAt: latestError?.lastErrorAt || null,
        errorTime: latestError?.lastErrorAt ? getRelativeTime(latestError.lastErrorAt) : null,
        requests: act.requests || 0,
        errors: act.errors || 0,
      };
    });
  }, [providers, connections, modelCounts, activity]);

  const summary = useMemo(() => {
    const s = {
      healthy: 0, degraded: 0, cooling: 0, down: 0, idle: 0, unconfigured: 0, configured: 0,
    };
    for (const r of rows) {
      s[r.state] += 1;
      if (r.connectionCount > 0) s.configured += 1;
    }
    return s;
  }, [rows]);

  // The default lens is the fleet that EXISTS. A fresh install has ~99
  // catalogued providers and zero connections; listing all of them buries
  // the one thing the console is for. "All" is one click away and says so
  // in its own count, so the default hides nothing the operator cannot see.
  const [showUnconfigured, setShowUnconfigured] = useState(false);

  const visible = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = rows.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q)) return false;
      if (authFilter !== "all" && r.auth !== authFilter) return false;
      if (stateFilter === "issues") {
        return r.state === "degraded" || r.state === "down" || r.state === "cooling";
      }
      if (stateFilter === "all") {
        // Searching is an explicit ask for the whole catalogue; without a
        // search, unconfigured providers stay behind the reveal.
        if (!q && !showUnconfigured && r.state === "unconfigured") return false;
        return true;
      }
      if (stateFilter === "unconfigured") return r.state === "unconfigured";
      return r.state === stateFilter;
    });
    list = [...list].sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "models") return b.modelCount - a.modelCount;
      if (sortBy === "activity") return b.requests - a.requests;
      // Priority is the routing order (lower runs first), which the page this
      // console replaces sorted by. Displaying it without offering the sort
      // would keep the column and lose the reason it exists.
      if (sortBy === "priority") {
        const pa = a.connections[0]?.priority ?? 999;
        const pb = b.connections[0]?.priority ?? 999;
        if (pa !== pb) return pa - pb;
        return a.name.localeCompare(b.name);
      }
      // health: broken first, then configured before unconfigured, then name
      const rs = STATE_RANK[a.state] - STATE_RANK[b.state];
      if (rs !== 0) return rs;
      const rc = (b.connectionCount > 0 ? 1 : 0) - (a.connectionCount > 0 ? 1 : 0);
      if (rc !== 0) return rc;
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [rows, searchQuery, authFilter, stateFilter, sortBy, showUnconfigured]);

  // One sweep for the whole fleet, replacing the old page's three per-section
  // "Test All" buttons. The route already accepts mode "all"; the console has
  // exactly one place to ask, which is one place for the answer to land.
  // A "lens" is any active narrowing: a search term or a non-default filter.
  // The empty-state copy depends on whether the operator is looking through
  // one, because "nothing matches" and "nothing exists" are different truths.
  const hasActiveLens =
    !!searchQuery.trim() ||
    authFilter !== "all" ||
    stateFilter !== "all" ||
    sortBy !== "health" ||
    showUnconfigured;

  // One sweep for the whole fleet, replacing the old page's three per-section
  // "Test All" buttons. The route already accepts mode "all"; the console has
  // exactly one place to ask, which is one place for the answer to land.
  const handleTestAll = async () => {
    if (testing) return;
    setTesting(true);
    setTestResults(null);
    try {
      const res = await fetch("/api/providers/test-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "all" }),
      });
      const data = await res.json();
      setTestResults(data);
      if (data.summary) {
        const { passed, failed, total } = data.summary;
        if (failed === 0) notify.success(`All ${total} tests passed`);
        else notify.warning(`${passed}/${total} passed, ${failed} failed`);
      }
    } catch {
      setTestResults({ error: "Test request failed" });
      notify.error("Provider test failed");
    } finally {
      setTesting(false);
    }
  };

  const handleToggleProvider = async (providerId, newActive) => {
    const matches = (c) => c.provider === providerId;
    const providerConns = connections.filter(matches);
    setConnections((prev) =>
      prev.map((c) => (matches(c) ? { ...c, isActive: newActive } : c)),
    );
    await Promise.allSettled(
      providerConns.map((c) =>
        fetch(`/api/providers/${c.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: newActive }),
        }),
      ),
    );
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4 px-1 sm:px-0">
      {/* ── Health strip: the one focal point, and the first thing read ── */}
      <section className="fleet-health" aria-label="Fleet health summary">
        <div className="fleet-health-cell">
          <div className="fleet-health-k">
            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
              monitor_heart
            </span>
            Fleet health
          </div>
          <div className="fleet-health-v">
            {summary.healthy}
            <span className="fleet-health-sub" style={{ display: "inline", marginLeft: 6 }}>
              of {summary.configured} configured
            </span>
          </div>
          <div className="fleet-health-sub">
            {summary.unconfigured} providers not yet connected
          </div>
          {/* The bar's segments are flex-grow values set from the counts, so
              the shape of the bar is the data and not a drawn guess. The
              unconfigured segment is surface.3, the same colour the empty
              activity meter uses, so "nothing here" reads the same twice. */}
          <div
            className="fleet-ratio"
            role="img"
            aria-label={`${summary.healthy} healthy, ${summary.degraded} degraded, ${summary.cooling} cooling, ${summary.down} down, ${summary.idle} disabled, ${summary.unconfigured} not connected`}
          >
            {summary.healthy > 0 && (
              <i style={{ flexGrow: summary.healthy, background: STATE_TOKEN.healthy }} />
            )}
            {summary.degraded > 0 && (
              <i style={{ flexGrow: summary.degraded, background: STATE_TOKEN.degraded }} />
            )}
            {summary.cooling > 0 && (
              <i style={{ flexGrow: summary.cooling, background: STATE_TOKEN.cooling }} />
            )}
            {summary.down > 0 && (
              <i style={{ flexGrow: summary.down, background: STATE_TOKEN.down }} />
            )}
            {summary.idle > 0 && (
              <i style={{ flexGrow: summary.idle, background: STATE_TOKEN.idle }} />
            )}
            {summary.unconfigured > 0 && (
              <i style={{ flexGrow: summary.unconfigured, background: STATE_TOKEN.unconfigured }} />
            )}
          </div>
        </div>
        {[
          ["healthy", "Healthy", "all keys active"],
          ["degraded", "Degraded", "key errors, still serving"],
          ["cooling", "Cooling", "retry backoff"],
          ["down", "Down", "no healthy key"],
        ].map(([key, label, sub]) => (
          <div className="fleet-health-cell" key={key}>
            <div className="fleet-health-k">
              <span
                className={`fleet-dot${key === "down" && summary.down > 0 ? " is-pulsing" : ""}`}
                style={{ background: STATE_TOKEN[key] }}
                aria-hidden="true"
              />
              {label}
            </div>
            <div className="fleet-health-v">{summary[key]}</div>
            <div className="fleet-health-sub">{sub}</div>
          </div>
        ))}
      </section>

      {/* ── Filters. Search lives in the header (one search per page, not
             two); these narrow by state and auth type. ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-0.5 rounded-[10px] bg-surface-2 p-[3px]">
          {[
            ["all", "Configured", summary.configured],
            ["issues", "Needs attention", summary.degraded + summary.down + summary.cooling],
            ["healthy", "Healthy", summary.healthy],
            ["idle", "Disabled", summary.idle],
            ["unconfigured", "Not connected", summary.unconfigured],
          ].map(([key, label, n]) => (
            <button
              key={key}
              type="button"
              aria-pressed={stateFilter === key}
              onClick={() => setStateFilter(key)}
              className={`inline-flex min-h-[30px] cursor-pointer items-center gap-1.5 rounded-[7px] px-3 text-[12.5px] font-medium motion-control focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] ${
                stateFilter === key
                  ? "bg-surface text-text-main shadow-[var(--shadow-soft)]"
                  : "text-text-muted hover:text-text-main"
              }`}
            >
              {label}
              <span className="text-[11px] tabular-nums text-text-muted">{n}</span>
            </button>
          ))}
        </div>
        <select
          aria-label="Filter by auth type"
          value={authFilter}
          onChange={(e) => setAuthFilter(e.target.value)}
          className="min-h-9 cursor-pointer rounded-[10px] border border-border bg-surface px-2.5 text-[12.5px] text-text-main focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
        >
          <option value="all">All auth types</option>
          <option value="oauth">OAuth</option>
          <option value="apikey">API Key</option>
          <option value="free">Free</option>
          <option value="custom">Custom</option>
        </select>
        <select
          aria-label="Sort providers"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="min-h-9 cursor-pointer rounded-[10px] border border-border bg-surface px-2.5 text-[12.5px] text-text-main focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
        >
          <option value="health">Sort: health</option>
          <option value="priority">Sort: priority</option>
          <option value="name">Sort: name</option>
          <option value="models">Sort: model count</option>
          <option value="activity">Sort: recent activity</option>
        </select>
        <div className="ml-auto flex items-center gap-2">
          <ModelAvailabilityBadge />
          <button
            type="button"
            onClick={handleTestAll}
            disabled={testing}
            aria-label="Test every provider connection"
            className={`inline-flex min-h-9 items-center gap-1.5 rounded-[10px] border px-3 text-[12.5px] font-medium motion-control focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] disabled:opacity-60 ${
              testing
                ? "border-primary/40 bg-primary/20 text-primary"
                : "border-border bg-surface text-text-muted hover:border-primary/40 hover:text-text-main"
            }`}
          >
            <span
              className={`material-symbols-outlined text-[14px]${testing ? " animate-spin" : ""}`}
              aria-hidden="true"
            >
              {testing ? "progress_activity" : "play_arrow"}
            </span>
            {testing ? "Testing..." : "Test all"}
          </button>
          <Button size="sm" icon="add_link" onClick={() => setShowAddCompatibleModal(true)}>
            Compatible
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon="add_link"
            onClick={() => setShowAddAnthropicCompatibleModal(true)}
          >
            Anthropic
          </Button>
          <Link
            href="/dashboard/providers/new"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-[10px] bg-brand-500 px-3 text-[13px] font-semibold text-white motion-control hover:bg-brand-600 focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
              add
            </span>
            Add provider
          </Link>
        </div>
      </div>

      {/* ── The fleet. Empty, error and no-match are three different
             truths and get three different sentences. ── */}
      {loadError ? (
        <div className="fleet-table">
          <div className="py-11 text-center">
            <span className="material-symbols-outlined text-[32px] text-danger" aria-hidden="true">
              cloud_off
            </span>
            <h3 className="mt-2.5 text-sm font-semibold">Could not reach the gateway</h3>
            <p className="mx-auto mt-1 max-w-[42ch] text-[12.5px] text-text-muted">
              The provider list failed to load. Check that the Vela service is running, then retry.
            </p>
            <div className="mt-3.5">
              <Button size="sm" icon="refresh" onClick={retry}>
                Retry
              </Button>
            </div>
          </div>
        </div>
      ) : rows.length === 0 ? (
        <div className="fleet-table">
          <div className="py-11 text-center">
            <span className="material-symbols-outlined text-[32px] text-text-muted" aria-hidden="true">
              dns
            </span>
            <h3 className="mt-2.5 text-sm font-semibold">No providers configured</h3>
            <p className="mx-auto mt-1 max-w-[42ch] text-[12.5px] text-text-muted">
              Connect your first upstream to start routing. An API key or an OAuth sign-in is all it takes.
            </p>
          </div>
        </div>
      ) : (
        <div className="fleet-table">
          <div className="fleet-head-row">
            <span />
            <span>Provider</span>
            <span>Auth</span>
            <span>Models</span>
            <span>Activity</span>
            <span>Status</span>
            <span>Last error</span>
            <span>Priority</span>
            <span />
          </div>
          {visible.map((r) => (
            <FleetRow key={r.id} row={r} onToggle={handleToggleProvider} />
          ))}
          {/* "No match" is only true when a lens is actually narrowing. With
              no search and no filter, an empty list means the fleet itself
              is empty, and the reveal below is the honest next step. */}
          {visible.length === 0 && hasActiveLens && (
            <div className="py-11 text-center">
              <span className="material-symbols-outlined text-[32px] text-text-muted" aria-hidden="true">
                search_off
              </span>
              <h3 className="mt-2.5 text-sm font-semibold">No providers match</h3>
              <p className="mx-auto mt-1 max-w-[42ch] text-[12.5px] text-text-muted">
                Nothing matches the current search and filters. Clear the search or pick another filter.
              </p>
            </div>
          )}
          {/* No lens, nothing configured, and no catalogue to reveal: the
              true empty install. */}
          {visible.length === 0 && !hasActiveLens && summary.unconfigured === 0 && (
            <div className="py-11 text-center">
              <span className="material-symbols-outlined text-[32px] text-text-muted" aria-hidden="true">
                dns
              </span>
              <h3 className="mt-2.5 text-sm font-semibold">No providers configured</h3>
              <p className="mx-auto mt-1 max-w-[42ch] text-[12.5px] text-text-muted">
                Connect your first upstream to start routing. An API key or an OAuth sign-in is all it takes.
              </p>
            </div>
          )}
          {/* No lens and nothing configured, but the catalogue is there: say
              so plainly, then offer the reveal. Two different truths, two
              different sentences, never both at once. */}
          {visible.length === 0 && !hasActiveLens && summary.unconfigured > 0 && (
            <div className="py-11 text-center">
              <span className="material-symbols-outlined text-[32px] text-text-muted" aria-hidden="true">
                dns
              </span>
              <h3 className="mt-2.5 text-sm font-semibold">No providers connected yet</h3>
              <p className="mx-auto mt-1 max-w-[42ch] text-[12.5px] text-text-muted">
                {summary.unconfigured} providers are catalogued and ready. Add a key or sign in with OAuth to bring one online.
              </p>
            </div>
          )}
          {/* The reveal. Without a search the console shows the fleet that
              exists; this is the honest door to the rest of the catalogue,
              and it names the number rather than making the operator guess. */}
          {stateFilter === "all" && !searchQuery.trim() && !showUnconfigured && summary.unconfigured > 0 && (
            <button
              type="button"
              onClick={() => setShowUnconfigured(true)}
              className="flex w-full cursor-pointer items-center justify-center gap-1.5 border-t border-dashed border-border px-3 py-3 text-[13px] font-medium text-text-muted motion-control hover:bg-bg-alt hover:text-text-main focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
            >
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                expand_more
              </span>
              Show {summary.unconfigured} providers not yet connected
            </button>
          )}
        </div>
      )}

      <AddCompatibleModal
        variant="openai"
        isOpen={showAddCompatibleModal}
        onClose={() => setShowAddCompatibleModal(false)}
        onCreated={(node) => {
          setProviderNodes((prev) => [...prev, node]);
          setShowAddCompatibleModal(false);
          notify.success("Compatible provider added");
        }}
      />
      <AddCompatibleModal
        variant="anthropic"
        isOpen={showAddAnthropicCompatibleModal}
        onClose={() => setShowAddAnthropicCompatibleModal(false)}
        onCreated={(node) => {
          setProviderNodes((prev) => [...prev, node]);
          setShowAddAnthropicCompatibleModal(false);
          notify.success("Compatible provider added");
        }}
      />

      {/* Test results, unchanged from the page this replaces: the modal was
          the right shape, so only its trigger moved to the fleet bar. */}
      {testResults && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center px-3 pt-[6vh] sm:pt-[10vh]"
          onClick={() => setTestResults(null)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative max-h-[86vh] w-full max-w-[600px] overflow-y-auto rounded-xl border border-border bg-surface shadow-2xl sm:max-h-[80vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-xl border-b border-border bg-surface/95 px-5 py-3 backdrop-blur-sm">
              <h3 className="font-semibold">Test results</h3>
              <button
                type="button"
                onClick={() => setTestResults(null)}
                className="cursor-pointer rounded-lg p-1 text-text-muted motion-control hover:bg-bg hover:text-text-main focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
                aria-label="Close test results"
              >
                <span className="material-symbols-outlined text-lg" aria-hidden="true">
                  close
                </span>
              </button>
            </div>
            <div className="p-5">
              <TestResultsView results={testResults} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Test results ───────────────────────────────────────────────────────────
// Ported verbatim from the page this console replaces: the batch route's
// response shape did not change, so neither should the reader of it.
function TestResultsView({ results }) {
  if (results.error && !results.results) {
    return (
      <div className="py-6 text-center">
        <span className="material-symbols-outlined mb-2 block text-[32px] text-danger" aria-hidden="true">
          error
        </span>
        <p className="text-sm text-danger">{results.error}</p>
      </div>
    );
  }
  const { summary } = results;
  const items = results.results || [];
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {summary && (
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs sm:gap-3">
          <span className="text-text-muted">Fleet test</span>
          <span className="rounded bg-emerald-500/15 px-2 py-0.5 font-medium text-emerald-400">
            {summary.passed} passed
          </span>
          {summary.failed > 0 && (
            <span className="rounded bg-red-500/15 px-2 py-0.5 font-medium text-red-400">
              {summary.failed} failed
            </span>
          )}
          <span className="text-text-muted sm:ml-auto">{summary.total} tested</span>
        </div>
      )}
      {items.map((r, i) => (
        <div
          key={r.connectionId || i}
          className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg bg-black/[0.03] px-3 py-2 text-xs dark:bg-white/[0.03] sm:flex-nowrap"
        >
          <span
            className={`material-symbols-outlined text-[16px] ${r.valid ? "text-emerald-500" : "text-danger"}`}
            aria-hidden="true"
          >
            {r.valid ? "check_circle" : "error"}
          </span>
          <div className="min-w-0 flex-[1_1_160px]">
            <span className="block truncate font-medium sm:inline">{r.connectionName}</span>
            <span className="block truncate text-text-muted sm:ml-1.5 sm:inline">({r.provider})</span>
          </div>
          {r.latencyMs !== undefined && (
            <span className="shrink-0 font-mono tabular-nums text-text-muted">{r.latencyMs}ms</span>
          )}
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
              r.valid ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
            }`}
          >
            {r.valid ? "OK" : r.diagnosis?.type || "ERROR"}
          </span>
        </div>
      ))}
      {items.length === 0 && (
        <div className="py-4 text-center text-sm text-text-muted">
          No active connections found.
        </div>
      )}
    </div>
  );
}

TestResultsView.propTypes = {
  results: PropTypes.shape({
    results: PropTypes.array,
    summary: PropTypes.shape({
      total: PropTypes.number,
      passed: PropTypes.number,
      failed: PropTypes.number,
    }),
    error: PropTypes.string,
  }).isRequired,
};

// ── One fleet row ──────────────────────────────────────────────────────────
function FleetRow({ row, onToggle }) {
  const r = row;
  const isCompatible = r.id.startsWith(OPENAI_COMPATIBLE_PREFIX) || r.id.startsWith(ANTHROPIC_COMPATIBLE_PREFIX);
  const isAnthropicCompatible = r.id.startsWith(ANTHROPIC_COMPATIBLE_PREFIX);
  const iconPath = isCompatible && r.apiType
    ? r.apiType === "responses"
      ? "/providers/oai-r.png"
      : "/providers/oai-cc.png"
    : isAnthropicCompatible
      ? "/providers/anthropic-m.png"
      : getProviderIconSrc(r.id);
  const authLabel = {
    oauth: "OAuth",
    apikey: "API Key",
    free: "Free",
    custom: "Custom",
  }[r.auth];
  // Dual-auth providers (xai, kiro, codebuddy) are catalogued under one bucket
  // but can hold the other credential. Once a connection exists, its own
  // authType is the truth; the registry bucket is only the fallback for a
  // provider with nothing connected. Showing "OAuth" on an API-key connection
  // was the first draft's defect, caught against real data.
  const connectedAuth = r.connections[0]?.authType;
  const authDisplay = connectedAuth
    ? { oauth: "OAuth", apikey: "API Key", api_key: "API Key", cookie: "Cookie" }[connectedAuth] || authLabel
    : authLabel;
  const anyActive = r.connections.some((c) => c.isActive !== false);
  // The meter: five segments, filled from how many requests the provider
  // served in the last 60s. It answers "is this one actually carrying
  // traffic", which a colour dot cannot.
  const filled = r.requests === 0 ? 0 : r.requests < 5 ? 2 : r.requests < 50 ? 3 : r.requests < 500 ? 4 : 5;

  return (
    <Link
      href={`/dashboard/providers/${r.id}`}
      className={`fleet-row${r.state === "idle" ? " is-dim" : ""}`}
      aria-label={`${r.name}, ${STATE_LABEL[r.state]}`}
    >
      <span className="fleet-col-dot flex items-center">
        <span
          className={`fleet-dot${r.state === "down" ? " is-pulsing" : ""}`}
          style={{ background: STATE_TOKEN[r.state] }}
          aria-hidden="true"
        />
      </span>

      <span className="fleet-col-name flex min-w-0 items-center gap-2.5">
        <span
          className="fleet-mark"
          style={{
            backgroundColor: `${r.color && r.color.length > 7 ? r.color : (r.color || "#888") + "15"}`,
          }}
        >
          {/* The provider's own mark, with its initials as the fallback. The
              old grid showed logos; a console that showed only letters would
              be a regression in recognition, not a simplification. */}
          <ProviderIcon
            src={iconPath}
            alt={r.name}
            size={24}
            className="max-h-[24px] max-w-[24px] rounded-[6px] object-contain"
            fallbackText={r.textIcon || r.id.slice(0, 2).toUpperCase()}
            fallbackColor={r.color}
          />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13.5px] font-semibold">{r.name}</span>
          <span className="block truncate text-[11.5px] text-text-muted">
            {r.connectionCount > 0
              ? `${r.connectionCount} ${r.connectionCount === 1 ? "connection" : "connections"}`
              : r.noAuth
                ? "no key needed"
                : "not connected"}
          </span>
        </span>
      </span>

      <span className="fleet-col-auth">
        <Badge variant="default" size="sm">{authDisplay}</Badge>
      </span>

      <span className="fleet-cell fleet-col-models is-strong">{r.modelCount}</span>

      <span className="fleet-col-meter">
        <span
          className="fleet-meter"
          role="img"
          aria-label={
            r.requests > 0
              ? `${r.requests} requests in the last minute${r.errors > 0 ? `, ${r.errors} failed` : ""}`
              : "no requests in the last minute"
          }
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <i
              key={i}
              style={
                i < filled
                  ? { background: r.errors > 0 ? STATE_TOKEN.degraded : STATE_TOKEN.healthy }
                  : undefined
              }
            />
          ))}
        </span>
      </span>

      <span className="fleet-col-status flex items-center gap-1.5">
        <span
          className="text-[12.5px] font-medium"
          style={{ color: STATE_TOKEN[r.state] }}
        >
          {STATE_LABEL[r.state]}
        </span>
      </span>

      <span className="fleet-cell fleet-col-err">
        {r.errorTag ? (
          <>
            <span className="font-semibold text-danger">{r.errorTag}</span>
            {r.errorTime ? <span className="text-text-subtle"> · {r.errorTime}</span> : null}
          </>
        ) : (
          <span className="text-text-subtle">·</span>
        )}
      </span>

      <span className="fleet-cell fleet-col-priority">
        {r.connections[0]?.priority != null ? `P${r.connections[0].priority}` : "·"}
      </span>

      <span className="fleet-col-toggle flex items-center justify-end">
        {r.connectionCount > 0 && (
          <span
            onClick={(e) => {
              // The row is the link; the switch must not follow it.
              e.preventDefault();
              e.stopPropagation();
              onToggle(r.id, !anyActive);
            }}
          >
            <Toggle
              size="sm"
              checked={anyActive}
              onChange={() => {}}
              title={anyActive ? "Disable provider" : "Enable provider"}
            />
          </span>
        )}
      </span>
    </Link>
  );
}

FleetRow.propTypes = {
  row: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    color: PropTypes.string,
    textIcon: PropTypes.string,
    apiType: PropTypes.string,
    auth: PropTypes.string,
    state: PropTypes.string.isRequired,
    connectionCount: PropTypes.number,
    modelCount: PropTypes.number,
    requests: PropTypes.number,
    errors: PropTypes.number,
    errorTag: PropTypes.string,
    errorTime: PropTypes.string,
    connections: PropTypes.array,
  }).isRequired,
  onToggle: PropTypes.func.isRequired,
};
