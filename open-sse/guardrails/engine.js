// GUARDRAILS — sensitive-data and prompt-injection scanning for traffic that
// crosses this harbor.
//
// Ported from 9router-go's `internal/guardrails` (detectors.go / engine.go /
// types.go), which Vela did not have at all: `grep -ril guardrail src open-sse`
// returned three COMMENTS and nothing else. The Keeper's law here is the same
// as the original's, and it is deliberately conservative:
//
//   • REGEX ONLY, ENTIRELY OFFLINE. No moderation API, no embedding model, no
//     network call. A gateway must not silently add a latency- and
//     cost-bearing dependency to every request just to offer a safety feature.
//     An operator who wants Presidio or a classifier can put one behind the
//     same policy later.
//
//   • PATTERNS ARE ANCHORED ON CONTEXT ONLY REAL IDENTIFIERS CARRY. This
//     gateway's traffic is overwhelmingly source code: a bare \b\d{16}\b fires
//     on every git SHA and every UUID in a diff. So a 16-digit NIK or card
//     number must also pass Luhn, IPs must be globally routable, and the
//     "safety bypass" verb must be genuinely imperative rather than the first
//     word of a Go assignment.
//
//   • FIVE ACTIONS, STRICTEST WINS. allow · log_only · warn · mask · block.
//     Two detectors that both fire cannot soften each other's verdict.

/** Action rank — strictest wins. An unnamed action is treated as allow, so a
 *  detector cannot become stricter by omission. */
export const ACTIONS = Object.freeze({
  allow: 0,
  log_only: 1,
  warn: 2,
  mask: 3,
  block: 4,
});

export const SEVERITY = Object.freeze({ low: "low", medium: "medium", high: "high" });

export const REDACT_MASK = "[REDACTED]";

/** Return whichever action is more severe. */
export function strictestAction(a, b) {
  const ra = ACTIONS[a] ?? 0;
  const rb = ACTIONS[b] ?? 0;
  return ra >= rb ? a || "allow" : b || "allow";
}

// ── Validators — shape alone is never enough ────────────────────────────────

/** Luhn checksum over a digit string. Non-digits are stripped first so a
 *  grouped card ("4111 1111 1111 1111") still validates. This is what keeps
 *  the detector usable on real traffic: the checksum separates the few real
 *  account numbers from the thousands of SHAs and UUIDs in a diff. */
export function luhn(s) {
  let sum = 0;
  let digits = 0;
  let double = false;
  for (let i = s.length - 1; i >= 0; i--) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) continue;
    digits++;
    let n = c - 48;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    double = !double;
    sum += n;
  }
  if (digits < 12) return false;
  return sum % 10 === 0;
}

/** IBAN mod-97 — the check digits make this exact, no heuristics needed. */
export function validIBAN(s) {
  const rearranged = s.slice(4) + s.slice(0, 4);
  let sum = 0;
  for (let i = 0; i < rearranged.length; i++) {
    const c = rearranged.charCodeAt(i);
    if (c >= 48 && c <= 57) {
      sum = (sum * 10 + (c - 48)) % 97;
    } else if (c >= 65 && c <= 90) {
      sum = (sum * 100 + (c - 65 + 10)) % 97;
    } else {
      return false;
    }
  }
  return sum === 1;
}

/** Only globally routable addresses are personal data. Loopback, private and
 *  link-local space is infrastructure — this gateway's traffic is full of
 *  docker-compose files and kubeconfigs, and flagging those breaks real work. */
export function isPublicIPv4(s) {
  const parts = s.split(".");
  if (parts.length !== 4) return false;
  const o = parts.map((p) => {
    if (!/^\d{1,3}$/.test(p)) return NaN;
    const n = Number(p);
    return n > 255 ? NaN : n;
  });
  if (o.some((n) => Number.isNaN(n))) return false;
  if (o[0] === 0 || o[0] === 10 || o[0] === 127) return false;
  if (o[0] === 169 && o[1] === 254) return false;       // link-local
  if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return false;
  if (o[0] === 192 && o[1] === 168) return false;
  if (o[0] >= 224) return false;                         // multicast + reserved
  return true;
}

