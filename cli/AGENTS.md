# cli — the `vela` npm launcher

The public npm package `vela` (`cli/package.json`) — the command a user runs to
install, start, and manage a Vela gateway. **This is not the gateway**; it is a
launcher that self-heals its runtime, spawns the server, and opens the browser.

> ⚠️ **Identity split.** The root app is `vela-app` (**private**). This package
> is `vela` (**public**) — the name on npm must not change, because it is both
> the install command and the updater's identity.

## The layout

| Path | What it is |
|-|-|
| `cli.js` | The bin entry (`bin: { vela: "./cli.js" }`). Arg parsing, server spawn, health poll, update check, tray handoff |
| `hooks/postinstall.js` | npm `postinstall` — installs the runtime deps (see below) |
| `hooks/sqliteRuntime.js` | `ensureSqliteRuntime()` + `buildEnvWithRuntime()` — the SQLite runtime self-heal |
| `hooks/trayRuntime.js` | `ensureTrayRuntime()` — the system-tray runtime self-heal (macOS/Linux only) |
| `src/cli/menus/` | Interactive TUI menus: `providers`, `apiKeys`, `combos`, `cliTools`, `settings` |
| `src/cli/commands/xaiVideo.js` | The `xai video` subcommand |
| `src/cli/tray/` | Tray implementations (`tray.js`, `trayWin.js`, `tray.ps1`, icons) |
| `src/cli/utils/` | `keyVault`, `endpoint`, `modelSelector`, `display`, `input`, `format`, `clipboard`, `menuHelper` |
| `src/cli/api/client.js` | HTTP client for the running gateway |
| `scripts/build-cli.js` / `buildMitm.js` | Bundling (`esbuild`) for publish |

## The command surface

`cli.js` reads `process.argv.slice(2)` directly. The flags, verbatim from the
help text it prints:

| Flag | Effect | Default |
|-|-|-|
| `-p, --port <port>` | Port for the server | `32060` |
| `-H, --host <host>` | Host to bind | `0.0.0.0` |
| `-n, --no-browser` | Don't open the browser | opens |
| `-l, --log` | Show server logs | hidden |
| `-t, --tray` | Run in system-tray mode (background) | off |
| `--no-tray` | Disable the tray icon (headless/CI) | — |
| `--skip-update` | Skip the auto-update check | — |
| `-h, --help` | Print help | — |
| `-v, --version` | Print version | — |
| `doctor` (subcommand) | Diagnose the local install (node, build, data dir, port) without starting the server | — |

**Subcommand:** `vela xai video --prompt "…" --output video.mp4` — runs against
an already-running gateway and **bypasses the launcher flow** entirely (no
runtime self-heal, no server spawn). It is dispatched at the very top of
`cli.js`, before any other work.

**Subcommand:** `vela doctor` — diagnoses the local install **without starting
the server** (dispatched at `cli.js:605`, `isDoctor = args[0] === "doctor"`).
Its four pre-flight checks: Node version, standalone build present, data dir
writable, port free.

> ⚠️ **Binding to `0.0.0.0` is network-exposed.** The default host is not
> loopback. `cli.js` prints a warning naming the LAN address it became
> reachable at, and recommends `--host 127.0.0.1` for local-only. A `vela`
> started with defaults on an untrusted network is a gateway on that network.

## How it starts the server

1. **Parse args** (`--port`, `--host`, …).
2. **Self-heal the SQLite runtime** — `ensureSqliteRuntime({ silent: true })`
   installs `sql.js` (required) and `better-sqlite3` (optional) into
   `~/.vela/runtime/node_modules`. `buildEnvWithRuntime()` puts that path on
   `NODE_PATH` so the server can resolve them. Wrapped in `try {} catch {}` —
   best-effort, stderr-only on failure.
3. **Self-heal the tray runtime** — `ensureTrayRuntime({ silent: true })` on
   macOS/Linux only.
4. **Find a port** — up to `MAX_PORT_ATTEMPTS` (10) if the preferred one is
   taken.
5. **Spawn** the server with `--dns-result-order=ipv4first` and
   `--max-old-space-size=6144`, then **poll TCP** until it accepts connections
   (`waitServerReady`, 150ms interval, 15s timeout) rather than blind-waiting.
6. **Open the browser** unless `--no-browser`.

> **Why the runtime lives in `~/.vela/runtime`, not in the package.** Bundling
> native `.node` files under the global install dir causes Windows `EBUSY` when
> updating the CLI — the install dir is locked while the old process runs. See
> the `comment_sqlite` / `comment_systray` fields in `cli/package.json`, which
> record this in the manifest itself.

> **Why systray2 is a fork, and Windows is special.** The legacy `systray@1.0.5`
> ships a 2017 x86_64 binary that fails on modern macOS `dyld`. And shipping
> unsigned Go binaries triggers antivirus false positives (Kaspersky). So:
> macOS/Linux lazy-install the `systray2` fork into `~/.vela/runtime`; **Windows
> uses a PowerShell `NotifyIcon`** (`tray.ps1`) with zero binary.

## Update & purge

- **Update** — `INSTALL_CMD_LATEST = npm i -g vela@latest --prefer-online`.
  The check is skipped with `--skip-update`.
- **Purge** — the CLI carries a full purge path (removes the runtime and data).
  Read `cli.js` for the exact scope before changing it; a purge that
  under-reaches leaves a broken runtime, one that over-reaches takes the user's
  database with it.

## Publishing

```bash
npm --prefix cli run pack:cli      # npm run build && npm pack --pack-destination ../..
npm --prefix cli run publish:cli   # npm run build && npm publish
```

Both run `scripts/build-cli.js` first (`prepublishOnly` guards it too). The
`files` allowlist in `cli/package.json` is explicit — `cli.js`, `src`, `hooks`,
`app`, `README.md`, `LICENSE`. **A new top-level directory is not published
unless it is added there.**

## Traps

- **The published surface is an allowlist.** See above — a file outside `files`
  exists in git and not on npm.
- **`vela` ≠ `vela-app`.** Never "fix" the CLI's `name` to match the root
  package; the npm name is the install command and the updater identity.
- **`0.0.0.0` by default.** Do not assume the CLI starts a loopback-only
  server; it does not, and it warns.
- **The runtime self-heal is best-effort.** A failure is swallowed by design so
  the launcher can still start; the consequence is a server that may fall back
  down the driver chain (`sql.js` last) rather than the native driver.
- **`vela xai video` short-circuits.** It returns before the launcher flow, so
  any change to arg handling must account for the early dispatch at the top of
  `cli.js`.
