"use client";

// The detail drawer — one combo, everything about it, no navigation. Members
// can be reordered here, which is the one edit a list-of-strings combo needs
// and the only place it is safe to do (order is the fallback ladder).
import { useEffect, useState } from "react";
import { Button, CapacityBadges, ModelSelectModal } from "@/shared/components";
import { cn } from "@/shared/utils/cn";
import { strategyMeta } from "../lib/comboMeta";
import { memberReachable, providerOf, splitHarbor } from "../lib/comboGroups";
import { TONES, timeAgo } from "../lib/comboFormat";
import HealthPill from "./HealthPill";
import StrategyControl from "./StrategyControl";
import UsageCell from "./UsageCell";

function Section({ title, children, action }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-subtle">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function ComboDetailDrawer({
  combo,
  strategy,
  usage,
  getCaps,
  hub,
  copied,
  activeProviders,
  onCopy,
  onClose,
  onEdit,
  onDuplicate,
  onDelete,
  onSetStrategy,
  onUpdateModels,
}) {
  const [showJudgeSelect, setShowJudgeSelect] = useState(false);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  if (!combo) return null;

  const current = strategy?.fallbackStrategy || "fallback";
  const judge = strategy?.judgeModel || "";
  const meta = strategyMeta(current);
  const { harbor, leaf } = splitHarbor(combo.name);
  const members = Array.isArray(combo.models) ? combo.models : [];

  const move = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= members.length) return;
    const next = [...members];
    [next[index], next[target]] = [next[target], next[index]];
    onUpdateModels?.(next);
  };

  const removeMember = (index) => {
    const next = members.filter((_, i) => i !== index);
    onUpdateModels?.(next);
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={`Combo ${combo.name}`}>
      <button
        type="button"
        aria-label="Close details"
        onClick={onClose}
        className="absolute inset-0 bg-black/30 motion-safe:transition-opacity motion-safe:duration-200"
      />
      <div className="relative flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-border-subtle bg-surface shadow-[var(--shadow-elev)] motion-safe:transition-transform motion-safe:duration-200">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-2 border-b border-border-subtle bg-surface/95 px-4 py-3 backdrop-blur">
          <div className="flex min-w-0 items-start gap-2">
            <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", TONES[meta.tone])} aria-hidden="true">
              <span className="material-symbols-outlined text-[18px]">{meta.icon}</span>
            </span>
            <div className="min-w-0">
              <h2 className="truncate font-mono text-sm font-medium text-text-main" title={combo.name}>
                {combo.name}
              </h2>
              <p className="mt-0.5 text-[11px] text-text-muted">
                {harbor ? `${harbor} · ` : ""}
                {meta.label} · {members.length} model{members.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => onCopy?.(combo.name, `drawer-${combo.id}`)}
              title="Copy name"
              aria-label="Copy name"
              className={cn("rounded p-1 transition-colors", copied === `drawer-${combo.id}` ? "text-primary" : "text-text-muted hover:text-primary")}
            >
              <span className="material-symbols-outlined text-[17px]">{copied === `drawer-${combo.id}` ? "check" : "content_copy"}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              title="Close"
              aria-label="Close details"
              className="rounded p-1 text-text-muted transition-colors hover:text-text-main"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-5 px-4 py-4">
          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <Button icon="edit" size="sm" variant="ghost" onClick={() => onEdit?.(combo)}>
              Edit
            </Button>
            <Button icon="copy_all" size="sm" variant="ghost" onClick={() => onDuplicate?.(combo)}>
              Duplicate
            </Button>
            <Button
              icon="delete"
              size="sm"
              variant="ghost"
              onClick={() => onDelete?.(combo)}
              className="text-red-600 dark:text-red-300"
            >
              Delete
            </Button>
            <span className="text-[11px] text-text-muted">
              <code className="font-mono">model: {combo.name}</code> in any client
            </span>
          </div>

          {/* Strategy */}
          <Section title="Strategy">
            <StrategyControl
              value={current}
              judge={judge}
              judgeFallback={members[0]}
              onChange={(next) => onSetStrategy?.({ fallbackStrategy: next })}
              onOpenJudge={() => setShowJudgeSelect(true)}
              onClearJudge={() => onSetStrategy?.({ judgeModel: "" })}
            />
            <p className="text-[11px] text-text-muted">{meta.hint}</p>
            {current === "fusion" && (
              <p className="text-[11px] text-text-muted">
                Judge: <span className="font-mono text-text-main">{judge || `Auto · ${members[0] || "first model"}`}</span>
              </p>
            )}
          </Section>

          {/* Usage */}
          <Section title="Usage · last 24h">
            <UsageCell usage={usage} size="lg" className="w-full" />
          </Section>

          {/* Members */}
          <Section
            title={`Members · ${members.length}`}
            action={
              <HealthPill reachable={members.filter((m) => memberReachable(m, hub) === true).length} total={members.filter((m) => memberReachable(m, hub) !== null).length} />
            }
          >
            {members.length === 0 ? (
              <p className="text-xs italic text-text-muted">
                No members yet — a combo without models resolves to nothing. Add one through Edit.
              </p>
            ) : (
              <ol className="flex flex-col gap-1">
                {members.map((model, index) => {
                  const verdict = memberReachable(model, hub);
                  const provider = providerOf(model);
                  return (
                    <li
                      key={`${model}-${index}`}
                      className="group flex items-center gap-2 rounded-lg border border-border-subtle bg-bg px-2 py-1.5"
                    >
                      <span className="w-4 shrink-0 text-center text-[10px] tabular-nums text-text-muted">{index + 1}</span>
                      <span className="min-w-0 flex-1">
                        <code className="block truncate font-mono text-xs text-text-main" title={model}>
                          {model}
                        </code>
                        <span className="mt-0.5 flex items-center gap-1 text-[10px] text-text-muted">
                          {provider ? (
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded px-1 py-0.5 font-medium",
                                TONES[verdict === true ? "emerald" : verdict === false ? "red" : "muted"]
                              )}
                            >
                              <span className="material-symbols-outlined text-[11px]" aria-hidden="true">
                                {verdict === true ? "check_circle" : verdict === false ? "error" : "help"}
                              </span>
                              {provider} {verdict === true ? "connected" : verdict === false ? "offline" : "unknown"}
                            </span>
                          ) : (
                            <span className="text-text-subtle">no provider prefix</span>
                          )}
                          <CapacityBadges caps={getCaps?.(model)} />
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <button
                          type="button"
                          onClick={() => move(index, -1)}
                          disabled={index === 0}
                          aria-label={`Move ${model} up`}
                          className={cn("rounded p-0.5 text-text-muted hover:text-primary", index === 0 && "opacity-30")}
                        >
                          <span className="material-symbols-outlined text-[14px]">arrow_upward</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => move(index, 1)}
                          disabled={index === members.length - 1}
                          aria-label={`Move ${model} down`}
                          className={cn("rounded p-0.5 text-text-muted hover:text-primary", index === members.length - 1 && "opacity-30")}
                        >
                          <span className="material-symbols-outlined text-[14px]">arrow_downward</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => removeMember(index)}
                          aria-label={`Remove ${model}`}
                          className="rounded p-0.5 text-text-muted hover:text-red-600 dark:hover:text-red-300"
                        >
                          <span className="material-symbols-outlined text-[14px]">close</span>
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </Section>

          {/* Meta */}
          <Section title="Record">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
              <dt className="text-text-muted">Kind</dt>
              <dd className="font-mono text-text-main">{combo.kind || "llm"}</dd>
              <dt className="text-text-muted">Created</dt>
              <dd className="text-text-main" title={combo.createdAt || ""}>
                {combo.createdAt ? new Date(combo.createdAt).toLocaleString() : "—"}
              </dd>
              <dt className="text-text-muted">Updated</dt>
              <dd className="text-text-main" title={combo.updatedAt || ""}>
                {combo.updatedAt ? new Date(combo.updatedAt).toLocaleString() : "—"}
              </dd>
              <dt className="text-text-muted">Last traffic</dt>
              <dd className="text-text-main">{usage?.lastAt ? timeAgo(usage.lastAt) : "—"}</dd>
              <dt className="text-text-muted">Leaf</dt>
              <dd className="font-mono text-text-main">{leaf}</dd>
            </dl>
          </Section>
        </div>

        {showJudgeSelect && (
          <ModelSelectModal
            isOpen={showJudgeSelect}
            onClose={() => setShowJudgeSelect(false)}
            onSelect={(m) => {
              onSetStrategy?.({ judgeModel: m?.value || "" });
              setShowJudgeSelect(false);
            }}
            activeProviders={activeProviders}
            title="Select Judge Model"
            addedModelValues={judge ? [judge] : []}
            closeOnSelect
          />
        )}
      </div>
    </div>
  );
}
