import { redirect } from "next/navigation";

// The profile room is gone; its eight lenses live under /dashboard/settings.
//
// Kept as a redirect rather than deleted, because it was the dashboard's
// Settings destination for thirty minor versions: bookmarks, browser history,
// and the operator's own muscle memory all still resolve here. A 404 would be
// a worse answer than the room they were actually looking for.
//
// `redirect()` throws internally, so this returns nothing — the shape proxy-pools
// already uses for the same act.
export default function ProfilePage() {
  redirect("/dashboard/settings");
}
