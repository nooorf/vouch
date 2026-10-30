import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { blobUrl, isSourcePath, readTar, unpackRepoArchive } from "./repo-snapshot";

/** A minimal tar writer for tests: ustar headers, optional pax "path" records. */
function tar(entries: { name: string; data?: string | Buffer; type?: string; pax?: string }[]): Buffer {
  const blocks: Buffer[] = [];
  const header = (name: string, size: number, type: string) => {
    const h = Buffer.alloc(512);
    h.write(name.slice(0, 100), 0);
    h.write("0000644\0", 100);
    h.write(size.toString(8).padStart(11, "0") + "\0", 124);
    h.write(type, 156);
    h.write("ustar\0" + "00", 257);
    return h;
  };
  const body = (data: Buffer) => Buffer.concat([data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
  for (const e of entries) {
    if (e.pax) {
      const rec = ` path=${e.pax}\n`;
      let len = rec.length + 2;
      len = `${len}${rec}`.length;
      const pax = Buffer.from(`${len}${rec}`);
      blocks.push(header("PaxHeader", pax.length, "x"), body(pax));
    }
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data ?? "");
    blocks.push(header(e.name, data.length, e.type ?? "0"), body(data));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

describe("readTar", () => {
  it("reads files, long pax paths, and skips directories and global headers", () => {
    const longPath = `repo-abc/${"deep/".repeat(30)}file.ts`;
    const archive = tar([
      { name: "pax_global_header", type: "g", data: "52 comment=0010bbea06781f11797c71a3497e7e0c1beff702\n" },
      { name: "repo-abc/", type: "5" },
      { name: "repo-abc/index.html", data: "<h1>Hi</h1>" },
      { name: "ignored-short-name", pax: longPath, data: "export const x = 1;" },
    ]);
    const seen: Record<string, string> = {};
    const { comment } = readTar(archive, (p, d) => (seen[p] = d.toString()));
    expect(seen).toEqual({ "repo-abc/index.html": "<h1>Hi</h1>", [longPath]: "export const x = 1;" });
    expect(comment).toBe("0010bbea06781f11797c71a3497e7e0c1beff702"); // the commit the archive came from
  });
});

describe("unpackRepoArchive", () => {
  it("keeps the freelancer's text source and skips dependencies, builds, lockfiles and binaries", () => {
    const gz = gzipSync(
      tar([
        { name: "site-1a2b/README.md", data: "# Site\nRun npm start." },
        { name: "site-1a2b/src/form.js", data: "function send() {\n  return true;\n}\n" },
        { name: "site-1a2b/node_modules/lib/index.js", data: "module.exports = 1" },
        { name: "site-1a2b/dist/app.js", data: "minified" },
        { name: "site-1a2b/package-lock.json", data: "{}" },
        { name: "site-1a2b/logo.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
        { name: "site-1a2b/data.bin", data: Buffer.from([1, 0, 2, 0]) },
      ]),
    );
    const { files, skipped } = unpackRepoArchive(gz);
    expect(files.map((f) => f.path)).toEqual(["README.md", "src/form.js"]);
    expect(files[1].lines).toBe(4);
    expect(skipped).toBe(5);
  });

  it("recognises source paths", () => {
    expect(isSourcePath("src/App.tsx")).toBe(true);
    expect(isSourcePath("packages/ui/node_modules/x.js")).toBe(false);
    expect(isSourcePath("public/app.min.js")).toBe(false);
    expect(isSourcePath(".next/server/page.js")).toBe(false);
  });

  it("links to lines at the judged commit", () => {
    expect(blobUrl({ owner: "o", repo: "r", sha: "abc" }, "src/my file.js", 3, 7)).toBe("https://github.com/o/r/blob/abc/src/my%20file.js#L3-L7");
    expect(blobUrl({ owner: "o", repo: "r", sha: "abc" }, "a.js", 3, 3)).toBe("https://github.com/o/r/blob/abc/a.js#L3");
  });
});
