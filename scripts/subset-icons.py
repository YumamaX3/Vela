#!/usr/bin/env python3
"""
subset-icons.py — build a minimal Material Symbols subset for Vela.

Perf audit V4 (2026-09-07): the npm package ships a 3.96MB woff2 covering
all 4,277 icons. Vela uses ~144. A naive pyftsubset cannot shrink it: the
rendering path is GSUB LIGATURES (the string "search" substitutes to one
icon glyph), and because every letter is needed for matching, the closure
keeps every ligature rule — and therefore every icon glyph.

The fix is two-stage:
  1. Prune the font's GSUB table to substitutions whose OUTPUT glyph is one
     of the wanted icons (or a passthrough). Now closure from the letters
     can only reach the wanted icons.
  2. pyftsubset with the wanted PUA codepoints + ASCII. Closure stays small.

Inputs:
  scripts/icon-ligatures.txt  — one icon name per line (checked in, so builds
                                are deterministic; regenerate with the grep
                                recipe in the header below)
  node_modules/material-symbols/material-symbols-outlined.woff2

Outputs:
  public/fonts/vela-icons.woff2          — the subset font
  scripts/icon-subset-manifest.json      — included names + sha256, for drift check

The generated font is COMMITTED — the build does not need Python. Regenerate
only when the icon inventory changes (script exits non-zero on drift between
manifest and current scan, see check mode).

Scan recipe (run from repo root, then merge + sort -u into icon-ligatures.txt):
  grep -rhoE 'material-symbols-outlined[^>]*>[a-z_0-9]+<' src --include='*.js' \
    | grep -oE '>[a-z_0-9]+<' | tr -d '<>' | sort -u
  grep -rhoE 'icon(=|: ?)"[a-z_0-9]+"' src --include='*.js' \
    | grep -oE '"[a-z_0-9]+"' | tr -d '"' | sort -u

Requires: pip install fonttools brotli
Usage: py -3.12 scripts/subset-icons.py [--check]
  --check  exit 1 if public/fonts/vela-icons.woff2 is missing or the
           manifest does not match scripts/icon-ligatures.txt
"""

import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from fontTools.ttLib import TTFont

REPO = Path(__file__).resolve().parent.parent
LIGATURES_FILE = REPO / "scripts" / "icon-ligatures.txt"
SOURCE_FONT = REPO / "node_modules" / "material-symbols" / "material-symbols-outlined.woff2"
OUT_FONT = REPO / "public" / "fonts" / "vela-icons.woff2"
OUT_MANIFEST = REPO / "scripts" / "icon-subset-manifest.json"
CODEPOINTS_URL = (
    "https://raw.githubusercontent.com/google/material-design-icons/master/"
    "variablefont/MaterialSymbolsOutlined%5BFILL%2CGRAD%2Copsz%2Cwght%5D.codepoints"
)


def load_wanted():
    names = [l.strip() for l in LIGATURES_FILE.read_text(encoding="utf-8").splitlines() if l.strip()]
    if not names:
        sys.exit("icon-ligatures.txt is empty")
    return sorted(set(names))


def load_codepoints():
    cp = {}
    for line in CODEPOINTS_CACHE.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if len(parts) == 2:
            cp[parts[0]] = parts[1]
    return cp


CODEPOINTS_CACHE = REPO / "assets-tmp" / "ms.codepoints"


def main():
    check_only = "--check" in sys.argv
    if check_only:
        if not OUT_FONT.exists() or not OUT_MANIFEST.exists():
            print("subset font or manifest missing — run scripts/subset-icons.py")
            return 1
        manifest = json.loads(OUT_MANIFEST.read_text())
        wanted = load_wanted()
        if manifest["icons"] != wanted:
            print("icon inventory drifted from the committed subset — regenerate")
            return 1
        print("subset font up to date:", len(wanted), "icons")
        return 0

    wanted = load_wanted()
    codepoints = load_codepoints()
    missing = [n for n in wanted if n not in codepoints]
    if missing:
        sys.exit(f"icons absent from the codepoints map (update ms.codepoints): {missing}")

    icon_glyphs = set()
    font = TTFont(SOURCE_FONT)
    glyph_order = font.getGlyphOrder()
    cp_to_glyph = {}
    cmap = font.getBestCmap()
    for name in wanted:
        cp_int = int(codepoints[name], 16)
        g = cmap.get(cp_int)
        if not g:
            sys.exit(f"codepoint {codepoints[name]} for {name} not in source cmap")
        icon_glyphs.add(g)
        cp_to_glyph[name] = cp_int

    # Stage 1 — prune GSUB to substitutions targeting wanted icons only.
    # Material Symbols carries its ligatures in type-7 EXTENSION subtables
    # (ExtSubTable); a first pass that walked only plain SubTables left all
    # 4,262 rules intact and the font at 3MB. Both shapes must be pruned.
    gsub = font.get("GSUB")

    def prune_subtable(st):
        if hasattr(st, "ligatures"):  # type 4 — ligature sets
            for first in list(st.ligatures.keys()):
                kept = [l for l in st.ligatures[first] if l.LigGlyph in icon_glyphs]
                if kept:
                    st.ligatures[first] = kept
                else:
                    del st.ligatures[first]
        elif hasattr(st, "mapping"):  # single-substitution dict forms
            st.mapping = {k: v for k, v in st.mapping.items() if v in icon_glyphs}
        elif hasattr(st, "alternates"):
            st.alternates = {
                k: [g for g in v if g in icon_glyphs] for k, v in st.alternates.items()
            }

    if gsub and gsub.table.LookupList:
        for lookup in gsub.table.LookupList.Lookup:
            for st in lookup.SubTable:
                prune_subtable(st)
                inner = getattr(st, "ExtSubTable", None)
                if inner is not None:
                    prune_subtable(inner)
        # Empty ligature sets leave dangling FeatureList entries; harmless for
        # subset stage 2, which recomputes features. Keep the table.

    with tempfile.NamedTemporaryFile(suffix=".ttf", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    try:
        font.save(tmp_path)
    finally:
        font.close()

    # Stage 2 — pyftsubset with wanted PUA + ASCII, closure now small.
    unicodes = ",".join(f"U+{cp_to_glyph[n]:04X}" for n in wanted) + ",U+0020-007E"
    OUT_FONT.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            sys.executable, "-m", "fontTools.subset", str(tmp_path),
            f"--unicodes={unicodes}",
            f"--output-file={OUT_FONT}",
            "--flavor=woff2",
            "--no-hinting",
        ],
        check=True,
    )
    tmp_path.unlink(missing_ok=True)

    # Verify: every wanted icon's codepoint must map in the subset cmap.
    sub = TTFont(OUT_FONT)
    sub_cmap = sub.getBestCmap()
    lost = [n for n in wanted if int(codepoints[n], 16) not in sub_cmap]
    sub.close()
    if lost:
        sys.exit(f"subset lost icons: {lost}")

    sha = hashlib.sha256(OUT_FONT.read_bytes()).hexdigest()
    OUT_MANIFEST.write_text(json.dumps({
        "icons": wanted,
        "count": len(wanted),
        "sha256": sha,
        "source": str(SOURCE_FONT.relative_to(REPO)).replace("\\", "/"),
    }, indent=2) + "\n")

    size = OUT_FONT.stat().st_size
    print(f"wrote {OUT_FONT.relative_to(REPO)}: {size:,} bytes ({len(wanted)} icons)")
    print(f"original: {SOURCE_FONT.stat().st_size:,} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
