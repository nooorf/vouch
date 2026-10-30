import { describe, expect, it } from "vitest";
import { findPlaceholders, looksLikePlaceholder } from "./placeholder";

describe("placeholder detection", () => {
  it("catches template filler", () => {
    expect(findPlaceholders("E-Commerce Lorem ipsum dolor sit amet, consectetur adipisicing elit.").map((f) => f.label)).toEqual(["Lorem ipsum", "dolor sit amet"]);
    expect(looksLikePlaceholder("Project Name")).toBe(true);
    expect(findPlaceholders("Portfolio Threads Explore", ["Portfolio", "Project Name"]).map((f) => f.label)).toEqual(["heading “Project Name”"]);
    expect(looksLikePlaceholder("Your company name here")).toBe(true);
    expect(looksLikePlaceholder("Insert text here")).toBe(true);
  });

  it("leaves real copy alone", () => {
    for (const real of [
      "Every bag is single-origin and traceable to the farm.",
      "We name every project after the café it was built for.",
      "Our sample roasts are free for wholesale customers.",
      "Text us your order and we'll have it ready.",
      "Pick up your coffee here every morning.",
      // Real apps use template-sounding words as labels; only a whole template heading counts.
      "Project name Due date Create project",
      "Download the sample text file and the placeholder text guidelines.",
    ]) {
      expect(looksLikePlaceholder(real), real).toBe(false);
    }
  });

  it("only counts template headings as whole headings", () => {
    expect(findPlaceholders("Create a project", ["Your projects", "Project name ideas"])).toEqual([]);
  });
});
