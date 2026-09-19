"use client";

// Honest empty states: an empty fleet teaches the namespacing trick, a filtered
// dead end offers the reset. Both are sentences, not illustrations.
import { Button, Card } from "@/shared/components";

export default function CombosEmptyState({ variant = "empty", onCreate, onReset }) {
  if (variant === "no-match") {
    return (
      <Card>
        <div className="py-10 text-center">
          <span className="material-symbols-outlined text-[28px] text-text-muted" aria-hidden="true">
            search_off
          </span>
          <p className="mt-2 text-sm text-text-muted">No combos match your filters.</p>
          <button type="button" onClick={onReset} className="mt-2 text-xs text-primary hover:underline">
            Clear filters
          </button>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="py-12 text-center">
        <div className="mb-4 inline-flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
          <span className="material-symbols-outlined text-[32px]" aria-hidden="true">
            layers
          </span>
        </div>
        <p className="mb-1 font-medium text-text-main">No combos yet</p>
        <p className="mx-auto mb-4 max-w-md text-sm text-text-muted">
          Create a combo to route one name across several models. Use <code className="font-mono">/</code> in the name
          to namespace, like <code className="font-mono">vela/cc/opus</code>.
        </p>
        <Button icon="add" onClick={onCreate} className="w-full sm:w-auto">
          New combo
        </Button>
      </div>
    </Card>
  );
}
