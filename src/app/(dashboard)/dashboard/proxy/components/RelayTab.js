"use client";
// RelayTab — the three edge relays as first-class rows (NEW; before this the three
// deploys were a dropdown menu that produced a pool and then forgot it existed).
//
// A relay is not a special pool type bolted on; it is a pool whose egress is an edge
// platform (Vercel / Cloudflare / Deno). This lens gives each platform a row that
// shows every relay pool of that type — its URL, its bound connections, its probe
// verdict, its egress — and a form to deploy a new one. Deploying is destructive to
// nothing: it mints a secret, deploys the relay, and persists a pool row, all
// server-side, and the console only reads `deployUrl` back (the response carries no
// secret and no pool row — see relayDeployResponse).
//
// The forms are per-platform because the credentials genuinely differ: Vercel wants
// an API token, Cloudflare wants an account id + workers token, Deno wants an org
// token + org domain. Collapsing them into one generic form would lie about that.
import { useMemo, useState } from "react";
import { Badge, Button, Card, CardSkeleton, Input, Modal, Toggle } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";
import { formatDateTime, maskProxyUrl, RELAY_PLATFORMS } from "../lib/proxyFormat";
import { PoolVerdictBadge } from "./HealthVerdict";

const RELAY_BLURB = {
  vercel: {
    title: "What is Vercel Relay?",
    body: "Deploys an edge relay function to Vercel. All AI provider requests will be forwarded through Vercel's edge network, masking your real IP from providers.",
    points: [
      "Your IP is replaced by Vercel's dynamic edge IPs (hundreds of IPs across 20+ global regions)",
      "Vercel serves millions of apps: providers can't block Vercel IPs without affecting legitimate traffic",
      "Free tier: 100GB bandwidth/month, 500K edge invocations",
      "Deploy multiple relays on different accounts for more IP diversity",
    ],
  },
  cloudflare: {
    title: "What is Cloudflare Relay?",
    body: "Deploys a Cloudflare Worker as a proxy relay. All AI provider requests will be forwarded through Cloudflare's global edge network.",
    points: [
      "High performance global routing and IP masking via Cloudflare Workers",
      "Free tier: 100,000 requests per day",
      "Requires Cloudflare Account ID and a Workers API Token (Edit Workers permission)",
    ],
  },
  deno: {
    title: "What is Deno Relay?",
    body: "Deploys a relay worker to Deno Deploy's global edge network. All AI provider requests are forwarded through Deno's edge, masking your real IP.",
    points: [
      "Deno Deploy v2 runs on a high-performance global edge network",
      "Free tier: 1M requests & 100GiB outbound traffic per month",
      "No per-request CPU time limits (unlike Vercel/Cloudflare)",
      "Support up to 20 active apps & 50 custom domains",
    ],
  },
};

const DEFAULT_FORM = {
  vercel: { vercelToken: "", projectName: "vercel-relay", allowWildcard: false },
  cloudflare: { accountId: "", apiToken: "", projectName: "cloudflare-relay", allowWildcard: false },
  deno: { denoToken: "", orgDomain: "", projectName: "", allowWildcard: false },
};

function canDeploy(platform, form) {
  if (platform === "vercel") return !!form.vercelToken.trim();
  if (platform === "cloudflare") return !!form.accountId.trim() && !!form.apiToken.trim();
  if (platform === "deno") return !!form.denoToken.trim() && !!form.orgDomain.trim();
  return false;
}

