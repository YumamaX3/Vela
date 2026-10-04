// M6 §3 — withVoyage is the mint-site chokepoint: the reqId is minted HERE, at
// handler entry, so every console line the gateway prints for this request
// carries it without a single call-site edit. An inbound x-vela-request-id is
// client-controlled and is never adopted (logContext.js mintVoyageReqId).
import { withVoyage } from "@/lib/logContext.js";
import { handleImageGeneration } from "@/sse/handlers/imageGeneration.js";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/** POST /v1/images/generations - OpenAI-compatible image generation endpoint */
export const POST = withVoyage(async function POST(request) {
  return await handleImageGeneration(request);
});