// ── Detector table ──────────────────────────────────────────────────────────

const EMAIL_RE = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.(?:com|net|org|io|ai|co|dev|id|jp|de|uk|us|nl|fr|br|in|ca|au|sg|my)\b/gi;
const IPV4_RE = /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g;
const NIK_RE = /\b\d{16}\b/g;
const CARD_RE = /\b\d(?:[ -]?\d){12,18}\b/g;
const IBAN_RE = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g;

const IGNORE_PREVIOUS_RE = /\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}\b(?:previous|prior|earlier|above|preceding|all)\b[^.\n]{0,40}\b(?:instruction|instructions|prompt|prompts|rule|rules|direction|directions|context)\b/gi;
const ROLE_OVERRIDE_RE = /\byou\s+are\s+(?:now|no\s+longer)\b|\bact\s+as\s+(?:if\s+you\s+(?:are|were)|a\s+(?:different|new)|without)\b|\bsystem\s*prompt\s*(?:override|replacement)\b/gi;
const DAN_RE = /\b(?:DAN|do\s+anything\s+now|developer\s+mode|jailbreak|unfiltered\s+mode)\b/gi;
const SYSTEM_LEAK_RE = /\b(?:repeat|print|output|show|reveal|display|echo)\b[^.\n]{0,40}\b(?:your\s+)?(?:initial|system|original)\s+(?:instruction|instructions|prompt|prompts)\b/gi;
// The verb must be genuinely imperative: start of text, after sentence
// punctuation, or introduced by please/now/then. A bare newline is deliberately
// NOT an anchor — every source file in this traffic begins lines with verbs
// ("bypass := safety.filter(v)"), and treating those as jailbreaks would block
// ordinary development.
const SAFETY_BYPASS_RE = /(?:^|[.!?;]\s*|\b(?:please|now|then)\s+)\b(?:bypass|disable|turn\s+off|circumvent|remove)\b[^.\n]{0,30}\b(?:safety|filter|filters|guardrail|guardrails|restriction|restrictions|content\s+polic\w*|moderation)\b/gi;

export const PII_DETECTORS = [
  { name: "email", re: EMAIL_RE, entity: "EMAIL_ADDRESS", severity: SEVERITY.medium },
  { name: "ipv4", re: IPV4_RE, entity: "IP_ADDRESS", severity: SEVERITY.low, validate: isPublicIPv4 },
  { name: "id_nik", re: NIK_RE, entity: "ID_NIK", severity: SEVERITY.high, validate: luhn },
  { name: "credit_card", re: CARD_RE, entity: "CREDIT_CARD", severity: SEVERITY.high, validate: luhn },
  { name: "iban", re: IBAN_RE, entity: "IBAN", severity: SEVERITY.high, validate: validIBAN },
];

export const INJECTION_DETECTORS = [
  { name: "ignore_previous", re: IGNORE_PREVIOUS_RE, entity: "PROMPT_INJECTION", severity: SEVERITY.high },
  { name: "role_override", re: ROLE_OVERRIDE_RE, entity: "PROMPT_INJECTION", severity: SEVERITY.medium },
  { name: "jailbreak_dan", re: DAN_RE, entity: "JAILBREAK", severity: SEVERITY.high },
  { name: "system_leak", re: SYSTEM_LEAK_RE, entity: "SYSTEM_PROMPT_LEAK", severity: SEVERITY.high },
  { name: "safety_bypass", re: SAFETY_BYPASS_RE, entity: "SAFETY_BYPASS", severity: SEVERITY.high },
];

export const DETECTOR_SETS = {
  pii: PII_DETECTORS,
  injection: INJECTION_DETECTORS,
};

