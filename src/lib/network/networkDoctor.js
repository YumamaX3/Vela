/**
 * Network Doctor — the Network lens's diagnostics engine.
 *
 * The settings room has always been able to *store* an egress path and *send*
 * one probe. It could never answer the operator's real question — "is this
 * path actually whole?" — because answering it means measuring the phases
 * separately: does the host resolve (DNS), does the socket open (TCP), does
 * the certificate still hold (TLS), and does the server answer (HTTP)?
 *
 * A single "reachable / unreachable" verdict hides which phase broke. This
 * module measures each phase on its own clock so the lens can say WHERE a
 * path failed, not merely that it did.
 *
 * Laws it honors:
 *   • SSRF — every operator-typed host crosses `validateProviderTestUrl`
 *     (the repo's one gate, `providerUrlSafety.js`), reused rather than
 *     re-implemented. A refused target returns a refusal verdict, never a dial.
 *   • Fail-open, never throw — each probe catches and returns a named error, so
 *     one dead phase can never abort the others (the poolEgressProbe precedent).
 *   • Injectable seams — dns/net/tls/fetch are injectable so the suite can prove
 *     the verdict logic without a live network.
 */
import dns from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";
import { validateProviderTestUrl } from "./providerUrlSafety.js";

export const DOCTOR_DEFAULT_TIMEOUT_MS = 8000;
const CERT_WARN_DAYS = 30;
const CERT_CRITICAL_DAYS = 7;

// The egress echo chain — rate-friendly first, quota-bound ipinfo last. Same
// order and parse map as poolEgressProbe, kept here so the Doctor needs no
// proxy pool to answer "what IP does this harbor actually leave from?".
export const EGRESS_PROBES = [
  { name: "ipwho.is", url: "https://ipwho.is/" },
  { name: "ip-api", url: "https://ip-api.com/json/?fields=status,message,query,country,regionName,city,org" },
  { name: "ipapi.co", url: "https://ipapi.co/json/" },
  { name: "ipinfo", url: "https://ipinfo.io/json" },
];
const EGRESS_PARSE = {
  "ipwho.is": (d) => ({ ip: d?.ip, country: d?.country, region: d?.region, city: d?.city, org: d?.org || d?.connection?.org }),
  "ip-api": (d) => ({ ip: d?.query, country: d?.country, region: d?.regionName, city: d?.city, org: d?.org }),
  "ipapi.co": (d) => ({ ip: d?.ip, country: d?.country_name, region: d?.region, city: d?.city, org: d?.org }),
  ipinfo: (d) => ({ ip: d?.ip, country: d?.country, region: d?.region, city: d?.city, org: d?.org }),
};

