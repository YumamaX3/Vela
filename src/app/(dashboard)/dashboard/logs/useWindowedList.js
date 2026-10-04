// useWindowedList — hand-rolled windowing for the Log Harbor's unified tail.
//
// WHY HAND-ROLLED: the tail has to hold 1,000+ live rows and page a 200k+
// query result, and the repo carries no virtualization library (package.json
// has none). Adding one is a dependency decision that belongs to the Star, so
// this hook is a fixed-row-height window: the cheapest of the three honest
// options and the one a log tail can actually support, because a log row is
// single-line by construction (§1's control-char law turns the C0 `\n` into a
// space, so a persisted row can never wrap to two lines at a known height).
//
// ── THE CONTRACT ────────────────────────────────────────────────────────────
//   • FIXED row height. Every row is `ROW_HEIGHT` px tall with `nowrap` +
//   `overflow-hidden`, so `index * ROW_HEIGHT` is exact, not an estimate — the
//   scrollbar never drifts as you scroll, and `clientHeight` of 0 in a
//   non-layout environment (happy-dom) degrades to a sane default instead of
//   producing NaN scroll offsets.
//   • OVERSCAN 10 rows either side. Large enough that a fast flick renders
//   before the blank band shows, small enough that the DOM count stays under
//   ~100 rows for any viewport.
//   • The window is a `useMemo` over (rows, scrollTop, viewport), so scrolling
//   costs one render of ~50 rows, not one render of 200,000.
//
// The hook returns the window AND the spacer geometry the scroller needs:
// `totalHeight`, `offsetY`. A caller that ignores them renders one screen of
// rows with no scroll range — which is the defect this exists to prevent.
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** The one number a log row's height comes from. Also the item-height input. */
export const ROW_HEIGHT = 26;

/** Rows painted above and below the viewport, so a flick does not flash blank. */
export const OVERSCAN = 10;

/** What a viewport is assumed to be before it has measured itself. */
const DEFAULT_VIEWPORT = 600;

/**
 * Window a list of `rows` against a scrolling element.
 *
 * @param {Array}  rows      - the full list, in render order.
 * @param {object} [options]
 * @param {number} [options.rowHeight]  - px per row (default ROW_HEIGHT).
 * @param {number} [options.overscan]   - rows painted beyond each edge.
 * @param {boolean}[options.follow]     - pin to the tail when rows grow.
 * @param {number} [options.viewport]   - override the measured height.
 * @returns {{window: Array, startIndex: number, endIndex: number,
 *            totalHeight: number, offsetY: number, scrollRef: object,
 *            onScroll: fn, jumpToTail: fn, atBottom: boolean}}
 */
export default function useWindowedList(rows, options = {}) {
  const { rowHeight = ROW_HEIGHT, overscan = OVERSCAN, follow = true, viewport: viewportOverride } = options;

  const scrollRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(viewportOverride ?? DEFAULT_VIEWPORT);
  const [atBottom, setAtBottom] = useState(true);
  const stickToBottomRef = useRef(true);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  // Measure once per mount/resize. `ResizeObserver` is absent in happy-dom, so
  // the initial `clientHeight` read is the fallback and a missing observer is
  // not an error — the default viewport then applies for the whole session.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const measure = () => {
      const h = el.clientHeight;
      if (h > 0) setViewport(h);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onScroll = useCallback((event) => {
    const el = event?.currentTarget ?? scrollRef.current;
    if (!el) return;
    const top = el.scrollTop;
    setScrollTop(top);
    const near = el.scrollHeight - top - el.clientHeight < rowHeight * 2;
    stickToBottomRef.current = near;
    setAtBottom((prev) => (prev === near ? prev : near));
  }, [rowHeight]);

  // Follow the tail only while the reader is at the bottom — the same restraint
  // the legacy streams show, and the reason a reader scrolled up to read an
  // error is not yanked back by the next line.
  useEffect(() => {
    if (!follow || !stickToBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setScrollTop(el.scrollTop);
  }, [rows, follow]);

  const jumpToTail = useCallback(() => {
    stickToBottomRef.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setAtBottom(true);
    setScrollTop(el ? el.scrollTop : 0);
  }, []);

  const window_ = useMemo(() => {
    const total = rows.length;
    const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const visibleCount = Math.ceil(viewport / rowHeight) + 1;
    const last = Math.min(total, first + visibleCount + overscan * 2);
    const slice = rows.slice(first, last);
    return {
      window: slice,
      startIndex: first,
      endIndex: last,
      totalHeight: total * rowHeight,
      offsetY: first * rowHeight,
    };
  }, [rows, scrollTop, viewport, rowHeight, overscan]);

  return { ...window_, scrollRef, onScroll, jumpToTail, atBottom };
}