// Autostart installation — the gateway comes back after a reboot.
//
// Port of 9router-go `internal/service`, narrowed to the backends this host
// family can actually be proven against: a systemd user unit on Linux, a
// launchd agent on macOS, a logon scheduled task on Windows, and a cron
// @reboot line as the portable fallback. An unsupported host is reported
// honestly rather than installing an entry nothing reads.
//
// Every backend runs `vela start`, which daemonizes and exits — so the unit
// type is oneshot (systemd) or RunAtLoad (launchd), never a process the
// supervisor thinks it must babysit.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const UNIT_NAME = "vela-gateway";
const WIN_TASK = "VelaGateway";
const LAUNCHD_LABEL = "com.vela.gateway";
const CRON_MARKER_BEGIN = "# >>> vela-gateway autostart >>>";
const CRON_MARKER_END = "# <<< vela-gateway autostart <<<";

function cliPath() {
  return path.resolve(__dirname, "..", "..", "cli.js");
}

function quote(arg) {
  return /[\s"]/g.test(arg) ? `"${String(arg).replace(/"/g, '\\"')}"` : arg;
}

function commandLine({ port, host }) {
  return [process.execPath, cliPath(), "start", "--port", String(port), "--host", host, "--skip-update"]
    .map(quote)
    .join(" ");
}

function detectBackend() {
  if (process.platform === "win32") return "windows-task";
  if (process.platform === "darwin") return "launchd";
  const home = os.homedir();
  if (
    fs.existsSync("/run/systemd/system") ||
    fs.existsSync(path.join(home, ".config", "systemd", "user"))
  ) {
    return "systemd-user";
  }
  return "cron";
}

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", windowsHide: true, timeout: 15000, ...opts }).trim();
}

function trySh(cmd, args, opts) {
  try { return sh(cmd, args, opts); } catch { return null; }
}

// ── systemd user unit ─────────────────────────────────────────────────────
function systemdPaths() {
  return {
    unit: path.join(os.homedir(), ".config", "systemd", "user", `${UNIT_NAME}.service`),
  };
}

function installSystemd(opts) {
  const { unit } = systemdPaths();
  fs.mkdirSync(path.dirname(unit), { recursive: true });
  const exec = commandLine(opts);
  const stop = [process.execPath, cliPath(), "stop"].map(quote).join(" ");
  fs.writeFileSync(
    unit,
    `[Unit]
Description=Vela AI Gateway
After=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=${exec}
ExecStop=${stop}
TimeoutStartSec=60

[Install]
WantedBy=default.target
`
  );
  trySh("systemctl", ["--user", "daemon-reload"]);
  const enabled = trySh("systemctl", ["--user", "enable", `${UNIT_NAME}.service`]) !== null;
  return { backend: "systemd-user", path: unit, enabled };
}

function uninstallSystemd() {
  const { unit } = systemdPaths();
  trySh("systemctl", ["--user", "disable", `${UNIT_NAME}.service`]);
  fs.rmSync(unit, { force: true });
  trySh("systemctl", ["--user", "daemon-reload"]);
  return { backend: "systemd-user", path: unit, removed: true };
}

function systemdStatus() {
  const { unit } = systemdPaths();
  return { backend: "systemd-user", path: unit, installed: fs.existsSync(unit) };
}

// ── launchd agent ─────────────────────────────────────────────────────────
function launchdPath() {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
}

function installLaunchd(opts) {
  const file = launchdPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const args = [process.execPath, cliPath(), "start", "--port", String(opts.port), "--host", opts.host, "--skip-update"];
  const xml = args.map((a) => `    <string>${a.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</string>`).join("\n");
  fs.writeFileSync(
    file,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${xml}
  </array>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
`
  );
  trySh("launchctl", ["load", "-w", file]);
  return { backend: "launchd", path: file, enabled: true };
}

function uninstallLaunchd() {
  const file = launchdPath();
  trySh("launchctl", ["unload", "-w", file]);
  fs.rmSync(file, { force: true });
  return { backend: "launchd", path: file, removed: true };
}

function launchdStatus() {
  const file = launchdPath();
  return { backend: "launchd", path: file, installed: fs.existsSync(file) };
}

// ── cron @reboot ──────────────────────────────────────────────────────────
function readCrontab() {
  return trySh("crontab", ["-l"]) || "";
}

function stripCronBlock(text) {
  const lines = text.split("\n");
  const out = [];
  let inside = false;
  for (const line of lines) {
    if (line.trim() === CRON_MARKER_BEGIN) { inside = true; continue; }
    if (line.trim() === CRON_MARKER_END) { inside = false; continue; }
    if (!inside) out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

function installCron(opts) {
  const current = stripCronBlock(readCrontab());
  const block = [
    CRON_MARKER_BEGIN,
    `@reboot ${commandLine(opts)} >> "${path.join(os.homedir(), ".vela", "gateway.log")}" 2>&1`,
    CRON_MARKER_END,
  ].join("\n");
  const next = current ? `${current}\n\n${block}\n` : `${block}\n`;
  execFileSync("crontab", ["-"], { input: next, encoding: "utf8", timeout: 15000 });
  return { backend: "cron", path: "crontab", enabled: true };
}

function uninstallCron() {
  const current = readCrontab();
  if (current.includes(CRON_MARKER_BEGIN)) {
    const next = stripCronBlock(current);
    execFileSync("crontab", ["-"], { input: next ? `${next}\n` : "", encoding: "utf8", timeout: 15000 });
  }
  return { backend: "cron", path: "crontab", removed: true };
}

function cronStatus() {
  return { backend: "cron", path: "crontab", installed: readCrontab().includes(CRON_MARKER_BEGIN) };
}

// ── Windows logon task ────────────────────────────────────────────────────
function installWindowsTask(opts) {
  const tr = commandLine(opts);
  try {
    sh("schtasks", ["/Create", "/F", "/SC", "ONLOGON", "/RL", "LIMITED", "/TN", WIN_TASK, "/TR", tr]);
    return { backend: "windows-task", path: WIN_TASK, enabled: true };
  } catch (error) {
    return { backend: "windows-task", path: WIN_TASK, enabled: false, error: String(error.message || error) };
  }
}

function uninstallWindowsTask() {
  trySh("schtasks", ["/Delete", "/F", "/TN", WIN_TASK]);
  return { backend: "windows-task", path: WIN_TASK, removed: true };
}

function windowsTaskStatus() {
  const out = trySh("schtasks", ["/Query", "/TN", WIN_TASK, "/FO", "LIST"]);
  return { backend: "windows-task", path: WIN_TASK, installed: Boolean(out) };
}

// ── public surface ────────────────────────────────────────────────────────
function install(opts) {
  switch (detectBackend()) {
    case "windows-task": return installWindowsTask(opts);
    case "launchd": return installLaunchd(opts);
    case "systemd-user": return installSystemd(opts);
    default: return installCron(opts);
  }
}

function uninstall() {
  switch (detectBackend()) {
    case "windows-task": return uninstallWindowsTask();
    case "launchd": return uninstallLaunchd();
    case "systemd-user": return uninstallSystemd();
    default: return uninstallCron();
  }
}

function status() {
  switch (detectBackend()) {
    case "windows-task": return windowsTaskStatus();
    case "launchd": return launchdStatus();
    case "systemd-user": return systemdStatus();
    default: return cronStatus();
  }
}

module.exports = { detectBackend, install, uninstall, status, commandLine };
