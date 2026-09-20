import { redirect } from "next/navigation";

// The Proxy Pools page moved into the Proxy console's Fleet lens. The file stays —
// the console merged two pages into one, and a bookmarked or linked
// `/dashboard/proxy-pools` must still land somewhere real — so this is a redirect,
// not a deletion. The `fleet` lens is the old page's exact subject.
export default function ProxyPoolsPage() {
  redirect("/dashboard/proxy?tab=fleet");
}
