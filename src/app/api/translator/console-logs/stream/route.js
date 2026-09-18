import { getConsoleLogs, getConsoleEmitter, getConsoleLogStats, initConsoleLogCapture } from "@/lib/consoleLogBuffer";

export const dynamic = "force-dynamic";

initConsoleLogCapture();

export async function GET(request) {
  const encoder = new TextEncoder();
  const emitter = getConsoleEmitter();
  const { searchParams } = new URL(request.url);
  const structured = searchParams.get("structured") === "true";

  const state = {
    closed: false,
    send: null,
    sendLines: null,
    sendEntries: null,
    sendClear: null,
    keepalive: null,
  };
  const cleanup = () => {
    if (state.closed) return;
    state.closed = true;
    if (state.send) emitter.off("line", state.send);
    if (state.sendLines) emitter.off("lines", state.sendLines);
    if (state.sendEntries) emitter.off("entries", state.sendEntries);
    clearInterval(state.keepalive);
  };

  request.signal.addEventListener("abort", cleanup, { once: true });

  const stream = new ReadableStream({
    start(controller) {
      // Send initial buffered payload
      const initialLogs = getConsoleLogs({ structured });
      const stats = getConsoleLogStats();

      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({
          type: "init",
          logs: initialLogs,
          stats,
          structured
        })}\n\n`)
      );

      // Raw line listener
      state.send = (line) => {
        if (state.closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "line", line })}\n\n`));
        } catch {
          cleanup();
        }
      };

      // Raw lines batch listener
      state.sendLines = (lines) => {
        if (state.closed || !Array.isArray(lines) || lines.length === 0) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "lines", lines })}\n\n`));
        } catch {
          cleanup();
        }
      };

      // Structured entries batch listener
      state.sendEntries = (entries) => {
        if (state.closed || !Array.isArray(entries) || entries.length === 0) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "entries", entries })}\n\n`));
        } catch {
          cleanup();
        }
      };

      // Clear event
      state.sendClear = () => {
        if (state.closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "clear" })}\n\n`));
        } catch {
          cleanup();
        }
      };

      if (structured) {
        emitter.on("entries", state.sendEntries);
      } else {
        emitter.on("line", state.send);
        emitter.on("lines", state.sendLines);
      }
      emitter.on("clear", state.sendClear);

      // Keepalive heartbeat
      state.keepalive = setInterval(() => {
        if (state.closed) return;
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          cleanup();
        }
      }, 15000);
      state.keepalive.unref?.();
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
