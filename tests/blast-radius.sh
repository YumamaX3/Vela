#!/usr/bin/env bash
# blast-radius.sh — the failing-test-NAME baseline rig (M1, board B6).
#
# WHY: this repo has no green suite to claim (see CLAUDE.md's Test Covenant:
# ~40 files / ~97-98 failing cases at pristine tests/unit, 112 whole-suite at
# e4e013ad). "Tests still pass" is therefore an unsayable sentence here. The
# honest instrument is a BLAST-RADIUS DIFF: run the suite at pristine HEAD,
# run it with the tide's changes, and compare failing test NAMES — never
# counts (durations differ and are not drift; a count match can hide a swap).
#
# KNOWN-FAILS.txt is unwired and stale (measured 2026-09-30: mtime Aug 23,
# machine-paths from another host) — this rig does NOT read it, by design.
# The pristine run IS the baseline.
#
# USAGE (from repo root):
#   bash tests/blast-radius.sh <label>
#
# Contract: refuses on modified/staged TRACKED files (a run over a half-edited
# tracked file is a lie about any version). Untracked files are fine mid-tide —
# they are listed as info; the reference snapshot (pristine.names) is captured
# at a clean HEAD (`git stash push -u` → run with label "pristine" → pop).
set -euo pipefail

LABEL="${1:?usage: bash tests/blast-radius.sh <label>}"
REPO="$(git rev-parse --show-toplevel)"
cd "$REPO"

# The instrument's own output directory never counts as tree state — a baseline
# capture must not block the diff that reads it.
#
# Contract: REFUSE on modified/staged/deleted TRACKED files (a baseline captured
# on a half-edited tracked file is a lie about any version). UNTRACKED files do
# not refuse: mid-tide wip is normal, and the reference snapshot (pristine.names)
# is captured at a clean HEAD either way. They are listed as info instead.
DIRTY_TRACKED="$(git status --porcelain | grep -vE '^\?\? ' || true)"
if [ -n "$DIRTY_TRACKED" ]; then
  echo "❌ tracked files modified — commit or stash the tide first:" >&2
  echo "$DIRTY_TRACKED" | sed 's/^/   /' >&2
  exit 1
fi
UNTRACKED="$(git status --porcelain -uall | grep -E '^\?\? ' | grep -v '^?? \.blast-radius/' || true)"
if [ -n "$UNTRACKED" ]; then
  echo "ℹ️ untracked files present (picked up by the suite, absent from pristine):" >&2
  echo "$UNTRACKED" | sed 's/^/   /' >&2
fi

BASELINE_DIR="$REPO/.blast-radius"
mkdir -p "$BASELINE_DIR"
OUT="$BASELINE_DIR/${LABEL}.names"
PRISTINE_OUT="$BASELINE_DIR/pristine.names"

# Failing test NAMES at HEAD (the tide in place). One name per line, sorted,
# durations stripped — a name is "<file> > describe > test".
npx vitest run -c tests/vitest.config.js 2>&1 \
  | grep -E "^ (FAIL|×)" \
  | sed -E 's/^ *(FAIL|×) *//' \
  | LC_ALL=C sort -u > "$OUT"

echo "✅ baseline '$LABEL' captured: $(wc -l < "$OUT") failing names -> $OUT"
echo
echo "Next tide, diff against the pristine snapshot:"
echo "  git stash push -m 'wip-tide'   # or commit"
echo "  bash tests/blast-radius.sh pristine"
echo "  git stash pop"
echo "  diff $BASELINE_DIR/pristine.names $BASELINE_DIR/${LABEL}.names"
echo
echo "Names only in the tide's list = NEW failures (the blast radius)."
echo "Names only in pristine = failures the tide mended."
if [ -f "$PRISTINE_OUT" ]; then
  echo
  echo "── live diff vs pristine ──"
  NEW=$(comm -13 "$PRISTINE_OUT" "$OUT" | grep -v '^$' | wc -l)
  MENDED=$(comm -23 "$PRISTINE_OUT" "$OUT" | grep -v '^$' | wc -l)
  echo "new: $NEW · mended: $MENDED"
  if [ "$NEW" -gt 0 ]; then
    echo "── NEW failures (the tide's blast radius) ──"
    comm -13 "$PRISTINE_OUT" "$OUT" | grep -v '^$'
  fi
else
  echo "(no pristine.names yet — capture it first: stash, run 'bash tests/blast-radius.sh pristine', pop)"
fi
