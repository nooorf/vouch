import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { generateJson } from "./index";
import { LlmUnavailableError, ProviderUnavailableError, type LlmCache, type LlmProvider } from "./types";

const Answer = z.object({ ok: z.boolean() });
const req = { task: "test", system: "sys", prompt: "hi", jsonSchema: {}, validate: Answer };

function fakeProvider(name: string, replies: (string | Error)[]): LlmProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    name,
    calls,
    async complete(r) {
      calls.push(r.prompt);
      const next = replies.shift();
      if (next === undefined || next instanceof Error) throw next ?? new ProviderUnavailableError(name, "no more replies");
      return { text: next, model: `${name}-model` };
    },
  };
}

function memoryCache(): LlmCache & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    store,
    async get(key) {
      return store.has(key) ? { model: "cached-model", response: store.get(key) } : null;
    },
    async set(key, _model, response) {
      store.set(key, response);
    },
  };
}

describe("generateJson", () => {
  it("returns a validated answer and caches it", async () => {
    const cache = memoryCache();
    const p = fakeProvider("a", ['{"ok":true}']);
    const res = await generateJson(req, { providers: [p], cache });
    expect(res).toMatchObject({ data: { ok: true }, provider: "a", model: "a-model", cached: false });
    expect(cache.store.size).toBe(1);

    const again = await generateJson(req, { providers: [fakeProvider("b", [])], cache });
    expect(again).toMatchObject({ data: { ok: true }, provider: "cache", cached: true });
  });

  it("retries once with the validation error when the answer is invalid", async () => {
    const p = fakeProvider("a", ['{"ok":"yes"}', '{"ok":false}']);
    const res = await generateJson(req, { providers: [p], cache: null });
    expect(res.data).toEqual({ ok: false });
    expect(p.calls).toHaveLength(2);
    expect(p.calls[1]).toMatch(/previous answer was rejected/);
  });

  it("gives up after two invalid answers, and never caches them", async () => {
    const cache = memoryCache();
    const p = fakeProvider("a", ["not json", '{"nope":1}']);
    await expect(generateJson(req, { providers: [p], cache })).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(cache.store.size).toBe(0);
  });

  it("falls through to the next provider when one is unavailable", async () => {
    const down = fakeProvider("down", [new ProviderUnavailableError("down", "503")]);
    const up = fakeProvider("up", ['{"ok":true}']);
    const res = await generateJson(req, { providers: [down, up], cache: null });
    expect(res.provider).toBe("up");
  });

  it("reports unavailable when every provider is down", async () => {
    const err = await generateJson(req, { providers: [fakeProvider("x", [new ProviderUnavailableError("x", "429")])], cache: null }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmUnavailableError);
    expect(err.detail).toMatch(/x unavailable: 429/);
  });

  it("does not swallow programming errors from a provider", async () => {
    const broken = fakeProvider("broken", [new TypeError("bug")]);
    await expect(generateJson(req, { providers: [broken], cache: null })).rejects.toBeInstanceOf(TypeError);
  });

  it("ignores a cached value that no longer validates", async () => {
    const cache = memoryCache();
    const p = fakeProvider("a", ['{"ok":true}']);
    const spy = vi.spyOn(cache, "get");
    await generateJson(req, { providers: [p], cache });
    cache.store.set([...cache.store.keys()][0], { ok: "stale" });
    const res = await generateJson(req, { providers: [fakeProvider("b", ['{"ok":false}'])], cache });
    expect(res).toMatchObject({ provider: "b", data: { ok: false } });
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
