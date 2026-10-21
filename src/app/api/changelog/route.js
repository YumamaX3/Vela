// GET /api/changelog — the project's changelog as markdown.
//
// Port of 9router-go `HandleChangelog`, narrowed to this repository's own
// files: the root CHANGELOG.md is the source, with the public copy as the
// fallback a packaged build carries. No remote fetch — a changelog request
// must not depend on GitHub being reachable.
import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const CANDIDATES = [
  path.join(process.cwd(), "CHANGELOG.md"),
  path.join(process.cwd(), "public", "CHANGELOG.md"),
];

export async function GET() {
  for (const file of CANDIDATES) {
    try {
      const markdown = await fs.readFile(file, "utf8");
      if (markdown.trim()) {
        return new NextResponse(markdown, {
          status: 200,
          headers: {
            "content-type": "text/markdown; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      }
    } catch { /* try the next location */ }
  }
  return NextResponse.json({ error: "changelog not found" }, { status: 404 });
}
