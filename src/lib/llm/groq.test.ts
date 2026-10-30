import { describe, expect, it } from "vitest";
import { GroqProvider } from "./groq";
import { ProviderUnavailableError } from "./types";

const config = { apiKey: "gsk_test_key_0123456789", models: ["big-model", "roomy-model"], visionModel: "vision-model" };
const req = { system: "Be a judge.", prompt: "Is it good?", jsonSchema: { type: "object" } };

type Reply = { status: number; body: unknown; headers?: Record<string, string> };
/** A fake Groq: answers each call with the next reply, and records what was sent. */
function fakeGroq(replies: Reply[]) {
  const sent: { model: string; response_format: { type: string }; messages: { role: string; content: unknown }[]; reasoning_effort?: string }[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    const r = replies.shift() ?? { status: 500, body: "no more replies" };
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status, headers: { "retry-after": "0", ...r.headers } });
  }) as unknown as typeof fetch;
  return { sent, fetchImpl };
}
const ok = (model: string, content = '{"ok":true}') => ({ status: 200, body: { model, choices: [{ message: { content } }] } });

describe("GroqProvider", () => {
  it("asks for structured output with our schema, and returns the answer", async () => {
    const g = fakeGroq([ok("big-model")]);
    const out = await new GroqProvider(config, g.fetchImpl).complete(req);
    expect(out).toEqual({ text: '{"ok":true}', model: "big-model" });
    expect(g.sent[0]).toMatchObject({ model: "big-model", response_format: { type: "json_schema" } });
    expect(g.sent[0].messages[0].content).toMatch(/JSON Schema/);
  });

  it("falls back to JSON mode when a model doesn't support structured output", async () => {
    const g = fakeGroq([{ status: 400, body: "response_format json_schema is not supported by this model" }, ok("big-model")]);
    await new GroqProvider(config, g.fetchImpl).complete(req);
    expect(g.sent.map((s) => s.response_format.type)).toEqual(["json_schema", "json_object"]);
  });

  it("moves to the next model when a request is too large for a model's free-tier limit", async () => {
    const g = fakeGroq([{ status: 413, body: "Request too large for model big-model: Limit 8000 tokens per minute" }, ok("roomy-model")]);
    const out = await new GroqProvider(config, g.fetchImpl).complete(req);
    expect(out.model).toBe("roomy-model");
    expect(g.sent.map((s) => s.model)).toEqual(["big-model", "roomy-model"]);
  });

  it("retries a busy model, then gives up so the next provider is tried", async () => {
    const busy = { status: 429, body: "rate limit reached, try again" };
    const g = fakeGroq(Array(6).fill(busy));
    await expect(new GroqProvider(config, g.fetchImpl).complete(req)).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(g.sent.map((s) => s.model)).toEqual(["big-model", "big-model", "big-model", "roomy-model", "roomy-model", "roomy-model"]);
  }, 30_000);

  it("waits out a per-minute limit on the same model instead of skipping it", async () => {
    const perMinute = { status: 429, body: "Rate limit reached on tokens per minute (TPM): Limit 8000, Used 7000, Requested 1336. Please try again in 0.01s." };
    const g = fakeGroq([perMinute, ok("big-model")]);
    const out = await new GroqProvider(config, g.fetchImpl).complete(req);
    expect(out.model).toBe("big-model");
    expect(g.sent.map((s) => s.model)).toEqual(["big-model", "big-model"]);
  });

  it("moves on when the wait would be too long", async () => {
    const longWait = { status: 429, body: "Rate limit reached on tokens per day (TPD). Please try again in 7m12s." };
    const g = fakeGroq([longWait, ok("roomy-model")]);
    const out = await new GroqProvider(config, g.fetchImpl).complete(req);
    expect(out.model).toBe("roomy-model");
  });

  it("switches to JSON mode when structured output fails to generate", async () => {
    const g = fakeGroq([{ status: 400, body: '{"error":{"message":"Failed to generate JSON.","code":"json_validate_failed"}}' }, ok("big-model")]);
    await new GroqProvider(config, g.fetchImpl).complete(req);
    expect(g.sent.map((s) => s.response_format.type)).toEqual(["json_schema", "json_object"]);
  });

  it("sends screenshots to the vision model", async () => {
    const g = fakeGroq([ok("vision-model")]);
    await new GroqProvider(config, g.fetchImpl).complete({ ...req, images: [{ mimeType: "image/jpeg", data: "AAAA" }] });
    expect(g.sent[0].model).toBe("vision-model");
    expect(JSON.stringify(g.sent[0].messages[1].content)).toContain("data:image/jpeg;base64,AAAA");
  });

  it("stops at once when the key is rejected", async () => {
    const g = fakeGroq([{ status: 401, body: "invalid api key" }]);
    await expect(new GroqProvider(config, g.fetchImpl).complete(req)).rejects.toThrow(/key was rejected/);
    expect(g.sent).toHaveLength(1);
  });

  it("passes the reasoning effort only to reasoning models", async () => {
    const g = fakeGroq([ok("openai/gpt-oss-120b")]);
    await new GroqProvider({ ...config, models: ["openai/gpt-oss-120b"] }, g.fetchImpl).complete({ ...req, thinking: "low" });
    expect(g.sent[0].reasoning_effort).toBe("low");
    const h = fakeGroq([ok("big-model")]);
    await new GroqProvider(config, h.fetchImpl).complete({ ...req, thinking: "low" });
    expect(h.sent[0].reasoning_effort).toBeUndefined();
  });
});
