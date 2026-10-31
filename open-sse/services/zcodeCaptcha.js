// zcode-plan captcha mint — the Aliyun slider is solved by the vendored Node solver
// (zcode-captcha/solver.js, a byte-verbatim copy of upstream's browserless happy-dom
// script). One solve per process, one solve at a time. Every failure throws so the
// caller can treat a captcha as a claim failure, never as an account-health signal.

import { spawn } from "child_process";
import path from "path";
import url from "url";
import { ZCODE_ORIGIN, ZCODE_BILLING_VERSION } from "./zcodePlanQuota.js";
import * as log from "../../src/sse/utils/logger.js";

const SOLVER_PATH = path.join(
  path.dirname(url.fileURLToPath(import.meta.url)),
  "zcode-captcha",
  "solver.js"
);

const SOLVER_TIMEOUT_MS = 40 * 1000;
const CFG_TTL_MS = 5 * 60 * 1000;

// Upstream's own fallback when client/configs cannot be reached.
const DEFAULT_CAPTCHA_CFG = {
  enabled: true,
  prefix: "no8xfe",
  region: "cn",
  sceneId: "11xygtvd",
  skipModelRequest: false,
};

let cfgCache = null; // { value, at }

function cachedCfg() {
  if (cfgCache && Date.now() - cfgCache.at < CFG_TTL_MS) return cfgCache.value;
  return null;
}

async function fetchCaptchaCfg() {
  const cached = cachedCfg();
  if (cached) return cached;

  try {
    // Plain fetch, no auth: the configs endpoint is public and must not route
    // through a per-connection proxy.
    const res = await fetch(
      `${ZCODE_ORIGIN}/api/v1/client/configs?app_version=${ZCODE_BILLING_VERSION}&platform=darwin-x64`,
      { signal: AbortSignal.timeout(15000) }
    );
    if (!res.ok) throw new Error(`configs HTTP ${res.status}`);
    const json = await res.json();
    const cc = json?.data?.configs?.captcha;
    if (json?.code === 0 && cc && cc.prefix) {
      const value = {
        enabled: cc.enabled !== false,
        prefix: cc.prefix,
        region: cc.region || "cn",
        sceneId: cc.sceneId || "",
        skipModelRequest: !!cc.skip_model_request,
      };
      cfgCache = { value, at: Date.now() };
      return value;
    }
    throw new Error("configs shape unexpected");
  } catch (err) {
    log.debug("ZCODE_CAPTCHA", "configs unreachable — using baked defaults", {
      error: err?.message ?? String(err),
    });
    return cached || DEFAULT_CAPTCHA_CFG;
  }
}

function runSolver(sceneId, region, prefix) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SOLVER_PATH, sceneId, region, prefix], {
      cwd: path.dirname(SOLVER_PATH),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }, SOLVER_TIMEOUT_MS);
    if (timer.unref) timer.unref();

    child.stdout.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`captcha solver spawn: ${err?.message ?? String(err)}`));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error("captcha solver timed out; retry later"));
        return;
      }
      if (code === 0) {
        const m = /VERIFY_PARAM=(.+)/.exec(stdout);
        if (!m) {
          reject(new Error("captcha solver failed to initialize"));
          return;
        }
        resolve(m[1].trim());
        return;
      }
      if (code === 2) reject(new Error("captcha solver timed out; retry later"));
      else if (code === 3) reject(new Error("captcha solver failed to initialize"));
      else if (code === 4) reject(new Error("captcha solve failed"));
      else if (code === 5) reject(new Error("captcha solver onError"));
      else reject(new Error(`captcha solver failed (exit ${code})`));
    });
  });
}

// Upstream runs a single-solve pool; serialize here the same way.
let solveChain = Promise.resolve();

function serialized(run) {
  const next = solveChain.then(run, run);
  solveChain = next.catch(() => {});
  return next;
}

/**
 * Mint one captcha verify param.
 * @returns {Promise<{ param: string, region: string }>} param is "" when captcha
 *   is disabled upstream — the claim then carries no verify headers.
 */
export async function solveCaptcha() {
  return serialized(async () => {
    const cfg = await fetchCaptchaCfg();
    if (!cfg.enabled) return { param: "", region: "" };

    const startedAt = Date.now();
    try {
      const param = await runSolver(cfg.sceneId, cfg.region, cfg.prefix);
      log.info("ZCODE_CAPTCHA", "captcha minted", {
        prefix: cfg.prefix,
        region: cfg.region,
        ms: Date.now() - startedAt,
      });
      return { param, region: cfg.region };
    } catch (err) {
      log.info("ZCODE_CAPTCHA", "captcha mint failed", {
        prefix: cfg.prefix,
        region: cfg.region,
        ms: Date.now() - startedAt,
        error: err?.message ?? String(err),
      });
      throw err;
    }
  });
}

export function resetCaptchaCfgCache() {
  cfgCache = null;
}
