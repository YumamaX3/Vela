// The five doors — the one list every cross-shore link reads (§4 · W4).
//
// The hub's cards, the Sidebar's children and the security banner's links all
// name the same shores, and a list copied three times is three chances to
// disagree about a route's address or its icon. So the doors live here, in the
// console's own vocabulary, and each surface selects the subset it frames — the
// hub takes all four lenses, a side reference takes one.
//
// `chip(c)` is a LIVE count where the store has an honest one, and `null` where
// it does not (§4.5: a tile with no honest number carries no chip). Diagnostics
// is a verb, not a count, so it carries none — and the Hub is the front door
// itself, listed last so the Sidebar's room tile keeps its own address.
//
// The count discipline is the same law the proxy doors carry: a chip is either
// derived from the live controller or it is absent. A fabricated zero would
// read as "nothing configured" when the truth is "not counted here."

export const ENDPOINT_DOORS = Object.freeze([
  {
    slug: "keys",
    href: "/dashboard/endpoint/keys",
    label: "API Keys",
    icon: "vpn_key",
    blurb: "The fleet: mint, file, scope, ceiling, pause and revoke — with the usage each key has earned.",
    chip: (c) => `${c.keys.length} key${c.keys.length === 1 ? "" : "s"}`,
  },
  {
    slug: "access",
    href: "/dashboard/endpoint/access",
    label: "Access",
    icon: "lan",
    blurb: "The three transports — local, Cloudflare Tunnel, Tailscale — and what each is reachable on.",
    chip: (c) => {
      const n = (c.tunnelEnabled ? 1 : 0) + (c.tsEnabled ? 1 : 0);
      return n > 0 ? `${n} remote` : null;
    },
  },
  {
    slug: "security",
    href: "/dashboard/endpoint/security",
    label: "Security",
    icon: "shield_lock",
    blurb: "The controls that decide whether this gateway is safe to expose.",
    chip: (c) => (c.missingControls > 0 ? `${c.missingControls} to set` : null),
  },
  {
    slug: "diagnostics",
    href: "/dashboard/endpoint/diagnostics",
    label: "Diagnostics",
    icon: "monitor_heart",
    blurb: "The live probe, its history, and what this browser measured.",
    // A verb, not a count — the door carries no chip rather than a guessed one.
    chip: null,
  },
  {
    // The hub itself, for the surfaces that want a way home. The hub does not
    // list itself, so it filters this entry out by slug.
    slug: "hub",
    href: "/dashboard/endpoint",
    label: "Endpoint",
    icon: "api",
    blurb: "The front door: posture, live pulse, and every lens.",
    chip: null,
  },
]);

/** The doors in console order, without the hub — what the hub's grid renders. */
export const ENDPOINT_LENSES = Object.freeze(ENDPOINT_DOORS.filter((d) => d.slug !== "hub"));

/** One door by slug — for a single cross-shore reference. */
export function doorBySlug(slug) {
  return ENDPOINT_DOORS.find((d) => d.slug === slug) || null;
}