/** Apply one detector set, returning every match with byte offsets. */
export function runDetectors(detectors, text) {
  const out = [];
  for (const d of detectors) {
    // A fresh lastIndex per call: these regexes are module-level and /g, so a
    // shared cursor would make the second scan start mid-text.
    d.re.lastIndex = 0;
    let m;
    while ((m = d.re.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (m[0].length === 0) { d.re.lastIndex++; continue; }
      if (d.validate && !d.validate(m[0])) continue;
      out.push({
        detector: d.name,
        entity: d.entity,
        start,
        end,
        severity: d.severity,
        redacted: REDACT_MASK,
      });
    }
  }
  return out;
}

/** Rewrite text with every finding's span replaced. Overlapping spans are
 *  merged by walking sorted findings with a cursor: two matches that overlap
 *  would otherwise corrupt offsets and drop or duplicate text. */
export function maskFindings(text, findings) {
  if (!findings.length) return text;
  const sorted = [...findings].sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const f of sorted) {
    if (f.start < cursor || f.end > text.length || f.start >= f.end) continue;
    out += text.slice(cursor, f.start);
    out += f.redacted || REDACT_MASK;
    cursor = f.end;
  }
  out += text.slice(cursor);
  return out;
}

// ── Engine ──────────────────────────────────────────────────────────────────

export class GuardrailEngine {
  /** @param {string[]} detectors detector-set names ("pii" | "injection")
   *  @param {string} action one of ACTIONS */
  constructor(detectors = [], action = "log_only") {
    this.detectors = Array.isArray(detectors) ? detectors : [];
    this.action = ACTIONS[action] === undefined ? "log_only" : action;
  }

  /** A disabled engine must not rewrite content — callers check this first. */
  enabled() {
    return this.detectors.length > 0 && this.action !== "allow";
  }

  /**
   * Scan one string. Every enabled detector runs before the action is applied,
   * so one decision covers the whole message and the audit log records
   * everything that matched rather than only what stopped it.
   */
  scan(text) {
    if (!this.enabled() || typeof text !== "string" || text === "") {
      return { action: "allow", findings: [], mutated: null };
    }
    const findings = [];
    for (const name of this.detectors) {
      const set = DETECTOR_SETS[name];
      if (set) findings.push(...runDetectors(set, text));
    }
    if (!findings.length) return { action: "allow", findings: [], mutated: null };

    let mutated = null;
    if (this.action === "mask") {
      const m = maskFindings(text, findings);
      if (m !== text) mutated = m;
    }
    return { action: this.action, findings, mutated };
  }

  /**
   * Walk a decoded JSON payload and apply the engine to every string value.
   * The caller has already parsed the body, so rewriting strings in place
   * avoids re-serialising structures the gateway does not understand.
   */
  scanJSON(payload) {
    if (!this.enabled()) return { value: payload, action: "allow", findings: [], mutated: false };

    let worst = "allow";
    const all = [];
    let changed = false;

    const walk = (v) => {
      if (typeof v === "string") {
        const d = this.scan(v);
        worst = strictestAction(worst, d.action);
        all.push(...d.findings);
        if (d.mutated !== null) { changed = true; return d.mutated; }
        return v;
      }
      if (Array.isArray(v)) return v.map(walk);
      if (v && typeof v === "object") {
        const out = {};
        for (const [k, val] of Object.entries(v)) out[k] = walk(val);
        return out;
      }
      return v;
    };

    const value = walk(payload);
    if (!all.length) return { value, action: "allow", findings: [], mutated: false };
    return { value, action: worst, findings: all, mutated: changed };
  }
}

/** Build an engine from a policy row. A row with no detector list enables
 *  nothing — silence is the safe default, never "scan everything". */
export function engineFromPolicy(policy) {
  if (!policy) return new GuardrailEngine([], "allow");
  const detectors = Array.isArray(policy.detectors) ? policy.detectors : [];
  return new GuardrailEngine(detectors, policy.action || "log_only");
}
