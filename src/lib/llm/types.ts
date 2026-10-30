/** One call to a model, provider-agnostic. */
export interface CompletionRequest {
  system: string;
  prompt: string;
  /** Inline images (e.g. a page screenshot), base64. */
  images?: { mimeType: string; data: string }[];
  /** JSON Schema the answer must follow (the subset every provider supports). */
  jsonSchema: object;
  thinking?: "low" | "medium" | "high";
}

export interface Completion {
  /** Raw model text, expected to be JSON. */
  text: string;
  /** Exact model that answered, e.g. "gemini-3.8-flash". */
  model: string;
}

/**
 * A model provider (Gemini today; Groq or a local model later).
 * It handles its own transient retries and model fallbacks, and throws
 * ProviderUnavailableError when it can't answer, so the next provider is tried.
 */
export interface LlmProvider {
  readonly name: string;
  complete(req: CompletionRequest): Promise<Completion>;
}

export class ProviderUnavailableError extends Error {
  constructor(readonly provider: string, readonly detail: string) {
    super(`${provider} unavailable: ${detail}`);
    this.name = "ProviderUnavailableError";
  }
}

/** The AI could not answer (every provider down or busy, or repeated invalid output). Callers show a retry. */
export class LlmUnavailableError extends Error {
  constructor(message: string, readonly detail?: string) {
    super(message);
    this.name = "LlmUnavailableError";
  }
}

/** Where validated answers are kept, keyed by a hash of the request. */
export interface LlmCache {
  get(key: string): Promise<{ model: string; response: unknown } | null>;
  set(key: string, model: string, response: unknown): Promise<void>;
}
