import { describe, expect, it, vi } from "vitest";
import { generateStructured, type LLMProvider } from "../llm-provider.js";
import { chunksByTextBudget, mapWithConcurrency } from "./provider.js";
import { z } from "zod";

describe("Wiki pipeline performance safeguards", () => {
  it("packs short page blocks by text budget instead of creating underfilled fixed batches", () => {
    const blocks = Array.from({ length: 686 }, (_, index) => ({ id: String(index), text: "x".repeat(334) }));
    const relevanceBatches = chunksByTextBudget(blocks, block => Math.min(block.text.length, 1_600), { maxChars: 20_000, maxItems: 48 });
    const extractionBatches = chunksByTextBudget(blocks, block => Math.min(block.text.length, 1_600), { maxChars: 18_000, maxItems: 28 });
    expect(relevanceBatches).toHaveLength(15);
    expect(extractionBatches).toHaveLength(25);
    expect(relevanceBatches.flat()).toEqual(blocks);
    expect(extractionBatches.flat()).toEqual(blocks);
  });

  it("keeps long blocks within the configured prompt budget", () => {
    const blocks = Array.from({ length: 30 }, (_, index) => ({ id: String(index), text: "x".repeat(1_600) }));
    const batches = chunksByTextBudget(blocks, block => block.text.length, { maxChars: 20_000, maxItems: 48 });
    expect(batches.every(batch => batch.reduce((sum, block) => sum + block.text.length, 0) <= 20_000)).toBe(true);
    expect(batches.flat()).toEqual(blocks);
  });

  it("preserves result order while enforcing bounded concurrency", async () => {
    let active = 0;
    let peak = 0;
    const results = await mapWithConcurrency([0, 1, 2, 3, 4, 5], 3, async value => {
      active++;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      return value * 2;
    });
    expect(peak).toBe(3);
    expect(results).toEqual([0, 2, 4, 6, 8, 10]);
  });

  it("reports real batch completions while concurrent results remain ordered", async () => {
    const completions: Array<[number, number]> = [];
    const results = await mapWithConcurrency([30, 5, 15], 3, async delay => {
      await new Promise(resolve => setTimeout(resolve, delay));
      return delay;
    }, (completed, total) => { completions.push([completed, total]); });
    expect(results).toEqual([30, 5, 15]);
    expect(completions).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it("requests provider-level JSON output for every structured generation", async () => {
    const provider: LLMProvider = { generate: vi.fn().mockResolvedValue({ provider: "test", text: JSON.stringify({ value: "ok" }) }) };
    await generateStructured(provider, { prompt: "Return JSON", maxTokens: 1_000 }, z.object({ value: z.string() }));
    expect(provider.generate).toHaveBeenCalledWith(expect.objectContaining({ responseFormat: "json_object", maxTokens: 1_000 }));
  });

  it("does not multiply provider network failures through schema-repair retries", async () => {
    const provider: LLMProvider = { generate: vi.fn().mockRejectedValue(new Error("network timeout")) };
    await expect(generateStructured(provider, { prompt: "Return JSON" }, z.object({ value: z.string() }), 1))
      .rejects.toThrow("network timeout");
    expect(provider.generate).toHaveBeenCalledOnce();
  });

  it("still repairs a provider response that is reachable but fails schema validation", async () => {
    const provider: LLMProvider = {
      generate: vi.fn()
        .mockResolvedValueOnce({ provider: "test", text: JSON.stringify({ wrong: true }) })
        .mockResolvedValueOnce({ provider: "test", text: JSON.stringify({ value: "fixed" }) }),
    };
    await expect(generateStructured(provider, { prompt: "Return JSON" }, z.object({ value: z.string() }), 1))
      .resolves.toEqual({ value: "fixed" });
    expect(provider.generate).toHaveBeenCalledTimes(2);
  });
});
