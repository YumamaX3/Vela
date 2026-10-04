// M6 §3 — withVoyage is the mint-site chokepoint: the reqId is minted HERE, at
// handler entry, so every console line the gateway prints for this request
// carries it without a single call-site edit. An inbound x-vela-request-id is
// client-controlled and is never adopted (logContext.js mintVoyageReqId).
import { withVoyage } from "@/lib/logContext.js";
import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * POST /v1/responses/compact - Compact conversation context
 * Reuses the same handleChat pipeline, signals compact via body._compact
 */
export const POST = withVoyage(async function POST(request) {
  await ensureInitialized();
  const body = await request.json();
  body._compact = true;
  const newRequest = new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(body)
  });
  return await handleChat(newRequest);
});
