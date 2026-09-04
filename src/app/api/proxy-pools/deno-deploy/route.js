import { NextResponse } from "next/server";
import {
  buildRelayAllowList,
  mintRelayToken,
  persistRelayPool,
  relayDeployResponse,
  relaySecretEnvVar,
  renderRelay,
  validateRelaySlug,
  validateRelayOrgDomain,
} from "@/lib/network/relayDeploy.js";

const DENO_V2_API = "https://api.deno.com/v2";

// §5.2 — Deno delivers its secret through `env_vars`, and two documented behaviours
// shape this route:
//
//   1. env_vars on POST /v2/apps are the APP's variables; a deployed revision
//      inherits them. Setting them at creation means the very first revision can
//      already see its secret — no ordering hazard, unlike Vercel.
//   2. PATCH /v2/apps/{app} DEEP-MERGES env_vars and restarts the isolates WITHOUT
//      a redeploy. That is the re-deploy/rotation path, and it is the only way to
//      land a fresh secret on an app that already exists — because a revision's
//      env_vars are immutable once created.
//
// THE 409 HAZARD THIS ROUTE NOW CLOSES: the old code refused a 409 outright ("choose
// a different name"), so a Deno relay could never be re-deployed from the dashboard
// and its token could never be rotated. Simply proceeding past the 409 would be
// worse — the app would keep its OLD secret while the pool row received a NEW one,
// and the relay would 401 every request after a deploy the dashboard called
// successful. So the 409 path patches the secret in and only then deploys.
//
// `labels` on PATCH REPLACES rather than merges, so the patch below sends the full
// label set rather than a partial one.
const RELAY_LABELS = { "custom.kind": "Vela-relay" };

