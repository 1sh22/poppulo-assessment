import { describe, expect, it } from "vitest";
import { reciprocalRankFusion } from "../lib/rag/rrf";

describe("reciprocalRankFusion", () => {
  it("favors docs that appear in multiple rankings", () => {
    const fused = reciprocalRankFusion([
      [
        { id: "a", rank: 0 },
        { id: "b", rank: 1 },
        { id: "c", rank: 2 },
      ],
      [
        { id: "c", rank: 0 },
        { id: "a", rank: 1 },
        { id: "d", rank: 2 },
      ],
    ]);
    expect(fused[0].id).toBe("a"); // appears high in both lists
    // c also appears in both; should outrank b/d which only appear once
    const ranks = fused.map((x) => x.id);
    expect(ranks.indexOf("c")).toBeLessThan(ranks.indexOf("b"));
    expect(ranks.indexOf("c")).toBeLessThan(ranks.indexOf("d"));
  });

  it("returns each id once", () => {
    const fused = reciprocalRankFusion([
      [{ id: "a", rank: 0 }],
      [{ id: "a", rank: 0 }],
    ]);
    expect(fused.length).toBe(1);
  });

  it("k parameter changes smoothing", () => {
    const a = reciprocalRankFusion(
      [
        [
          { id: "x", rank: 0 },
          { id: "y", rank: 10 },
        ],
      ],
      5,
    );
    const b = reciprocalRankFusion(
      [
        [
          { id: "x", rank: 0 },
          { id: "y", rank: 10 },
        ],
      ],
      100,
    );
    // Smaller k → larger spread between rank 0 and rank 10.
    const spreadA = a[0].score - a[1].score;
    const spreadB = b[0].score - b[1].score;
    expect(spreadA).toBeGreaterThan(spreadB);
  });
});
