import { describe, expect, it } from "vitest";
import { quoteOnPage } from "./judge";

const page =
  "Ember & Oak Coffee Roasters. Small-batch, single-origin coffee roasted every Tuesday in East London. Every bag is single-origin and traceable to the farm. Drink our coffee where it's roasted: Shoreditch and Hackney. Our cafés open daily.";

describe("quoteOnPage", () => {
  it("accepts exact quotes, ignoring case, accents, quotes and spacing", () => {
    expect(quoteOnPage("Every bag is single-origin and traceable to the farm.", page)).toBe(true);
    expect(quoteOnPage("“every  bag is SINGLE-ORIGIN and traceable to the farm”", page)).toBe(true);
    expect(quoteOnPage("Our cafes open daily", page)).toBe(true);
  });

  it("accepts quotes with … gaps when every fragment is on the page", () => {
    expect(quoteOnPage("Small-batch, single-origin coffee … traceable to the farm", page)).toBe(true);
    expect(quoteOnPage("Small-batch, single-origin coffee … grown on our own farm", page)).toBe(false);
  });

  it("rejects invented or paraphrased quotes", () => {
    expect(quoteOnPage("All beans are sourced directly from farmers in Ethiopia.", page)).toBe(false);
    expect(quoteOnPage("Every bag is single origin and can be traced back to the farm.", page)).toBe(false);
  });

  it("rejects quotes too short to prove anything", () => {
    expect(quoteOnPage("coffee", page)).toBe(false);
    expect(quoteOnPage("", page)).toBe(false);
  });
});
