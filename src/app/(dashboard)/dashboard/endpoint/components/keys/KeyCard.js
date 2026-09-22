"use client";

// The card lens — one key per row, everything a person needs to decide whether
// to touch it, and nothing they would have to open another page for.
//
// Read the row top-down: what it IS (name, posture, category), what it REACHES
// (scope), what it is allowed to SPEND (ceilings), how to USE it (prefix + the
// browser vault's copy), and what it HAS DONE (the usage strip).
import { Toggle } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { getKey, hasKey, removeKey } from "@/shared/utils/keyVault";
import { postureOf, timeAgo } from "../../lib/keyFormat";
import {
  CategoryPill,
  LimitPills,
  PosturePill,
  ScopePill,
  SelectBox,
  StoredHerePill,
  UsageStrip,
} from "./KeyBits";

export default function KeyCard({ k, deck }) {
  const {
    selected,
    toggleSelect,
    setActive,
    revoke,
    openEditKey,
    openDetail,
    copy,
    copied,
    keyUsage,
  } = deck;

  const posture = postureOf(k);
  const paused = posture === "paused";
  const storedOnDevice = hasKey(k.id);
  const usage = keyUsage[k.id];
  const isSelected = selected.has(k.id);

  return (
    <div
      className={`group py-3 border-b border-black/[0.03] dark:border-white/[0.03] last:border-b-0 ${
        paused ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="pt-1">
          <SelectBox
            checked={isSelected}
            onChange={(next) => toggleSelect(k.id, next)}
            title={translate("Select this key")}
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => openDetail(k.id)}
              className="text-sm font-medium truncate hover:text-primary motion-control"
              title={translate("Open the key's details")}
            >
              {k.name}
            </button>
            <PosturePill posture={posture} />
            <CategoryPill category={k.category} />
            <ScopePill key={k} />
            <LimitPills key={k} />
            {storedOnDevice && <StoredHerePill />}
          </div>

          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <code className="text-xs text-text-muted font-mono">{k.keyPrefix}</code>
            {storedOnDevice && (
              <>
                <button
                  onClick={() => copy(getKey(k.id), k.id)}
                  className="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary motion-control"
                  title={translate("Copy full key (from this browser's vault)")}
                >
                  <span className="material-symbols-outlined text-[14px]">
                    {copied === k.id ? "check" : "content_copy"}
                  </span>
                </button>
                <button
                  onClick={() => removeKey(k.id)}
                  className="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-red-500 motion-control"
                  title={translate("Forget the full key from this browser's vault")}
                >
                  <span className="material-symbols-outlined text-[14px]">lock_reset</span>
                </button>
              </>
            )}
            <button
              onClick={() => openEditKey(k)}
              className="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary motion-control"
              title={translate("Edit name, description, allowed models")}
            >
              <span className="material-symbols-outlined text-[14px]">edit</span>
            </button>
          </div>

          {k.description && (
            <p className="text-xs text-text-muted mt-1 truncate">{k.description}</p>
          )}

          <p className="text-xs text-text-muted mt-1">
            {translate("Created")} {new Date(k.createdAt).toLocaleDateString()}
            {k.lastUsedAt
              ? ` · ${translate("Last used")} ${timeAgo(k.lastUsedAt)}`
              : ` · ${translate("Never used")}`}
            {k.expiresAt ? ` · ${translate("Expires")} ${new Date(k.expiresAt).toLocaleDateString()}` : ""}
          </p>

          {usage && <UsageStrip usage={usage} className="mt-1.5" />}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* The pause confirm lives at the mutation (the deck's setActive), so
              this view only asks. One call, so a new lens cannot reintroduce an
              ungated pause. */}
          <Toggle
            size="sm"
            checked={k.isActive ?? true}
            onChange={(checked) => setActive([k.id], checked)}
            title={k.isActive ? translate("Pause key") : translate("Resume key")}
          />
          <button
            onClick={() => revoke([k.id])}
            className="p-2 hover:bg-red-500/10 rounded text-red-500 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 motion-control"
            title={translate("Delete (revoke)")}
          >
            <span className="material-symbols-outlined text-[18px]">delete</span>
          </button>
        </div>
      </div>
    </div>
  );
}
