// M6 §3 — withVoyage is the mint-site chokepoint: the reqId is minted HERE, at
// handler entry, so every console line the gateway prints for this request
// carries it without a single call-site edit. An inbound x-vela-request-id is
// client-controlled and is never adopted (logContext.js mintVoyageReqId).
import { withVoyage } from "@/lib/logContext.js";
import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { semanticCache, extractSessionId } from "@/lib/semanticCache.js";
import { ensureSemanticCacheHydrated } from "@/lib/semanticCacheDb.js";

let initialized = false;

/**
 * Initialize translators once
 */
async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

export const POST = withVoyage(async function POST(request) {
  // Fallback to local handling
  await ensureInitialized();

  // F-7 — exact-key semantic cache. Disabled by default; when enabled, only
  // non-streaming requests are eligible (a stream is not a body until it
  // ends). The key carries the session header when one is present, so two
  // callers behind the same gateway never read each other's answers.
  if (!semanticCache.enabled) return await handleChat(request);

  let body = null;
  try { body = await request.clone().json(); } catch { /* non-JSON: not cacheable */ }
  if (!body || body.stream === true) return await handleChat(request);

  await ensureSemanticCacheHydrated();
  const sessionId = extractSessionId(request);
  const hit = semanticCache.lookup(sessionId, body);
  if (hit) {
    return new Response(hit.responseBody, {
      status: 200,
      headers: {
        "content-type": hit.contentType || "application/json",
        "x-vela-semantic-cache": "hit",
        "access-control-allow-origin": "*",
      },
    });
  }

  const response = await handleChat(request);
  if (response.ok) {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      try {
        // clone() means the caller still receives the untouched body.
        semanticCache.storeResponse(sessionId, body, await response.clone().text(), contentType);
      } catch { /* a cache write must never break a live response */ }
    }
  }
  return response;
});

