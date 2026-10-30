import { ApiError, GoogleGenAI, ThinkingLevel, type Part } from "@google/genai";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import { db, schema } from "@/db";
import { canonicalJson, sha256 } from "@/lib/brief/hash";

/** The AI could not answer (rate limit, outage, or repeated invalid output). Callers show a retry. */
export class LlmUnavailableError extends Error {
  constructor(message: string, readonly detail?: string) {
    super(message);
    this.name = "LlmUnavailableError";
  }
}

export interface JsonRequest<T> {
  /** Names the use case in the cache key and logs, e.g. "brief.draft". */
  task: string;
  system: string;
  prompt: string;
  /** Inline images (e.g. a page screenshot), base64. */
  images?: { mimeType: string; data: string }[];
  /** JSON Schema in the subset Gemini supports. */
  jsonSchema: object;
  /** Validates the parsed output. */
  validate: z.ZodType<T>;
  thinking?: "low" | "medium" | "high";
  /** Reuse an identical earlier answer. Default true. */
  cache?: boolean;
}

export interface JsonResult<T> {
  data: T;
  model: string;
  promptHash: string;
  cached: boolean;
}

/** The model answered, but not with valid JSON for the schema. */
class InvalidOutput extends Error {}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
/** Per attempt. A busy free-tier model can hang; we'd rather move to the fallback. */
const TIMEOUT_MS = 30_000;
/** Attempts per model on busy/timeout errors before moving on. */
const ATTEMPTS_PER_MODEL = 2;

let client: GoogleGenAI | null = null;
function ai() {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new LlmUnavailableError("The AI is not configured (GEMINI_API_KEY missing).");
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

export function models(): string[] {
  const primary = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const fallback = process.env.GEMINI_FALLBACK_MODEL || "gemini-flash-lite-latest";
  return primary === fallback ? [primary] : [primary, fallback];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const thinkingLevels = { low: ThinkingLevel.LOW, medium: ThinkingLevel.MEDIUM, high: ThinkingLevel.HIGH };

async function callOnce(model: string, req: JsonRequest<unknown>, extraNote?: string): Promise<string> {
  const parts: Part[] = [{ text: extraNote ? `${req.prompt}\n\n${extraNote}` : req.prompt }];
  for (const img of req.images ?? []) parts.push({ inlineData: img });

  const res = await ai().models.generateContent({
    model,
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: req.system,
      responseMimeType: "application/json",
      responseJsonSchema: req.jsonSchema,
      temperature: 0.2,
      thinkingConfig: { thinkingLevel: thinkingLevels[req.thinking ?? "low"] },
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    },
  });
  const text = res.text;
  if (!text) throw new Error("Empty response");
  return text;
}

/**
 * Ask Gemini for JSON that must pass `validate`.
 * Tries the primary model (2 attempts on busy errors), then the fallback model.
 * An answer that fails validation gets one retry with the validation error attached.
 */
export async function generateJson<T>(req: JsonRequest<T>): Promise<JsonResult<T>> {
  const promptHash = sha256(canonicalJson({ task: req.task, system: req.system, prompt: req.prompt, schema: req.jsonSchema, images: (req.images ?? []).map((i) => sha256(i.data)) }));
  const useCache = req.cache ?? true;

  if (useCache) {
    const [hit] = await db.select().from(schema.llmCache).where(eq(schema.llmCache.key, promptHash));
    if (hit) {
      const parsed = req.validate.safeParse(hit.response);
      if (parsed.success) return { data: parsed.data, model: hit.model, promptHash, cached: true };
    }
  }

  let lastError = "";
  for (const model of models()) {
    let note: string | undefined;
    for (let attempt = 0; attempt < ATTEMPTS_PER_MODEL + 1; attempt++) {
      const started = Date.now();
      try {
        const text = await callOnce(model, req, note);
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          throw new InvalidOutput("The answer was not valid JSON.");
        }
        const parsed = req.validate.safeParse(json);
        if (!parsed.success) throw new InvalidOutput(parsed.error.message.slice(0, 800));

        if (useCache) {
          await db
            .insert(schema.llmCache)
            .values({ key: promptHash, model, response: parsed.data as object })
            .onConflictDoNothing();
        }
        return { data: parsed.data, model, promptHash, cached: false };
      } catch (err) {
        const ms = Date.now() - started;
        if (err instanceof InvalidOutput) {
          lastError = `${model}: ${err.message}`;
          console.warn(`[llm] ${req.task} ${model} invalid output after ${ms}ms`);
          if (note) break; // already retried once with the error; try the next model
          note = `Your previous answer was rejected: ${err.message}\nReturn JSON that matches the schema exactly.`;
          continue;
        }
        const status = err instanceof ApiError ? err.status : null;
        const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
        lastError = `${model}: ${status ?? (timedOut ? "timeout" : "")} ${err instanceof Error ? err.message : String(err)}`.slice(0, 500);
        console.warn(`[llm] ${req.task} ${model} attempt ${attempt + 1} failed after ${ms}ms: ${lastError.slice(0, 160)}`);
        if (status === 404 || status === 400) break; // model unavailable or request rejected: next model
        if (status !== null && !RETRYABLE.has(status)) break;
        if (attempt + 1 >= ATTEMPTS_PER_MODEL) break; // busy: move on to the fallback model
        await sleep(1000);
      }
    }
  }
  console.error(`[llm] ${req.task} failed: ${lastError}`);
  throw new LlmUnavailableError("The AI is busy right now. Please try again in a minute.", lastError);
}

