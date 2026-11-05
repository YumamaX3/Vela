// The eight doors — the one list every cross-shore link reads (§4 · W4).
//
// The hub's cards, the usage page's "open the ledger" jump and the tools page's
// pointers all name the same shores, and a list copied three times is three
// chances to disagree about a route's address or its icon. So the doors live
// here, in the console's own vocabulary, and each surface selects the subset it
// frames — the hub takes all eight, a side reference takes one.
//
// `chip(c)` is a LIVE count where the store has an honest one, and `null` where
// it does not (§4.5: a tile with no honest number carries no chip). The three
// telemetry shores — ledger, usage — read their own seams and never a store
// field, so they carry no chip here rather than a fabricated zero; and Tools is
// a verb, not a count, so it carries none either.

export const PROXY_DOORS = Object.freeze([
  {
    slug: "pools",
    href: "/dashboard/proxy/pools",
    label: "Pools",
    icon: "lan",
    blurb: "Create, edit, test, toggle and delete the fleet. Batch import and one bulk sweep.",
    chip: (c) => `${c.census.total} pool${c.census.total === 1 ? "" : "s"}`,
  },
  {
    slug: "fitness",
    href: "/dashboard/proxy/fitness",
    label: "Fitness",
    icon: "monitor_heart",
    blurb: "The block ledger: which provider refuses which egress, why, and until when.",
    chip: (c) => `${c.census.blocked} blocked`,
  },
  {
    slug: "egress",
    href: "/dashboard/proxy/egress",
    label: "Egress",
    icon: "travel_explore",
    blurb: "Each pool's observed IP, country, flapping signal and prior-IP history.",
    chip: (c) => {
      const n = Object.keys(c.geo || {}).length;
      return n > 0 ? `${n} observed` : null;
    },
  },
  {
    slug: "relay",
    href: "/dashboard/proxy/relay",
    label: "Relay",
    icon: "cloud_upload",
    blurb: "Vercel, Cloudflare and Deno relays as rows, with a deploy form per platform.",
    chip: (c) => `${c.relays.length} relay${c.relays.length === 1 ? "" : "s"}`,
  },
  {
    slug: "ledger",
    href: "/dashboard/proxy/ledger",
    label: "Ledger",
    icon: "route",
    blurb: "The routing trace: which provider, which model, which pool — and the health score.",
    // The ledger reads its own seam (the route ring), not the fleet store — so no
    // chip can be sourced from `c` honestly. Null, never a guessed zero.
    chip: null,
  },
  {
    slug: "usage",
    href: "/dashboard/proxy/usage",
    label: "Usage",
    icon: "query_stats",
    blurb: "Per-pool requests, tokens, cost and latency — attributed since the seam landed.",
    chip: null,
  },
  {
    slug: "tools",
    href: "/dashboard/proxy/tools",
    label: "Tools",
    icon: "handyman",
    blurb: "The toolbox: sweep, probe, import, geo toggle, export, deploy, CSV, ledger filter.",
    chip: null,
  },
  {
    // The hub itself, for the shores that want a way home. The hub does not list
    // itself, so it filters this entry out by slug.
    slug: "hub",
    href: "/dashboard/proxy/hub",
    label: "Hub",
    icon: "space_dashboard",
    blurb: "The front door: census, quick health, recent routes and every lens.",
    chip: null,
  },
]);

/** The doors in console order, without the hub — what the hub's grid renders. */
export const PROXY_LENSES = Object.freeze(PROXY_DOORS.filter((d) => d.slug !== "hub"));

/** One door by slug — for a single cross-shore reference. */
export function doorBySlug(slug) {
  return PROXY_DOORS.find((d) => d.slug === slug) || null;
}
