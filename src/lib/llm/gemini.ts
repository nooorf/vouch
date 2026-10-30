import { ApiError, GoogleGenAI, ThinkingLevel, type Part } from "@google/genai";
import { requireFeature } from "@/lib/env";
import { ProviderUnavailableError, type Completion, type CompletionRequest, type LlmProvider } from "./types";

/** Per attempt. A busy free-tier model can hang; we'd rather move on to the fallback. */
const TIMEOUT_MS = 30_000;
/** Attempts per model on busy/timeout errors before moving on. */
const ATTEMPTS_PER_MODEL = 2;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const thinkingLevels = { low: ThinkingLevel.LOW, medium: ThinkingLevel.MEDIUM, high: ThinkingLevel.HIGH };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Google Gemini. Tries the primary model, then the fallback model.
 * Note: Gemini rejects minimum/maximum/minItems/maxItems in responseJsonSchema.
 */
export class GeminiProvider implements LlmProvider {
  readonly name = "gemini";
  private client: GoogleGenAI | null = null;

  private ai() {
    this.client ??= new GoogleGenAI({ apiKey: requireFeature("ai").GEMINI_API_KEY! });
    return this.client;
  }

  models(): string[] {
    const e = requireFeature("ai");
    return e.GEMINI_MODEL === e.GEMINI_FALLBACK_MODEL ? [e.GEMINI_MODEL] : [e.GEMINI_MODEL, e.GEMINI_FALLBACK_MODEL];
  }

  async complete(req: CompletionRequest): Promise<Completion> {
    const parts: Part[] = [{ text: req.prompt }];
    for (const img of req.images ?? []) parts.push({ inlineData: img });

    let lastError = "";
    for (const model of this.models()) {
      for (let attempt = 1; attempt <= ATTEMPTS_PER_MODEL; attempt++) {
        const started = Date.now();
        try {
          const res = await this.ai().models.generateContent({
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
          if (!res.text) throw new Error("Empty response");
          return { text: res.text, model: res.modelVersion ?? model };
        } catch (err) {
          const status = err instanceof ApiError ? err.status : null;
          const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
          lastError = `${model}: ${status ?? (timedOut ? "timeout" : "error")} ${err instanceof Error ? err.message : String(err)}`.slice(0, 400);
          console.warn(`[llm:gemini] ${model} attempt ${attempt} failed after ${Date.now() - started}ms: ${lastError.slice(0, 160)}`);
          if (status === 400 || status === 404) break; // request rejected or model gone: next model
          if (status !== null && !RETRYABLE.has(status)) break;
          if (attempt < ATTEMPTS_PER_MODEL) await sleep(1000);
        }
      }
    }
    throw new ProviderUnavailableError(this.name, lastError);
  }
}
