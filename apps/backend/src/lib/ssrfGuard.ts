// src/lib/ssrfGuard.ts
//
// Blocks the crawler from being used as a pivot into internal/private
// infrastructure. An "operator submits a URL, server fetches it" tool is a
// classic SSRF vector — someone (or a redirect on a page we were told to
// crawl) points us at http://169.254.169.254/, http://localhost:5432/, an
// internal admin panel, etc. This is the one thing standing between a
// crawl request and the rest of this deployment's network, so every
// outbound request the crawler makes (page fetch, image fetch, robots.txt
// fetch, and every sub-request a rendered page's browser context makes)
// must go through guardUrl() first — including after each redirect hop,
// since the ORIGINAL url can be public while a redirect target isn't.
//
// Pure logic only (net/dns are Node core modules, no third-party deps),
// so this file is unit-testable in isolation from the rest of the crawler.

import { isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";

export interface GuardResult {
  ok: boolean;
  reason?: string;
  addresses?: string[];
}

// IPv4 ranges that must never be reachable from an outbound crawl request:
// loopback, "this network", link-local (incl. the 169.254.169.254 cloud
// metadata endpoint), private RFC1918 blocks, carrier-grade NAT, documentation
// ranges, multicast, and reserved/future-use space.
const V4_BLOCKED_RANGES: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
  ["255.255.255.255", 32],
];

function v4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

export function isPublicIPv4(ip: string): boolean {
  if (isIP(ip) !== 4) return false;
  const n = v4ToInt(ip);
  for (const [base, bits] of V4_BLOCKED_RANGES) {
    const baseInt = v4ToInt(base);
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((n & mask) === (baseInt & mask)) return false;
  }
  return true;
}

// IPv6: unwrap IPv4-mapped (::ffff:a.b.c.d), then block loopback (::1),
// unspecified (::), unique-local (fc00::/7), and link-local (fe80::/10).
export function isPublicIPv6(ip: string): boolean {
  if (isIP(ip) !== 6) return false;
  const lower = ip.toLowerCase();

  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicIPv4(mapped[1]);

  if (lower === "::1" || lower === "::") return false;

  // Expand to compare the first hextet cheaply without a full parser.
  const first = lower.split("::")[0].split(":")[0] || "0";
  const firstVal = parseInt(first || "0", 16);

  // fc00::/7  => first hextet 0xfc00-0xfdff
  if (firstVal >= 0xfc00 && firstVal <= 0xfdff) return false;
  // fe80::/10 (link-local) => first hextet 0xfe80-0xfebf
  if (firstVal >= 0xfe80 && firstVal <= 0xfebf) return false;

  return true;
}

export function isPublicIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPublicIPv4(ip);
  if (v === 6) return isPublicIPv6(ip);
  return false;
}

const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost.localdomain", "metadata.google.internal"]);

/**
 * Validates a URL is http(s), has no embedded credentials, and resolves
 * (via real DNS) to only public IP addresses. Throws with a human-readable
 * reason on any violation — callers should catch and surface `.message`.
 *
 * Note: this is a best-effort check performed once before connecting, not
 * a socket-level guarantee — a DNS answer could theoretically change
 * between this check and the actual fetch (DNS rebinding). That gap is a
 * known, documented limitation of doing SSRF protection without a custom
 * dispatcher/agent that pins the resolved IP; acceptable for this tool's
 * threat model (opportunistic SSRF via operator-submitted URLs), not a
 * hardened guarantee against an adversarial DNS operator racing us.
 */
export async function guardUrl(rawUrl: string): Promise<GuardResult> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "Not a valid URL" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: `Protocol "${parsed.protocol}" is not allowed — only http/https` };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: "URLs with embedded credentials are not allowed" };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { ok: false, reason: `Host "${hostname}" is blocked` };
  }

  // Literal IP in the URL — check it directly, no DNS involved.
  if (isIP(hostname)) {
    if (!isPublicIp(hostname)) {
      return { ok: false, reason: `IP address ${hostname} is not a routable public address` };
    }
    return { ok: true, addresses: [hostname] };
  }

  let records: { address: string }[];
  try {
    records = await dnsLookup(hostname, { all: true, verbatim: true });
  } catch (err: any) {
    return { ok: false, reason: `DNS lookup failed for ${hostname}: ${err.message ?? String(err)}` };
  }
  if (records.length === 0) {
    return { ok: false, reason: `DNS lookup returned no addresses for ${hostname}` };
  }

  const bad = records.find((r) => !isPublicIp(r.address));
  if (bad) {
    return { ok: false, reason: `Host "${hostname}" resolves to a non-public address (${bad.address}) — blocked` };
  }

  return { ok: true, addresses: records.map((r) => r.address) };
}