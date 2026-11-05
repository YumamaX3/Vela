import { redirect } from "next/navigation";

// The Proxy Fitness page → the separated Fitness route (plan 2026-11-04 §3.1 redirect law).
//
// Same reasoning as its sibling: the file stays so an old link lands on the lens that
// owns its exact subject, and the subject now has its own URL instead of a query tab.
export default function ProxyFitnessPage() {
  redirect("/dashboard/proxy/fitness");
}
