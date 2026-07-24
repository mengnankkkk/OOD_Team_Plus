import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_REDIRECTS = 3;

export function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/u, "");
  return normalized === "localhost" || normalized.endsWith(".localhost") || normalized === "metadata.google.internal" || normalized.endsWith(".internal") || normalized.endsWith(".local");
}

export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [first, second, third] = address.split(".").map(Number);
    return first === 0 || first === 10 || first === 127 || first >= 224
      || (first === 100 && second >= 64 && second <= 127)
      || (first === 169 && second === 254)
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168)
      || (first === 192 && second === 0 && (third === 0 || third === 2))
      || (first === 198 && (second === 18 || second === 19 || (second === 51 && third === 100)))
      || (first === 203 && second === 0 && third === 113);
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith("::ffff:")) return isPrivateAddress(normalized.slice(7));
    return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd")
      || /^fe[89ab]/u.test(normalized) || normalized.startsWith("ff") || normalized.startsWith("2001:db8:");
  }
  return true;
}

export async function assertPublicHttpUrl(value: string): Promise<URL> {
  const url = new URL(value);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) throw new Error("Only public HTTP(S) URLs are allowed");
  if (url.port && url.port !== "80" && url.port !== "443") throw new Error("Only ports 80 and 443 are allowed");
  const hostname = url.hostname.replace(/^\[|\]$/gu, "");
  if (isBlockedHostname(hostname)) throw new Error("Hostname is not public");
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error("IP address is not public");
    return url;
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) throw new Error("Hostname resolves to a non-public address");
  return url;
}

export async function fetchPublicHttpUrl(value: string, init: RequestInit = {}): Promise<Response> {
  let current = await assertPublicHttpUrl(value);
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetch(current, { ...init, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location || redirectCount === MAX_REDIRECTS) throw new Error("Unsafe or excessive redirect");
    current = await assertPublicHttpUrl(new URL(location, current).toString());
  }
  throw new Error("Too many redirects");
}
