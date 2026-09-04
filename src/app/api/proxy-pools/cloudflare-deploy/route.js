import { NextResponse } from "next/server";
import {
  buildRelayAllowList,
  mintRelayToken,
  persistRelayPool,
  relayDeployResponse,
  relaySecretEnvVar,
  renderRelay,
  validateRelaySlug,
} from "@/lib/network/relayDeploy.js";

const CF_API = "https://api.cloudflare.com/client/v4";

// §5.2 — Cloudflare is the simplest of the three, because its secret rides INLINE
// in the same multipart upload as the script:
//
//   metadata.bindings[] accepts { type: "secret_text", name, text }
//
// documented as "You can upload secrets at the same time as your Worker code…
// Secrets not included in the file are preserved from the previous version." So
// there is no sequencing hazard here, unlike Vercel (whose env changes never reach
// an already-created deployment) and unlike Deno (whose revision env_vars are
// immutable once created).
//
// Why a `secret_text` binding and not `plain_text`: both surface identically on the
// Worker's `env` parameter, but plain_text is "not encrypted" and visible in the
// dashboard and in `GET …/versions/{id}` bindings — frozen into an immutable,
// append-only version history forever. secret_text is value-omitted on both GET
// endpoints. A relay token in version history is a permanent leak; this is the one
// choice in this file that is not interchangeable.
export async function POST(request) {
  try {
    const body = await request.json();
    const accountId = body.accountId?.trim();
    const apiToken = body.apiToken?.trim();
    const poolId = typeof body.poolId === "string" && body.poolId.trim() ? body.poolId.trim() : null;
    const allowWildcard = body.allowWildcard === true;

    if (!accountId || !apiToken) {
      return NextResponse.json({ error: "Cloudflare Account ID and API Token are required" }, { status: 400 });
    }

    // §5.5b — projectName is interpolated raw into the persisted proxyUrl at :121
    // (`https://${projectName}.${subdomain}.workers.dev`), so it is validated BEFORE the
    // first platform call at :78 — same orphan hazard as deno (the catch returns 500,
    // and a refusal after a successful upload leaves a live worker with no pool row).
    // A side benefit: once projectName is a DNS label ([a-z0-9-] only) it is safe to
    // interpolate into the CF API path at :55, which is why that segment needs no
    // encodeURIComponent the way deno's does — validation makes it safe by construction
    // rather than escaping a value that could still be anything.
    const slugCheck = validateRelaySlug(
      body.projectName?.trim() || `relay-${Date.now().toString(36)}`
    );
    if (!slugCheck.ok) {
      return NextResponse.json({ error: slugCheck.message }, { status: 400 });
    }
    const projectName = slugCheck.slug;

    if (allowWildcard) {
      console.warn(
        `[cloudflare-deploy] relay "${projectName}" deployed with a WILDCARD target allow-list — it will forward to any http(s) host for a holder of its secret`
      );
    }

    const { hosts, source } = await buildRelayAllowList();
    const relayToken = mintRelayToken();
    const relaySource = renderRelay("cloudflare", hosts, { wildcard: allowWildcard });
    const { name: envKey, value: envValue } = relaySecretEnvVar(relayToken);

    // ── 1. Upload the Worker script AND its secret in one call ───────────────
    const workerScriptUrl = `${CF_API}/accounts/${accountId}/workers/scripts/${projectName}`;
    const formData = new FormData();
    formData.append(
      "index.js",
      new Blob([relaySource], { type: "application/javascript+module" }),
      "index.js"
    );
    formData.append(
      "metadata",
      new Blob(
        [
          JSON.stringify({
            main_module: "index.js",
            compatibility_date: "2024-03-20",
            observability: { enabled: true },
            bindings: [{ type: "secret_text", name: envKey, text: envValue }],
          }),
        ],
        { type: "application/json" }
      ),
      "metadata.json"
    );

    const uploadRes = await fetch(workerScriptUrl, {
      method: "PUT",
      headers: { Authorization: `Bearer ${apiToken}` },
      body: formData,
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.json().catch(() => ({}));
      console.error("Cloudflare upload error:", err);
      // 10215 is Cloudflare's "the latest version of your Worker isn't currently
      // deployed" guard on secret edits. It cannot arise on this combined upload
      // path, but naming it keeps the failure readable if Cloudflare ever starts
      // returning it here.
      const code = err?.errors?.[0]?.code;
      const message = err?.errors?.[0]?.message || "Failed to upload Worker to Cloudflare";
      return NextResponse.json(
        { error: code === 10215 ? `${message} (Cloudflare 10215: deploy the latest version first)` : message },
        { status: uploadRes.status }
      );
    }

    // ── 2. Enable the workers.dev subdomain ──────────────────────────────────
    const enableSubdomainRes = await fetch(`${workerScriptUrl}/subdomain`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    if (!enableSubdomainRes.ok) {
      // Non-fatal: the script and its secret are already live, and an operator with
      // a custom domain does not need workers.dev at all. The URL step below fails
      // loud if it genuinely cannot resolve an address.
      console.warn("Cloudflare subdomain enable failed:", enableSubdomainRes.status);
    }

    // ── 3. Resolve the public URL ────────────────────────────────────────────
    let deployUrl = "";
    const subdomainRes = await fetch(`${CF_API}/accounts/${accountId}/workers/subdomain`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    });
    if (subdomainRes.ok) {
      const subdomainData = await subdomainRes.json();
      if (subdomainData.result?.subdomain) {
        deployUrl = `https://${projectName}.${subdomainData.result.subdomain}.workers.dev`;
      }
    }

    if (!deployUrl) {
      return NextResponse.json(
        {
          error:
            "Worker deployed but failed to retrieve workers.dev subdomain. Make sure you have set up a workers.dev subdomain in the Cloudflare Dashboard.",
        },
        { status: 400 }
      );
    }

    const { pool, reusedRow } = await persistRelayPool({
      poolId,
      name: projectName,
      proxyUrl: deployUrl,
      type: "cloudflare",
      relayToken,
      hostCount: allowWildcard ? 0 : hosts.length,
      wildcard: allowWildcard,
    });

    return NextResponse.json(
      relayDeployResponse({
        pool,
        deployUrl,
        reusedRow,
        hostCount: allowWildcard ? 0 : source.total,
        wildcard: allowWildcard,
      }),
      { status: 201 }
    );
  } catch (error) {
    if (error?.status === 404) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.log("Error deploying Cloudflare relay:", error);
    return NextResponse.json({ error: error.message || "Deploy failed" }, { status: 500 });
  }
}
