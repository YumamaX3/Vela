// Port of apply_filter (rtk/src/cmds/system/pipe_cmd.rs) — catch_unwind equivalent
import * as keeperLog from "../../src/sse/utils/logger.js";
// On panic/error: passthrough raw output + warn through the Vela logger
export function safeApply(fn, text) {
  if (typeof fn !== "function") return text;
  try {
    const out = fn(text);
    if (typeof out !== "string") return text;
    return out;
  } catch (err) {
    // Rust: eprintln!("[rtk] warning: filter panicked — passing through raw output")
    const name = fn.filterName || fn.name || "anonymous";
    keeperLog.warn("EXECUTOR", `warning: filter '${name}' panicked — passing through raw output: ${err?.message || err}`);
    return text;
  }
}
