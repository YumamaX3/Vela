#!/usr/bin/env node
// Ship's Log local serve — the dashboard's Changelog modal reads the log
// from the gateway itself (public/CHANGELOG.md), because the GitHub repo is
// private and raw.githubusercontent returns 404 for private repos.
// Run on every dev startup and before every build; the postbuild standalone
// asset copier then carries public/ into the standalone output, so shipped
// builds keep working too.
//
// The source of truth stays the root CHANGELOG.md — this file is a derived
// copy, gitignored, regenerated on demand.

import { copyFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(projectRoot, "CHANGELOG.md");
const destination = resolve(projectRoot, "public", "CHANGELOG.md");

if (!existsSync(source)) {
  console.error("[changelog-sync] CHANGELOG.md not found at project root — nothing to serve");
  process.exit(1);
}

copyFileSync(source, destination);
console.log("[changelog-sync] public/CHANGELOG.md is current");