function withTimeout(promise, ms, label) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout`)), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

/** DNS: resolve a hostname and time the lookup. */
export async function resolveDns(host, { timeoutMs = DOCTOR_DEFAULT_TIMEOUT_MS, dnsImpl = dns } = {}) {
  const started = Date.now();
  try {
    const records = await withTimeout(dnsImpl.lookup(host, { all: true }), timeoutMs, "dns");
    const addresses = (records || []).map((r) => ({ address: r.address, family: r.family }));
    return { ok: addresses.length > 0, ms: Date.now() - started, addresses, error: addresses.length ? null : "no records" };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, addresses: [], error: err?.code || err?.message || "dns failed" };
  }
}

/** TCP: open a socket to host:port and time the connect. */
export function probeTcp(host, port, { timeoutMs = DOCTOR_DEFAULT_TIMEOUT_MS, netImpl = net } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = new netImpl.Socket();
    let settled = false;
    const done = (ok, error) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* already gone */ }
      resolve({ ok, ms: Date.now() - started, error: error || null });
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true, null));
    socket.once("timeout", () => done(false, "tcp timeout"));
    socket.once("error", (err) => done(false, err?.code || err?.message || "tcp failed"));
    try {
      socket.connect(port, host);
    } catch (err) {
      done(false, err?.message || "tcp failed");
    }
  });
}

/** TLS: handshake, then read the peer certificate's expiry and subject. */
export function probeTls(host, port, { timeoutMs = DOCTOR_DEFAULT_TIMEOUT_MS, tlsImpl = tls } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    const done = (payload) => {
      if (settled) return;
      settled = true;
      resolve({ ms: Date.now() - started, ...payload });
    };
    let socket;
    try {
      socket = tlsImpl.connect({ host, port, servername: host, rejectUnauthorized: false });
    } catch (err) {
      return done({ ok: false, error: err?.message || "tls failed" });
    }
    socket.setTimeout(timeoutMs);
    socket.once("secureConnect", () => {
      try {
        const cert = socket.getPeerCertificate() || {};
        const validTo = cert.valid_to ? new Date(cert.valid_to) : null;
        const daysRemaining = validTo ? Math.floor((validTo.getTime() - Date.now()) / 86_400_000) : null;
        done({
          ok: true,
          authorized: socket.authorized === true,
          protocol: socket.getProtocol ? socket.getProtocol() : null,
          expiresAt: validTo ? validTo.toISOString() : null,
          daysRemaining,
          issuer: cert.issuer?.O || cert.issuer?.CN || null,
          subject: cert.subject?.CN || null,
          error: null,
        });
      } catch (err) {
        done({ ok: false, error: err?.message || "cert read failed" });
      }
    });
    socket.once("timeout", () => { done({ ok: false, error: "tls timeout" }); try { socket.destroy(); } catch {} });
    socket.once("error", (err) => done({ ok: false, error: err?.code || err?.message || "tls failed" }));
  });
}

/** HTTP: one HEAD (falling back to GET on 405) and time the response. */
export async function probeHttp(url, { timeoutMs = DOCTOR_DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error("http timeout")), timeoutMs);
  try {
    let res = await fetchImpl(url, { method: "HEAD", signal: ctrl.signal, redirect: "manual" });
    if (res.status === 405 || res.status === 501) {
      res = await fetchImpl(url, { method: "GET", signal: ctrl.signal, redirect: "manual" });
    }
    return { ok: res.status < 500, status: res.status, ms: Date.now() - started, error: null };
  } catch (err) {
    return { ok: false, status: null, ms: Date.now() - started, error: err?.name === "AbortError" || /timeout/.test(err?.message || "") ? "http timeout" : (err?.code || err?.message || "http failed") };
  } finally {
    clearTimeout(timer);
  }
}

/** Cert health verdict from days remaining — the operator's own thresholds. */
export function certVerdict(daysRemaining) {
  if (daysRemaining == null) return "unknown";
  if (daysRemaining < 0) return "expired";
  if (daysRemaining <= CERT_CRITICAL_DAYS) return "critical";
  if (daysRemaining <= CERT_WARN_DAYS) return "warning";
  return "ok";
}

/**
 * Diagnose one endpoint end to end. The verdict is the FIRST phase that broke
 * (dns → tcp → tls → http), so the lens can name where the path stopped.
 */
export async function diagnoseEndpoint(rawUrl, opts = {}) {
  const gate = validateProviderTestUrl(rawUrl);
  if (!gate.ok) {
    return {
      ok: false,
      refused: true,
      url: null,
      host: null,
      port: null,
      verdict: "refused",
      reason: gate.reason || gate.error || "URL refused by the SSRF gate",
      dns: null, tcp: null, tls: null, http: null,
    };
  }
  const url = new URL(gate.url);
  const host = url.hostname;
  const isHttps = url.protocol === "https:";
  const port = Number(url.port) || (isHttps ? 443 : 80);

  const dnsResult = await resolveDns(host, opts);
  if (!dnsResult.ok) {
    return { ok: false, url: gate.url, host, port, verdict: "dns", reason: `DNS: ${dnsResult.error}`, dns: dnsResult, tcp: null, tls: null, http: null };
  }
  const tcpResult = await probeTcp(host, port, opts);
  if (!tcpResult.ok) {
    return { ok: false, url: gate.url, host, port, verdict: "tcp", reason: `TCP: ${tcpResult.error}`, dns: dnsResult, tcp: tcpResult, tls: null, http: null };
  }
  let tlsResult = null;
  if (isHttps) {
    tlsResult = await probeTls(host, port, opts);
    if (!tlsResult.ok) {
      return { ok: false, url: gate.url, host, port, verdict: "tls", reason: `TLS: ${tlsResult.error}`, dns: dnsResult, tcp: tcpResult, tls: tlsResult, http: null };
    }
  }
  const httpResult = await probeHttp(gate.url, opts);
  const cert = tlsResult ? certVerdict(tlsResult.daysRemaining) : null;
  return {
    ok: httpResult.ok,
    url: gate.url,
    host,
    port,
    verdict: httpResult.ok ? "ok" : "http",
    reason: httpResult.ok ? null : `HTTP: ${httpResult.error || httpResult.status}`,
    cert,
    dns: dnsResult,
    tcp: tcpResult,
    tls: tlsResult,
    http: httpResult,
  };
}

/**
 * Resolve this harbor's EFFECTIVE egress identity — the IP it actually leaves
 * from, through the configured outbound proxy when one is set (the honest
 * answer to "is my proxy really routing?"). Rides the egress echo chain.
 */
export async function resolveEgressIdentity({ proxyUrl = null, timeoutMs = DOCTOR_DEFAULT_TIMEOUT_MS, fetchImpl = null } = {}) {
  const { proxyAwareFetch } = fetchImpl
    ? { proxyAwareFetch: fetchImpl }
    : await import("open-sse/utils/proxyFetch.js");
  const proxyOptions = proxyUrl ? { enabled: true, url: proxyUrl, strictProxy: true } : null;
  const started = Date.now();
  for (const probe of EGRESS_PROBES) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error("egress timeout")), timeoutMs);
    try {
      const res = await proxyAwareFetch(probe.url, { signal: ctrl.signal, headers: { "User-Agent": "Vela" } }, proxyOptions);
      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) return { ok: false, error: res.status === 429 ? "rate-limit" : "server", source: probe.name, via: proxyUrl ? "proxy" : "direct", ms: Date.now() - started };
        continue;
      }
      const data = await res.json().catch(() => null);
      const parsed = data ? EGRESS_PARSE[probe.name]?.(data) : null;
      if (parsed?.ip) return { ok: true, ...parsed, source: probe.name, via: proxyUrl ? "proxy" : "direct", ms: Date.now() - started, error: null };
    } catch (err) {
      return { ok: false, error: err?.name === "AbortError" ? "timeout" : (err?.code || err?.message || "egress failed"), source: probe.name, via: proxyUrl ? "proxy" : "direct", ms: Date.now() - started };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, error: "no-ip", source: null, via: proxyUrl ? "proxy" : "direct", ms: Date.now() - started };
}

/**
 * The full Doctor sweep: the harbor's own egress identity, plus every distinct
 * upstream host the operator's connections point at (bounded, deduped).
 */
export async function runDoctor({ targets = [], proxyUrl = null, timeoutMs = DOCTOR_DEFAULT_TIMEOUT_MS, limit = 8, ...opts } = {}) {
  const unique = [];
  const seen = new Set();
  for (const t of targets) {
    const key = String(t || "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(key);
    if (unique.length >= limit) break;
  }
  const egress = await resolveEgressIdentity({ proxyUrl, timeoutMs, ...opts });
  const endpoints = [];
  for (const target of unique) {
    endpoints.push(await diagnoseEndpoint(target, { timeoutMs, ...opts }));
  }
  return { egress, endpoints, checkedAt: new Date().toISOString() };
}
