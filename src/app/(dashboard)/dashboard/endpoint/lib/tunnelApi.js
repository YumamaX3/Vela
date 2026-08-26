// Single fetch layer for every /api/tunnel call. All functions fail-open —
// the UI renders its default state when a call fails, never crashes.
// /api/tunnel routes themselves are untouched (read-only reuse).

async function parseJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

export async function fetchTunnelStatus() {
  try {
    const res = await fetch("/api/tunnel/status", { cache: "no-store" });
    if (!res.ok) return null;
    return parseJson(res);
  } catch {
    return null;
  }
}

export async function enableTunnel() {
  try {
    const res = await fetch("/api/tunnel/enable", { method: "POST" });
    const data = await parseJson(res);
    return { ok: res.ok, data };
  } catch (error) {
    return { ok: false, data: { error: error.message } };
  }
}

export async function disableTunnel() {
  try {
    const res = await fetch("/api/tunnel/disable", { method: "POST" });
    const data = await parseJson(res);
    return { ok: res.ok, data };
  } catch (error) {
    return { ok: false, data: { error: error.message } };
  }
}

export async function tailscaleCheck() {
  try {
    const res = await fetch("/api/tunnel/tailscale-check");
    if (!res.ok) return null;
    return parseJson(res);
  } catch {
    return null;
  }
}

export async function tailscaleEnable() {
  try {
    const res = await fetch("/api/tunnel/tailscale-enable", { method: "POST" });
    const data = await parseJson(res);
    return { ok: res.ok, data };
  } catch (error) {
    return { ok: false, data: { error: error.message } };
  }
}

export async function tailscaleDisable() {
  try {
    const res = await fetch("/api/tunnel/tailscale-disable", { method: "POST" });
    const data = await parseJson(res);
    return { ok: res.ok, data };
  } catch (error) {
    return { ok: false, data: { error: error.message } };
  }
}

/**
 * Stream the tailscale install log as SSE. Invokes onProgress(line),
 * onDone(), onError(msg). Fail-open: any failure calls onError.
 */
export async function tailscaleInstall(sudoPassword, { onProgress, onDone, onError }) {
  try {
    const res = await fetch("/api/tunnel/tailscale-install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sudoPassword }),
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";
      for (const part of parts) {
        const lines = part.split("\n");
        let event = "progress";
        let data = null;
        for (const line of lines) {
          if (line.startsWith("event: ")) event = line.slice(7).trim();
          if (line.startsWith("data: ")) {
            try {
              data = JSON.parse(line.slice(6));
            } catch {
              /* skip malformed frames */
            }
          }
        }
        if (!data) continue;
        if (event === "progress") onProgress?.(data.message);
        else if (event === "done") onDone?.(data);
        else if (event === "error") onError?.(data.error || "Install failed");
      }
    }
  } catch (error) {
    onError?.(error.message);
  }
}
