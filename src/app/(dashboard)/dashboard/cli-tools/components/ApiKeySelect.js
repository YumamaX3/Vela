"use client";

import { useState } from "react";
import { getKey, hasKey } from "@/shared/utils/keyVault";

const CUSTOM_VALUE = "__custom__";

// Key select redesigned for hash-at-rest (plan §3.6): options carry the keyId,
// labels show the masked prefix + name. Selecting a captured keyId yields the
// full key from the local vault; the parent stores that as selectedApiKey.
export default function ApiKeySelect({ value, onChange, apiKeys = [], cloudEnabled = false, className = "" }) {
  // `value` may be a full vela key (custom) or a captured state; derive initial mode
  const [mode, setMode] = useState(() => {
    if (!value) return apiKeys.length > 0 ? apiKeys[0].id : CUSTOM_VALUE;
    if (apiKeys.some((k) => k.id === value)) return value;
    return CUSTOM_VALUE;
  });
  const [customInput, setCustomInput] = useState(typeof value === "string" && value.startsWith("vela-") ? value : "");

  const emit = (nextMode) => {
    // keyId selected — resolve to the full key from the local vault if captured,
    // otherwise emit the keyId itself (resolveKeyRef handles it at apply time).
    onChange(getKey(nextMode) || nextMode);
  };

  const handleSelect = (e) => {
    const next = e.target.value;
    setMode(next);
    if (next === CUSTOM_VALUE) {
      setCustomInput("");
      onChange("");
    } else {
      emit(next);
    }
  };

  const handleCustomInput = (e) => {
    const v = e.target.value;
    setCustomInput(v);
    onChange(v);
  };

  if (apiKeys.length === 0 && mode !== CUSTOM_VALUE) {
    return (
      <span className={`min-w-0 rounded bg-surface/40 px-2 py-2 text-xs text-text-muted sm:py-1.5 ${className}`}>
        {cloudEnabled ? "No API keys - Create one in Keys page" : "Local mode (no key required)"}
      </span>
    );
  }

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <select
        value={mode}
        onChange={handleSelect}
        className="w-full min-w-0 px-2 py-2 bg-surface rounded text-xs border border-border focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5"
      >
        {apiKeys.map((k) => {
          const label = `${k.keyPrefix || `vela-v1-${String(k.id).slice(0, 8)}…`}${k.name ? ` — ${k.name}` : ""}${hasKey(k.id) ? "" : " (key not on this device)"}`;
          return <option key={k.id} value={k.id}>{label}</option>;
        })}
        <option value={CUSTOM_VALUE}>Custom...</option>
      </select>
      {mode === CUSTOM_VALUE && (
        <input
          type="text"
          value={customInput}
          onChange={handleCustomInput}
          placeholder="vela-v1-…"
          className="w-full min-w-0 px-2 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5"
        />
      )}
    </div>
  );
}
