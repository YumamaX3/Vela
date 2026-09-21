"use client";
// KeysCard — the key fleet: require-key gate, usage window, category chips, and
// one row per key. Extracted verbatim from the page client; only its address
// changed. R-31: the row's badges are semantic (they ARE the key's posture).
import { Card, Button, Toggle } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { getKey, hasKey, removeKey } from "@/shared/utils/keyVault";
import { formatTokens, formatCost, limitBadges, UNCATEGORIZED } from "../../lib/keyLimits";
import CategoryPicker from "../keys/CategoryPicker";
import SecurityWarning from "../endpoint/SecurityWarning";

export default function KeysCard({ c }) {
  const {
    activeCategoryFilter,
    categories,
    copied,
    copy,
    filteredKeys,
    handleDeleteKey,
    handleRequireApiKey,
    handleToggleKey,
    isRemoteHost,
    keyUsage,
    keys,
    openCreateModal,
    openEditKey,
    requireApiKey,
    setActiveCategoryFilter,
    setConfirmState,
    setUsagePeriod,
    usagePeriod,
  } = c;

  return (
          <Card id="require-api-key">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">vpn_key</span>
            {translate("API Keys")}
          </h2>
          <div className="flex items-center gap-2">
            {/* Usage window — filters the per-key stats strips below */}
            <div className="flex items-center rounded-[10px] bg-surface-2 border border-border-subtle p-0.5">
              {[["24h", "24h"], ["7d", "7d"], ["30d", "30d"], ["all", translate("All time")]].map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setUsagePeriod(value)}
                  title={translate("Usage window")}
                  className={`text-[11px] px-2 py-1 rounded-lg motion-control ${
                    usagePeriod === value
                      ? "bg-primary/15 text-primary font-semibold"
                      : "text-text-muted hover:text-text-main"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <Button icon="add" onClick={openCreateModal}>
              {translate("Create Key")}
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between pb-4 mb-4 border-b border-border">
          <div>
            <p className="font-medium">{translate("Require API key")}</p>
            <p className="text-sm text-text-muted">
              {translate("Requests without a valid key will be rejected")}
            </p>
          </div>
          <Toggle
            checked={requireApiKey}
            onChange={() => handleRequireApiKey(!requireApiKey)}
          />
        </div>

        {isRemoteHost && !requireApiKey && (
          <div className="mb-4 -mt-2">
            <SecurityWarning message="Endpoint is exposed without an API key." />
          </div>
        )}

        {/* Category filter chips — derived from the categories keys carry */}
        {keys.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mb-4">
            <button
              onClick={() => setActiveCategoryFilter("all")}
              className={`text-xs px-2.5 py-1 rounded-full border motion-control ${
                activeCategoryFilter === "all"
                  ? "bg-primary/15 text-primary border-primary/40 font-semibold"
                  : "bg-surface-2 text-text-muted border-border-subtle hover:text-text-main"
              }`}
            >
              {translate("All")} · {keys.length}
            </button>
            {categories.map((cat) => {
              const count = keys.filter((k) => k.category === cat).length;
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategoryFilter(cat)}
                  title={cat}
                  className={`text-xs px-2.5 py-1 rounded-full border motion-control ${
                    activeCategoryFilter === cat
                      ? "bg-primary/15 text-primary border-primary/40 font-semibold"
                      : "bg-surface-2 text-text-muted border-border-subtle hover:text-text-main"
                  }`}
                >
                  {cat} · {count}
                </button>
              );
            })}
            {keys.some((k) => !k.category) && (
              <button
                onClick={() => setActiveCategoryFilter(UNCATEGORIZED)}
                className={`text-xs px-2.5 py-1 rounded-full border motion-control ${
                  activeCategoryFilter === UNCATEGORIZED
                    ? "bg-primary/15 text-primary border-primary/40 font-semibold"
                    : "bg-surface-2 text-text-muted border-border-subtle hover:text-text-main"
                }`}
              >
                {translate("Uncategorized")} · {keys.filter((k) => !k.category).length}
              </button>
            )}
          </div>
        )}

        {keys.length === 0 ? (
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
              <span className="material-symbols-outlined text-[32px]">vpn_key</span>
            </div>
            <p className="text-text-main font-medium mb-1">{translate("No API keys yet")}</p>
            <p className="text-sm text-text-muted mb-4">{translate("Create your first API key to get started")}</p>
            <Button icon="add" onClick={openCreateModal}>
              {translate("Create Key")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col">
            {filteredKeys.map((key) => {
              const paused = key.isActive === false;
              const storedOnDevice = hasKey(key.id);
              const scopeCount = Array.isArray(key.allowedModels) ? key.allowedModels.length : 0;
              const usage = keyUsage[key.id]; // absent → no traffic in the window
              return (
                <div
                  key={key.id}
                  className={`group py-3 border-b border-black/[0.03] dark:border-white/[0.03] last:border-b-0 ${paused ? "opacity-60" : ""}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium truncate">{key.name}</p>
                        {paused ? (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30">{translate("Paused")}</span>
                        ) : (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/30">{translate("Active")}</span>
                        )}
                        {key.category && (
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30"
                            title={key.category}
                          >
                            {key.category}
                          </span>
                        )}
                        {scopeCount > 0 ? (
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/30"
                            title={key.allowedModels.join(", ")}
                          >
                            {scopeCount} model{scopeCount === 1 ? "" : "s"}
                          </span>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-2 text-text-muted border border-border-subtle" title="No model restriction">
                            {translate("All models")}
                          </span>
                        )}
                        {limitBadges(key).map((b) => (
                          <span
                            key={b.k}
                            className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-2 text-text-muted border border-border-subtle"
                            title={translate("Key limit")}
                          >
                            {b.text}
                          </span>
                        ))}
                        {storedOnDevice && (
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-2 text-text-muted border border-border-subtle"
                            title="Full key captured in this browser's local vault"
                          >
                            {translate("stored here")}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <code className="text-xs text-text-muted font-mono">{key.keyPrefix}</code>
                        {storedOnDevice && (
                          <>
                            <button
                              onClick={() => copy(getKey(key.id), key.id)}
                              className="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary motion-control"
                              title={translate("Copy full key (from this browser's vault)")}
                            >
                              <span className="material-symbols-outlined text-[14px]">
                                {copied === key.id ? "check" : "content_copy"}
                              </span>
                            </button>
                            <button
                              onClick={() => removeKey(key.id)}
                              className="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-red-500 motion-control"
                              title={translate("Forget the full key from this browser's vault")}
                            >
                              <span className="material-symbols-outlined text-[14px]">lock_reset</span>
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => openEditKey(key)}
                          className="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary motion-control"
                          title={translate("Edit name, description, allowed models")}
                        >
                          <span className="material-symbols-outlined text-[14px]">edit</span>
                        </button>
                      </div>
                      {key.description && (
                        <p className="text-xs text-text-muted mt-1 truncate">{key.description}</p>
                      )}
                      <p className="text-xs text-text-muted mt-1">
                        Created {new Date(key.createdAt).toLocaleDateString()}
                        {key.lastUsedAt ? ` · Last used ${new Date(key.lastUsedAt).toLocaleDateString()}` : " · Never used"}
                        {key.expiresAt ? ` · Expires ${new Date(key.expiresAt).toLocaleDateString()}` : ""}
                      </p>
                      {/* Usage strip — requests, in/out/total tokens, spend */}
                      {usage && (
                        <div className="flex items-center gap-3 flex-wrap mt-1.5 text-[11px] text-text-muted">
                          <span className="inline-flex items-center gap-1" title="Requests">
                            <span className="material-symbols-outlined text-[13px] text-primary/70">swap_calls</span>
                            {usage.requests.toLocaleString()}
                          </span>
                          <span className="inline-flex items-center gap-1" title="Input tokens">
                            <span className="material-symbols-outlined text-[13px] text-sky-500/70">south</span>
                            {formatTokens(usage.promptTokens)} in
                          </span>
                          <span className="inline-flex items-center gap-1" title="Output tokens">
                            <span className="material-symbols-outlined text-[13px] text-emerald-500/70">north</span>
                            {formatTokens(usage.completionTokens)} out
                          </span>
                          <span className="inline-flex items-center gap-1" title="Total tokens">
                            <span className="material-symbols-outlined text-[13px] text-violet-500/70">token</span>
                            {formatTokens(usage.totalTokens)} total
                          </span>
                          <span className="inline-flex items-center gap-1 font-medium text-text-main" title="Estimated spend">
                            <span className="material-symbols-outlined text-[13px] text-amber-500/70">paid</span>
                            {formatCost(usage.cost)}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Toggle
                        size="sm"
                        checked={key.isActive ?? true}
                        onChange={(checked) => {
                          if (key.isActive && !checked) {
                            setConfirmState({
                              title: "Pause API Key",
                              message: `Pause API key "${key.name}"?\n\nThis key will stop working immediately but can be resumed later.`,
                              onConfirm: async () => {
                                setConfirmState(null);
                                handleToggleKey(key.id, checked);
                              }
                            });
                          } else {
                            handleToggleKey(key.id, checked);
                          }
                        }}
                        title={key.isActive ? translate("Pause key") : translate("Resume key")}
                      />
                      <button
                        onClick={() => handleDeleteKey(key.id)}
                        className="p-2 hover:bg-red-500/10 rounded text-red-500 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 motion-control"
                        title={translate("Delete (revoke)")}
                      >
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
  );
}
