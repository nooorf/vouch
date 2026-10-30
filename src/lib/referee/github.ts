import { env } from "@/lib/env";

/** Facts about a public GitHub repository, read through the GitHub REST API. */
export interface RepoFacts {
  ok: true;
  fullName: string;
  defaultBranch: string;
  readme: { words: number } | null;
  commitsSince: number;
  latestRun: { conclusion: string | null; status: string; name: string; url: string } | null;
}
export type RepoOutcome = RepoFacts | { ok: false; error: string };

export function parseRepoUrl(raw: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(raw.trim());
    if (u.hostname !== "github.com" && u.hostname !== "www.github.com") return null;
    const [owner, repo] = u.pathname.replace(/^\/|\/$/g, "").split("/");
    if (!owner || !repo || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;
    return { owner, repo: repo.replace(/\.git$/, "") };
  } catch {
    return null;
  }
}

async function gh<T>(path: string): Promise<{ status: number; body: T | null }> {
  const token = env().GITHUB_TOKEN;
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "VouchReferee",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
  return { status: res.status, body: res.ok ? ((await res.json()) as T) : null };
}

export async function readRepo(repoUrl: string, since: Date | null): Promise<RepoOutcome> {
  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) return { ok: false, error: "That isn't a github.com repository link." };
  const base = `/repos/${parsed.owner}/${parsed.repo}`;
  try {
    const repo = await gh<{ full_name: string; default_branch: string; private: boolean }>(base);
    if (repo.status === 404) return { ok: false, error: "Repository not found or not public." };
    if (!repo.body) return { ok: false, error: `GitHub returned HTTP ${repo.status}` };
    if (repo.body.private) return { ok: false, error: "The repository is private." };

    const [readme, commits, runs] = await Promise.all([
      gh<{ content?: string; encoding?: string }>(`${base}/readme`),
      gh<unknown[]>(`${base}/commits?per_page=30${since ? `&since=${since.toISOString()}` : ""}`),
      gh<{ workflow_runs: { conclusion: string | null; status: string; name: string; html_url: string }[] }>(
        `${base}/actions/runs?per_page=1&branch=${encodeURIComponent(repo.body.default_branch)}`,
      ),
    ]);

    const text = readme.body?.content && readme.body.encoding === "base64" ? Buffer.from(readme.body.content, "base64").toString("utf8") : "";
    const run = runs.body?.workflow_runs?.[0];
    return {
      ok: true,
      fullName: repo.body.full_name,
      defaultBranch: repo.body.default_branch,
      readme: readme.body ? { words: text.split(/\s+/).filter((w) => /[a-z]/i.test(w)).length } : null,
      commitsSince: Array.isArray(commits.body) ? commits.body.length : 0,
      latestRun: run ? { conclusion: run.conclusion, status: run.status, name: run.name, url: run.html_url } : null,
    };
  } catch (err) {
    return { ok: false, error: `GitHub request failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
