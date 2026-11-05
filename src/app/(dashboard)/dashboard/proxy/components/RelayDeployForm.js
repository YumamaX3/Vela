"use client";
// RelayDeployForm — the three edge-relay deploy forms, shared by the Relay shore and
// the Tools shore (§3.3 "Deploy relay — the forms, moved from RelayTab").
//
// The forms are per-platform because the credentials genuinely differ: Vercel wants
// an API token, Cloudflare wants an account id + workers token, Deno wants an org
// token + org domain. Collapsing them into one generic form would lie about that.
//
// WHY HERE AND NOT IN RelayTab: the Tools page offers the deploy forms as a tool,
// and the Relay page frames them beside the relay rows. Two copies of a credential
// form is two chances for one to gain a field the other lacks — or to lose the
// wildcard toggle's blast-radius warning. So the forms, defaults, readiness
// predicate and blurbs live here ONCE; each shore composes them into its own frame.
import { Input, Toggle } from "@/shared/components";

export const RELAY_BLURB = {
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

export const DEFAULT_FORM = {
  vercel: { vercelToken: "", projectName: "vercel-relay", allowWildcard: false },
  cloudflare: { accountId: "", apiToken: "", projectName: "cloudflare-relay", allowWildcard: false },
  deno: { denoToken: "", orgDomain: "", projectName: "", allowWildcard: false },
};

export function canDeploy(platform, form) {
  if (platform === "vercel") return !!form.vercelToken.trim();
  if (platform === "cloudflare") return !!form.accountId.trim() && !!form.apiToken.trim();
  if (platform === "deno") return !!form.denoToken.trim() && !!form.orgDomain.trim();
  return false;
}

export function RelayBlurb({ platform }) {
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

export function RelayForm({ platform, form, setField }) {
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
export function RelayWildcardToggle({ platform, form, setField }) {
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

export default RelayForm
