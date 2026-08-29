import { getUpdateInfo } from "@/lib/updateInfo";

// The update horizon — where the notice looks for the newest tide.
// Shape (all fields fail-open):
//   currentVersion  — the running build (package.json)
//   latestVersion   — newest stable from GitHub releases/tags, npm fallback, null if unreachable
//   hasUpdate       — latest > current
//   source          — "github-releases" | "github-tags" | "npm" | null
//   releaseNotes    — the latest version's section of the ship's log (markdown)
//   deployment      — "docker" | "k8s" | "npm" | "dev" (VELA_DEPLOYMENT env wins)
//   updateCommand   — the right command for the berth (docker compose / npm / k8s)
//   checkedAt       — ISO timestamp of the probe (1h cache per process)
export async function GET() {
  return Response.json(await getUpdateInfo());
}
