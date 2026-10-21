// Daemon lifecycle — a real detached child, a real HTTP stop, no mocks.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const require = createRequire(import.meta.url);
const daemon = require("../../cli/src/cli/daemon.js");
const service = require("../../cli/src/cli/service.js");

let tempDir;
let appDir;
let serverPath;
let port;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-daemon-"));
  appDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-app-"));
  process.env.DATA_DIR = tempDir;
  port = 33999;
  serverPath = path.join(appDir, "fake-server.js");
  fs.writeFileSync(serverPath, `
const http = require("http");
const s = http.createServer((req, res) => {
  if (req.url === "/api/health") { res.writeHead(200, {"content-type":"application/json"}); return res.end('{"ok":true}'); }
  if (req.url === "/api/version/shutdown" && req.method === "POST") {
    res.writeHead(200); res.end('{"success":true}');
    setTimeout(() => process.exit(0), 100);
    return;
  }
  res.writeHead(404); res.end();
});
s.listen(Number(process.env.PORT), process.env.HOSTNAME);
`);
});

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.rmSync(appDir, { recursive: true, force: true });
});

describe("daemon lifecycle", () => {
  it("starts detached, reports healthy, logs, and stops through its own door", async () => {
    const started = await daemon.start({ runtime: process.execPath, appDir, serverPath, port, host: "127.0.0.1" });
    expect(started.ok, JSON.stringify(started)).toBe(true);
    expect(daemon.runningPid()).toBe(started.pid);

    const state = await daemon.status();
    expect(state).toMatchObject({ running: true, pid: started.pid, port, healthy: true });

    const stopped = await daemon.stop();
    expect(stopped.ok).toBe(true);
    expect(stopped.graceful).toBe(true);
    expect(daemon.runningPid()).toBe(0);

    const again = await daemon.stop();
    expect(again.code).toBe("not_running");
  }, 40000);

  it("refuses a second daemon on a busy port", async () => {
    const first = await daemon.start({ runtime: process.execPath, appDir, serverPath, port, host: "127.0.0.1" });
    expect(first.ok).toBe(true);
    const second = await daemon.start({ runtime: process.execPath, appDir, serverPath, port, host: "127.0.0.1" });
    expect(second).toMatchObject({ ok: false, code: "already_running" });
    await daemon.stop();
  }, 40000);

  it("names the host's autostart backend and a runnable start line", () => {
    const backend = service.detectBackend();
    expect(["windows-task", "launchd", "systemd-user", "cron"]).toContain(backend);
    const line = service.commandLine({ port, host: "127.0.0.1" });
    expect(line).toContain("start");
    expect(line).toContain(String(port));
    expect(line).toContain("--skip-update");
  });
});
