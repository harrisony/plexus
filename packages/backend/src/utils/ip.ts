import { FastifyRequest } from 'fastify';
import { isIpAllowed } from './ip-match';

/**
 * getClientIp
 *
 * Safely extracts the client's original IP address from incoming headers.
 * Implements a prioritized list of headers commonly used by proxies and CDNs.
 *
 * NOTE: forwarding headers are spoofable by anyone who can reach the server
 * directly. For security decisions (IP allowlists) prefer getTrustedClientIp(),
 * which only believes these headers when the immediate peer is a trusted proxy.
 */
export function getClientIp(request: FastifyRequest): string | null {
  const headers = request.headers;

  // 1. Cloudflare prioritized connecting IP
  const cfIp = headers['cf-connecting-ip'];
  if (cfIp && typeof cfIp === 'string') return cfIp;

  // 2. Standard CDN/Proxy "True Client" headers
  const trueClientIp = headers['true-client-ip'];
  if (trueClientIp && typeof trueClientIp === 'string') return trueClientIp;

  // 3. Common reverse proxy headers (X-Real-IP)
  const xRealIp = headers['x-real-ip'];
  if (xRealIp && typeof xRealIp === 'string') return xRealIp;

  // 4. X-Forwarded-For chain: The leftmost IP is the original client.
  const xForwardedFor = headers['x-forwarded-for'];
  if (xForwardedFor && typeof xForwardedFor === 'string') {
    const ips = xForwardedFor.split(',').map((ip) => ip.trim());
    if (ips.length > 0) return ips[0] || null;
  }

  // 5. Secondary fallback headers
  const xClientIp = headers['x-client-ip'];
  if (xClientIp && typeof xClientIp === 'string') return xClientIp;

  const fastlyClientIp = headers['fastly-client-ip'];
  if (fastlyClientIp && typeof fastlyClientIp === 'string') return fastlyClientIp;

  const xClusterClientIp = headers['x-cluster-client-ip'];
  if (xClusterClientIp && typeof xClusterClientIp === 'string') return xClusterClientIp;

  // 6. RFC 7239 'Forwarded' header parsing
  const forwarded = headers['forwarded'];
  if (forwarded && typeof forwarded === 'string') {
    const match = forwarded.match(/for="?([^";,]+)"?/i);
    if (match && match[1]) return match[1];
  }

  // 7. Socket-level IP provided by Fastify or Node.js
  return request.ip || request.socket.remoteAddress || null;
}

/**
 * getTrustedClientIp
 *
 * Trust-aware client IP resolution. Forwarding headers (X-Forwarded-For,
 * CF-Connecting-IP, …) are only honored when the request's immediate peer is a
 * configured trusted proxy; otherwise the peer address itself is treated as the
 * client. This keeps IP allowlists authoritative even though forwarding headers
 * can be spoofed by a direct caller.
 *
 * `trustedProxies` semantics (distinct from per-key allowlists, where empty
 * means "no restriction"):
 *   - undefined        → not configured ⇒ trust all peers (legacy behavior)
 *   - contains 0.0.0.0/0 (the UI default) ⇒ trust all peers
 *   - []               → trust no peers ⇒ forwarding headers are ignored
 *   - specific entries → only peers matching them are trusted
 */
export function getTrustedClientIp(
  request: FastifyRequest,
  trustedProxies: string[] | undefined
): string | null {
  // Not configured: preserve the original header-trusting behavior.
  if (trustedProxies === undefined) return getClientIp(request);

  const rules = trustedProxies.map((r) => r.trim()).filter(Boolean);
  const peer = request.ip || request.socket?.remoteAddress || null;

  // No trusted proxies → never believe forwarding headers; the peer is the client.
  if (rules.length === 0) return peer;

  // Immediate peer is a trusted proxy → believe the forwarded client IP.
  if (isIpAllowed(peer, rules)) return getClientIp(request);

  // Untrusted direct connection → the peer is the real client.
  return peer;
}
