import http from "node:http";
import { type AddressInfo } from "node:net";
import zlib from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkUrl, FetchBlockedError, isBlockedAddress, safeFetch } from "./fetch";

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.20.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "64:ff9b::a9fe:a9fe",
    "not-an-ip",
  ])("blocks %s", (ip) => expect(isBlockedAddress(ip)).toBe(true));

  it.each(["8.8.8.8", "1.1.1.1", "142.250.200.174", "2606:4700:4700::1111"])("allows %s", (ip) => expect(isBlockedAddress(ip)).toBe(false));
});

describe("checkUrl", () => {
  it("rejects other schemes, credentials, odd ports and internal names", () => {
    for (const bad of ["ftp://example.com", "file:///etc/passwd", "https://user:pw@example.com", "http://example.com:8080", "http://metadata.google.internal/", "nonsense"]) {
      expect(() => checkUrl(bad), bad).toThrow(FetchBlockedError);
    }
  });
  it("accepts ordinary web links", () => {
    expect(checkUrl("https://example.com/page?x=1").hostname).toBe("example.com");
  });
});

it("refuses loopback unless explicitly allowed", async () => {
  const err = await safeFetch("http://127.0.0.1/").catch((e) => e);
  expect(err).toBeInstanceOf(FetchBlockedError);
  expect(err.message).toMatch(/private or internal/);
});

describe("safeFetch against a local test server", () => {
  let server: http.Server;
  let port = 0;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const path = req.url ?? "/";
      if (path === "/hello") return res.end("<h1>Hello</h1>");
      if (path === "/to-metadata") {
        res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
        return res.end();
      }
      if (path.startsWith("/loop")) {
        const n = Number(path.slice(5) || 0);
        res.writeHead(302, { location: `/loop${n + 1}` });
        return res.end();
      }
      if (path === "/big") return res.end("x".repeat(5000));
      if (path === "/gzip") {
        res.writeHead(200, { "content-encoding": "gzip" });
        return res.end(zlib.gzipSync("<p>compressed</p>"));
      }
      if (path === "/slow") return setTimeout(() => res.end("late"), 2000);
      res.statusCode = 404;
      res.end("missing");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  // Route "http://127.0.0.1/..." (port 80, passes checkUrl) to the test server's real port.
  const viaTestServer = <T,>(fn: () => Promise<T>) => {
    const original = http.request;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (http as any).request = (url: URL, opts: http.RequestOptions, cb: (res: http.IncomingMessage) => void) => {
      const u = new URL(url.toString());
      u.port = String(port);
      return original(u, opts, cb);
    };
    return fn().finally(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (http as any).request = original;
    });
  };
  const allow = { allowAddress: (ip: string) => ip === "127.0.0.1" };

  it("fetches a page and reports status, size and timing", async () => {
    const r = await viaTestServer(() => safeFetch("http://127.0.0.1/hello", allow));
    expect(r).toMatchObject({ status: 200, body: "<h1>Hello</h1>", truncated: false });
    expect(r.ms).toBeGreaterThanOrEqual(0);
  });

  it("re-checks every redirect: a hop to cloud metadata is refused", async () => {
    const err = await viaTestServer(() => safeFetch("http://127.0.0.1/to-metadata", allow)).catch((e) => e);
    expect(err).toBeInstanceOf(FetchBlockedError);
    expect(err.message).toMatch(/private or internal/);
  });

  it("stops after 3 redirects", async () => {
    const err = await viaTestServer(() => safeFetch("http://127.0.0.1/loop0", allow)).catch((e) => e);
    expect(err.message).toMatch(/Too many redirects/);
  });

  it("caps the body size", async () => {
    const r = await viaTestServer(() => safeFetch("http://127.0.0.1/big", { ...allow, maxBytes: 1000 }));
    expect(r.truncated).toBe(true);
    expect(r.bytes).toBeLessThanOrEqual(1000);
  });

  it("decompresses gzip", async () => {
    const r = await viaTestServer(() => safeFetch("http://127.0.0.1/gzip", allow));
    expect(r.body).toBe("<p>compressed</p>");
  });

  it("times out slow pages", async () => {
    const err = await viaTestServer(() => safeFetch("http://127.0.0.1/slow", { ...allow, timeoutMs: 300 })).catch((e) => e);
    expect(err.message).toMatch(/too long/);
  });
});
