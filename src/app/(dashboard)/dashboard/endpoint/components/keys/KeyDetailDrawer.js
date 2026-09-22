"use client";

// The key's full dossier — everything the row could only abbreviate.
//
// One key, four questions, in the order an operator asks them: what IS this key
// (posture, prefix, provenance), what has it DONE (usage), what is it ALLOWED
// to do (category, scope, ceilings), and how do I end it (pause, revoke, and
// the browser vault's copy).
//
// Category and ceilings are EDITED here rather than on the row, because both are
// deliberate acts — a dropdown of categories on every card would be a misclick
// waiting to re-file a key, and a limits editor on a row would be a wall of
// numbers on a surface meant for scanning.
import { useState } from "react";
import { Button, Drawer, KeyLimitsEditor, Toggle } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { getKey, hasKey, removeKey } from "@/shared/utils/keyVault";
import { limitsFromRecord, limitsToRecord, postureOf, timeAgo } from "../../lib/keyFormat";
import CategoryPicker from "./CategoryPicker";
import {
  CategoryPill,
  LimitPills,
  PosturePill,
  ScopePill,
  StoredHerePill,
  UsageStrip,
} from "./KeyBits";

function Field({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-black/[0.03] dark:border-white/[0.03] last:border-b-0">
      <span className="text-xs text-text-muted shrink-0">{label}</span>
      <span className="text-xs text-right min-w-0">{children}</span>
    </div>
  );
}

export default function KeyDetailDrawer({ k, deck }) {
  const { categories, openEditKey, copy, copied, keyUsage, setCategory, applyLimits, setActive, revoke, busy } = deck;

  // Local drafts: the editor is a form, and a form that wrote on every keystroke
  // would issue a request per digit typed.
  const [limits, setLimits] = useState(() => limitsFromRecord(k));

  const posture = postureOf(k);
  const usage = keyUsage[k.id];
  const storedOnDevice = hasKey(k.id);

  return (
    <Drawer isOpen onClose={deck.closeDetail} title={k.name} width="md">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <PosturePill posture={posture} />
          <CategoryPill category={k.category} />
          <ScopePill k={k} />
          <LimitPills k={k} />
          {storedOnDevice && <StoredHerePill />}
        </div>

        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-xs font-mono text-text-main bg-surface-2 px-2 py-1 rounded">{k.keyPrefix}</code>
            {storedOnDevice && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  icon={copied === k.id ? "check" : "content_copy"}
                  onClick={() => copy(getKey(k.id), k.id)}
                >
                  {translate("Copy full key")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  icon="lock_reset"
                  onClick={() => removeKey(k.id)}
                  title={translate("Forget the full key from this browser's vault")}
                >
                  {translate("Forget")}
                </Button>
              </>
            )}
          </div>
          {!storedOnDevice && (
            <p className="text-[11px] text-text-muted mt-2">
              {translate("The full key is not in this browser's vault. It was shown once, at creation, and cannot be shown again — rotate it if it was lost.")}
            </p>
          )}
        </div>

        {usage && (
          <div className="rounded-[10px] bg-surface-2 border border-border-subtle p-3">
            <p className="text-[11px] uppercase tracking-wide text-text-muted mb-2">
              {translate("Usage in this window")}
            </p>
            <UsageStrip usage={usage} />
          </div>
        )}

        <div>
          <Field label={translate("Description")}>
            {k.description || <span className="text-text-muted">—</span>}
          </Field>
          <Field label={translate("Created")}>{new Date(k.createdAt).toLocaleString()}</Field>
          <Field label={translate("Last used")}>
            {k.lastUsedAt ? `${timeAgo(k.lastUsedAt)} · ${new Date(k.lastUsedAt).toLocaleString()}` : translate("Never")}
          </Field>
          <Field label={translate("Expires")}>
            {k.expiresAt ? new Date(k.expiresAt).toLocaleString() : translate("Never")}
          </Field>
          <Field label={translate("Model scope")}>
            {Array.isArray(k.allowedModels) && k.allowedModels.length > 0
              ? <span className="font-mono">{k.allowedModels.join(", ")}</span>
              : translate("Every model this harbor can dial")}
          </Field>
        </div>

        <div>
          <p className="text-sm font-medium mb-2">{translate("Category")}</p>
          <CategoryPicker
            value={k.category || ""}
            existing={categories}
            onChange={(next) => setCategory([k.id], next || null)}
            idPrefix={`key-detail-${k.id}`}
          />
          <p className="text-[11px] text-text-muted mt-2">
            {translate("Filing is immediate — the rail's counts follow.")}
          </p>
        </div>

        <div className="pt-2 border-t border-border">
          <KeyLimitsEditor value={limits} onChange={setLimits} />
          <div className="flex items-center justify-between gap-2 mt-3">
            <p className="text-[11px] text-text-muted flex-1">
              {translate("Ceilings apply to this key alone. Cleared fields become unlimited.")}
            </p>
            <Button
              size="sm"
              icon="save"
              disabled={busy}
              onClick={() => applyLimits([k.id], limitsToRecord(limits))}
            >
              {translate("Apply limits")}
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 pt-3 border-t border-border">
          <div className="min-w-0">
            <p className="text-sm font-medium">{translate("Pause this key")}</p>
            <p className="text-[11px] text-text-muted">
              {translate("Requests bearing it are refused until you resume. The key string never changes.")}
            </p>
          </div>
          <Toggle size="sm" checked={k.isActive ?? true} onChange={(next) => setActive([k.id], next)} />
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" icon="edit" onClick={() => openEditKey(k)}>
            {translate("Edit name & scope")}
          </Button>
          <Button size="sm" variant="danger" icon="delete" onClick={() => revoke([k.id])}>
            {translate("Revoke")}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
