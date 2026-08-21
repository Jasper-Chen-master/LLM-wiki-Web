import katex from "katex";
import { describe, expect, it } from "vitest";
import { toWikiLatex } from "./math-rendering";

describe("Wiki math rendering", () => {
  it("separates a Unicode Greek symbol from the following variable", () => {
    expect(toWikiLatex("P = Mgh/Δt")).toBe("P = Mgh/\\Delta t");
  });

  it("repairs an already compacted Greek TeX command", () => {
    const tex = toWikiLatex("P = Mgh/\\Deltat");
    expect(tex).toBe("P = Mgh/\\Delta t");
    expect(katex.renderToString(tex, { throwOnError: false })).not.toContain("katex-error");
  });

  it("keeps normal subscripts and existing Greek commands valid", () => {
    expect(toWikiLatex("\\theta_0 = Δt")).toBe("\\theta_{0} = \\Delta t");
  });
});
