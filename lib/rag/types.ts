export type DocumentId = string;
export type ChunkId = string;

export interface ParsedParagraph {
  docId: DocumentId;
  page: number;
  paragraphIdx: number;
  text: string;
}

export interface Chunk {
  id: ChunkId;
  docId: DocumentId;
  docName: string;
  page: number;
  paragraphIdx: number;
  sentenceStart: number;
  sentenceEnd: number;
  text: string;
}

export interface DocumentMeta {
  id: DocumentId;
  name: string;
  pageCount: number;
  chunkCount: number;
  bytes: number;
  createdAt: string;
  blobUrl?: string;
}

export interface ScoredChunk {
  chunk: Chunk;
  score: number;
  source: "dense" | "bm25" | "hybrid";
}

export interface Citation {
  chunkId: ChunkId;
  docId: DocumentId;
  docName: string;
  page: number;
  paragraphIdx: number;
  quote: string;
  /** 1-based index as used in the answer text, e.g. [1], [3], [4]. Optional for backwards compat. */
  citationNumber?: number;
}

export interface AnswerPayload {
  answer: string;
  citations: Citation[];
  retrieved: ScoredChunk[];
  model: string;
  elapsedMs: number;
}
