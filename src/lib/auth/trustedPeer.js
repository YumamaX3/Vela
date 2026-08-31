import { timingSafeEqual } from "@/shared/utils/timingSafeEqual.js";

// x-9r-real-ip is only trustworthy when custom-server.js stamped it from the TCP socket.
// It proves that by echoing the per-process secret it generated at boot, which a client
// cannot guess. Without the proof the header is just attacker-supplied input.
// The compare is constant-time (house pattern) — this token is the key to locality.
export function hasTrustedPeerHeaders(request) {
  const token = process.env.VELA_PEER_TOKEN;
  return Boolean(token) && timingSafeEqual(request.headers.get("x-9r-peer-token"), token);
}
