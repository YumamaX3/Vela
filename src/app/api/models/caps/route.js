// GET /api/models/caps?provider=<id> — per-model capability matrix.
//
// Port of 9router-go `HandleGetModelCaps`, adapted to Vela's own resolver
// (`open-sse/providers/capabilities.js`) instead of duplicating a second
// capability table. A provider with no models returns an empty map, never a
// 404: "no models known" is a real state for a fresh compatible node.
import * as log from "@/sse/utils/logger.js";
import { NextResponse } from "next/server";
import { getModelsByProviderId, PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";

export async function GET(request) {
  try {
    const provider = new URL(request.url).searchParams.get("provider") || "";
    if (!provider) {
      return NextResponse.json({ error: "provider is required" }, { status: 400 });
    }

    const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
    const models = getModelsByProviderId(provider);
    const caps = {};
    for (const entry of models) {
      if (!entry?.id) continue;
      caps[entry.id] = getCapabilitiesForModel(alias, entry.id);
    }

    return NextResponse.json({ provider, caps });
  } catch (error) {
    log.error("MODELS", "Failed to read caps:", (error?.message ?? error));
    return NextResponse.json({ error: "Failed to read model capabilities" }, { status: 500 });
  }
}
