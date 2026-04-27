import type { Chunk, ChunkId } from "./types";

/**
 * Minimal BM25 implementation, persisted as plain JSON. We serialize posting
 * lists + doc-length stats so the index can be reloaded on a cold lambda
 * invocation without rebuilding from source text.
 */

export interface SerializedBm25 {
  k1: number;
  b: number;
  avgdl: number;
  docCount: number;
  docLengths: Record<ChunkId, number>;
  // term → [chunkId, termFrequency][]
  postings: Record<string, [ChunkId, number][]>;
  chunks: Record<ChunkId, Chunk>;
}

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "of", "to", "in",
  "on", "for", "with", "by", "as", "is", "are", "was", "were", "be",
  "been", "being", "that", "this", "it", "its", "at", "from", "we",
  "our", "you", "your", "i", "he", "she", "they", "them", "their",
  "which", "who", "whom", "what", "how", "why",
]);

const TOKEN_RE = /[A-Za-z0-9][A-Za-z0-9-]*/g;

export function tokenize(text: string): string[] {
  const raw = text.toLowerCase().match(TOKEN_RE) ?? [];
  return raw.filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export class Bm25Index {
  readonly k1 = 1.5;
  readonly b = 0.75;
  private avgdl = 0;
  private docCount = 0;
  private docLengths: Record<ChunkId, number> = {};
  private postings: Record<string, [ChunkId, number][]> = {};
  private chunks: Record<ChunkId, Chunk> = {};

  static fromChunks(chunks: Chunk[]): Bm25Index {
    const idx = new Bm25Index();
    idx.addChunks(chunks);
    return idx;
  }

  static fromJSON(data: SerializedBm25): Bm25Index {
    const idx = new Bm25Index();
    Object.assign(idx, {
      avgdl: data.avgdl,
      docCount: data.docCount,
      docLengths: data.docLengths,
      postings: data.postings,
      chunks: data.chunks,
    });
    return idx;
  }

  toJSON(): SerializedBm25 {
    return {
      k1: this.k1,
      b: this.b,
      avgdl: this.avgdl,
      docCount: this.docCount,
      docLengths: this.docLengths,
      postings: this.postings,
      chunks: this.chunks,
    };
  }

  addChunks(chunks: Chunk[]): void {
    const tfByDoc = new Map<ChunkId, Map<string, number>>();
    for (const chunk of chunks) {
      const tokens = tokenize(chunk.text);
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
      tfByDoc.set(chunk.id, tf);
      this.docLengths[chunk.id] = tokens.length;
      this.chunks[chunk.id] = chunk;
    }

    for (const [chunkId, tf] of tfByDoc) {
      for (const [term, count] of tf) {
        if (!this.postings[term]) this.postings[term] = [];
        this.postings[term].push([chunkId, count]);
      }
    }

    this.docCount = Object.keys(this.docLengths).length;
    const totalLen = Object.values(this.docLengths).reduce((a, b) => a + b, 0);
    this.avgdl = this.docCount > 0 ? totalLen / this.docCount : 0;
  }

  getChunk(id: ChunkId): Chunk | undefined {
    return this.chunks[id];
  }

  size(): number {
    return this.docCount;
  }

  /** Remove all chunks that belong to a document (e.g. when the doc is deleted). */
  removeByDocId(docId: string): void {
    const toRemove = new Set<ChunkId>();
    for (const [id, chunk] of Object.entries(this.chunks)) {
      if (chunk.docId === docId) toRemove.add(id);
    }
    if (toRemove.size === 0) return;

    for (const id of toRemove) {
      delete this.docLengths[id];
      delete this.chunks[id];
    }

    for (const term of Object.keys(this.postings)) {
      const list = this.postings[term]!.filter(
        ([chunkId]) => !toRemove.has(chunkId),
      );
      if (list.length === 0) delete this.postings[term];
      else this.postings[term] = list;
    }

    this.docCount = Object.keys(this.docLengths).length;
    const totalLen = Object.values(this.docLengths).reduce((a, b) => a + b, 0);
    this.avgdl = this.docCount > 0 ? totalLen / this.docCount : 0;
  }

  search(query: string, topK = 20): { chunkId: ChunkId; score: number }[] {
    const terms = Array.from(new Set(tokenize(query)));
    if (terms.length === 0 || this.docCount === 0) return [];

    const scores = new Map<ChunkId, number>();
    for (const term of terms) {
      const posting = this.postings[term];
      if (!posting) continue;
      const df = posting.length;
      const idf = Math.log(1 + (this.docCount - df + 0.5) / (df + 0.5));
      for (const [chunkId, tf] of posting) {
        const dl = this.docLengths[chunkId];
        const norm = 1 - this.b + this.b * (dl / this.avgdl);
        const score = idf * ((tf * (this.k1 + 1)) / (tf + this.k1 * norm));
        scores.set(chunkId, (scores.get(chunkId) || 0) + score);
      }
    }

    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([chunkId, score]) => ({ chunkId, score }));
  }
}
