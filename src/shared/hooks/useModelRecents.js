"use client";

// useModelRecents — the one source of truth for the model-picker recents
// strip (v0.9.60, the Single Mast).
//
// Three copies of the same load-listen-cleanup dance used to live across
// QuickAddBar (deleted), ModelSelectModal, and this hook's consumers. All of
// them read localStorage (key `vela:picker:recents`), subscribed to
// `vela:recents:changed` (the picker modal's own emit) and the cross-tab
// `storage` event, and called setState synchronously in a mount effect —
// the exact shape `react-hooks/set-state-in-effect` rejects.
//
// useSyncExternalStore removes the setState entirely: the store is
// localStorage, the subscription is the two events, and the snapshot is
// identity-stable via a module-level cache keyed on the raw string (so
// React's Object.is bail-out works across re-renders that don't change the
// data). SSR renders the server snapshot ([]), hydration agrees, and the
// first client snapshot re-reads the real value.

import { useSyncExternalStore } from "react";

const RECENTS_KEY = "vela:picker:recents";
const RECENTS_EVENT = "vela:recents:changed";

const EMPTY = [];
let cacheRaw = null;
let cacheValue = EMPTY;

function parseRecents(raw) {
  if (!raw) return EMPTY;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : EMPTY;
  } catch {
    return EMPTY;
  }
}

function getSnapshot() {
  // The whole read is wrapped: localStorage can be missing entirely
  // (happy-dom stubs), throw on access (privacy modes, blocked site data),
  // or hold unparseable content — every one fails open to [] exactly as the
  // deleted QuickAddBar's try/catch did. A snapshot fn that throws would
  // break useSyncExternalStore's contract and crash the component.
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(RECENTS_KEY);
    if (raw !== cacheRaw) {
      cacheRaw = raw;
      cacheValue = parseRecents(raw);
    }
  } catch {
    return EMPTY;
  }
  return cacheValue;
}

function getServerSnapshot() {
  return EMPTY;
}

function subscribe(callback) {
  // Named handlers both, so the cleanup removes exactly what was added —
  // an anonymous storage handler would leak for the component's lifetime.
  const onChanged = () => callback();
  const onStorage = (e) => {
    if (e.key === RECENTS_KEY) callback();
  };
  window.addEventListener(RECENTS_EVENT, onChanged);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(RECENTS_EVENT, onChanged);
    window.removeEventListener("storage", onStorage);
  };
}

export default function useModelRecents() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
