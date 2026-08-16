// W2-G visual verification — minimal CDP driver over a Steel browser.
// STEEL_CDP_URL points at the Steel CDP endpoint (default http://127.0.0.1:9223).
// Commands: node cdp.mjs <cmd> [args...]
//   resize <w> <h>            — set device metrics (desktop, dsf 1)
//   go <url>                  — navigate + wait for load
//   wait <ms>                 — sleep
//   shoot <path> [viewport]   — full-page PNG (or "viewport" = viewport only)
//   eval <expr>               — Runtime.evaluate, print JSON result
//   key <Enter|ArrowDown|ArrowUp|Space> — keyDown+keyUp to the focused element
//   cookie <name> <value> <url>         — set a cookie for the page's origin
//   tab <name>                — find target whose url contains <name>, print ws url
import fs from "node:fs";

const BASE = process.env.STEEL_CDP_URL || "http://127.0.0.1:9223";

async function targets() {
  const r = await fetch(`${BASE}/json`);
  return r.json();
}

class CDP {
  constructor(ws) { this.ws = ws; this.seq = 0; this.pending = new Map(); this.events = []; }
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new CDP(ws);
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && c.pending.has(m.id)) {
        const p = c.pending.get(m.id); c.pending.delete(m.id);
        if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
      } else c.events.push(m);
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`timeout ${method}`)); } }, 60000);
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const list = await targets();
  // Prefer the Observatory tab if it is already open, else the first page.
  const page = list.find((t) => t.type === "page" && t.url.includes("dashboard/usage"))
    || list.find((t) => t.type === "page");
  if (!page) { console.error("NO PAGE TARGET"); process.exit(1); }
  if (cmd === "tab") { console.log(JSON.stringify({ url: page.url, ws: page.webSocketDebuggerUrl })); return; }

  // Chrome may omit the port in webSocketDebuggerUrl when bound beyond loopback.
  // Derive the fallback port from the configured endpoint.
  let wsUrl = page.webSocketDebuggerUrl;
  try {
    const u = new URL(wsUrl);
    if (!u.port) { u.port = new URL(BASE).port || "9222"; wsUrl = u.toString(); }
  } catch {}
  const cdp = await CDP.connect(wsUrl);
  try {
    switch (cmd) {
      case "resize": {
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width: Number(args[0]), height: Number(args[1]), deviceScaleFactor: 1, mobile: false,
        });
        console.log(`RESIZED ${args[0]}x${args[1]}`);
        break;
      }
      case "go": {
        await cdp.send("Page.enable");
        await cdp.send("Page.navigate", { url: args[0] });
        await sleep(Number(args[1] || 2500));
        console.log(`NAVIGATED ${args[0]}`);
        break;
      }
      case "wait":
        await sleep(Number(args[0]));
        console.log(`WAITED ${args[0]}ms`);
        break;
      case "shoot": {
        const full = args[1] !== "viewport";
        const shot = await cdp.send("Page.captureScreenshot", {
          format: "png", captureBeyondViewport: full,
        });
        fs.writeFileSync(args[0], Buffer.from(shot.data, "base64"));
        console.log(`SHOT ${args[0]} (${fs.statSync(args[0]).size} bytes)`);
        break;
      }
      case "eval": {
        const res = await cdp.send("Runtime.evaluate", {
          expression: args.join(" "), returnByValue: true, awaitPromise: true,
        });
        if (res.exceptionDetails) { console.error("EVAL ERROR:", JSON.stringify(res.exceptionDetails.exception?.description || res.exceptionDetails.text)); process.exit(2); }
        console.log(JSON.stringify(res.result.value));
        break;
      }
      case "key": {
        // key <Enter|ArrowDown|ArrowUp|Space> — keyDown+keyUp to the focused element
        const key = args[0];
        const code = key === "Space" ? " " : key;
        await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: code, code: key === "Space" ? "Space" : key, windowsVirtualKeyCode: code.charCodeAt(0), nativeVirtualKeyCode: code.charCodeAt(0) });
        await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: code, code: key === "Space" ? "Space" : key, windowsVirtualKeyCode: code.charCodeAt(0), nativeVirtualKeyCode: code.charCodeAt(0) });
        console.log(`KEY ${key}`);
        break;
      }
      case "cookie": {
        // cookie <name> <value> <url> — set a cookie for the page's origin
        await cdp.send("Network.setCookie", { name: args[0], value: args[1], url: args[2], path: "/" });
        console.log(`COOKIE ${args[0]}=${args[1]}`);
        break;
      }
      default:
        console.error(`unknown cmd ${cmd}`); process.exit(1);
    }
  } finally { cdp.close(); }
}

main().catch((e) => { console.error("CDP FAIL:", e.message); process.exit(1); });
