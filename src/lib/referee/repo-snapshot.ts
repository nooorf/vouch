import { gunzipSync } from "node:zlib";
import { parseRepoUrl } from "./github";

/**
 * A delivered GitHub repository, read at one pinned commit, so evidence like "src/form.js lines
 * 12-18" always points at the code that was judged, even after later pushes.
 *
 * No API calls: the code comes as a single archive of the default branch from GitHub's download
 * host, which isn't subject to the API's rate limit (60 requests an hour without a token). git
 * writes the exact commit ID into the archive, which is how the snapshot is pinned. The archive is
 * unpacked in memory; only text source files are kept (dependencies, build output, lockfiles,
 * binaries and huge files are skipped).
 */

export interface RepoFile {
  path: string;
  text: string;
  lines: number;
}

export interface RepoSnapshot {
  owner: string;
  repo: string;
  /** Full commit SHA the files come from. */
  sha: string;
  /** Always the repository's default branch (what GitHub serves as HEAD). */
  branch: string;
  files: RepoFile[];
  /** Files left out (dependencies, binaries, too big…), for the report. */
  skipped: number;
}

export type SnapshotOutcome = ({ ok: true } & RepoSnapshot) | { ok: false; error: string };

const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_FILE_BYTES = 200 * 1024;
const MAX_FILES = 5000;

/** Paths that are never the freelancer's own source: dependencies, build output, tooling caches. */
const IGNORED_DIR = /(^|\/)(node_modules|bower_components|vendor|dist|build|out|\.next|\.nuxt|\.svelte-kit|coverage|\.git|\.cache|__pycache__|\.venv|venv|target|\.idea|\.vscode)\//;
const IGNORED_FILE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|composer\.lock|Gemfile\.lock|go\.sum)$|\.(min\.(js|css)|map)$/i;
const BINARY_EXT = /\.(png|jpe?g|gif|webp|avif|ico|bmp|tiff?|svgz|mp[34]|mov|webm|ogg|wav|flac|pdf|zip|gz|tgz|rar|7z|woff2?|ttf|otf|eot|exe|dll|so|dylib|class|jar|wasm|psd|ai|sketch|fig)$/i;

export function isSourcePath(path: string): boolean {
  return !IGNORED_DIR.test(path) && !IGNORED_FILE.test(path) && !BINARY_EXT.test(path);
}

/* ---------------- tar ---------------- */

const readString = (buf: Buffer, start: number, len: number) => {
  const end = buf.indexOf(0, start);
  return buf.toString("utf8", start, end === -1 || end > start + len ? start + len : end);
};
const readOctal = (buf: Buffer, start: number, len: number) => parseInt(readString(buf, start, len).trim() || "0", 8);

/** Pax extended header records: "<len> key=value\n". We only need "path". */
function paxPath(body: Buffer): string | null {
  let i = 0;
  while (i < body.length) {
    const space = body.indexOf(0x20, i);
    if (space === -1) break;
    const len = parseInt(body.toString("utf8", i, space), 10);
    if (!len) break;
    const record = body.toString("utf8", space + 1, i + len - 1);
    const eq = record.indexOf("=");
    if (record.slice(0, eq) === "path") return record.slice(eq + 1);
    i += len;
  }
  return null;
}

/**
 * Regular files in a tar archive (ustar, with pax and GNU long names, as GitHub produces).
 * Calls `onFile` with the path and contents; returns nothing else.
 */
export function readTar(tar: Buffer, onFile: (path: string, data: Buffer) => void): { comment: string | null } {
  let comment: string | null = null;
  let offset = 0;
  let longName: string | null = null;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break; // end of archive
    const size = readOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 0x30);
    const body = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;

    if (type === "x") {
      longName = paxPath(body) ?? longName;
      continue;
    }
    if (type === "L") {
      longName = readString(body, 0, body.length);
      continue;
    }
    if (type === "g") {
      // git archive's global header: "comment=<commit sha>".
      comment = /(?:^|\n)\d+ comment=([0-9a-f]{40})\n/.exec(body.toString("utf8"))?.[1] ?? comment;
      continue;
    }
    const prefix = readString(header, 345, 155);
    const name = longName ?? (prefix ? `${prefix}/${readString(header, 0, 100)}` : readString(header, 0, 100));
    longName = null;
    if (type === "0" || type === "\0") onFile(name, body);
  }
  return { comment };
}

/** Unpack a GitHub archive: drop its top-level "<repo>-<sha>/" folder, keep text source files. */
export function unpackRepoArchive(gz: Buffer): { files: RepoFile[]; skipped: number; sha: string | null } {
  const tar = gunzipSync(gz);
  const files: RepoFile[] = [];
  let skipped = 0;
  const { comment } = readTar(tar, (rawPath, data) => {
    const path = rawPath.split("/").slice(1).join("/");
    if (!path) return;
    if (!isSourcePath(path) || data.length > MAX_FILE_BYTES || files.length >= MAX_FILES || data.subarray(0, 8000).includes(0)) {
      skipped++;
      return;
    }
    const text = data.toString("utf8");
    files.push({ path, text, lines: text.split("\n").length });
  });
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, skipped, sha: comment };
}

/* ---------------- download ---------------- */

/** Read a public GitHub repository's default branch at its latest commit. */
export async function fetchRepoSnapshot(repoUrl: string): Promise<SnapshotOutcome> {
  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) return { ok: false, error: "That isn't a github.com repository link." };
  const { owner, repo } = parsed;
  try {
    const res = await fetch(`https://codeload.github.com/${owner}/${repo}/tar.gz/HEAD`, { signal: AbortSignal.timeout(30_000), headers: { "user-agent": "VouchReferee" } });
    if (res.status === 404) return { ok: false, error: "Repository not found or not public." };
    if (!res.ok || !res.body) return { ok: false, error: `Couldn't download the code (HTTP ${res.status}).` };
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      total += chunk.length;
      if (total > MAX_ARCHIVE_BYTES) return { ok: false, error: `The repository is over ${MAX_ARCHIVE_BYTES / 1024 / 1024} MB compressed; too big to read.` };
      chunks.push(Buffer.from(chunk));
    }
    const { files, skipped, sha } = unpackRepoArchive(Buffer.concat(chunks));
    if (!sha) return { ok: false, error: "Couldn't tell which commit the code came from." };
    if (!files.length) return { ok: false, error: "The repository has no readable source files." };
    return { ok: true, owner, repo, sha, branch: "default branch", files, skipped };
  } catch (err) {
    return { ok: false, error: `Reading the repository failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Link to lines of a file at the judged commit. */
export function blobUrl(s: Pick<RepoSnapshot, "owner" | "repo" | "sha">, path: string, start: number, end: number): string {
  return `https://github.com/${s.owner}/${s.repo}/blob/${s.sha}/${path.split("/").map(encodeURIComponent).join("/")}#L${start}${end > start ? `-L${end}` : ""}`;
}
