// Watchdog + network monitor timings (shared by both services)
export const RESTART_COOLDOWN_MS = 120000;
export const NETWORK_SETTLE_MS = 2500;
export const WATCHDOG_INTERVAL_MS = 60000;

// Responsive Tide P8 — 5s → 30s. The monitor's tick is not a cheap check: every
// 5s it ran `os.networkInterfaces()` + a REAL TCP reachability probe to
// 1.1.1.1:443, twelve times a minute for the life of the process, for a signal
// (a DHCP/sleep/wake transition) that does not need that resolution. 30s still
// catches a transition far inside the restart cooldown's 120s, and cuts the
// probe load by 6×.
export const NETWORK_CHECK_INTERVAL_MS = 30000;

// The sleep detector reads ELAPSED TIME, not a tick count: a gap over this window
// means the process was suspended or starved past it. It is therefore an explicit
// idiom, NOT `NETWORK_CHECK_INTERVAL_MS * 6` — that expression used to be correct
// only by accident (6 × 5s). P8 widened the POLL cadence to 30s; the detection
// window is a property of sleep/wake, not of polling, so it HOLDS AT 30s (6 × 5s,
// the tested original steady-state baseline) instead of stretching to 3 minutes,
// which would swallow the short sleeps this monitor exists to catch.
export const SLEEP_DETECT_MS = 30_000;

// Skip virtual/transient interfaces (tailscale utun, AirDrop awdl, bridges) that flap and cause false netchange
export const VIRTUAL_IFACE_REGEX = /^(utun|awdl|llw|anpi|bridge|gif|stf|ipsec|ap|tun|tap|vmnet|veth|docker)/i;
