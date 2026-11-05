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
//
// The forms themselves live in `RelayDeployForm` (§3.3) so the Tools shore can offer
// the SAME credential forms without a second copy; this file imports them back and
// keeps the toggle's blast-radius warning beside the switch it explains.
import { useMemo, useState } from "react";
import { Badge, Button, Card, CardSkeleton, Modal } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";
import { formatDateTime, maskProxyUrl, RELAY_PLATFORMS } from "../lib/proxyFormat";
import { PoolVerdictBadge } from "./HealthVerdict";
import { DEFAULT_FORM, canDeploy, RelayBlurb, RelayForm } from "./RelayDeployForm";

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
                    <span className={`material-symbols-outlined text-xl ${platform.tone}`} aria-hidden="true">
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
                            <code className="truncate font-mono text-2xs text-text-muted">
                              {maskProxyUrl(pool.proxyUrl)}
                            </code>
                            {geo ? (
                              <p className="flex items-center gap-1.5 text-2xs text-text-muted">
                                <span className="material-symbols-outlined text-xs">travel_explore</span>
                                <span className="font-mono">{geo.ip}</span>
                                {geo.country ? <span>· {geo.country}</span> : null}
                                {geo.isUnstable ? <span>· flapping</span> : null}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-2xs text-text-muted">
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
