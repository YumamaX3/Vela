// Background daemon lifecycle — start, stop, status, logs.
//
// Port of 9router-go `internal/daemon`: the gateway detaches, writes a PID
// file beside its data, appends to one bounded log, and is asked to leave
// through its own HTTP shutdown door before any signal is raised. The order
// matters: a graceful stop flushes the ledger; SIGKILL does not.
//
// Everything here is plain Node — the CLI must work on a bare install, so no
// dependency is added for a file, a socket, or a timer.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn, execFileSync } = require("child_process");

const RUN_LOG_MAX_BYTES = 16 << 20;
const LOG_TAIL_BYTES = 256 << 10;
const STARTUP_TIMEOUT_MS = 20_000;
const STOP_GRACE_MS = 5_000;
const STOP_TIMEOUT_MS = 10_000;

function defaultDataDir() {
  return process.platform === "win32"
    ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "vela")
    : path.join(os.homedir(), ".vela");
}

function dataDir() {
  const configured = process.env.DATA_DIR;
  if (configured && !(process.platform === "win32" && /^\//.test(configured))) return configured;
  return defaultDataDir();
}

function dir() {
  const d = dataDir();
  fs.mkdirSync(d, { recursive: true });
  return d;
}

const pidFile = () => path.join(dir(), "gateway.pid");
const stateFile = () => path.join(dir(), "gateway.service.json");
const logPath = () => path.join(dir(), "gateway.log");

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM"; // exists, owned by someone else
  }
}

/** The daemon's PID, or 0 when the file is missing, malformed, or stale. */
function runningPid() {
  try {
    const raw = Number.parseInt(fs.readFileSync(pidFile(), "utf8").trim(), 10);
    if (!isAlive(raw)) return 0;
    return raw;
  } catch {
    return 0;
  }
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf8"));
  } catch {
    return null;
  }
}

function writeState(state) {
  fs.writeFileSync(stateFile(), JSON.stringify(state, null, 2));
}

function unregister(pid) {
  // Never delete a foreign claim: if the file now names another live process,
  // this command is not the one that should remove it.
  try {
    const current = Number.parseInt(fs.readFileSync(pidFile(), "utf8").trim(), 10);
    if (!pid || current === pid) fs.rmSync(pidFile(), { force: true });
  } catch { /* nothing to unregister */ }
}

function trimLog() {
  try {
    const size = fs.statSync(logPath()).size;
    if (size <= RUN_LOG_MAX_BYTES) return;
    const fd = fs.openSync(logPath(), "r");
    const keep = Buffer.alloc(RUN_LOG_MAX_BYTES);
    fs.readSync(fd, keep, 0, RUN_LOG_MAX_BYTES, size - RUN_LOG_MAX_BYTES);
    fs.closeSync(fd);
    fs.writeFileSync(`${logPath()}.1`, fs.readFileSync(logPath()));
    fs.writeFileSync(logPath(), keep);
  } catch { /* a log that cannot be trimmed is not a reason to refuse boot */ }
}

function health(port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    if (!port) return resolve(false);
    const req = http.get({ host: "127.0.0.1", port, path: "/api/health", timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.on("error", () => resolve(false));
  });
}

function waitFor(predicate, timeoutMs, intervalMs = 200) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const tick = async () => {
      if (await predicate()) return resolve(true);
      if (Date.now() >= deadline) return resolve(false);
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

/** Start the standalone server as a detached daemon. */
async function start({ runtime, appDir, serverPath, port, host }) {
  const existing = runningPid();
  if (existing) {
    const up = await health(port);
    return { ok: false, code: "already_running", pid: existing, healthy: up };
  }

  if (await health(port)) {
    return { ok: false, code: "port_busy", message: `Port ${port} already answers a gateway; not starting a second one.` };
  }

  trimLog();
  const logFd = fs.openSync(logPath(), "a");
  const child = spawn(
    runtime,
    ["--dns-result-order=ipv4first", "--max-old-space-size=6144", serverPath],
    {
      cwd: appDir,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env, PORT: String(port), HOSTNAME: host, DATA_DIR: dataDir(), VELA_SERVICE: "1" },
    }
  );
  child.unref();
  fs.closeSync(logFd);

  fs.writeFileSync(pidFile(), String(child.pid));
  writeState({ pid: child.pid, port, host, startedAt: new Date().toISOString(), version: process.env.VELA_VERSION || null });

  const ready = await waitFor(async () => (await health(port)) && isAlive(child.pid), STARTUP_TIMEOUT_MS);
  if (!ready) {
    return { ok: false, code: "startup_timeout", pid: child.pid, log: logPath() };
  }
  return { ok: true, pid: child.pid, port, host, log: logPath() };
}

function requestShutdown(port) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: "/api/version/shutdown", method: "POST", timeout: 3000 },
      (res) => { res.resume(); resolve(res.statusCode >= 200 && res.statusCode < 300); }
    );
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.on("error", () => resolve(false));
    req.end();
  });
}

function forceKill(pid) {
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/F", "/T", "/PID", String(pid)], { stdio: "ignore", windowsHide: true, timeout: 5000 });
    } else {
      process.kill(pid, "SIGKILL");
    }
  } catch { /* already gone */ }
}

/** Stop the daemon: graceful HTTP first, forced kill only after the grace. */
async function stop() {
  const pid = runningPid();
  if (!pid) {
    unregister();
    return { ok: true, code: "not_running" };
  }
  const state = readState() || {};
  const port = state.port;
  if (port) await requestShutdown(port);

  const exited = await waitFor(() => !isAlive(pid), STOP_TIMEOUT_MS);
  if (!exited) {
    forceKill(pid);
    await waitFor(() => !isAlive(pid), STOP_GRACE_MS);
  }
  unregister(pid);
  return { ok: !isAlive(pid), pid, graceful: exited, code: exited ? "stopped" : "killed" };
}

async function status() {
  const pid = runningPid();
  const state = readState() || {};
  const port = state.port || null;
  return {
    running: Boolean(pid),
    pid: pid || null,
    port,
    healthy: pid && port ? await health(port) : false,
    log: logPath(),
    dataDir: dataDir(),
  };
}

function logTail(lines = 40) {
  try {
    const size = fs.statSync(logPath()).size;
    const start = Math.max(0, size - LOG_TAIL_BYTES);
    const fd = fs.openSync(logPath(), "r");
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const all = buf.toString("utf8").split("\n");
    if (start > 0) all.shift(); // the first line is likely cut in half
    return all.slice(-lines).join("\n");
  } catch {
    return "";
  }
}

module.exports = { start, stop, status, logTail, runningPid, dataDir, pidFile, logPath };
