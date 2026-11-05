import { redirect } from "next/navigation";

// The Proxy Pools page → the separated Pools route (plan 2026-11-04 §3.1 redirect law).
//
// This file has now survived two moves, and the file's job has not changed: a
// bookmarked `/dashboard/proxy-pools` must land somewhere real. The console merged
// the two old pages into `?tab=` lenses; the separation then gave each lens its own
// route. The destination follows the SUBJECT (pools), so this redirect is the same
// statement it was before — it just points at the address the subject now lives at.
export default function ProxyPoolsPage() {
  redirect("/dashboard/proxy/pools");
}
