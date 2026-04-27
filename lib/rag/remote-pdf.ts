import dns from "node:dns/promises";
import net from "node:net";

const MAX_REDIRECTS = 5;
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
]);

export async function fetchRemotePdf(
  input: string,
): Promise<{ buffer: Uint8Array; finalUrl: string }> {
  let current = normalizeUrl(input);

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    await assertSafeUrl(current);

    const res = await fetch(current, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
      headers: {
        accept: "application/pdf,application/octet-stream;q=0.9,*/*;q=0.1",
        "user-agent": "rag-challenge-ingest/1.0",
      },
    });

    if (isRedirect(res.status)) {
      const location = res.headers.get("location");
      if (!location) {
        throw new Error(`Redirect from ${current} did not include a Location header.`);
      }
      current = new URL(location, current).toString();
      continue;
    }

    if (!res.ok) {
      throw new Error(`Failed to fetch ${current}: ${res.status}`);
    }

    const contentLength = Number(res.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > 25 * 1024 * 1024) {
      throw new Error(`File too large (${contentLength} bytes). Max is ${25 * 1024 * 1024}.`);
    }

    const buffer = new Uint8Array(await res.arrayBuffer());
    if (!looksLikePdf(buffer)) {
      throw new Error("The fetched file does not look like a valid PDF.");
    }

    return { buffer, finalUrl: current };
  }

  throw new Error(`Too many redirects while fetching ${input}.`);
}

function normalizeUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Invalid URL.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only http:// and https:// URLs are allowed.");
  }
  if (!url.hostname) {
    throw new Error("URL must include a hostname.");
  }
  if (url.username || url.password) {
    throw new Error("Embedded credentials are not allowed in URLs.");
  }

  return url.toString();
}

async function assertSafeUrl(input: string) {
  const url = new URL(input);
  const hostname = url.hostname.toLowerCase();

  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error("That URL points to a private or reserved host and cannot be fetched.");
  }

  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error("That URL points to a private or reserved IP address and cannot be fetched.");
    }
    return;
  }

  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  if (records.length === 0) {
    throw new Error(`Could not resolve ${hostname}.`);
  }

  for (const record of records) {
    if (isPrivateIp(record.address)) {
      throw new Error("That URL resolves to a private or reserved IP address and cannot be fetched.");
    }
  }
}

function isRedirect(status: number) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function looksLikePdf(buffer: Uint8Array) {
  if (buffer.byteLength < 5) return false;
  return (
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46 &&
    buffer[4] === 0x2d
  );
}

function isPrivateIp(address: string) {
  if (net.isIPv4(address)) {
    const parts = address.split(".").map(Number);
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }

  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:") ||
      normalized.startsWith("::ffff:127.") ||
      normalized.startsWith("::ffff:10.") ||
      normalized.startsWith("::ffff:192.168.") ||
      /^::ffff:172\.(1[6-9]|2\d|3[0-1])\./.test(normalized) ||
      normalized.startsWith("::ffff:169.254.")
    );
  }

  return true;
}

export const __internal = {
  isPrivateIp,
  looksLikePdf,
  normalizeUrl,
};
