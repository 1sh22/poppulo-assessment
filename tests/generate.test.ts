import { describe, expect, it } from "vitest";
import { looseContains } from "../lib/rag/generate";

describe("looseContains", () => {
  const passage =
    "The complexity of a self-attention layer is O(n^2 · d) where n is the sequence length.";

  it("accepts exact quote", () => {
    expect(looseContains(passage, "self-attention layer is O(n^2 · d)")).toBe(true);
  });

  it("accepts quote with minor whitespace / punctuation drift", () => {
    expect(
      looseContains(passage, "self attention layer is O(n2 d) where n is the sequence length"),
    ).toBe(true);
  });

  it("rejects a fabricated quote", () => {
    expect(looseContains(passage, "convolutional layers run in linear time")).toBe(false);
  });

  it("rejects quotes that are too short", () => {
    expect(looseContains(passage, "is")).toBe(false);
  });
});
