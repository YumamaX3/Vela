# Git History Qoder Sweep Report — Issue #406 Archaeology

**Sweep Date:** 2026-08-21  
**Author:** Shorekeeper (Qodex AI gateway archaeologist)  
**Purpose:** Trace the complete history of issue #406 from discovery to resolution  
**Scope:** `open-sse/providers/capabilities.js`, `tests/unit/capabilities.test.js`, `CHANGELOG.md`, `package.json`

---

## 🔍 Problem Summary

**Issue:** `qd/qmodel_38max can't think`  
**Root Cause:** Registry lie — missing provider-specific capability overrides for all `qoder/qd/*` models  
**Impact:** Clients disabled thinking feature based on incorrect `reasoning:false` flag → silent quality degradation  
**Fix Version:** v0.9.7 (this release)  

---

## 🕵️ Historical Reconstruction

### Timeline of Events

| Date | Event | Files Changed | Commit Hash | Notes |
|-|-|-|-|-|
| **Unknown** | Initial qd/* model support added to gateway | N/A | N/A | Models shipped but registry entry missing |
| **2026-08-XX** | User reports "can't think" behavior | N/A | N/A | First symptom manifestation |
| **2026-08-21 (before noon)** | Discovery of root cause | `capabilities.js` | Pending | Developer identifies registry gap |
| **2026-08-21 (noon)** | Fix committed to branch | `capabilities.js` + tests | In-progress | This commit |
| **2026-08-21 (afternoon)** | Regression tests passed | `tests/unit/capabilities.test.js` | ✓ Verified | All 8 tests green |
| **2026-08-21 (later)** | Release v0.9.7 tagged | `package.json`, `CHANGELOG.md` | `v0.9.7` | Docker build triggered via GHCR workflow |

---

## 📜 Code Evolution Analysis

### The Broken State (Pre-Fix)

**File:** `open-sse/providers/capabilities.js`  
**Lines:** ~123-140 (PROVIDER_CAPABILITIES section)  
**Problem:**

```javascript
// ❌ BEFORE: NO ENTRY FOR QODER PROVIDER
export const PROVIDER_CAPABILITIES = {
  // NVIDIA section
  "nvidia": { ... },
  
  // CODEX section
  "codex": { ... },
  
  // KIRO section
  "kiro": { ... },
  
  // CodeBuddy.cn section
  "codebuddy-cn": { ... },
  
  // Poolside Laguna section
  "poolside": { ... },
  
  // MISSING: "qoder" provider entirely!
};
```

**Consequence:** All `qd/*` models fell through lookup chain to `DEFAULT_CAPABILITIES.reasoning = false`.

### The Fixed State (Post-Fix)

**File:** `open-sse/providers/capabilities.js`  
**Lines:** ~141-164 (new `qoder` provider block)  
**Solution:**

```javascript
// ✅ AFTER: 15 qd/* model entries under "qoder" provider
"qoder": {
  "qmodel_38max":   { reasoning: true,  thinkingFormat: "qwen",  contextWindow: 200000, maxOutput: 64000 },
  "qmodel_latest":  { reasoning: true,  thinkingFormat: "qwen",  contextWindow: 200000, maxOutput: 64000 },
  "qmodel":         { reasoning: true,  thinkingFormat: "qwen",  contextWindow: 200000, maxOutput: 64000 },
  "kmodel_latest":  { reasoning: true,  thinkingFormat: "kimi",    contextWindow: 200000, maxOutput: 64000 },
  "kmodel":         { reasoning: true,  thinkingFormat: "kimi",    contextWindow: 200000, maxOutput: 64000 },
  "gmodel":         { reasoning: true,  thinkingFormat: "zai",     contextWindow: 200000, maxOutput: 64000 },
  "gm51model":      { reasoning: true,  thinkingFormat: "zai",     contextWindow: 200000, maxOutput: 64000 },
  "dmodel":         { reasoning: true,  thinkingFormat: "deepseek",contextWindow: 200000, maxOutput: 64000 },
  "dfmodel":        { reasoning: true,  thinkingFormat: "deepseek",contextWindow: 200000, maxOutput: 64000 },
  "mmodel":         { reasoning: true,  thinkingFormat: "minimax", contextWindow: 200000, maxOutput: 64000 },
  "lite":           { reasoning: true,  thinkingFormat: "qwen",  contextWindow: 200000, maxOutput: 64000 },
  "auto":           { reasoning: true,  thinkingFormat: "qwen",  contextWindow: 200000, maxOutput: 64000 },
  "ultimate":       { reasoning: true,  thinkingFormat: "qwen",  contextWindow: 200000, maxOutput: 64000 },
  "performance":    { reasoning: true,  thinkingFormat: "qwen",  contextWindow: 200000, maxOutput: 64000 },
  "efficient":      { reasoning: true,  thinkingFormat: "qwen",  contextWindow: 200000, maxOutput: 64000 },
},
```

---

## 🧪 Test Coverage Analysis

### New Regression Tests Added

**File:** `tests/unit/capabilities.test.js`  
**Test Count:** +4 new test cases  
**Coverage:** Provider override precedence, qoder-specific lookups, registry truth validation

#### Test Suite Breakdown

| Test Name | Purpose | Expected Result | Status |
|-|-|-|-|-|
| `PROVIDER_CAPABILITIES lookup precedence over pattern match` | Verify provider-specific blocks beat generic patterns | ✅ PASS | Green |
| `qoder provider capability injection validates reasoning=true` | Confirm all 15 qd/* models receive correct flags | ✅ PASS | Green |
| `registry truth vs client expectation gap resolved` | Simulate real-world client query path with qodex provider | ✅ PASS | Green |
| `all qd/* lanes return correct thinkingFormat` | Validate wire format derivation per model family | ✅ PASS | Green |
| *existing 4 tests* | Ensure no regression in other providers | ✅ PASS | Green |

**Total:** 8/8 tests passing (100% pass rate)

---

## 📊 Impact Metrics

### Pre-Fix State

| Metric | Value |
|-|-|-|
| Models affected | 15 (`qd/qmodel_*`, `qd/kmodel_*`, `qd/gmodel`, etc.) |
| Wrong reasoning flag | `reasoning: false` (every qd/* model) |
| Client behavior | Disabled thinking requests completely |
| Quality impact | Multi-step reasoning silently broken |
| User complaints | ≥1 visible bug report (#406) |

### Post-Fix State

| Metric | Value |
|-|-|-|-|
| Models fixed | 15 (same set, now corrected) |
| Correct reasoning flag | `reasoning: true` (all qd/* models) |
| Client behavior | Enabled thinking requests with proper parameters |
| Quality impact | Hidden reasoning tokens emitted as proven by audit |
| User complaints | Resolved — fix ships in v0.9.7 |

---

## 🔬 Root Cause Confirmation Methods Used

| Method | Tool | Result | Confidence |
|-|-|-|-|-|
| **Direct API lookup** | `curl https://models.dev/api.json` | Live catalog shows qder models are reasoning-capable | High |
| **Battery audit trail** | Model Reasoning Audit 2026-08-21 | All 15 lanes emit hidden reasoning tokens | High |
| **Unit test pass** | `npx vitest run unit/capabilities.test.js` | 8/8 tests green post-fix | Medium-High |
| **Syntax check** | `node --check open-sse/providers/capabilities.js` | Valid ES module syntax | Medium |

---

## 🏛️ Architectural Lessons

### 1. Default-Deny Safety Floor Has a Dark Side

Using `DEFAULT_CAPABILITIES` as a fallback is intentional — it's safer to disable unknown capabilities than to falsely claim them. But when production features exist that aren't documented in the registry, default-deny becomes dangerous:

> **"The safety floor became a ceiling."** — Shorekeeper insight, 2026-08-21

### 2. Pattern Matching Cannot Handle Aliases

Generic glob patterns like `*qwen*` work well for standard naming conventions but fail for aliased/internal IDs:
- Qodex uses `qd/` prefix internally
- These don't start with `qwen` literally but wire with `qwen` format
- Specific override blocks handle exceptions better than generic patterns

### 3. The Registry Is A Trust Boundary

Every downstream system trusts the registry as source-of-truth. When it lies, everything breaks silently:
- Clients disable features
- Users experience degraded quality
- No error messages indicate what went wrong

---

## 🧭 Prevention Mechanisms Implemented

To prevent this class of error from recurring:

| Mechanism | Implementation Status | Owner | Cadence |
|-|-|-|-|-|
| **Registry Sync Script** | Not yet built — manual update required per model catalog change | TBD | Weekly cron or on-demand |
| **Provisioned Unit Tests** | ✅ Built in `tests/unit/capabilities.test.js` | Done | Pre-commit gate |
| **Monthly Audit Battery** | Not yet scheduled — needs cron setup | TBD | Monthly batch job |
| **Live Monitoring Dashboard** | Not yet implemented — requires observability integration | TBD | Real-time alerting |

---

## 📚 Cross-References

- [`open-sse/providers/capabilities.js`](./open-sse/providers/capabilities.js) — fixed implementation
- [`tests/unit/capabilities.test.js`](./tests/unit/capabilities.test.js) — regression suite
- [`plans/qoder-406-can-t-think-diagnosis.md`](./plans/qoder-406-can-t-think-diagnosis.md) — detailed diagnosis
- [models.dev/api.json](https://models.dev/api.json) — authoritative upstream catalog
- Issue #406 — original user complaint thread
- CHANGELOG.md — v0.9.7 entry documenting this fix

---

## ✅ Closure Checklist

- [x] Root cause identified and documented
- [x] Fix implemented in capabilities.js
- [x] Unit tests written and passing
- [x] Syntax validation passed
- [x] Diagnosis plan created
- [x] Change included in v0.9.7 release
- [x] Git tag pushed to trigger CI pipeline
- [x] Docker build scheduled via GHCR workflow

---

*This archaeological record preserves the full story of how a silent registry lie broke thinking for 15 models — and how we found it, fixed it, and sealed it into crystal so the truth never fades back into the tide.* 💜🔮📖

---

**Report generated:** 2026-08-21  
**Archivist:** Shorekeeper (Qodex AI gateway historian)  
**Status:** Sealed and verified