export async function POST(request) {
  try {
    const body = await request.json();
    const denoToken = body.denoToken?.trim();
    const poolId = typeof body.poolId === "string" && body.poolId.trim() ? body.poolId.trim() : null;
    const allowWildcard = body.allowWildcard === true;

    // §5.5b — BOTH of these are interpolated raw into the persisted proxyUrl at :194
    // (`https://${projectName}.${orgSlug}.deno.net`, orgSlug being
    // orgDomain.split(".")[0]), and that row becomes the egress path for every proxied
    // request. Measured with no validation:
    //   projectName = "169.254.169.254/#" → persisted hostname 169.254.169.254 (cloud metadata)
    //   orgDomain   = "a/b.deno.net"      → persisted hostname relay-1.a       (suffix escaped)
    // So they are judged here, BEFORE the first platform call at :78 — the catch below
    // returns 500, and refusing after a successful deploy would orphan a live publicly
    // reachable relay holding a freshly minted secret with no pool row to govern it.
    const slugCheck = validateRelaySlug(
      body.projectName?.trim() || `relay-${Date.now().toString(36)}`
    );
    if (!slugCheck.ok) {
      return NextResponse.json({ error: slugCheck.message }, { status: 400 });
    }
    const projectName = slugCheck.slug;

    const orgCheck = validateRelayOrgDomain(body.orgDomain);
    if (!orgCheck.ok) {
      return NextResponse.json({ error: orgCheck.message }, { status: 400 });
    }
    const orgDomain = orgCheck.domain;

    if (!denoToken) {
      return NextResponse.json({ error: "Deno Deploy API token is required" }, { status: 400 });
    }

    if (allowWildcard) {
      console.warn(
        `[deno-deploy] relay "${projectName}" deployed with a WILDCARD target allow-list — it will forward to any http(s) host for a holder of its secret`
      );
    }

    const headers = {
      Authorization: `Bearer ${denoToken}`,
      "Content-Type": "application/json",
    };

    const { hosts, source } = await buildRelayAllowList();
    const relayToken = mintRelayToken();
    const relaySource = renderRelay("deno", hosts, { wildcard: allowWildcard });
    const { name: envKey, value: envValue } = relaySecretEnvVar(relayToken);
    const envVars = [{ key: envKey, value: envValue, secret: true }];

    // ── 1. Create the app, secret included ───────────────────────────────────
    // `createdHere` governs the rollback below: an app we adopted on a 409 belongs
    // to the operator, and deleting it because OUR deploy failed would destroy
    // their relay. That guard did not exist when every path created the app.
    let appId = null;
    let createdHere = false;

    const createAppRes = await fetch(`${DENO_V2_API}/apps`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        slug: projectName,
        labels: RELAY_LABELS,
        env_vars: envVars,
        config: {
          install: "deno install",
          runtime: {
            type: "dynamic",
            entrypoint: "main.ts",
          },
        },
      }),
    });

    if (createAppRes.ok) {
      const app = await createAppRes.json();
      appId = app.id;
      createdHere = true;
    } else if (createAppRes.status === 409) {
      // ── 1b. The app already exists — rotate its secret instead ─────────────
      // PATCH addresses the app by slug, deep-merges env_vars, and restarts the
      // isolates. `labels` is sent whole because PATCH replaces it.
      const patchRes = await fetch(`${DENO_V2_API}/apps/${encodeURIComponent(projectName)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ labels: RELAY_LABELS, env_vars: envVars }),
      });
      if (!patchRes.ok) {
        const text = await patchRes.text().catch(() => "");
        // Abort rather than deploy. Same law as the Vercel route: a relay without
        // its secret fail-closes on every request, and a dashboard that reported
        // success would be lying.
        return NextResponse.json(
          {
            error: `App "${projectName}" already exists and its relay secret could not be rotated (${patchRes.status}): ${
              text || "unknown"
            }. Aborting deploy — the relay would refuse every request with a stale secret.`,
          },
          { status: 502 }
        );
      }
      const patched = await patchRes.json().catch(() => null);
      // Fall back to the slug for the deploy path if the patch response omits an id
      // — Deno accepts the slug there, which is why the PATCH above could use it.
      appId = patched?.id || projectName;
    } else {
      const text = await createAppRes.text().catch(() => "");
      return NextResponse.json(
        { error: `Failed to create app (${createAppRes.status}): ${text}` },
        { status: createAppRes.status }
      );
    }

    // ── 2. Deploy the rendered relay ─────────────────────────────────────────
    // The secret is NOT repeated here. Deno documents its own resolution order
    // between app-level and revision-level env_vars inconsistently, so the key is
    // set in exactly one place — the app — and the revision inherits it.
    const deployRes = await fetch(
      `${DENO_V2_API}/apps/${encodeURIComponent(appId)}/deploy`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          assets: {
            "main.ts": {
              kind: "file",
              content: relaySource,
              encoding: "utf-8",
            },
          },
        }),
      }
    );

    if (!deployRes.ok) {
      const text = await deployRes.text().catch(() => "");
      console.error("Deno Deploy error:", deployRes.status, text);
      if (createdHere) await deleteApp(appId, denoToken);
      return NextResponse.json(
        { error: `Deploy failed (${deployRes.status}): ${text}` },
        { status: deployRes.status }
      );
    }

    const revision = await deployRes.json();
    const revisionId = revision.id;

    // ── 3. Wait for the revision to succeed ──────────────────────────────────
    let status = revision.status;
    let attempts = 0;
    const maxAttempts = 30; // 30 * 2s = 60s max
    while (status === "queued" || status === "building") {
      if (attempts >= maxAttempts) {
        if (createdHere) await deleteApp(appId, denoToken);
        throw new Error("Deploy timed out after 60 seconds");
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const statusRes = await fetch(`${DENO_V2_API}/revisions/${revisionId}`, {
        headers: { Authorization: `Bearer ${denoToken}` },
      });
      if (!statusRes.ok) break;
      const statusData = await statusRes.json();
      status = statusData.status;
      attempts++;
    }

    if (status !== "succeeded") {
      if (createdHere) await deleteApp(appId, denoToken);
      return NextResponse.json({ error: `Deploy failed with status: ${status}` }, { status: 500 });
    }

    // ── 4. Resolve the public URL and persist the pool ───────────────────────
    const orgSlug = orgDomain.split(".")[0];
    const deployUrl = `https://${projectName}.${orgSlug}.deno.net`;

    const { pool, reusedRow } = await persistRelayPool({
      poolId,
      name: projectName,
      proxyUrl: deployUrl,
      type: "deno",
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
    console.log("Error deploying Deno Deploy relay:", error);
    return NextResponse.json({ error: error.message || "Deploy failed" }, { status: 500 });
  }
}

/** Best-effort rollback of an app THIS request created. Never throws — a failed
 *  cleanup must not mask the deploy error the operator actually needs to see. */
async function deleteApp(appId, denoToken) {
  try {
    await fetch(`${DENO_V2_API}/apps/${encodeURIComponent(appId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${denoToken}` },
    });
  } catch {
    // Deliberately silent: the deploy failure is the signal that matters.
  }
}
