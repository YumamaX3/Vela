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
 * POST /v1/responses - OpenAI Responses API format
 * Now handled by translator pattern (openai-responses format auto-detected)
 */
export const POST = withVoyage(async function POST(request) {
  await ensureInitialized();
  return await handleChat(request);
});
