"use client";
// StatusLine — one rendering for the room's "what just happened" sentence.
//
// The old room inlined this markup eleven times, and each copy picked its own
// greens: `text-green-500`, `text-green-600 dark:text-green-400`, and a bare
// `text-success` in the pricing room. Three spellings of success means an
// operator cannot learn the colour, and a palette drift lands in one copy
// without the others noticing. The tone map below is the single source.
//
// `role="status"` because these lines appear AFTER an action with no navigation,
// so without a live region a screen-reader user gets no confirmation that a save
// landed — the same reason the rail announcement exists.
import { cn } from "@/shared/utils/cn";

const TONES = {
  success: "text-success",
  error: "text-red-500",
  warn: "text-amber-600 dark:text-amber-400",
  info: "text-text-muted",
};

export default function StatusLine({ status, className }) {
  if (!status?.message) return null;
  return (
    <p
      role="status"
      className={cn("text-sm", TONES[status.type] || TONES.info, className)}
    >
      {status.message}
    </p>
  );
}
