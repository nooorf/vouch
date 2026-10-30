import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import zlib from "node:zlib";

/**
 * Fetching URLs that people submit is a classic SSRF risk: a "delivery" could point at our own
 * server, a private network or a cloud metadata endpoint. Every request here:
 * - allows only http/https on ports 80/443, no credentials in the URL;
 * - resolves DNS itself, refuses private/loopback/link-local/metadata/reserved addresses, and
 *   connects to exactly the address it checked (no DNS-rebinding window);
 * - follows at most 3 redirects, re-checking each hop;
 * - caps time (10 s) and size (2 MB after decompression), and sends no cookies.
 */

export class FetchBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetchBlockedError";
  }
}

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
  ["100::", 64],
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

/** The IPv4 address hidden inside an IPv6 one (::ffff:a.b.c.d, ::a.b.c.d, NAT64 64:ff9b::/96), if any. */
function embeddedIPv4(ip: string): string | null {
  const lower = ip.toLowerCase();
  const dotted = lower.match(/^(?:::ffff:|::|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1];
  const hex = lower.match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const a = parseInt(hex[1], 16);
    const b = parseInt(hex[2], 16);
    return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
  }
  return null;
}

export function isBlockedAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return blocked.check(ip, "ipv4");
  if (v === 6) {
    const inner = embeddedIPv4(ip);
    if (inner) return blocked.check(inner, "ipv4");
    return blocked.check(ip, "ipv6");
  }
  return true; // not an IP at all
}

export interface FetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  method?: "GET" | "HEAD";
  /** Tests and local dev only: allow specific addresses that would otherwise be blocked. */
  allowAddress?: (ip: string) => boolean;
  /** Local dev only: allow non-standard ports (e.g. localhost:3000). */
  allowAnyPort?: boolean;
}

export interface FetchResult {
  url: string;
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  bytes: number;
  truncated: boolean;
  ms: number;
  redirects: string[];
}

/** Validate a URL people submit. Throws FetchBlockedError with a reason a person can act on. */
export function checkUrl(raw: string, opts: { allowAnyPort?: boolean } = {}): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new FetchBlockedError("That isn't a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new FetchBlockedError("Only http and https links can be checked.");
  if (url.username || url.password) throw new FetchBlockedError("Links with a username or password can't be checked.");
  if (url.port && url.port !== "80" && url.port !== "443" && !opts.allowAnyPort) throw new FetchBlockedError("Only the standard web ports (80 and 443) can be checked.");
  if (!url.hostname || url.hostname.endsWith(".internal") || url.hostname.endsWith(".local")) {
    throw new FetchBlockedError("That address can't be checked.");
  }
  // "localhost" and IP literals pass here; resolveSafe() refuses them unless explicitly allowed.
  return url;
}

async function resolveSafe(hostname: string, allow?: (ip: string) => boolean): Promise<{ address: string; family: 4 | 6 }> {
  const bare = hostname.replace(/^\[|\]$/g, "");
  const literal = isIP(bare);
  const candidates = literal ? [{ address: bare, family: literal as 4 | 6 }] : ((await dnsLookup(bare, { all: true, verbatim: true })) as { address: string; family: 4 | 6 }[]);
  if (!candidates.length) throw new FetchBlockedError(`Couldn't find ${hostname}.`);
  // Every address must be public: a hostname resolving to both public and private is refused.
  for (const c of candidates) {
    if (isBlockedAddress(c.address) && !allow?.(c.address)) {
      throw new FetchBlockedError("That link points to a private or internal address, so it can't be checked.");
    }
  }
  return candidates[0];
}

function decoder(encoding: string | undefined) {
  switch ((encoding ?? "").toLowerCase()) {
    case "gzip":
    case "x-gzip":
      return zlib.createGunzip();
    case "deflate":
      return zlib.createInflate();
    case "br":
      return zlib.createBrotliDecompress();
    default:
      return null;
  }
}

function pinnedLookup(pinned: { address: string; family: 4 | 6 }): LookupFunction {
  return (_host, options, cb) => {
    if ((options as { all?: boolean }).all) {
      (cb as unknown as (err: null, addresses: { address: string; family: number }[]) => void)(null, [{ address: pinned.address, family: pinned.family }]);
    } else {
      cb(null, pinned.address, pinned.family);
    }
  };
}

function requestOnce(url: URL, pinned: { address: string; family: 4 | 6 }, opts: Required<Pick<FetchOptions, "maxBytes" | "method">>, deadline: number) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer; truncated: boolean }>((resolve, reject) => {
    const mod = url.protocol === "https:" ? https : http;
    const remaining = Math.max(1, deadline - Date.now());
    const req = mod.request(
      url,
      {
        method: opts.method,
        agent: false,
        timeout: remaining,
        headers: {
          "user-agent": "VouchReferee/1.0 (checks freelance deliveries; +https://github.com)",
          accept: "text/html,application/xhtml+xml,text/css,*/*;q=0.8",
          "accept-encoding": "gzip, deflate, br",
        },
        // Connect to the address we validated, whatever DNS says now.
        lookup: pinnedLookup(pinned),
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        const dec = opts.method === "HEAD" ? null : decoder(res.headers["content-encoding"] as string | undefined);
        const stream = dec ? res.pipe(dec) : res;
        const timer = setTimeout(() => {
          req.destroy(new Error("timeout"));
        }, Math.max(1, deadline - Date.now()));
        stream.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > opts.maxBytes) {
            truncated = true;
            chunks.push(chunk.subarray(0, Math.max(0, opts.maxBytes - (size - chunk.length))));
            res.destroy();
            stream.emit("end");
            return;
          }
          chunks.push(chunk);
        });
        stream.once("end", () => {
          clearTimeout(timer);
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks), truncated });
        });
        stream.once("error", (err) => {
          clearTimeout(timer);
          if (truncated) resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks), truncated });
          else reject(err);
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

export async function safeFetch(raw: string, options: FetchOptions = {}): Promise<FetchResult> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  const maxRedirects = options.maxRedirects ?? 3;
  const method = options.method ?? "GET";
  const started = Date.now();
  const deadline = started + timeoutMs;
  const redirects: string[] = [];

  let url = checkUrl(raw, options);
  for (;;) {
    const pinned = await resolveSafe(url.hostname, options.allowAddress);
    let res;
    try {
      res = await requestOnce(url, pinned, { maxBytes, method }, deadline);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new FetchBlockedError(msg === "timeout" || Date.now() >= deadline ? "The page took too long to respond." : `Couldn't load the page (${msg}).`);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      if (redirects.length >= maxRedirects) throw new FetchBlockedError("Too many redirects.");
      const next = new URL(String(res.headers.location), url);
      redirects.push(next.toString());
      url = checkUrl(next.toString(), options);
      continue;
    }
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(", ") : String(v);
    return {
      url: raw,
      finalUrl: url.toString(),
      status: res.status,
      headers,
      body: res.body.toString("utf8"),
      bytes: res.body.length,
      truncated: res.truncated,
      ms: Date.now() - started,
      redirects,
    };
  }
}
