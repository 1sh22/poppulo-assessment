import { NextRequest, NextResponse } from "next/server";
import { QdrantClient } from "@qdrant/js-client-rest";
import { getBm25 } from "@/lib/rag/ingest";
import { embedOne } from "@/lib/rag/embed";
import { searchDense } from "@/lib/rag/qdrant";
import { listDocuments } from "@/lib/rag/documents";
import { retrieve } from "@/lib/rag/retrieve";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "attention";
  const collection = process.env.QDRANT_COLLECTION ?? "rag_chunks";
  const url = process.env.QDRANT_URL!;
  const apiKey = process.env.QDRANT_API_KEY;
  const client = new QdrantClient({ url, apiKey });

  const out: Record<string, unknown> = {
    env: {
      hasOpenAI: !!process.env.OPENAI_API_KEY,
      qdrantUrl: url,
      collection,
      useBlob: !!process.env.BLOB_READ_WRITE_TOKEN,
    },
    documents: await listDocuments(),
  };

  try {
    const info = await client.getCollection(collection);
    out.qdrantCollection = {
      points_count: info.points_count,
      status: info.status,
      config: info.config?.params,
    };
  } catch (e) {
    out.qdrantCollectionError = (e as Error).message;
  }

  try {
    const sample = await client.scroll(collection, { limit: 3, with_payload: true });
    out.qdrantSample = sample.points.map((p) => ({
      id: p.id,
      payloadKeys: p.payload ? Object.keys(p.payload) : [],
      chunkId: (p.payload as Record<string, unknown> | undefined)?.chunkId,
      docName: (p.payload as Record<string, unknown> | undefined)?.docName,
      page: (p.payload as Record<string, unknown> | undefined)?.page,
      textSnippet:
        typeof (p.payload as Record<string, unknown> | undefined)?.text === "string"
          ? ((p.payload as Record<string, string>).text.slice(0, 120))
          : null,
    }));
  } catch (e) {
    out.qdrantScrollError = (e as Error).message;
  }

  try {
    const bm25 = await getBm25();
    out.bm25Size = bm25.size();
    out.bm25Sample = bm25.search(q, 3).map((h) => ({
      chunkId: h.chunkId,
      score: h.score,
      docName: bm25.getChunk(h.chunkId)?.docName,
      page: bm25.getChunk(h.chunkId)?.page,
    }));
  } catch (e) {
    out.bm25Error = (e as Error).message;
  }

  try {
    const vec = await embedOne(q);
    const hits = await searchDense(vec, 3);
    out.denseSample = hits.map((h) => ({
      chunkId: h.chunkId,
      score: h.score,
      docName: h.chunk.docName,
      page: h.chunk.page,
    }));
  } catch (e) {
    out.denseSampleError = (e as Error).message;
  }

  try {
    const retrieved = await retrieve(q, { rerank: false, expandQuery: false });
    out.retrieveNoRerankNoExpand = retrieved.map((r) => ({
      chunkId: r.chunk.id,
      score: r.score,
      docName: r.chunk.docName,
      page: r.chunk.page,
    }));
  } catch (e) {
    out.retrieveNoRerankNoExpandError = (e as Error).message;
    out.retrieveNoRerankNoExpandStack = (e as Error).stack;
  }

  try {
    const retrieved = await retrieve(q);
    out.retrieveFull = retrieved.map((r) => ({
      chunkId: r.chunk.id,
      score: r.score,
      docName: r.chunk.docName,
      page: r.chunk.page,
    }));
  } catch (e) {
    out.retrieveFullError = (e as Error).message;
    out.retrieveFullStack = (e as Error).stack;
  }

  return NextResponse.json(out, { status: 200 });
}
