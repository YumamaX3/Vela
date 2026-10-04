// LogPostureBanner — §2's posture law, in the harbor's own voice.
//
// The shipper's `getLogshipperStats()` is a set of numbers that each describe a
// LIMITATION. The harbor's job is not to hide them; it is to say them, in
// words, where the operator reads the rows. A tail that renders cleanly while
// its rows are five seconds stale and one batch from being lost on a hard kill
// is the silent-lie class §2's ledger exists to prevent.
//
// The four postures, and what each MEANS:
//   · degraded  — the driver is sql.js, so the worker is bypassed: batching in
//     memory, one persist per 5s, a 50 MB cap. R4 (logging never blocks a
//     request) holds only for the ENQUEUE; the periodic persist pause is
//     O(file) and real. Durability lags by up to 5s.
//   · mysql     — durable logging is DISABLED. No SQLite primary owns logEvents,
//     so nothing is persisted at all. Live lines still arrive; a reload loses
//     them. This is the one posture where the honest answer is "the ledger does
//     not exist right now", and the harbor says exactly that instead of showing
//     an empty table that reads as "nothing happened".
//   · mirror    — the MariaDB twin is NOT MIRRORED. logEvents is PRIMARY-ONLY by
//     construction (worker writes sit outside the main isolate's outbox
//     capture), so every log row lives only in the SQLite primary.
//   · sqlite    — the full posture. Named for completeness, and never dressed up:
//     even here the hard-kill window is real and is stated.
//
// THE HARD-KILL WINDOW IS ALWAYS SHOWN. `shutdownFlushWindowMs` plus the
// worker flush cadence is the ~2.5s the design names for a worker posture; a
// graceful restart drains it, a SIGKILL does not. Durability survives graceful
// shutdown up to that bound — and this banner says so in those words, every
// time, rather than implying a durability it does not have.
"use client";
import { useEffect, useMemo, useState } from "react";
import { translate } from "@/i18n/runtime";
import { cn } from "@/shared/utils/cn";

/**
 * Reduce the stats door's answer to a list of tone + sentences.
 *
 * @param {object|null} stats  the /api/logs/stats body.
 * @param {object|null} error  a fetch failure, if any.
 * @returns {Array<{tone: string, text: string}>}
 */
export function postureLines(stats, error) {
  const out = [];

  if (error) {
    out.push({
      tone: "danger",
      text: translate(
        "The harbor could not read its own posture from /api/logs/stats. Everything below is unverified: the rows you see may be incomplete, and the guarantees described here cannot be claimed."
      ),
    });
    return out;
  }
  if (!stats) return out;

  const posture = stats.posture;
  const degraded = Boolean(stats.degraded);

  if (posture === "mysql") {
    out.push({
      tone: "danger",
      text: translate(
        "Durable logging is DISABLED in this posture (VELA_DB_MODE=mysql — no SQLite primary owns the logEvents table). Nothing shown here is persisted; a reload loses it. The live tail below still carries console and container lines from the memory rings."
      ),
    });
    return out;
  }

  if (degraded) {
    const lag = stats.degradedFlushLagMs;
    out.push({
      tone: "warn",
      text: translate(
        `Degraded posture: the driver is ${stats.driver || "sql.js"}, so the worker is bypassed. Lines batch in memory and persist at most every ${Math.round((lag ?? 5000) / 1000)}s when non-empty, under a 50 MB cap that prunes oldest-first. Gateway speed is preserved for the enqueue; the periodic persist pause is real and O(file).`
      ),
    });
  }

  if (posture === "mirror") {
    out.push({
      tone: "warn",
      text: translate(
        "Mirror posture: the MariaDB twin is NOT-MIRRORED for logs. logEvents is primary-only — worker writes sit outside the main isolate, so every row here exists solely in the SQLite primary."
      ),
    });
  }

  const flush = Number(stats.shutdownFlushWindowMs) || 0;
  const cadence = Number(stats.workerFlushCadenceMs) || 0;
  const hardKill = flush + cadence;
  out.push({
    tone: degraded ? "warn" : "info",
    text: translate(
      `Durability window: a graceful restart drains within ${flush}ms${cadence ? ` plus one ${cadence}ms batch interval (≈${hardKill}ms worst case)` : ""}. A hard kill (SIGKILL, power loss) loses up to that unflushed window.`
    ),
  });

  const dropped = Number(stats.droppedCount) || 0;
  if (dropped > 0) {
    out.push({
      tone: "warn",
      text: translate(
        `${dropped} line${dropped === 1 ? "" : "s"} were dropped by the ring since boot (oldest overwritten under pressure). The tail is not complete.`
      ),
    });
  }

  if (stats.durableRows === null && stats.durableRowsError) {
    out.push({
      tone: "warn",
      text: translate(`The durable row count is unavailable (${stats.durableRowsError}). It is not zero — the count failed.`)
    });
  }

  if (stats.bootError) {
    out.push({ tone: "danger", text: translate(`The log worker failed to boot: ${stats.bootError}`) });
  }

  if (stats.held) {
    out.push({
      tone: "warn",
      text: translate("The shipper is HELD: new lines are buffering for an ordered clear. They will be released as post-clear evidence.")
    });
  }

  return out;
}

const TONE_CLASS = Object.freeze({
  info: "border-sky-500/50 bg-sky-500/10 text-sky-800 dark:text-sky-200",
  warn: "border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-200",
  danger: "border-red-500/50 bg-red-500/10 text-red-800 dark:text-red-200",
});

export default function LogPostureBanner() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/logs/stats")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`The stats door answered ${res.status}.`))))
      .then((data) => {
        if (!cancelled) {
          setStats(data);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e?.message ?? e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const lines = useMemo(() => postureLines(stats, error), [stats, error]);
  if (lines.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5" role="status" aria-live="polite">
      {lines.map((line, i) => (
        <p
          key={i}
          className={cn(
            "rounded-[10px] border px-3 py-2 text-xs leading-relaxed",
            TONE_CLASS[line.tone] || TONE_CLASS.info
          )}
        >
          {line.text}
        </p>
      ))}
    </div>
  );
}