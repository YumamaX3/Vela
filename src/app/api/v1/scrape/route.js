// POST /api/v1/scrape — page extraction.
//
// 9router-go forwards `/scrape` to the selected provider's scrape endpoint.
// Vela's fetch core already owns that capability (firecrawl / jina / tavily /
// exa / ollama each expose a scrape lane), so this route rides it rather than
// opening a second extraction path with its own provider table.
import { withVoyage } from "@/lib/logContext.js";
import { handleFetch } from "@/sse/handlers/fetch.js";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

export const POST = withVoyage(async function POST(request) {
  return await handleFetch(request);
});
