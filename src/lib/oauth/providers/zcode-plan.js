import crypto from "crypto";
import { GLM_OAUTH_CONFIG } from "../constants/oauth.js";
import { v4 as uuidv4 } from "uuid";

// ZCode Start Plan OAuth — the glm.js CLI polling flow (same origin,
// zcode.z.ai /api/v1/oauth/cli/{init,poll}), stopping at the access token:
//
//   1) POST {cliInitUrl}   Authorization: Bearer <pollToken>  {"provider":"zai"}
//        → { code: 0, data: { authorize_url, flow_id, poll_interval_sec, expires_at } }
//   2) Browser opens authorize_url; user signs in with the Z.ai account
//   3) GET {cliPollUrl}/<flow_id>   Authorization: Bearer <pollToken>
//        → { data: { status: "pending" } } until
//          { data: { status: "ready", token, user, zai: { access_token } } }
//
// The TOP-LEVEL `token` is the plan JWT — that is the chat credential (and the
// billing credential), per upstream login.go. The nested `zai.access_token` is
// the ZAI OAuth token and is NOT used for chat: upstream only best-effort
// exchanges it for a coding-plan API key, so we keep it aside
// (zaiOAuthToken) for a future exchange. There is no business-token exchange
// and no refresh grant; expiry means re-login.
const zcodePlan = {
  config: GLM_OAUTH_CONFIG,
  flowType: "device_code",
  requestDeviceCode: async (config) => {
    const pollToken = crypto.randomBytes(32).toString("hex");
    const response = await fetch(config.cliInitUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${pollToken}`,
      },
      body: JSON.stringify({ provider: config.providerId || "zai" }),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ZCode OAuth init failed: ${error}`);
    }
    const payload = await response.json();
    if (!isSuccessCode(payload.code) || !payload.data) {
      throw new Error(payload.msg || "ZCode OAuth init returned no data");
    }
    const data = payload.data;
    if (!data.flow_id || !data.authorize_url) {
      throw new Error("ZCode OAuth init response missing flow_id/authorize_url");
    }
    return {
      device_code: data.flow_id,
      verification_uri: data.authorize_url,
      // expires_at is upstream-absolute; surface a relative deadline for the UI
      expires_in: relativeSeconds(data.expires_at) ?? 300,
      interval: data.poll_interval_sec || 3,
      _zcodePollToken: pollToken,
    };
  },
  pollToken: async (config, deviceCode, _codeVerifier, extraData) => {
    const pollToken = extraData?._zcodePollToken;
    if (!pollToken) {
      return {
        ok: true,
        data: {
          error: "access_denied",
          error_description: "Missing ZCode poll token — restart the login flow",
        },
      };
    }

    const response = await fetch(`${config.cliPollUrl}/${encodeURIComponent(deviceCode)}`, {
      headers: { Authorization: `Bearer ${pollToken}` },
    });
    if (!response.ok) {
      return {
        ok: true,
        data: {
          error: "access_denied",
          error_description: `ZCode poll failed (HTTP ${response.status})`,
        },
      };
    }

    const payload = await response.json();
    if (!isSuccessCode(payload.code)) {
      return {
        ok: true,
        data: { error: "access_denied", error_description: payload.msg || "ZCode poll failed" },
      };
    }

    const data = payload.data || {};
    if (data.status === "pending") {
      return { ok: true, data: { error: "authorization_pending" } };
    }
    if (data.status === "failed") {
      return {
        ok: true,
        data: {
          error: "access_denied",
          error_description: "ZCode authorization failed or was cancelled",
        },
      };
    }
    if (data.status !== "ready") {
      return {
        ok: true,
        data: { error: "authorization_pending", error_description: `Unknown status: ${data.status}` },
      };
    }

    // The TOP-LEVEL plan JWT (data.token) is the chat credential; upstream
    // login.go admits exactly that to the pool. The nested zai.access_token is
    // the OAuth token — kept aside, never used for chat.
    const planToken = data.token || data.accessToken || data.access_token;
    const providerData = data[config.providerId] || data[data.providerId] || {};
    const zaiAccessToken = providerData.access_token || providerData.accessToken || null;
    if (!planToken) {
      return {
        ok: true,
        data: {
          error: "access_denied",
          error_description: "ZCode poll response missing plan token",
        },
      };
    }

    return {
      ok: true,
      data: {
        access_token: planToken, // chat credential — the plan JWT
        _zaiOAuthToken: zaiAccessToken || "",
        _zcodeExpiresIn: relativeSeconds(data.expires_at),
        _zcodeUser: data.user || {},
        _zcodePollToken: pollToken,
      },
    };
  },
  mapTokens: (tokens) => {
    const user = tokens._zcodeUser || {};
    const displayName = user.name || user.email || null;
    return {
      accessToken: tokens.access_token,
      refreshToken: null,
      expiresIn: tokens._zcodeExpiresIn ?? undefined,
      email: user.email || null,
      ...(displayName ? { displayName } : {}),
      providerSpecificData: {
        authMethod: "cli_poll",
        username: user.name || undefined,
        userId: user.user_id || user.id || undefined,
        // minted once here and persisted on the connection row — billing
        // headers and session-id derivation depend on it staying stable
        deviceMid: uuidv4(),
        zcodeUser: user,
        ...(tokens._zaiOAuthToken ? { zaiOAuthToken: tokens._zaiOAuthToken } : {}),
      },
    };
  },
};

// Upstream answers {code, msg, data}; code 0/200 (or absent) = success.
function isSuccessCode(code) {
  return code === undefined || code === null || code === 0 || code === 200 || code === "0" || code === "200";
}

// Absolute epoch (s or ms) → seconds from now; null when absent/invalid.
function relativeSeconds(expiresAt) {
  const raw = Number(expiresAt);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const ms = raw > 1e12 ? raw : raw * 1000;
  const seconds = Math.floor((ms - Date.now()) / 1000);
  return seconds > 0 ? seconds : null;
}

export default zcodePlan;
