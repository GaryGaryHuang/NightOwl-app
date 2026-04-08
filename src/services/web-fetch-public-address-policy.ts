import { isIP } from "node:net";

export interface WebFetchPublicAddressPolicy {
  isAllowed(address: string): boolean;
}

export class DefaultWebFetchPublicAddressPolicy
  implements WebFetchPublicAddressPolicy {
  isAllowed(address: string): boolean {
    return isAllowedPublicWebFetchAddress(address);
  }
}

export function isAllowedPublicWebFetchAddress(address: string): boolean {
  const normalizedAddress = normalizeWebFetchAddress(address);
  const ipVersion = isIP(normalizedAddress);

  if (ipVersion === 4) {
    return !isDisallowedWebFetchIpv4(normalizedAddress);
  }

  if (ipVersion === 6) {
    return !isDisallowedWebFetchIpv6(normalizedAddress);
  }

  return false;
}

export function normalizeWebFetchAddress(address: string): string {
  const lowercaseAddress = address.toLowerCase();

  return lowercaseAddress.startsWith("[") && lowercaseAddress.endsWith("]")
    ? lowercaseAddress.slice(1, -1)
    : lowercaseAddress;
}

function extractMappedIpv4(address: string): string | undefined {
  if (!address.startsWith("::ffff:")) {
    return undefined;
  }

  const suffix = address.slice("::ffff:".length);

  if (isIP(suffix) === 4) {
    return suffix;
  }

  const segments = suffix.split(":");

  if (segments.length !== 2) {
    return undefined;
  }

  const values = segments.map((segment) => Number.parseInt(segment, 16));

  if (
    values.some(
      (value) => Number.isNaN(value) || value < 0 || value > 0xffff
    )
  ) {
    return undefined;
  }

  return [
    values[0] >> 8,
    values[0] & 0xff,
    values[1] >> 8,
    values[1] & 0xff
  ].join(".");
}

function isDisallowedWebFetchIpv4(address: string): boolean {
  const octets = address.split(".").map((value) => Number.parseInt(value, 10));

  if (octets.length !== 4 || octets.some((value) => Number.isNaN(value))) {
    return true;
  }

  if (octets[0] === 0 || octets[0] === 10 || octets[0] === 127) {
    return true;
  }

  if (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) {
    return true;
  }

  if (octets[0] === 169 && octets[1] === 254) {
    return true;
  }

  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
    return true;
  }

  if (octets[0] === 192) {
    if (octets[1] === 168) {
      return true;
    }

    if (octets[1] === 0 && octets[2] === 2) {
      return true;
    }
  }

  if (octets[0] === 198) {
    if (octets[1] >= 18 && octets[1] <= 19) {
      return true;
    }

    if (octets[1] === 51 && octets[2] === 100) {
      return true;
    }
  }

  if (octets[0] === 203 && octets[1] === 0 && octets[2] === 113) {
    return true;
  }

  if (octets[0] >= 224) {
    return true;
  }

  return false;
}

function isDisallowedWebFetchIpv6(address: string): boolean {
  const mappedIpv4 = extractMappedIpv4(address);

  if (mappedIpv4) {
    return isDisallowedWebFetchIpv4(mappedIpv4);
  }

  return (
    address === "::" ||
    address === "::1" ||
    address.startsWith("fc") ||
    address.startsWith("fd") ||
    /^fe[89ab]/u.test(address) ||
    /^fe[cdef]/u.test(address) ||
    address.startsWith("ff") ||
    /^2001:0?db8:/u.test(address)
  );
}
