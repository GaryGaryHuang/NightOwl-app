import assert from "node:assert/strict";
import test from "node:test";

import {
  isAllowedPublicWebFetchAddress,
  normalizeWebFetchAddress
} from "../../src/services/web-fetch-public-address-policy.ts";

test("shared public-address policy allows representative public IPv4 and IPv6 addresses", () => {
  for (const address of [
    "93.184.216.34",
    "8.8.8.8",
    "2001:4860:4860::8888",
    "2606:2800:220:1:248:1893:25c8:1946"
  ]) {
    assert.equal(isAllowedPublicWebFetchAddress(address), true, address);
  }
});

test("shared public-address policy denies representative non-public and reserved IPv4 ranges", () => {
  for (const address of [
    "0.0.0.0",
    "10.0.0.5",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.1.2",
    "172.16.0.1",
    "192.168.1.10",
    "192.0.2.10",
    "198.18.0.10",
    "198.51.100.10",
    "203.0.113.20",
    "224.0.0.1",
    "240.0.0.1"
  ]) {
    assert.equal(isAllowedPublicWebFetchAddress(address), false, address);
  }
});

test("shared public-address policy denies representative non-public and reserved IPv6 ranges", () => {
  for (const address of [
    "::",
    "::1",
    "fc12:3456:789a::1",
    "fd12:3456:789a::1",
    "fe80::1",
    "fec0::1",
    "ff02::1",
    "2001:db8::1"
  ]) {
    assert.equal(isAllowedPublicWebFetchAddress(address), false, address);
  }
});

test("shared public-address policy classifies IPv4-mapped IPv6 by the mapped IPv4 value", () => {
  assert.equal(isAllowedPublicWebFetchAddress("::ffff:93.184.216.34"), true);
  assert.equal(isAllowedPublicWebFetchAddress("::ffff:127.0.0.1"), false);
  assert.equal(isAllowedPublicWebFetchAddress("::ffff:c633:640a"), false);
});

test("shared public-address policy normalizes bracketed addresses before classification", () => {
  assert.equal(normalizeWebFetchAddress("[::1]"), "::1");
  assert.equal(normalizeWebFetchAddress("[::ffff:127.0.0.1]"), "::ffff:127.0.0.1");
});
