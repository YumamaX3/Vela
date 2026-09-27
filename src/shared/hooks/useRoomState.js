"use client";
// useRoomState — a fetch that fails becomes a visible state, never a swallowed
// current (v1.0.30 "The Beacon Shore", R-27).
//
// WHY: rooms across the deck wrap their fetches in try/catch that only
// console.error — the visitor sees a spinner that never ends. This hook wraps
// the existing fetch pattern (no new data layer): loading / error / data with
// a `refetch` that retries in place. `detail` carries the response body text
// or thrown message, because "Failed to fetch" alone does not help the
// operator find the wound.
//
// SHAPE: `loading` is DERIVED (no data yet and no error yet) rather than
// stored, so the effect body never calls setState synchronously — the fetch's
// outcome lands inside the async continuation only. Stale runs are discarded
// by runId: a `key` change that overtakes an in-flight response never lets
// the older answer land. The fetcher is read through a ref that an effect
// keeps current, so a caller may pass an inline arrow without re-sailing.
//
// @param {fn}    fetcher - async; resolves the room's data, throws on failure.
// @param {string} [key]   - change to re-sail (e.g. `${period}`).
import { useCallback, useEffect, useRef, useState } from "react";

export default function useRoomState(fetcher, { key = "" } = {}) {
  const [state, setState] = useState({ data: null, error: null });
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });
  const runIdRef = useRef(0);

  const load = useCallback(async () => {
    const runId = ++runIdRef.current;
    try {
      const data = await fetcherRef.current();
      if (runIdRef.current !== runId) return;
      setState({ data, error: null });
    } catch (e) {
      if (runIdRef.current !== runId) return;
      const detail =
        e?.bodyText ||
        e?.message ||
        (typeof e === "string" ? e : null) ||
        "The request never reached the harbor.";
      setState({ data: null, error: detail });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, key]);

  const refetch = useCallback(() => load(), [load]);
  const loading = state.data === null && state.error === null;
  return { ...state, loading, refetch };
}
