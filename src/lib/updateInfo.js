// The update truth-source — where the horizon bell looks for the newest tide.
//
// The ancestor only asked the npm registry for "Vela" — a package that does
// not exist there, so the notice never rang for a GHCR/docker deployment.
// This module probes the REAL sources in order of truth:
//   1. GitHub releases (api.github.com — carries release notes)
//   2. GitHub tags      (the repo has no releases today; tags API reads work)
//   3. npm registry     (kept honest for the npm/CLI deployment path)
//
// It also detects HOW Vela is deployed (VELA_DEPLOYMENT env, /.dockerenv,
// k8s markers) and hands the notice the right update command for that berth:
// docker → `docker compose pull && docker compose up -d`, npm → install cmd.
//
// Fail-open contract: every probe failure resolves to "no info", never throws
// — an unreachable registry must never break /api/version.

import https from "https";
import fs from "fs";
import path from "path";
import pkg from "../../package.json" with { type: "json" };
import { UPDATER_CONFIG } from "@/shared/constants/config";

const GITHUB_OWNER = "YumamaX3";
const GITHUB_REPO = "Vela";
const VERSION_CACHE_TTL_MS = 3600000; // probe at most once an hour per process

// Survive hot reload; one cache per process
const versionCache = (global.__updateInfoCache ??= { value: null, fetchedAt: 0 });

// ── Version primitives ──────────────────────────────────────────────────

/** Strict x.y.z only — retreat markers (v0.9.27-retreat) and prereleases never count as "latest". */
export function parseTagVersion(tag) {
  if (!tag || typeof tag !== "string") return null;
  const m = tag.match(/^v?(\d+\.\d+\.\d+)$/);
  return m ? m[1] : null;
}

/** Three-part numeric compare. Returns 1 / -1 / 0. */
export function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

/**
 * Extract one version's section from the ship's log — from its `# v0.9.x`
 * heading to the next top-level heading. Returns "" when absent (fail-open).
 */
export function extractChangelogSection(md, version) {
  if (!md || typeof md !== "string" || !version) return "";
  const escaped = String(version).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headerRe = new RegExp(`^#\\s+v?${escaped}(?:\\s.*)?$`, "m");
  const m = md.match(headerRe);
  if (!m) return "";
  const start = md.indexOf(m[0]) + m[0].length;
  const rest = md.slice(start);
  const next = rest.search(/^#\s+/m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

// ── The probes ───────────────────────────────────────────────────────────

function githubHeaders() {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "vela-update-check",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  // GH_TOKEN (or GITHUB_TOKEN) raises the rate limit and reaches private repos.
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** Probe GitHub releases first (notes aboard), then tags. Fail-open. */
async function fetchLatestFromGithub() {
  // 1) Releases — skip drafts/prereleases, take the newest stable
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=5`,
      { headers: githubHeaders(), signal: AbortSignal.timeout(4000) },
    );
    if (res.ok) {
      const releases = await res.json();
      for (const r of Array.isArray(releases) ? releases : []) {
        if (r?.draft || r?.prerelease) continue;
        const v = parseTagVersion(r?.tag_name);
        if (v) return { version: v, source: "github-releases", notes: typeof r.body === "string" ? r.body : "" };
      }
    }
  } catch { /* fall through to tags */ }

  // 2) Tags — no notes, but honest about the newest version
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/tags?per_page=30`,
      { headers: githubHeaders(), signal: AbortSignal.timeout(4000) },
    );
    if (res.ok) {
      const tags = await res.json();
      let best = null;
      for (const t of Array.isArray(tags) ? tags : []) {
        const v = parseTagVersion(t?.name);
        if (v && (!best || compareVersions(v, best) > 0)) best = v;
      }
      if (best) return { version: best, source: "github-tags", notes: "" };
    }
  } catch { /* fall through to npm */ }

  return null;
}

/** npm registry probe — the truth for the npm/CLI deployment path only. */
function fetchLatestFromNpm(packageName) {
  return new Promise((resolve) => {
    const req = https.get(
      `https://registry.npmjs.org/${packageName}/latest`,
      { timeout: 4000 },
      (res) => {
        if (res.statusCode !== 200) { res.resume(); resolve(null); return; }
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try { resolve(JSON.parse(data).version || null); } catch { resolve(null); }
        });
      },
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

// ── Deployment detection ─────────────────────────────────────────────────

/** Which berth does this Vela sleep in? env override wins, then the markers. */
export function detectDeployment() {
  const env = process.env;
  if (env.VELA_DEPLOYMENT) return String(env.VELA_DEPLOYMENT);
  if (env.KUBERNETES_SERVICE_HOST) return "k8s";
  try {
    if (fs.existsSync("/.dockerenv")) return "docker";
  } catch { /* non-linux or unreadable */ }
  return env.NODE_ENV === "production" ? "npm" : "dev";
}

/** The right command for the berth. */
export function updateCommandFor(deployment) {
  if (deployment === "docker") return "docker compose pull && docker compose up -d";
  if (deployment === "k8s") return "update the image tag (ghcr.io/yumamax3/vela:<tag>) and apply";
  if (deployment === "npm") return UPDATER_CONFIG.installCmdLatest;
  return "";
}

// ── The assembled truth ──────────────────────────────────────────────────

function readChangelog() {
  // The build serves a synced copy at public/CHANGELOG.md; the root is the
  // source of truth in dev. Read whichever answers first.
  for (const p of [path.join(process.cwd(), "public", "CHANGELOG.md"), path.join(process.cwd(), "CHANGELOG.md")]) {
    try {
      return fs.readFileSync(p, "utf8");
    } catch { /* try next */ }
  }
  return "";
}

/**
 * The full update picture for /api/version:
 *   { currentVersion, latestVersion, hasUpdate, source, releaseNotes,
 *     deployment, updateCommand, checkedAt }
 * Fail-open: unreachable registries → latestVersion null, hasUpdate false.
 */
export async function getUpdateInfo() {
  const currentVersion = pkg.version;
  const deployment = detectDeployment();

  let latest = versionCache.value;
  if (!latest || Date.now() - versionCache.fetchedAt >= VERSION_CACHE_TTL_MS) {
    const fromGithub = await fetchLatestFromGithub();
    if (fromGithub) {
      latest = fromGithub;
    } else {
      const npmVersion = await fetchLatestFromNpm(UPDATER_CONFIG.npmPackageName);
      latest = npmVersion ? { version: npmVersion, source: "npm", notes: "" } : null;
    }
    if (latest) {
      versionCache.value = latest;
      versionCache.fetchedAt = Date.now();
    }
  }

  const latestVersion = latest?.version || null;
  const hasUpdate = latestVersion ? compareVersions(latestVersion, currentVersion) > 0 : false;

  // Release notes: GitHub release body wins; fall back to the version's own
  // section in the ship's log (docker/today path — no releases exist yet).
  let releaseNotes = latest?.notes || "";
  if (hasUpdate && !releaseNotes) {
    releaseNotes = extractChangelogSection(readChangelog(), latestVersion);
  }

  return {
    currentVersion,
    latestVersion,
    hasUpdate,
    source: latest?.source || null,
    releaseNotes,
    deployment,
    updateCommand: hasUpdate ? updateCommandFor(deployment) : "",
    checkedAt: new Date().toISOString(),
  };
}
