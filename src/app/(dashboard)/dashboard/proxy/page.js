import { redirect } from "next/navigation";

// The integrated console's `?tab=` links → the separated routes (§3.1 redirect law).
//
// WHY A REDIRECT AND NOT A PAGE WITH TABS: the console became four routes, and the
// old tab URL is a link that exists in the wild — the Sidebar's PROXY_CHILDREN still
// builds `/dashboard/proxy?tab=<lens>` until W5 re-points them, and any bookmark or
// shared link outlives that edit. Rendering the console again here would be the
// fifth copy of a page that no longer has a subject of its own; a redirect keeps the
// address honest and lands the visitor on the lens they asked for.
//
// An ABSENT or UNKNOWN `tab` goes to the hub rather than to a lens, because a tab we
// cannot name is not a vote for Pools — it is a request for the console's front door.
const TAB_ROUTES = {
  fleet: "/dashboard/proxy/pools",
  fitness: "/dashboard/proxy/fitness",
  egress: "/dashboard/proxy/egress",
  relay: "/dashboard/proxy/relay",
};

export default async function ProxyPage({ searchParams }) {
  // Next 15 hands `searchParams` as a promise; awaiting it is what makes the read
  // legal in a server component, and an absent param is simply `undefined`.
  const params = (await searchParams) ?? {};
  const tab = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  redirect(TAB_ROUTES[tab] || "/dashboard/proxy/hub");
}
