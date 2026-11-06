import { redirect } from "next/navigation";

// The endpoint console's `?tab=` links → the separated routes (§3.1 redirect law).
//
// WHY A REDIRECT AND NOT A PAGE WITH TABS: the console became five routes, and
// the old tab URL is a link that exists in the wild — the Sidebar's chip links,
// any bookmark or shared view outlive the edit. Rendering the console again
// here would be a second copy of a page that no longer has a subject of its
// own; a redirect keeps the address honest and lands the visitor on the lens
// they asked for.
//
// An ABSENT or UNKNOWN `tab` stays on this address and renders the hub directly
// rather than redirecting to it: `/dashboard/endpoint` IS the hub, so a tab we
// cannot name is not a vote for Keys — it is a request for the front door, and
// the front door answers from this very address with no hop at all. A redirect
// here would send this address to itself.
//
// The hash rides along: `?tab=keys#require-api-key` resolves through this map
// with the hash intact, and the Keys page owns the anchor's new home.
import HubClient from "./hub/HubClient";

const TAB_ROUTES = {
  keys: "/dashboard/endpoint/keys",
  access: "/dashboard/endpoint/access",
  security: "/dashboard/endpoint/security",
  diagnostics: "/dashboard/endpoint/diagnostics",
};

export default async function EndpointPage({ searchParams }) {
  // Next 15 hands `searchParams` as a promise; awaiting it is what makes the
  // read legal in a server component, and an absent param is simply `undefined`.
  const params = (await searchParams) ?? {};
  const tab = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  if (TAB_ROUTES[tab]) redirect(TAB_ROUTES[tab]);
  return <HubClient />;
}

