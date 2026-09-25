import { getSettings } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";

let initialized = false;

export async function ensureOutboundProxyInitialized() {
  if (initialized) return true;

  try {
    const settings = await getSettings();
    applyOutboundProxyEnv(settings);
    // The timeout policy rides the same boot read — a harbor whose operator set
    // it in the Network lens gets it applied before the first request.
    const { applyNetworkTimeoutOverrides } = await import("open-sse/config/runtimeConfig.js");
    applyNetworkTimeoutOverrides(settings);
    initialized = true;
  } catch (error) {
    console.error("[ServerInit] Error initializing outbound proxy:", error);
  }

  return initialized;
}

// Defer init so HTTP server accepts connections first
setImmediate(() => {
  ensureOutboundProxyInitialized().catch(console.log);
});

export default ensureOutboundProxyInitialized;
