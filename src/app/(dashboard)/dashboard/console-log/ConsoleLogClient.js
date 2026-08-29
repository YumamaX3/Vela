"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Card, Button } from "@/shared/components";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config";

// Server lines now arrive as "HH:MM:SS [LEVEL] message" (consoleLogBuffer).
const LEVEL_META = {
  LOG:   { text: "text-green-400",  chip: "border-green-500/40  bg-green-500/10  text-green-400",  row: "" },
  INFO:  { text: "text-blue-400",   chip: "border-blue-500/40   bg-blue-500/10   text-blue-400",   row: "" },
  WARN:  { text: "text-yellow-400", chip: "border-yellow-500/40 bg-yellow-500/10 text-yellow-400", row: "bg-yellow-500/5" },
  ERROR: { text: "text-red-400",    chip: "border-red-500/40    bg-red-500/10    text-red-400",    row: "bg-red-500/10" },
  DEBUG: { text: "text-purple-400", chip: "border-purple-500/40 bg-purple-500/10 text-purple-400", row: "" },
};

// Split a captured line into { time, level, text }. Old untagged lines
// (from before timestamps landed) fall back to LOG.
function parseLine(line) {
  const m = line.match(/^(\d{2}:\d{2}:\d{2}) \[(LOG|INFO|WARN|ERROR|DEBUG)\] ([\s\S]*)$/);
  if (!m) return { time: "", level: "LOG", text: line };
  return { time: m[1], level: m[2], text: m[3] };
}

export default function ConsoleLogClient() {
  const [logs, setLogs] = useState([]);
  const [connected, setConnected] = useState(false);
  const [activeLevels, setActiveLevels] = useState(() => new Set(Object.keys(LEVEL_META)));
  const [query, setQuery] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [wrap, setWrap] = useState(false);
  const logRef = useRef(null);
  const stickToBottomRef = useRef(true); // false when the reader scrolls up

  const handleClear = async () => {
    try {
      await fetch("/api/translator/console-logs", { method: "DELETE" });
      // UI cleared via the SSE "clear" event
    } catch (err) {
      console.error("Failed to clear console logs:", err);
    }
  };

  useEffect(() => {
    const es = new EventSource("/api/translator/console-logs/stream");

    es.onopen = () => setConnected(true);

    const append = (incoming) => {
      setLogs((prev) => {
        const next = prev.length ? [...prev, ...incoming] : incoming;
        return next.length > CONSOLE_LOG_CONFIG.maxLines
          ? next.slice(-CONSOLE_LOG_CONFIG.maxLines)
          : next;
      });
    };

    es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "init") {
        setLogs(msg.logs.slice(-CONSOLE_LOG_CONFIG.maxLines));
      } else if (msg.type === "line") {
        append([msg.line]);
      } else if (msg.type === "lines") {
        append(msg.lines);
      } else if (msg.type === "clear") {
        setLogs([]);
      }
    };

    es.onerror = () => setConnected(false);

    return () => es.close();
  }, []);

  // Follow the stream only when auto-scroll is on AND the reader is at
  // (or near) the bottom. Scrolling up pauses the follow until the reader
  // returns to the bottom or flips the toggle back on.
  useEffect(() => {
    if (autoScroll && stickToBottomRef.current && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleScroll = useCallback(() => {
    const el = logRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  const toggleLevel = useCallback((level) => {
    setActiveLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter((line) => {
      const { level, text, time } = parseLine(line);
      if (!activeLevels.has(level)) return false;
      if (q && !text.toLowerCase().includes(q) && !time.includes(q)) return false;
      return true;
    });
  }, [logs, activeLevels, query]);

  const copyAll = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(filtered.join("\n"));
    } catch {
      // Clipboard can be unavailable (permissions / non-secure context) —
      // fall back to a transient textarea selection.
      const ta = document.createElement("textarea");
      ta.value = filtered.join("\n");
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
  }, [filtered]);

  const downloadTxt = useCallback(() => {
    const blob = new Blob([filtered.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vela-console-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filtered]);

  return (
    <Card
      title="Console Log"
      subtitle="live gateway output"
      icon="terminal"
      padding="none"
    >
      {/* ── Toolbar ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        {/* Level filter chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          {Object.keys(LEVEL_META).map((level) => {
            const on = activeLevels.has(level);
            return (
              <button
                key={level}
                type="button"
                onClick={() => toggleLevel(level)}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                  on
                    ? LEVEL_META[level].chip
                    : "border-border bg-surface-2 text-text-muted opacity-60"
                }`}
              >
                {level}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter logs…"
          className="h-7 w-40 rounded-[8px] border border-border bg-surface-2 px-2.5 text-xs text-text-main placeholder:text-text-muted focus:border-brand-500/60 focus:outline-none"
        />

        <div className="ml-auto flex items-center gap-1.5">
          {/* Line count + connection dot */}
          <span className="flex items-center gap-1.5 text-[11px] tabular-nums text-text-muted">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                connected ? "animate-pulse bg-success" : "bg-red-500"
              }`}
              title={connected ? "Live stream connected" : "Stream disconnected"}
            />
            {filtered.length} / {CONSOLE_LOG_CONFIG.maxLines}
          </span>

          {/* Auto-scroll toggle — the Star's decree */}
          <Button
            size="sm"
            variant={autoScroll ? "primary" : "outline"}
            icon={autoScroll ? "vertical_align_bottom" : "pause"}
            onClick={() => {
              setAutoScroll((v) => {
                if (!v) stickToBottomRef.current = true;
                return !v;
              });
            }}
          >
            {autoScroll ? "Following" : "Paused"}
          </Button>

          {/* Word wrap */}
          <Button size="sm" variant="ghost" icon="wrap_text" onClick={() => setWrap((w) => !w)}>
            {wrap ? "Unwrap" : "Wrap"}
          </Button>

          {/* Copy / download */}
          <Button size="sm" variant="outline" icon="content_copy" onClick={copyAll}>
            Copy
          </Button>
          <Button size="sm" variant="outline" icon="download" onClick={downloadTxt}>
            .txt
          </Button>

          <Button size="sm" variant="outline" icon="delete" onClick={handleClear}>
            Clear
          </Button>
        </div>
      </div>

      {/* ── The terminal ────────────────────────────────────────── */}
      <div
        ref={logRef}
        onScroll={handleScroll}
        className="h-[calc(100vh-280px)] overflow-y-auto bg-black p-4 font-mono text-xs"
      >
        {filtered.length === 0 ? (
          <span className="text-text-muted">
            {logs.length === 0
              ? "No console logs yet."
              : "No lines match the current filters."}
          </span>
        ) : (
          <div className="space-y-0.5">
            {filtered.map((line, i) => {
              const { time, level, text } = parseLine(line);
              const meta = LEVEL_META[level] || LEVEL_META.LOG;
              return (
                <div
                  key={i}
                  className={`rounded px-1 -mx-1 ${meta.row} ${wrap ? "break-all whitespace-pre-wrap" : "whitespace-pre"}`}
                >
                  {time && <span className="mr-2 text-text-subtle">{time}</span>}
                  <span className={`mr-2 font-semibold ${meta.text}`}>[{level}]</span>
                  <span className={meta.text}>{text}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}
