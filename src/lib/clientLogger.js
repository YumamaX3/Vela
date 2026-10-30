// The harbor's logger, browser-side.
//
// The dashboard's console lines are BROWSER lines: they live in the client's
// own console and can never reach the server's ledger. This shim gives them
// the same realms and the same voice — theme comes from the server-rendered
// data-theme marker (or localStorage) so a sweep reads identically on both
// sides of the water. Pure client code: no fs, no DB, no server imports.
"use client";

export const LOG_THEMES = { THEMED: "themed", PLAIN: "plain" };

export function normalizeLogTheme(raw) {
  return String(raw || "").toLowerCase() === "plain" ? "plain" : "themed";
}

export function stripTheme(text) {
  return String(text ?? "")
    .replace(/[\u2190-\u21FF\u2300-\u23FF\u2460-\u24FF\u25A0-\u27BF\u2B00-\u2BFF\uFE0F\u200D\u20E3]|\p{Extended_Pictographic}/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[\s·:—-]+/, "")
    .trim();
}

// The realms — mirrored from open-sse/utils/logfmt.js REALMS. A new realm
// there is unknown here until copied; unknown tags take the quiet banner.
const REALMS = {
  CHAT: "🧭", COMBO: "⛵", PROXY: "🔗", TOKEN_REFRESH: "🗝️", USAGE: "💡",
  FETCH: "🌐", IMAGE: "🖌️", SEARCH: "🔍", TTS: "🔊", AUTH: "⚔️",
  DB: "📚", STREAM: "〜",
};
const GENERIC = "•";

function realmMark(tag) {
  return REALMS[String(tag || "").toUpperCase()] || "•";
}

function readTheme() {
  if (typeof window === "undefined") return "themed";
  // The server-rendered setting seeds the voice when the page carries it;
  // localStorage (the dashboard toggle) is the fallback, then themed.
  const injected = typeof window.__VELA_LOG_THEME__ !== "undefined" ? window.__VELA_LOG_THEME__ : undefined;
  if (injected !== undefined && injected !== null && injected !== "") return normalizeLogTheme(injected);
  try {
    const v = window.localStorage.getItem("vela.logTheme");
    return normalizeLogTheme(v);
  } catch {
    return "themed";
  }
}

export function setClientLogTheme(next) {
  try { window.localStorage.setItem("vela.logTheme", normalizeLogTheme(next)); } catch {}
}

function stamp() {
  try { return new Date().toLocaleTimeString("en-US", { hour12: false }); } catch { return ""; }
}

function render(level, tag, message) {
  const themed = `[${stamp()}] ${realmMark(tag)} [${tag}] ${message ?? ""}`;
  return readTheme() === "plain" ? stripTheme(themed) : themed;
}

function sink(level, tag, message, data) {
  const ch = level === "error" ? "error" : level === "warn" ? "warn" : "log";
  console[ch](render(level, tag, message), data !== undefined ? data : "");
}

export const logger = {
  debug: (tag, message, data) => { if (process.env.NODE_ENV !== "production") sink("debug", tag, message, data); },
  info: (tag, message, data) => sink("info", tag, message, data),
  warn: (tag, message, data) => sink("warn", tag, message, data),
  error: (tag, message, data) => sink("error", tag, message, data),
};
