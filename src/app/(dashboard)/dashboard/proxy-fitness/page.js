import { redirect } from "next/navigation";

// The Proxy Fitness page moved into the Proxy console's Fitness lens. The file stays
// — the console merged two pages into one, and a bookmarked or linked
// `/dashboard/proxy-fitness` must still land somewhere real — so this is a redirect,
// not a deletion. The `fitness` lens is the old page's exact subject.
export default function ProxyFitnessPage() {
  redirect("/dashboard/proxy?tab=fitness");
}
