// CLI surface for the daemon and autostart entry.
// Kept out of cli.js so the launcher stays a launcher.
"use strict";

const daemon = require("./daemon");
const service = require("./service");

function flag(argv, name, fallback = null) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

async function run(argv, config) {
  const command = argv[0];
  const { port, host, appDir, serverPath, runtime } = config;

  if (command === "start") {
    const result = await daemon.start({ runtime, appDir, serverPath, port, host });
    if (!result.ok) {
      if (result.code === "already_running") {
        console.log(`⛵ Vela is already running (pid ${result.pid}${result.healthy ? ", healthy" : ""}).`);
        return 0;
      }
      if (result.code === "port_busy") {
        console.error(`❌ ${result.message}`);
        return 1;
      }
      console.error(`❌ Vela did not answer within 20s (pid ${result.pid}). Inspect ${result.log}`);
      return 1;
    }
    console.log(`⛵ Vela started — pid ${result.pid}, http://${host}:${port}, log ${result.log}`);
    return 0;
  }

  if (command === "stop") {
    const result = await daemon.stop();
    if (result.code === "not_running") console.log("⛵ Vela is not running.");
    else if (result.graceful) console.log(`⛵ Vela stopped gracefully (pid ${result.pid}).`);
    else console.log(`⛵ Vela was still alive after the grace period; killed (pid ${result.pid}).`);
    return result.ok ? 0 : 1;
  }

  if (command === "restart") {
    const stopped = await daemon.stop();
    if (stopped.code === "not_running") console.log("⛵ Nothing was running; starting fresh.");
    const result = await daemon.start({ runtime, appDir, serverPath, port, host });
    if (!result.ok) {
      console.error(`❌ Restart failed (${result.code}). ${result.message || ""}`);
      return 1;
    }
    console.log(`⛵ Vela restarted — pid ${result.pid}, http://${host}:${port}`);
    return 0;
  }

  if (command === "status") {
    const [runState, entry] = [await daemon.status(), service.status()];
    console.log("⛵ Vela status");
    console.log(`   daemon   ${runState.running ? `running (pid ${runState.pid})` : "not running"}`);
    if (runState.port) console.log(`   health   ${runState.healthy ? "ok" : "unreachable"}`);
    console.log(`   data     ${runState.dataDir}`);
    console.log(`   log      ${runState.log}`);
    console.log(`   autostart ${entry.backend} — ${entry.installed ? `installed (${entry.path})` : "not installed"}`);
    return 0;
  }

  if (command === "logs") {
    const lines = Number(flag(argv, "-n", flag(argv, "--lines", "40")));
    const tail = daemon.logTail(Number.isFinite(lines) && lines > 0 ? lines : 40);
    console.log(tail || `(no log yet at ${daemon.logPath()})`);
    return 0;
  }

  if (command === "service") {
    const action = argv[1] || "status";
    if (action === "install") {
      const result = service.install({ port, host });
      if (result.enabled === false) {
        console.error(`❌ Autostart entry was written but could not be enabled: ${result.error || "unknown reason"}`);
        console.error(`   Entry: ${result.path}`);
        return 1;
      }
      console.log(`⛵ Autostart installed (${result.backend}) → ${result.path}`);
      console.log("   It runs `vela start` at logon; the daemon it launches survives this shell.");
      return 0;
    }
    if (action === "uninstall") {
      const result = service.uninstall();
      console.log(`⛵ Autostart removed (${result.backend}) → ${result.path}`);
      return 0;
    }
    const state = service.status();
    console.log(`⛵ Autostart (${state.backend}) — ${state.installed ? `installed (${state.path})` : "not installed"}`);
    return 0;
  }

  console.error(`Unknown command: ${command}`);
  return 1;
}

module.exports = { run };
