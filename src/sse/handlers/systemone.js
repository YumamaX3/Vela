// POST /v1/systemone — provider-side structured evaluation passthrough.
//
// Port of 9router-go `HandleSystemone`. The request is forwarded to the
// selected provider's `/systemone` endpoint with that connection's credentials;
// the body is passed through unchanged (the provider owns the schema). Model
// resolution is the ordinary chat resolver, so a provider prefix selects the
// harbor exactly as it does on every other lane.
import { getProviderCredentials, extractApiKey } from "../services/auth.js";
import { authorizeApiRequest } from "../services/keyGate.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo } from "../services/model.js";
import { checkAndRefreshToken } from "../services/tokenRefresh.js";
import { resolveProviderId } from "@/shared/constants/providers.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import REGISTRY from "open-sse/providers/registry/index.js";
import * as log from "../utils/logger.js";

const DEFAULT_MODEL = "gpt-4o";
const TIMEOUT_MS = Number(process.env.SYSTEMONE_TIMEOUT_MS || 60000);

function registryEntry(providerId) {
  return REGISTRY.find((r) => r.id === providerId) || null;
}

/** Chat base URLs point at the completions endpoint; systemone lives beside it. */
export function systemoneUrl(providerId, credentials) {
  const custom = credentials?.providerSpecificData?.baseUrl;
  const entry = registryEntry(providerId);
  const base = custom || entry?.transport?.baseUrl || entry?.baseUrl;
  if (!base) return null;
  const trimmed = String(base).replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return `${trimmed.slice(0, -"/chat/completions".length)}/systemone`;
  if (trimmed.endsWith("/messages")) return `${trimmed.slice(0, -"/messages".length)}/systemone`;
  if (trimmed.endsWith("/v1")) return `${trimmed}/systemone`;
  return `${trimmed}/v1/systemone`;
}

export async function handleSystemone(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const modelInput = typeof body?.model === "string" && body.model.trim() ? body.model.trim() : DEFAULT_MODEL;
  const settings = await getSettings();
  const gate = await authorizeApiRequest(request, { requestModel: modelInput, settings, kind: "chat" });
  if (!gate.ok) return gate.response;

  const apiKey = extractApiKey(request);
  if (apiKey) log.debug("AUTH", `API Key: ${log.maskKey(apiKey)}`);

  const modelInfo = await getModelInfo(modelInput);
  const provider = resolveProviderId(modelInfo?.provider || "");
  if (!provider) return errorResponse(HTTP_STATUS.BAD_REQUEST, `Cannot resolve provider for model: ${modelInput}`);

  const credentials = await getProviderCredentials(provider, null, modelInfo.model);
  if (!credentials || credentials.allRateLimited) {
    return errorResponse(
      credentials?.allRateLimited ? HTTP_STATUS.SERVICE_UNAVAILABLE : HTTP_STATUS.BAD_REQUEST,
      `No credentials for provider: ${provider}`
    );
  }

  const refreshed = await checkAndRefreshToken(provider, credentials);
  const url = systemoneUrl(provider, refreshed);
  if (!url) return errorResponse(HTTP_STATUS.BAD_REQUEST, `Provider '${provider}' has no base URL for systemone`);

  const forward = { ...body, model: modelInfo.model || body.model };
  const token = refreshed?.accessToken || refreshed?.apiKey;
  const headers = { "content-type": "application/json", accept: "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(url, { method: "POST", headers, body: JSON.stringify(forward), signal: controller.signal });
  } catch (error) {
    clearTimeout(timer);
    const message = error?.name === "AbortError" ? `[${provider}] systemone timed out` : `[${provider}] systemone fetch failed: ${error.message}`;
    log.warn("SYSTEMONE", message);
    return errorResponse(HTTP_STATUS.BAD_GATEWAY, message);
  }
  clearTimeout(timer);

  const text = await upstream.text().catch(() => "");
  return new Response(text, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") || "application/json" },
  });
}
