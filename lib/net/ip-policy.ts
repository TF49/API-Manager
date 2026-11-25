import { BlockList, isIP } from 'node:net';

/**
 * Decides whether an IP address is a public, routable destination the server may call.
 * Used to stop SSRF: a stored site base_url must not make the server reach loopback,
 * the LAN, link-local cloud metadata (169.254.169.254) or other reserved ranges.
 */

const blocked = new BlockList();

// IPv4 special-purpose ranges (RFC 6890 and friends)
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4');
}

// IPv6 special-purpose ranges
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96], // NAT64 can reach internal IPv4
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23], // Teredo, benchmarking, ORCHID etc.
  ['2001:db8::', 32],
  ['2002::', 16], // 6to4 embeds IPv4
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // deprecated site-local
  ['ff00::', 8], // multicast
] as const) {
  blocked.addSubnet(net, prefix, 'ipv6');
}

/** Extracts the IPv4 part of an IPv4-mapped / IPv4-compatible IPv6 address, if any. */
function embeddedIPv4(ip: string): string | null {
  const lower = ip.toLowerCase();
  const dotted = lower.match(/^(?:::ffff:|::)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return dotted[1];
  const hex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return null;
}

export function isPublicIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return !blocked.check(ip, 'ipv4');
  if (family === 6) {
    const v4 = embeddedIPv4(ip);
    if (v4) return isPublicIp(v4);
    // Any other address inside ::ffff:0:0/96 is mapped IPv4 we couldn't parse: reject.
    if (/^::ffff:/i.test(ip)) return false;
    return !blocked.check(ip, 'ipv6');
  }
  return false;
}

/**
 * Hosts explicitly exempted from the private-address check, e.g. a relay you run on the
 * same machine. Comma-separated hostnames or IPs in SSRF_ALLOWED_HOSTS.
 */
export function allowedPrivateHosts(raw = process.env.SSRF_ALLOWED_HOSTS): Set<string> {
  return new Set(
    (raw || '')
      .split(',')
      .map((h) => h.trim().toLowerCase().replace(/^\[|\]$/g, ''))
      .filter(Boolean)
  );
}

/**
 * CIDR ranges exempted from the check, comma-separated in SSRF_ALLOWED_CIDRS.
 * Default outside production: 198.18.0.0/15, the "fake-ip" range used by local proxy tools
 * (Clash, Surge...) which resolve every domain into it. Production default: nothing.
 */
export function buildAllowedCidrs(
  raw = process.env.SSRF_ALLOWED_CIDRS,
  isProd = process.env.NODE_ENV === 'production'
): BlockList {
  const list = new BlockList();
  const spec = raw ?? (isProd ? '' : '198.18.0.0/15');
  for (const part of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [net, prefixRaw] = part.split('/');
    const family = isIP(net);
    const prefix = Number(prefixRaw);
    if (!family || !Number.isInteger(prefix)) {
      throw new Error(`SSRF_ALLOWED_CIDRS 中的 "${part}" 不是合法的 CIDR`);
    }
    list.addSubnet(net, prefix, family === 4 ? 'ipv4' : 'ipv6');
  }
  return list;
}

let allowedCidrs: BlockList | null = null;

/** Public address, or inside an explicitly allowed CIDR. */
export function isAllowedDestination(ip: string): boolean {
  if (isPublicIp(ip)) return true;
  allowedCidrs ??= buildAllowedCidrs();
  const family = isIP(ip);
  return family !== 0 && allowedCidrs.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}
