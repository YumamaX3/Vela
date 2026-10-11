import { redirect } from "next/navigation";

// The bare /dashboard/media-providers shore was never paved: the Sidebar's
// "Media Providers" tile and QuickNav both link it, but the room's real pages
// live only under web/, [kind]/ and combo/. A 404 card was the answer the
// rail's own door returned — a worse answer than the room the operator was
// looking for.
//
// Redirect to the first kind in MEDIA_PROVIDER_KINDS, which is also the rail's
// first child under this room (/dashboard/media-providers/embedding), so the
// landing matches the door that sits directly beneath the tile.
export default function MediaProvidersPage() {
  redirect("/dashboard/media-providers/embedding");
}
