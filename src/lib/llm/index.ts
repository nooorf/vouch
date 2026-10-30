import { eq } from "drizzle-orm";
import type { z } from "zod";
import { db, schema } from "@/db";
import { canonicalJson, sha256 } from "@/lib/brief/hash";
import { env } from "@/lib/env";
import { GeminiProvider } from "./gemini";
import {
  LlmUnavailableError,
  ProviderUnavailableError,
  type CompletionRequest,
  type LlmCache,
  type LlmProvider,
} from "./types";

export { LlmUnavailableError } from "./types";
export type { LlmProvider } from "./types";

export interface JsonRequest<T> extends CompletionRequest {
  /** Names the use case in the cache key and logs, e.g. "brief.draft". */
  task: string;
  /** Validates the parsed answer. Only valid answers are returned or cached. */
  validate: z.ZodType<T>;
  /** Reuse an identical earlier answer. Default true. */
  cache?: boolean;
}

export interface JsonResult<T> {
  data: T;
  model: string;
  provider: string;
  promptHash: string;
  cached: boolean;
}

export interface LlmDeps {
  providers: LlmProvider[];
  cache: LlmCache | null;
}

/* ------------------------------------------------------------------ */
/* Defaults: providers from env, cache in Postgres                       */
/* ------------------------------------------------------------------ */

const dbCache: LlmCache = {
  async get(key) {
    const [hit] = await db.select().from(schema.llmCache).where(eq(schema.llmCache.key, key));
    return hit ? { model: hit.model, response: hit.response } : null;
  },
  async set(key, model, response) {
    await db.insert(schema.llmCache).values({ key, model, response: response as object }).onConflictDoNothing();
  },
};

let providers: LlmProvider[] | null = null;
function defaultProviders(): LlmProvider[] {
  // Order matters: later providers are fallbacks. Groq will be added here.
  providers ??= [env().LLM_PROVIDER].map((name) => {
    switch (name) {
      case "gemini":
        return new GeminiProvider();
    }
  });
  return providers;
}

/* ------------------------------------------------------------------ */
/* Core                                                                 */
/* ------------------------------------------------------------------ */

export function requestHash(req: Pick<JsonRequest<unknown>, "task" | "system" | "prompt" | "jsonSchema" | "images">): string {
  return sha256(
    canonicalJson({
      task: req.task,
      system: req.system,
      prompt: req.prompt,
      schema: req.jsonSchema,
      images: (req.images ?? []).map((i) => sha256(i.data)),
    }),
  );
}

async function completeWithFallback(list: LlmProvider[], req: CompletionRequest) {
  const errors: string[] = [];
  for (const provider of list) {
    try {
      return { ...(await provider.complete(req)), provider: provider.name };
    } catch (err) {
      if (!(err instanceof ProviderUnavailableError)) throw err;
      errors.push(err.message);
    }
  }
  throw new LlmUnavailableError("The AI is busy right now. Please try again in a minute.", errors.join(" | "));
}

/**
 * Ask the model for JSON that must pass `validate`.
 * Cached answers are reused. An answer that fails validation gets one retry with the
 * validation error attached. Providers are tried in order until one answers.
 */
export async function generateJson<T>(req: JsonRequest<T>, deps?: Partial<LlmDeps>): Promise<JsonResult<T>> {
  const list = deps?.providers ?? defaultProviders();
  const cache = deps && "cache" in deps ? deps.cache : dbCache;
  const promptHash = requestHash(req);
  const useCache = (req.cache ?? true) && cache !== null;

  if (useCache) {
    const hit = await cache!.get(promptHash);
    const parsed = hit ? req.validate.safeParse(hit.response) : null;
    if (hit && parsed?.success) return { data: parsed.data, model: hit.model, provider: "cache", promptHash, cached: true };
  }

  let note = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const out = await completeWithFallback(list, { ...req, prompt: note ? `${req.prompt}\n\n${note}` : req.prompt });

    let problem: string;
    try {
      const parsed = req.validate.safeParse(JSON.parse(out.text));
      if (parsed.success) {
        if (useCache) await cache!.set(promptHash, out.model, parsed.data);
        return { data: parsed.data, model: out.model, provider: out.provider, promptHash, cached: false };
      }
      problem = parsed.error.message.slice(0, 800);
    } catch {
      problem = "The answer was not valid JSON.";
    }
    console.warn(`[llm] ${req.task}: invalid answer from ${out.model} (attempt ${attempt})`);
    note = `Your previous answer was rejected: ${problem}\nReturn JSON that matches the schema exactly.`;
  }
  throw new LlmUnavailableError("The AI returned an answer we couldn't use. Please try again.");
}
