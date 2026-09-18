// Icon-subset guard — every Material Symbols ligature named in src/ must exist
// in the pruned subset that public/fonts/vela-icons.*.woff2 actually ships.
//
// Why this test exists: the subset is GSUB-pruned to 232 icons (perf audit V4,
// ~170KB against the package's 3.96MB). An icon outside that inventory does not
// fail loudly — the ligature simply never forms and the raw text ("table_rows")
// renders as a 240px word beside the real glyphs. That is exactly how
// `table_rows` reached the Console Log deck and survived review: the build was
// green and the only symptom was visual.
//
// Two spellings are scanned: the `icon="name"` prop form and the inline
// `<span class="material-symbols-outlined …">name</span>` form. Dynamic values
// (a variable, a template literal) are skipped — this guard proves named
// literals, which is where the defect lives.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");
const INVENTORY = join(ROOT, "scripts", "icon-ligatures.txt");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (/\.(js|jsx)$/.test(entry)) out.push(full);
  }
  return out;
}

// `icon="name"` / `icon={'name'}` / `icon: "name"` (the segmented-control shape)
const PROP_RE = /\bicon\s*[:=]\s*[{]?\s*["'`]([a-z][a-z0-9_]*)["'`]/g;
// <span class="material-symbols-outlined …">name</span>
const SPAN_RE = /material-symbols-outlined[^>]*>\s*([a-z][a-z0-9_]*)\s*</g;

function collectIcons() {
  const found = new Map(); // name -> Set(files)
  for (const file of walk(SRC)) {
    const code = readFileSync(file, "utf8");
    const rel = file.slice(ROOT.length + 1);
    for (const re of [PROP_RE, SPAN_RE]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(code)) !== null) {
        if (!found.has(m[1])) found.set(m[1], new Set());
        found.get(m[1]).add(rel);
      }
    }
  }
  return found;
}

const inventory = new Set(
  readFileSync(INVENTORY, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
);

describe("icon subset — every named ligature ships in the font", () => {
  it("the inventory itself is non-trivial", () => {
    expect(inventory.size).toBeGreaterThan(100);
  });

  it("no src/ icon literal falls outside scripts/icon-ligatures.txt", () => {
    const found = collectIcons();
    const missing = [];
    for (const [name, files] of found) {
      if (!inventory.has(name)) {
        missing.push(`${name} (${[...files].sort().join(", ")})`);
      }
    }
    expect(missing, `Icons not in the pruned subset:\n${missing.join("\n")}`).toEqual([]);
  });
});
