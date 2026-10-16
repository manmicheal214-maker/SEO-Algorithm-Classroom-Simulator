import test from "node:test";
import assert from "node:assert/strict";
import { isBlockedIp } from "./ip.js";

test("blocks IPv4 special-use and non-global ranges", () => {
  for (const ip of [
    "224.0.0.1", "239.255.255.250", "240.0.0.1", "255.255.255.255",
    "192.0.0.1", "192.0.2.1", "198.51.100.1", "203.0.113.1", "192.88.99.1",
    "0.1.2.3", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254",
    "172.16.0.1", "192.168.1.1", "198.18.0.1", "not-an-ip"
  ]) assert.equal(isBlockedIp(ip), true, ip);
});

test("normalizes IPv4-mapped IPv6, NAT64 and 6to4 embedded IPv4", () => {
  for (const ip of [
    "::ffff:10.0.0.1", "::ffff:a00:1", "::ffff:169.254.169.254",
    "::ffff:a9fe:a9fe", "::ffff:192.168.1.1", "::ffff:7f00:1",
    "64:ff9b::7f00:1", "64:ff9b::a9fe:a9fe",
    "2002:7f00:1::1", "2002:a9fe:a9fe::1"
  ]) assert.equal(isBlockedIp(ip), true, ip);
});

test("blocks IPv6 non-global and special-use ranges", () => {
  for (const ip of ["::", "::1", "fc00::1", "fd12::1", "fe80::1", "fec0::1", "ff02::1", "2001:db8::1"]) {
    assert.equal(isBlockedIp(ip), true, ip);
  }
  assert.equal(isBlockedIp("2001:4860:4860::8888"), false);
  assert.equal(isBlockedIp("8.8.8.8"), false);
});
