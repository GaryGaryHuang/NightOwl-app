export function normalizeHostnameForNetworkChecks(hostname: string): string {
  const lowercaseHostname = hostname.toLowerCase();

  return lowercaseHostname.startsWith("[") && lowercaseHostname.endsWith("]")
    ? lowercaseHostname.slice(1, -1)
    : lowercaseHostname;
}

export function canonicalizeHostnameForComparison(hostname: string): string {
  return normalizeHostnameForNetworkChecks(hostname).replace(/\.$/u, "");
}