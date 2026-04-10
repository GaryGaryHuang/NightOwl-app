import assert from "node:assert/strict";
import test from "node:test";

import {
  isAllowedPublicWebFetchAddress
} from "../../src/services/web-fetch-public-address-policy.ts";

function assertAddressClassification(
  addresses: readonly string[],
  expected: boolean
): void {
  for (const address of addresses) {
    assert.equal(isAllowedPublicWebFetchAddress(address), expected, address);
  }
}

test("shared public-address policy allows representative public IPv4 and IPv6 addresses", () => {
  assertAddressClassification([
    "93.184.216.34",
    "8.8.8.8",
    "2001:4860:4860::8888",
    "2606:2800:220:1:248:1893:25c8:1946"
  ], true);
});

test("shared public-address policy denies representative non-public and reserved addresses across IPv4 and IPv6 ranges", () => {
  const deniedAddressGroups = [
    {
      label: "ipv4 private and loopback ranges",
      addresses: [
        "0.0.0.0",
        "10.0.0.5",
        "127.0.0.1",
        "169.254.1.2",
        "172.16.0.1",
        "192.168.1.10"
      ]
    },
    {
      label: "ipv4 reserved and special-use ranges",
      addresses: [
        "100.64.0.1",
        "192.0.2.10",
        "198.18.0.10",
        "198.51.100.10",
        "203.0.113.20",
        "224.0.0.1",
        "240.0.0.1"
      ]
    },
    {
      label: "ipv6 loopback unique-local link-local multicast and documentation ranges",
      addresses: [
        "::",
        "::1",
        "fc12:3456:789a::1",
        "fd12:3456:789a::1",
        "fe80::1",
        "fec0::1",
        "ff02::1",
        "2001:db8::1"
      ]
    }
  ] as const;

  for (const group of deniedAddressGroups) {
    assertAddressClassification(group.addresses, false);
  }
});

test("shared public-address policy classifies IPv4-mapped IPv6 by the mapped IPv4 value", () => {
  const cases = [
    {
      address: "::ffff:93.184.216.34",
      expected: true
    },
    {
      address: "::ffff:127.0.0.1",
      expected: false
    },
    {
      address: "::ffff:c633:640a",
      expected: false
    }
  ] as const;

  for (const testCase of cases) {
    assert.equal(
      isAllowedPublicWebFetchAddress(testCase.address),
      testCase.expected,
      testCase.address
    );
  }
});

