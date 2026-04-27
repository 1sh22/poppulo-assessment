import { describe, expect, it } from "vitest";
import { Bm25Index, tokenize } from "../lib/rag/bm25";
import type { Chunk } from "../lib/rag/types";

const chunk = (id: string, text: string): Chunk => ({
  id,
  docId: "d1",
  docName: "test.pdf",
  page: 1,
  paragraphIdx: 0,
  sentenceStart: 0,
  sentenceEnd: 1,
  text,
});

describe("tokenize", () => {
  it("lowercases and keeps hyphenated terms", () => {
    expect(tokenize("Self-Attention is NOT the only mechanism.")).toEqual([
      "self-attention",
      "not",
      "only",
      "mechanism",
    ]);
  });

  it("drops stopwords", () => {
    expect(tokenize("the cat and the dog")).toEqual(["cat", "dog"]);
  });
});

describe("Bm25Index", () => {
  it("ranks exact-term matches above unrelated docs", () => {
    const idx = Bm25Index.fromChunks([
      chunk("a", "Transformer architecture uses self-attention."),
      chunk("b", "The cat sat on the mat."),
      chunk("c", "Transformer models use scaled dot-product attention layers."),
    ]);
    const hits = idx.search("self-attention transformer", 3);
    expect(hits[0].chunkId).toBe("a"); // matches both query terms
    expect(hits.map((h) => h.chunkId)).toContain("c"); // matches "transformer"
    expect(hits.map((h) => h.chunkId)).not.toContain("b");
  });

  it("serializes and deserializes losslessly", () => {
    const idx = Bm25Index.fromChunks([
      chunk("a", "Alpha beta gamma."),
      chunk("b", "Gamma delta epsilon."),
    ]);
    const restored = Bm25Index.fromJSON(idx.toJSON());
    expect(restored.size()).toBe(2);
    const hits = restored.search("gamma", 2);
    expect(hits.length).toBe(2);
  });

  it("returns empty array for empty query", () => {
    const idx = Bm25Index.fromChunks([chunk("a", "hello world")]);
    expect(idx.search("", 5)).toEqual([]);
  });

  it("removeByDocId drops all chunks for that document", () => {
    const d1 = (id: string, text: string): Chunk => ({
      id,
      docId: "doc-a",
      docName: "a.pdf",
      page: 1,
      paragraphIdx: 0,
      sentenceStart: 0,
      sentenceEnd: 1,
      text,
    });
    const d2 = (id: string, text: string): Chunk => ({
      id,
      docId: "doc-b",
      docName: "b.pdf",
      page: 1,
      paragraphIdx: 0,
      sentenceStart: 0,
      sentenceEnd: 1,
      text,
    });
    const idx = Bm25Index.fromChunks([
      d1("c1", "alpha beta uniqueq"),
      d1("c2", "alpha gamma"),
      d2("c3", "delta uniqueq"),
    ]);
    expect(idx.getChunk("c1")).toBeDefined();
    idx.removeByDocId("doc-a");
    expect(idx.getChunk("c1")).toBeUndefined();
    expect(idx.getChunk("c2")).toBeUndefined();
    expect(idx.getChunk("c3")?.docId).toBe("doc-b");
    const hits = idx.search("uniqueq", 5);
    expect(hits).toEqual([{ chunkId: "c3", score: expect.any(Number) }]);
  });
});
