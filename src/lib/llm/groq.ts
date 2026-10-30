import { requireFeature } from "@/lib/env";
import { ProviderUnavailableError, type Completion, type CompletionRequest, type LlmProvider } from "./types";

/**
 * Groq (free tier), the fallback when Gemini is out of quota or busy. OpenAI-compatible API, so
 * plain fetch: no SDK.
 *
 * - Models are tried in order. Free-tier limits differ by model (tokens per minute), so a request
 *   too large for one model moves on to the next instead of failing.
 * - Answers use structured output (our JSON Schema); a model that doesn't support it gets JSON
 *   mode with the schema in the instructions, and our validator checks the result either way.
 * - Requests with images (page screenshots) go to the vision model.
 */

const URL_ = "https://api.groq.com/openai/v1/chat/completions";
const TIMEOUT_MS = 45_000;
const ATTEMPTS_PER_MODEL = 3;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
/**
 * A request bigger than a model's whole per-minute allowance (HTTP 413, or a 4xx saying so):
 * waiting won't help, so move to the next model. A 429 that merely says this minute's allowance is
 * used up ("Used 7000, Requested 1336… try again in 4.2s") is different: wait and retry.
 */
const TOO_BIG = /request too large|reduce your message size|context_length|maximum context/i;
/** Longest we'll wait on a per-minute limit before giving up on the model. */
const MAX_WAIT_MS = 20_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface GroqConfig {
  apiKey: string;
  /** Text models, in order. */
  models: string[];
  /** For requests with images. */
  visionModel: string;
}

export class GroqProvider implements LlmProvider {
  readonly name = "groq";

  constructor(
    private readonly config?: GroqConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private settings(): GroqConfig {
    if (this.config) return this.config;
    const e = requireFeature("groq");
    return {
      apiKey: e.GROQ_API_KEY!,
      models: e.GROQ_MODELS.split(",").map((m) => m.trim()).filter(Boolean),
      visionModel: e.GROQ_VISION_MODEL,
    };
  }

  models(req: Pick<CompletionRequest, "images">): string[] {
    const s = this.settings();
    return req.images?.length ? [s.visionModel] : s.models;
  }

  private body(req: CompletionRequest, model: string, format: "json_schema" | "json_object") {
    const user = req.images?.length
      ? [{ type: "text", text: req.prompt }, ...req.images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mimeType};base64,${i.data}` } }))]
      : req.prompt;
    return {
      model,
      messages: [
        { role: "system", content: `${req.system}\n\nAnswer with a single JSON object that matches this JSON Schema:\n${JSON.stringify(req.jsonSchema)}` },
        { role: "user", content: user },
      ],
      temperature: 0.2,
      // Answers are short; Groq counts this allowance against the per-minute token limit.
      max_completion_tokens: 2048,
      response_format: format === "json_schema" ? { type: "json_schema", json_schema: { name: "answer", schema: req.jsonSchema } } : { type: "json_object" },
      // Reasoning models take an effort level; others reject the field.
      ...(/gpt-oss/.test(model) ? { reasoning_effort: req.thinking ?? "low" } : {}),
    };
  }

  async complete(req: CompletionRequest): Promise<Completion> {
    const { apiKey } = this.settings();
    let lastError = "";
    for (const model of this.models(req)) {
      let format: "json_schema" | "json_object" = "json_schema";
      for (let attempt = 1; attempt <= ATTEMPTS_PER_MODEL; attempt++) {
        const started = Date.now();
        let status: number | null = null;
        let detail = "";
        try {
          const res = await this.fetchImpl(URL_, {
            method: "POST",
            headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
            body: JSON.stringify(this.body(req, model, format)),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
          status = res.status;
          if (res.ok) {
            const data = (await res.json()) as { model?: string; choices?: { message?: { content?: string | null } }[] };
            const text = data.choices?.[0]?.message?.content;
            if (!text) throw new Error("Empty response");
            return { text, model: data.model ?? model };
          }
          detail = (await res.text()).slice(0, 300);
          if (status === 400 && format === "json_schema" && /response_format|json_schema|schema|json_validate_fail|failed to generate json/i.test(detail)) {
            // This model doesn't do structured output: JSON mode, same attempt budget.
            format = "json_object";
            attempt--;
            continue;
          }
          if (status === 401 || status === 403) throw new ProviderUnavailableError(this.name, `the API key was rejected (HTTP ${status})`);
          if (status === 413 || (status !== 429 && TOO_BIG.test(detail))) {
            const counts = /Limit \d+, Requested \d+/i.exec(detail)?.[0];
            lastError = `${model}: request too large for its free-tier limit${counts ? ` (${counts})` : ""}`;
            console.warn(`[llm:groq] ${lastError}`);
            break;
          }
          if (!RETRYABLE.has(status)) {
            lastError = `${model}: HTTP ${status} ${detail}`;
            console.warn(`[llm:groq] ${lastError.slice(0, 200)}`);
            break;
          }
          lastError = `${model}: HTTP ${status} ${detail}`;
          // Groq says how long to wait ("try again in 4.2s", or the retry-after header).
          const m = /try again in (?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/i.exec(detail);
          const fromText = m && (m[1] || m[2] || m[3]) ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
          const hinted = fromText || Number(res.headers.get("retry-after")) || attempt * 2;
          const wait = Math.ceil(hinted * 1000) + 250;
          if (wait > MAX_WAIT_MS) {
            console.warn(`[llm:groq] ${model} busy for ${Math.round(hinted)} s; trying the next model`);
            break;
          }
          console.warn(`[llm:groq] ${model} attempt ${attempt} busy (HTTP ${status}) after ${Date.now() - started}ms`);
          if (attempt < ATTEMPTS_PER_MODEL) await sleep(wait);
        } catch (err) {
          if (err instanceof ProviderUnavailableError) throw err;
          const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
          lastError = `${model}: ${timedOut ? "timeout" : err instanceof Error ? err.message : String(err)}`.slice(0, 300);
          console.warn(`[llm:groq] ${model} attempt ${attempt} failed after ${Date.now() - started}ms: ${lastError}`);
          if (attempt < ATTEMPTS_PER_MODEL) await sleep(1000);
        }
      }
    }
    throw new ProviderUnavailableError(this.name, lastError || "no model answered");
  }
}
