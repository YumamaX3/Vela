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

const VERCEL_API = "https://api.vercel.com";

// §5.2 — this route was restructured, not extended, and the reason is a documented
// platform constraint rather than a preference:
//
//   "Any change you make to environment variables are not applied to previous
//    deployments, they only apply to new deployments."
//
// and POST /v13/deployments has NO env channel at all — its 13 body parameters do
// not include one, and `projectSettings` is `additionalProperties: false`, so an
// unrecognised `projectSettings.env` is a schema violation rather than a silent
// pass-through. Therefore deploying first and setting the secret after yields a
// relay that can never see its own secret: it fail-closes on every request, forever,
// with a dashboard that reported success.
//
// The only ordering that works is: ensure project → set secret → deploy.
//
// Endpoint versions below are the documented current ones: env creation is
// /v10/projects/{idOrName}/env (Vercel's own cURL example uses v10; the v9 path this
// file once used for ssoProtection is a different resource and stays as it was).
export async function POST(request) {
  try {
    const body = await request.json();
    const vercelToken = body.vercelToken?.trim();
    // The ADR's update path: without this, every re-deploy minted a second row
    // pointing at the same relay URL (persistRelayPool adopts by URL as a fallback).
    const poolId = typeof body.poolId === "string" && body.poolId.trim() ? body.poolId.trim() : null;
    // "*" is the explicit operator escape hatch. It is logged here, baked visibly
    // into the deployed source, and surfaced in the response — never a default.
    const allowWildcard = body.allowWildcard === true;

    if (!vercelToken) {
      return NextResponse.json({ error: "Vercel API token is required" }, { status: 400 });
    }

    // §5.5b — validated for UNIFORMITY across the three deploy routes, though vercel is
    // the one whose persisted proxyUrl is platform-derived (`https://${ready.url}` from
    // pollDeployment, not interpolated from operator input) and therefore not injectable
    // the way deno and cloudflare are. Two reasons it is still worth the check here:
    //   1. `projectId = project?.id || projectName` at :76 feeds projectName into the
    //      Vercel API path. It is encodeURIComponent'd at :86/:151 today, so this makes
    //      that safe by construction rather than depending on both escapes staying put.
    //   2. The persisted pool `name` becomes a clean DNS label like the other two, and a
    //      future maintainer does not have to work out why one route differs.
    // Placed before the first platform call (:63) for the same orphan reason as the others.
    const slugCheck = validateRelaySlug(
      body.projectName?.trim() || `relay-${Date.now().toString(36)}`
    );
    if (!slugCheck.ok) {
      return NextResponse.json({ error: slugCheck.message }, { status: 400 });
    }
    const projectName = slugCheck.slug;

    if (allowWildcard) {
      console.warn(
        `[vercel-deploy] relay "${projectName}" deployed with a WILDCARD target allow-list — it will forward to any http(s) host for a holder of its secret`
      );
    }

    const auth = { Authorization: `Bearer ${vercelToken}`, "Content-Type": "application/json" };
    const { hosts, source } = await buildRelayAllowList();
    const relayToken = mintRelayToken();
    const relaySource = renderRelay("vercel", hosts, { wildcard: allowWildcard });

    // ── 1. Ensure the project exists BEFORE the secret is set ────────────────
    // The first deployment would otherwise create the project implicitly, and the
    // docs describe no ordering guarantee between that implicit creation and a
    // subsequent env write — so the project is created explicitly. A 409 here means
    // it already exists, which is the normal re-deploy case and not an error.
    const createProjectRes = await fetch(`${VERCEL_API}/v11/projects`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: projectName }),
    });
    if (!createProjectRes.ok && createProjectRes.status !== 409) {
      const err = await createProjectRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: err.error?.message || `Failed to create Vercel project (${createProjectRes.status})` },
        { status: createProjectRes.status }
      );
    }
    const project = createProjectRes.ok ? await createProjectRes.json() : null;
    const projectId = project?.id || projectName;

    // ── 2. Set the secret ────────────────────────────────────────────────────
    // type "sensitive" + visibility "secret" is Vercel's Secret classification:
    // write-only after saving, never decryptable through the API, and redacted from
    // build logs. That is the whole reason the pool row is the only readable copy.
    // `upsert=true` is a QUERY parameter, not a body field — without it a re-deploy
    // would create a second variable with the same key rather than rotate it.
    const { name: envKey, value: envValue } = relaySecretEnvVar(relayToken);
    const setSecretRes = await fetch(
      `${VERCEL_API}/v10/projects/${encodeURIComponent(projectId)}/env?upsert=true`,
      {
        method: "POST",
        headers: auth,
        body: JSON.stringify([
          {
            key: envKey,
            value: envValue,
            type: "sensitive",
            visibility: "secret",
            target: ["production"],
          },
        ]),
      }
    );
    if (!setSecretRes.ok) {
      const err = await setSecretRes.json().catch(() => ({}));
      // Abort rather than deploy. A relay deployed without its secret fail-closes on
      // every request, which is safe but useless — and the dashboard would have
      // reported a successful deploy while the pool silently could not serve
      // traffic. Honest refusal beats a broken artifact.
      return NextResponse.json(
        {
          error: `Relay secret could not be set on the Vercel project (${setSecretRes.status}): ${
            err.error?.message || "unknown"
          }. Aborting deploy — a relay without its secret would refuse every request.`,
        },
        { status: 502 }
      );
    }

    // ── 3. Deploy, now that the secret exists ────────────────────────────────
    const deployRes = await fetch(`${VERCEL_API}/v13/deployments`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: projectName,
        project: projectId,
        files: [
          { file: "api/relay.js", data: relaySource },
          { file: "package.json", data: JSON.stringify({ name: projectName, version: "1.0.0" }) },
          {
            file: "vercel.json",
            data: JSON.stringify({ rewrites: [{ source: "/(.*)", destination: "/api/relay" }] }),
          },
        ],
        projectSettings: { framework: null },
        target: "production",
      }),
    });

    if (!deployRes.ok) {
      const err = await deployRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: err.error?.message || "Failed to create Vercel deployment" },
        { status: deployRes.status }
      );
    }

    const deployment = await deployRes.json();
    const deploymentId = deployment.id || deployment.uid;

    // ssoProtection:null makes the deployment URL publicly reachable — which is now
    // acceptable BECAUSE the relay authenticates, and was the open-proxy hole
    // before it did.
    await fetch(`${VERCEL_API}/v9/projects/${encodeURIComponent(projectId)}`, {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify({ ssoProtection: null }),
    });

    const ready = await pollDeployment(deploymentId, vercelToken);
    const deployUrl = `https://${ready.url}`;

    const { pool, reusedRow } = await persistRelayPool({
      poolId,
      name: projectName,
      proxyUrl: deployUrl,
      type: "vercel",
      relayToken,
      hostCount: allowWildcard ? 0 : hosts.length,
      wildcard: allowWildcard,
    });

    // Never the secret, never the pool row. See relayDeployResponse.
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
    console.log("Error deploying Vercel relay:", error);
    return NextResponse.json({ error: error.message || "Deploy failed" }, { status: 500 });
  }
}

async function pollDeployment(deploymentId, token, maxMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const res = await fetch(`${VERCEL_API}/v13/deployments/${deploymentId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.readyState === "READY") return data;
    if (data.readyState === "ERROR" || data.readyState === "CANCELED") {
      throw new Error(`Deployment failed: ${data.readyState}`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("Deployment timed out");
}
