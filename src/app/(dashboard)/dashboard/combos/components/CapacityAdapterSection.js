"use client";

// The capacity adapter — carried forward from the pre-upgrade page, restyled
// into the deck's system. Behavior is unchanged: per-capability fallback pools
// that catch a request whose target model cannot read the payload.
import { useState } from "react";
import { Button, CapacityBadges, Card, ModelSelectModal, Toggle } from "@/shared/components";
import {
  CAPACITY_ADAPTER_CAPS,
  DEFAULT_FALLBACK_MODEL,
  EMPTY_CAP_ENTRY,
} from "../lib/comboMeta";

function CapacityAdapterCap({ cap, entry, onChange, activeProviders, getCaps }) {
  const [showModelSelect, setShowModelSelect] = useState(false);
  const { enabled, roundRobin, models } = entry;

  const patch = (p) => onChange({ ...entry, ...p });

  const handleAdd = (model) => {
    if (models.includes(model.value)) return;
    patch({ models: [...models, model.value] });
  };

  const handleRemove = (index) => {
    const next = models.filter((_, i) => i !== index);
    patch({ models: next.length === 0 ? [DEFAULT_FALLBACK_MODEL] : next });
  };

  const handleMove = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= models.length) return;
    const next = [...models];
    [next[index], next[target]] = [next[target], next[index]];
    patch({ models: next });
  };

  return (
    <Card padding="sm" className={`group ${!enabled ? "opacity-50" : ""}`}>
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-2.5 sm:items-center">
          <Toggle checked={enabled} onChange={(v) => patch({ enabled: v })} aria-label={`Enable ${cap.label} adapter`} />
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <span className="material-symbols-outlined text-[18px] text-primary" aria-hidden="true">
              {cap.icon}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <code className="font-mono text-sm font-medium">{cap.label}</code>
              <span className="text-[10px] text-text-muted">— {cap.desc}</span>
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
              {models.length === 0 ? (
                <span className="text-xs italic text-text-muted">No models</span>
              ) : (
                models.slice(0, 3).map((model, index) => (
                  <code
                    key={`${model}-${index}`}
                    className="group/chip inline-flex items-center gap-1 rounded bg-black/5 px-1.5 py-0.5 font-mono text-xs text-text-muted dark:bg-white/5"
                  >
                    <span>{model}</span>
                    <CapacityBadges caps={getCaps?.(model)} />
                    <button
                      type="button"
                      onClick={() => handleMove(index, -1)}
                      disabled={index === 0}
                      aria-label={`Move ${model} up`}
                      className={`leading-none opacity-0 group-hover/chip:opacity-100 focus-visible:opacity-100 ${
                        index === 0 ? "text-text-muted/20" : "text-text-muted hover:text-primary"
                      }`}
                    >
                      <span className="material-symbols-outlined text-[12px]">arrow_upward</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMove(index, 1)}
                      disabled={index === models.length - 1}
                      aria-label={`Move ${model} down`}
                      className={`leading-none opacity-0 group-hover/chip:opacity-100 focus-visible:opacity-100 ${
                        index === models.length - 1 ? "text-text-muted/20" : "text-text-muted hover:text-primary"
                      }`}
                    >
                      <span className="material-symbols-outlined text-[12px]">arrow_downward</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemove(index)}
                      aria-label={`Remove ${model}`}
                      className="leading-none text-text-muted opacity-0 hover:text-red-600 focus-visible:opacity-100 group-hover/chip:opacity-100 dark:hover:text-red-300"
                    >
                      <span className="material-symbols-outlined text-[12px]">close</span>
                    </button>
                  </code>
                ))
              )}
              {models.length > 3 && <span className="text-[10px] text-text-muted">+{models.length - 3} more</span>}
            </div>
          </div>
        </div>

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:shrink-0 sm:flex-row sm:items-center sm:gap-3">
          <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-text-muted">
            <Toggle
              checked={roundRobin}
              onChange={(v) => patch({ roundRobin: v })}
              disabled={!enabled}
              aria-label={`Round-robin ${cap.label} adapter`}
            />
            <span>Round</span>
          </label>
          <Button
            icon="add"
            variant="ghost"
            size="sm"
            onClick={() => setShowModelSelect(true)}
            disabled={!enabled}
            title={`Add ${cap.label} model`}
          >
            Add Model
          </Button>
        </div>
      </div>

      {showModelSelect && (
        <ModelSelectModal
          isOpen={showModelSelect}
          onClose={() => setShowModelSelect(false)}
          onSelect={handleAdd}
          activeProviders={activeProviders}
          title={`Add ${cap.label} Model`}
          addedModelValues={models}
          capFilter={cap.key}
          closeOnSelect={false}
        />
      )}
    </Card>
  );
}

export default function CapacityAdapterSection({ capacityAdapter, onChange, activeProviders, getCaps }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">Vision Adapter</p>
        <p className="mt-0.5 text-xs text-text-muted">
          Your model can&apos;t read image/audio? Auto-switches to a model in the pool below.
        </p>
        <ul className="mt-1.5 flex flex-col gap-0.5 text-[11px] text-text-muted">
          <li>
            <span className="font-medium text-text-main">Vision</span> — images (png, jpg, webp, …)
          </li>
          <li>
            <span className="font-medium text-text-main">Audio</span> — audio input
          </li>
        </ul>
      </div>
      <div className="flex flex-col gap-4">
        {CAPACITY_ADAPTER_CAPS.map((cap) => (
          <CapacityAdapterCap
            key={cap.key}
            cap={cap}
            entry={capacityAdapter[cap.key] || EMPTY_CAP_ENTRY}
            onChange={(entry) => onChange({ ...capacityAdapter, [cap.key]: entry })}
            activeProviders={activeProviders}
            getCaps={getCaps}
          />
        ))}
      </div>
    </div>
  );
}
