import { QdrantClient } from "@qdrant/js-client-rest";
import { embedDimension } from "./embed";
import type { Chunk, ChunkId } from "./types";

const COLLECTION = process.env.QDRANT_COLLECTION ?? "rag_chunks";

let client: QdrantClient | null = null;

function getClient(): QdrantClient {
  if (client) return client;
  const url = process.env.QDRANT_URL;
  const apiKey = process.env.QDRANT_API_KEY;
  if (!url) throw new Error("QDRANT_URL is not set");
  client = new QdrantClient({ url, apiKey });
  return client;
}

export async function ensureCollection(): Promise<void> {
  const c = getClient();
  const existing = await c.getCollections();
  if (existing.collections.some((col) => col.name === COLLECTION)) return;
  await c.createCollection(COLLECTION, {
    vectors: { size: embedDimension(), distance: "Cosine" },
    optimizers_config: { default_segment_number: 2 },
  });
  await c.createPayloadIndex(COLLECTION, {
    field_name: "docId",
    field_schema: "keyword",
  });
}

export async function upsertChunks(
  chunks: Chunk[],
  vectors: number[][],
): Promise<void> {
  if (chunks.length !== vectors.length) {
    throw new Error("chunks.length !== vectors.length");
  }
  const c = getClient();
  await ensureCollection();
  const points = chunks.map((chunk, i) => ({
    id: idToQdrantId(chunk.id),
    vector: vectors[i],
    payload: {
      chunkId: chunk.id,
      docId: chunk.docId,
      docName: chunk.docName,
      page: chunk.page,
      paragraphIdx: chunk.paragraphIdx,
      sentenceStart: chunk.sentenceStart,
      sentenceEnd: chunk.sentenceEnd,
      text: chunk.text,
    },
  }));
  // Qdrant caps batch sizes; chunk the upserts.
  const BATCH = 256;
  for (let i = 0; i < points.length; i += BATCH) {
    await c.upsert(COLLECTION, { points: points.slice(i, i + BATCH), wait: true });
  }
}

export async function searchDense(
  vector: number[],
  topK: number,
  docIds?: string[],
): Promise<{ chunkId: ChunkId; score: number; chunk: Chunk }[]> {
  const c = getClient();
  await ensureCollection();
  const filter =
    docIds && docIds.length > 0
      ? { must: [{ key: "docId", match: { any: docIds } }] }
      : undefined;
  const res = await c.search(COLLECTION, {
    vector,
    limit: topK,
    with_payload: true,
    filter,
  });
  return res.map((r) => {
    const p = r.payload as Record<string, unknown>;
    return {
      chunkId: p.chunkId as string,
      score: r.score ?? 0,
      chunk: {
        id: p.chunkId as string,
        docId: p.docId as string,
        docName: p.docName as string,
        page: p.page as number,
        paragraphIdx: p.paragraphIdx as number,
        sentenceStart: p.sentenceStart as number,
        sentenceEnd: p.sentenceEnd as number,
        text: p.text as string,
      },
    };
  });
}

export async function deleteDocument(docId: string): Promise<void> {
  const c = getClient();
  await ensureCollection();
  await c.delete(COLLECTION, {
    filter: { must: [{ key: "docId", match: { value: docId } }] },
    wait: true,
  });
}

/**
 * Qdrant point IDs must be UUIDs or unsigned ints. We hash our string chunk
 * IDs deterministically to a UUIDv5-ish hex string.
 */
function idToQdrantId(chunkId: string): string {
  // FNV-1a 64-bit → 2 × 32-bit pieces, then format as UUID.
  let h1 = 0x811c9dc5;
  let h2 = 0xc9dc5118;
  for (let i = 0; i < chunkId.length; i++) {
    const c = chunkId.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2166136261);
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  const a = hex(h1);
  const b = hex(h2);
  const c = hex(Math.imul(h1 ^ h2, 2654435761));
  const d = hex(Math.imul(h2 ^ h1 ^ 0x9e3779b9, 2246822507));
  return `${a}-${b.slice(0, 4)}-${b.slice(4, 8)}-${c.slice(0, 4)}-${c.slice(4, 8)}${d}`;
}