export default function RelayTab({ c }) {
  const notify = useNotificationStore();
  const [openPlatform, setOpenPlatform] = useState(null);
  const [forms, setForms] = useState(DEFAULT_FORM);
  const [deploying, setDeploying] = useState(false);
  const [probingId, setProbingId] = useState(null);

  const handleProbe = async (poolId) => {
    setProbingId(poolId);
    try {
      const res = await c.probeEgress(poolId);
      if (!res.ok) {
        notify.error(res.body?.error || "Egress probe failed");
        return;
      }
      notify.success(`Egress probed: ${res.body?.ip || "no IP returned"}`);
    } catch (err) {
      notify.error(`Egress probe failed: ${err.message}`);
    } finally {
      setProbingId(null);
    }
  };

  const relaysByType = useMemo(() => {
    const out = { vercel: [], cloudflare: [], deno: [] };
    for (const pool of c.relays) {
      if (out[pool.type]) out[pool.type].push(pool);
    }
    return out;
  }, [c.relays]);

  const openDeploy = (platform) => {
    setForms((prev) => ({ ...prev, [platform]: { ...DEFAULT_FORM[platform] } }));
    setOpenPlatform(platform);
  };
  const closeDeploy = () => {
    if (deploying) return;
    setOpenPlatform(null);
  };
  const setField = (platform, key, value) =>
    setForms((prev) => ({ ...prev, [platform]: { ...prev[platform], [key]: value } }));

  const handleDeploy = async () => {
    const platform = openPlatform;
    if (!platform) return;
    const form = forms[platform];
    if (!canDeploy(platform, form)) return;
    setDeploying(true);
    try {
      const res = await c.deploy(platform, form);
      if (res.ok) {
        notify.success(`Deployed: ${res.body?.deployUrl || "relay"}`);
        setOpenPlatform(null);
      } else {
        notify.error(res.body?.error || "Deploy failed");
      }
    } catch (err) {
      notify.error(`Deploy failed: ${err.message}`);
    } finally {
      setDeploying(false);
    }
  };

  if (c.loading) return <CardSkeleton />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-text-main">Edge relays</h2>
          <Badge variant="default" size="sm">{c.relays.length} relay pool{c.relays.length === 1 ? "" : "s"}</Badge>
        </div>
        <Button variant="secondary" size="sm" icon="refresh" onClick={c.reload}>
          Refresh
        </Button>
      </div>
      <p className="text-sm text-text-muted">
        Deploy an edge relay to mask this gateway&apos;s IP from providers. Each deploy mints a fresh
        relay secret, delivers it to the platform&apos;s own secret store, and persists one pool row:
        the secret is never returned to the browser. Deploy more than one relay for IP diversity.
      </p>

      <div className="flex flex-col gap-3">
        {RELAY_PLATFORMS.map((platform) => {
          const pools = relaysByType[platform.id] || [];
          return (
            <Card key={platform.id} padding="sm">
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`material-symbols-outlined text-[20px] ${platform.tone}`} aria-hidden="true">
                      {platform.icon}
                    </span>
                    <p className="text-sm font-medium">{platform.label}</p>
                    <Badge variant="default" size="sm">{pools.length} deployed</Badge>
                  </div>
                  <Button size="sm" icon="rocket_launch" onClick={() => openDeploy(platform.id)}>
                    Deploy
                  </Button>
                </div>

                {pools.length === 0 ? (
                  <p className="text-xs text-text-muted">No {platform.label.toLowerCase()} pools yet.</p>
                ) : (
                  <div className="flex flex-col divide-y divide-black/[0.04] dark:divide-white/[0.05]">
                    {pools.map((pool) => {
                      const geo = c.geo[pool.id];
                      return (
                        <div key={pool.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-sm font-medium">{pool.name}</p>
                              <PoolVerdictBadge pool={pool} />
                              <Badge variant={pool.isActive ? "success" : "default"} size="sm">
                                {pool.isActive ? "active" : "inactive"}
                              </Badge>
                              <Badge variant="default" size="sm">{pool.boundConnectionCount || 0} bound</Badge>
                            </div>
                            <code className="truncate font-mono text-[11px] text-text-muted">
                              {maskProxyUrl(pool.proxyUrl)}
                            </code>
                            {geo ? (
                              <p className="flex items-center gap-1.5 text-[11px] text-text-muted">
                                <span className="material-symbols-outlined text-[12px]">travel_explore</span>
                                <span className="font-mono">{geo.ip}</span>
                                {geo.country ? <span>· {geo.country}</span> : null}
                                {geo.isUnstable ? <span>· flapping</span> : null}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-text-muted">
                              {pool.relayDeployedAt ? `deployed ${formatDateTime(pool.relayDeployedAt)}` : null}
                            </span>
                            <Button
                              size="sm"
                              variant="secondary"
                              icon="science"
                              onClick={() => handleProbe(pool.id)}
                              disabled={probingId === pool.id}
                              title="Probe this relay's egress"
                            >
                              {probingId === pool.id ? "Probing…" : "Probe"}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {RELAY_PLATFORMS.map((platform) => (
        <Modal
          key={platform.id}
          isOpen={openPlatform === platform.id}
          title={`Deploy ${platform.label}`}
          onClose={closeDeploy}
        >
          <div className="flex flex-col gap-4">
            <RelayBlurb platform={platform.id} />
            <RelayForm platform={platform.id} form={forms[platform.id]} setField={setField} />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button
                fullWidth
                onClick={handleDeploy}
                disabled={!canDeploy(platform.id, forms[platform.id]) || deploying}
              >
                {deploying ? "Deploying…" : "Deploy"}
              </Button>
              <Button fullWidth variant="ghost" onClick={closeDeploy} disabled={deploying}>
                Cancel
              </Button>
            </div>
          </div>
        </Modal>
      ))}
    </div>
  );
}

function RelayBlurb({ platform }) {
  const b = RELAY_BLURB[platform];
  const tone = platform === "vercel" ? "blue" : platform === "cloudflare" ? "orange" : "black";
  const toneClass =
    platform === "vercel"
      ? "bg-blue-500/5 border-blue-500/10"
      : platform === "cloudflare"
        ? "bg-orange-500/5 border-orange-500/10"
        : "bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10";
  return (
    <div className={`flex flex-col gap-1.5 rounded-lg border p-3 ${toneClass}`} data-tone={tone}>
      <p className="text-sm font-medium text-text-main">{b.title}</p>
      <p className="text-xs text-text-muted">{b.body}</p>
      <ul className="list-disc space-y-0.5 pl-4 text-xs text-text-muted">
        {b.points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
    </div>
  );
}

function RelayForm({ platform, form, setField }) {
  if (platform === "vercel") {
    return (
      <>
        <Input
          label="Vercel API Token"
          value={form.vercelToken}
          onChange={(e) => setField(platform, "vercelToken", e.target.value)}
          placeholder="your-vercel-api-token"
          hint={<>Token is used once for deployment and not stored. <a href="https://vercel.com/account/tokens" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Get token →</a></>}
          type="password"
        />
        <Input
          label="Project Name"
          value={form.projectName}
          onChange={(e) => setField(platform, "projectName", e.target.value)}
          placeholder="my-relay"
          hint="Unique name for your Vercel project. Leave empty for an auto-generated name."
        />
        <RelayWildcardToggle platform={platform} form={form} setField={setField} />
      </>
    );
  }
  if (platform === "cloudflare") {
    return (
      <>
        <Input
          label="Account ID"
          value={form.accountId}
          onChange={(e) => setField(platform, "accountId", e.target.value)}
          placeholder="your-cloudflare-account-id"
          hint="Found on the right side of the Cloudflare dashboard overview page."
        />
        <Input
          label="API Token"
          value={form.apiToken}
          onChange={(e) => setField(platform, "apiToken", e.target.value)}
          placeholder="your-cloudflare-api-token"
          hint={<>Requires &quot;Workers Scripts: Edit&quot; permission. <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Get token →</a></>}
          type="password"
        />
        <Input
          label="Worker Name"
          value={form.projectName}
          onChange={(e) => setField(platform, "projectName", e.target.value)}
          placeholder="my-relay"
          hint="Unique name for your Cloudflare Worker. Leave empty for an auto-generated name."
        />
        <RelayWildcardToggle platform={platform} form={form} setField={setField} />
      </>
    );
  }
  return (
    <>
      <Input
        label="Deno Deploy API Token"
        value={form.denoToken}
        onChange={(e) => setField(platform, "denoToken", e.target.value)}
        placeholder="ddo_xxxxxxxxxxxxxxxx"
        hint="Token is used once for deployment, not stored. Found in Organization Settings."
        type="password"
      />
      <Input
        label="Organization Domain"
        value={form.orgDomain}
        onChange={(e) => setField(platform, "orgDomain", e.target.value)}
        placeholder="your-org.deno.net"
        hint="Organization's default domain. Your relay URL will be: https://my-relay.your-org.deno.net"
      />
      <Input
        label="App Name"
        value={form.projectName}
        onChange={(e) => setField(platform, "projectName", e.target.value)}
        placeholder="deno-relay"
        hint="Unique app name. Leave empty for an auto-generated name."
      />
      <RelayWildcardToggle platform={platform} form={form} setField={setField} />
    </>
  );
}

// §5.5b — the allow-list is built from the gateway's own provider registry + DB
// hosts by default. Opting into a wildcard means the relay will forward to ANY host
// for a holder of its secret; that is a real widening of blast radius, so it is an
// explicit switch with the cost written beside it, never a default.
function RelayWildcardToggle({ platform, form, setField }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/50 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-medium">Allow any host (wildcard)</p>
        <p className="text-xs text-text-muted">
          Off by default: the relay forwards only to hosts in this gateway&apos;s provider registry.
          On, it forwards to any http(s) host for a holder of its secret.
        </p>
      </div>
      <Toggle
        checked={form.allowWildcard === true}
        onChange={(next) => setField(platform, "allowWildcard", next)}
      />
    </div>
  );
}
