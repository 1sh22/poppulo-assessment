import type { Chunk, ParsedParagraph, DocumentId } from "./types";

const TOKENS_PER_CHUNK = 450;
const OVERLAP_TOKENS = 80;

/**
 * Rough token estimate — Unicode-safe, avoids a tiktoken dependency.
 * ~4 chars/token for English is the standard heuristic.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Sentence segmentation using Intl.Segmenter when available, with a regex
 * fallback for environments where the `sentence` granularity is missing.
 */
export function splitSentences(text: string): string[] {
  try {
    const seg = new Intl.Segmenter("en", { granularity: "sentence" });
    const out: string[] = [];
    for (const s of seg.segment(text)) {
      const t = s.segment.trim();
      if (t) out.push(t);
    }
    if (out.length > 0) return out;
  } catch {
    // fall through
  }
  return text
    .replace(/([.!?])\s+(?=[A-Z])/g, "$1")
    .split("")
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface ChunkOptions {
  tokensPerChunk?: number;
  overlapTokens?: number;
}

/**
 * Sentence-aware greedy packer. Sentences are accumulated until the running
 * token count would exceed `tokensPerChunk`; on overflow a new chunk is
 * started with the last ~`overlapTokens` worth of sentences carried over.
 * Paragraph boundaries are respected — chunks never span paragraphs so
 * citations always resolve to a single paragraph.
 */
export function chunkParagraphs(
  paragraphs: ParsedParagraph[],
  docName: string,
  opts: ChunkOptions = {},
): Chunk[] {
  const max = opts.tokensPerChunk ?? TOKENS_PER_CHUNK;
  const overlap = opts.overlapTokens ?? OVERLAP_TOKENS;
  const chunks: Chunk[] = [];

  for (const para of paragraphs) {
    const sentences = splitSentences(para.text);
    if (sentences.length === 0) continue;

    let buf: string[] = [];
    let bufStart = 0;
    let tokenCount = 0;

    const flush = (endExclusive: number) => {
      if (buf.length === 0) return;
      const text = buf.join(" ").trim();
      if (!text) return;
      chunks.push(createChunk(para, docName, bufStart, endExclusive, text, chunks.length));
    };

    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i];
      const sTokens = estimateTokens(s);
      if (tokenCount + sTokens > max && buf.length > 0) {
        flush(i);
        // Build overlap prefix
        const carried: string[] = [];
        let carriedTokens = 0;
        for (let j = buf.length - 1; j >= 0; j--) {
          const t = estimateTokens(buf[j]);
          if (carriedTokens + t > overlap) break;
          carried.unshift(buf[j]);
          carriedTokens += t;
        }
        buf = carried;
        tokenCount = carriedTokens;
        bufStart = i - carried.length;
      }
      buf.push(s);
      tokenCount += sTokens;
    }
    flush(sentences.length);
  }

  return chunks;
}

function createChunk(
  para: ParsedParagraph,
  docName: string,
  sentenceStart: number,
  sentenceEnd: number,
  text: string,
  runningIdx: number,
): Chunk {
  return {
    id: makeChunkId(para.docId, para.page, para.paragraphIdx, runningIdx),
    docId: para.docId,
    docName,
    page: para.page,
    paragraphIdx: para.paragraphIdx,
    sentenceStart,
    sentenceEnd,
    text,
  };
}

export function makeChunkId(
  docId: DocumentId,
  page: number,
  paragraphIdx: number,
  running: number,
): string {
  return `${docId}:${page}:${paragraphIdx}:${running}`;
}
