import net from "node:net";

function ipv4Number(ip) {
  if (!net.isIPv4(ip)) return null;
  return ip.split(".").reduce((n, part) => ((n * 256) + Number(part)) >>> 0, 0);
}
function inV4(ip, base, bits) {
  const value = ipv4Number(ip), network = ipv4Number(base);
  if (value === null || network === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (network & mask);
}
function ipv6Number(ip) {
  if (!net.isIPv6(ip)) return null;
  let s = ip.toLowerCase();
  if (s.includes(".")) {
    const last = s.slice(s.lastIndexOf(":") + 1);
    const v4 = ipv4Number(last);
    if (v4 === null) return null;
    s = s.slice(0, s.lastIndexOf(":")) + ":" + ((v4 >>> 16).toString(16)) + ":" + (v4 & 0xffff).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const words = [...left, ...Array(missing).fill("0"), ...right];
  if (words.length !== 8 || words.some(w => !/^[0-9a-f]{1,4}$/.test(w))) return null;
  return words.reduce((n, w) => (n << 16n) | BigInt(parseInt(w, 16)), 0n);
}
function inV6(ip, base, bits) {
  const value = ipv6Number(ip), network = ipv6Number(base);
  if (value === null || network === null) return false;
  const shift = BigInt(128 - bits);
  return (value >> shift) === (network >> shift);
}

const blockedV4 = [
  ["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],
  ["169.254.0.0",16],["172.16.0.0",12],["192.0.0.0",24],["192.0.2.0",24],
  ["192.88.99.0",24],["192.168.0.0",16],["198.18.0.0",15],["198.51.100.0",24],
  ["203.0.113.0",24],["224.0.0.0",4],["240.0.0.0",4]
];
const blockedV6 = [
  ["::",128],["::1",128],["fc00::",7],["fe80::",10],["fec0::",10],
  ["ff00::",8],["2001:db8::",32]
];

/** Returns true unless the input is a parseable globally routable address. */
export function isBlockedIp(ip) {
  if (typeof ip !== "string") return true;
  const value = ip.trim();
  if (net.isIPv4(value)) return blockedV4.some(([base,bits]) => inV4(value,base,bits));
  if (!net.isIPv6(value)) return true;
  // Normalize IPv4-embedded transition formats and re-apply IPv4 policy.
  if (inV6(value,"::ffff:0:0",96)) {
    const n = ipv6Number(value);
    const embedded = Number(n & 0xffffffffn);
    return isBlockedIp([embedded >>> 24,(embedded >>> 16)&255,(embedded >>> 8)&255,embedded&255].join("."));
  }
  if (inV6(value,"64:ff9b::",96)) {
    const n = ipv6Number(value);
    const embedded = Number(n & 0xffffffffn);
    return isBlockedIp([embedded >>> 24,(embedded >>> 16)&255,(embedded >>> 8)&255,embedded&255].join("."));
  }
  if (inV6(value,"2002::",16)) {
    const n = ipv6Number(value);
    const embedded = Number((n >> 80n) & 0xffffffffn);
    return isBlockedIp([embedded >>> 24,(embedded >>> 16)&255,(embedded >>> 8)&255,embedded&255].join("."));
  }
  return blockedV6.some(([base,bits]) => inV6(value,base,bits));
}
