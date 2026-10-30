// Debug logging utility — only active in dev mode (NODE_ENV !== "production")
// Outputs are tagged with [DBG:tag] for easy grep/filter
//
// The logger is reached LAZILY: open-sse sits at repo-root level and is also
// loaded by worker threads and raw Node (no vitest alias there), where the
// bare `@/` and even `open-sse` specifiers cannot resolve. A debug door must
// never be the reason a module graph fails — fail silent, never fatal.
const isDev = process.env.NODE_ENV !== "production";

function ts() {
  return new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export async function dbg(tag, msg) {
  if (!isDev) return;
  try {
    const { info } = await import("@/sse/utils/logger.js");
    info("STREAM", `[${ts()}] 🐛 [DBG:${tag}] ${msg}`);
  } catch {
    console.log(`[${ts()}] 🐛 [DBG:${tag}] ${msg}`);
  }
}

export const isDebugEnabled = isDev;
