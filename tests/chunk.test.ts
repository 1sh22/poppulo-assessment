import { describe, expect, it } from "vitest";
import {
  chunkParagraphs,
  estimateTokens,
  splitSentences,
} from "../lib/rag/chunk";
import type { ParsedParagraph } from "../lib/rag/types";

describe("splitSentences", () => {
  it("splits on sentence boundaries", () => {
    const out = splitSentences("Hello world. How are you? I'm fine!");
    expect(out.length).toBe(3);
  });

  it("returns the whole text when there is no terminator", () => {
    const out = splitSentences("A single fragment without punctuation");
    expect(out.length).toBe(1);
  });
});

describe("estimateTokens", () => {
  it("is roughly 1 token per 4 characters", () => {
    expect(estimateTokens("four")).toBe(1);
    expect(estimateTokens("aaaaaaaaaa")).toBeGreaterThanOrEqual(2);
  });
});

describe("chunkParagraphs", () => {
  const para = (text: string, page = 1, idx = 0): ParsedParagraph => ({
    docId: "d1",
    page,
    paragraphIdx: idx,
    text,
  });

  it("returns one chunk for a short paragraph", () => {
    const chunks = chunkParagraphs(
      [para("This is a short paragraph. It has two sentences.")],
      "test.pdf",
    );
    expect(chunks.length).toBe(1);
    expect(chunks[0].text).toContain("short paragraph");
    expect(chunks[0].docName).toBe("test.pdf");
    expect(chunks[0].page).toBe(1);
  });

  it("never crosses paragraph boundaries", () => {
    const longPara = "This is a sentence. ".repeat(200);
    const chunks = chunkParagraphs(
      [para(longPara, 1, 0), para("Short second paragraph.", 2, 0)],
      "x.pdf",
    );
    // no chunk should contain both a sentence from para 0 and "Short second"
    for (const c of chunks) {
      const a = c.text.includes("This is a sentence.");
      const b = c.text.includes("Short second");
      expect(a && b).toBe(false);
    }
  });

  it("splits long paragraphs into multiple chunks with overlap", () => {
    const longPara = Array.from({ length: 60 }, (_, i) => `Sentence ${i}.`).join(" ");
    const chunks = chunkParagraphs([para(longPara)], "x.pdf", {
      tokensPerChunk: 50,
      overlapTokens: 10,
    });
    expect(chunks.length).toBeGreaterThan(1);
    // Overlap: some sentence should appear in two consecutive chunks.
    const overlaps = chunks.slice(1).filter((c, i) => {
      const prev = chunks[i];
      return prev.text.split(" ").some((w) => c.text.startsWith(w));
    });
    expect(overlaps.length).toBeGreaterThan(0);
  });

  it("attaches correct citation metadata", () => {
    const chunks = chunkParagraphs(
      [para("Alpha beta gamma.", 3, 2)],
      "doc.pdf",
    );
    expect(chunks[0].page).toBe(3);
    expect(chunks[0].paragraphIdx).toBe(2);
    expect(chunks[0].id).toContain("d1:3:2");
  });
});
