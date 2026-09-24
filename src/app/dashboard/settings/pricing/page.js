import { redirect } from "next/navigation";

// The pricing orphan is folded into the settings room's Billing lens.
//
// It was reachable only by typing the URL — no nav entry ever pointed here,
// because the old profile room owned pricing inline while this page mirrored it
// outside the dashboard shell. Two surfaces for one dataset, one of them half
// the story. The lens is the whole story now, so this resolves there.
export default function PricingSettingsPage() {
  redirect("/dashboard/settings?tab=billing");
}
