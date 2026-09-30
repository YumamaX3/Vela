import { redirect } from "next/navigation";

// The Console Log room is gone; its stream lives on as the Console tab of the
// Log Harbor (/dashboard/logs?tab=console), beside the Container and Request
// streams it always belonged with.
//
// Kept as a redirect rather than deleted, because this was a System room of the
// dashboard for many versions: bookmarks, browser history, and the operator's
// own muscle memory all still resolve here. A 404 would be a worse answer than
// the stream they were actually looking for.
//
// `redirect()` throws internally, so this returns nothing — the shape
// /dashboard/profile already uses for the same act.
export default function ConsoleLogPage() {
  redirect("/dashboard/logs?tab=console");
}
