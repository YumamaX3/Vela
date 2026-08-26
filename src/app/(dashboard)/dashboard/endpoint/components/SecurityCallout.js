"use client";

import SecurityWarning from "./SecurityWarning";

/**
 * The pre-enable security gate banner — shown while the dashboard is
 * login-unsafe and no remote access is active.
 */
export default function SecurityCallout({ unsafeReason, enabled }) {
  if (!unsafeReason || enabled) return null;
  return (
    <div className="mt-4">
      <SecurityWarning message={unsafeReason} action={{ label: "Open settings", href: "/dashboard/settings" }} />
    </div>
  );
}
