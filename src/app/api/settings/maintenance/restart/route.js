// POST /api/settings/maintenance/restart — recycle the server process.
// Mirrors /api/version/shutdown but signals restart: the process exits and the
// container/service manager brings it back. In dev (no supervisor) this is a
// shutdown — the response says so honestly.
import { NextResponse } from "next/server";
import { killAppProcesses } from "@/lib/appUpdater";

export const dynamic = "force-dynamic";

const isProduction = () => process.env.NODE_ENV === "production";

export async function POST() {
  try {
    await killAppProcesses();
  } catch {
    /* best effort */
  }

  const message = isProduction()
    ? "Restarting — the service manager will bring Vela back up in a few seconds."
    : "Process exiting (dev mode has no supervisor — start it again manually).";

  const response = NextResponse.json({ success: true, message });

  setTimeout(() => process.exit(0), 500);

  return response;
}
