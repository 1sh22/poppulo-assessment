import { NextRequest } from "next/server";
import { retrieveWithDetails, type HistoryTurn } from "@/lib/rag/retrieve";
import { generateAnswerStreaming } from "@/lib/rag/generate";
import { listDocuments } from "@/lib/rag/documents";
import { ensureDefaultDocuments } from "@/lib/rag/default-docs";

export const runtime = "nodejs";
export const maxDuration = 60;

function parseHistory(raw: unknown): HistoryTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: HistoryTurn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = (item as { role?: unknown }).role;
    const c = (item as { content?: unknown }).content;
    if ((r !== "user" && r !== "assistant") || typeof c !== "string") continue;
    const cited = (item as { citedDocIds?: unknown }).citedDocIds;
    const citedDocIds = Array.isArray(cited)
      ? cited.filter((x): x is string => typeof x === "string")
      : undefined;
    const citedChunksRaw = (item as { citedChunkIds?: unknown }).citedChunkIds;
    const citedChunkIds = Array.isArray(citedChunksRaw)
      ? citedChunksRaw.filter((x): x is string => typeof x === "string")
      : undefined;
    out.push({ role: r, content: c, citedDocIds, citedChunkIds });
  }
  return out;
}

function sseEvent(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(
      `data: ${JSON.stringify({ type: "error", error: "Invalid JSON body." })}\n\n`,
      { status: 400, headers: { "Content-Type": "text/event-stream" } },
    );
  }

  const question =
    typeof body.question === "string" ? body.question.trim() : "";
  if (!question) {
    return new Response(
      `data: ${JSON.stringify({ type: "error", error: "Missing 'question' field." })}\n\n`,
      { status: 400, headers: { "Content-Type": "text/event-stream" } },
    );
  }

  const docIds = Array.isArray(body.docIds)
    ? body.docIds.filter((d: unknown): d is string => typeof d === "string")
    : undefined;
  const model = typeof body.model === "string" ? body.model : undefined;
  const topK = typeof body.topK === "number" ? body.topK : undefined;
  const history = parseHistory(body.history);

  const stream = new ReadableStream({
    async start(controller) {
      const started = Date.now();
      try {
        await ensureDefaultDocuments();
        const availableDocs = (await listDocuments()).map((d) => ({
          id: d.id,
          name: d.name,
        }));

        const retrieveOpts: Parameters<typeof retrieveWithDetails>[1] = {
          history,
          availableDocs,
        };
        if (docIds && docIds.length > 0) retrieveOpts.docIds = docIds;
        if (typeof topK === "number") retrieveOpts.topK = topK;

        const retrieved = await retrieveWithDetails(question, retrieveOpts);

        // Immediately send retrieved passages so the client can show them.
        const retrievedForClient = retrieved.chunks.map((r) => ({
          chunkId: r.chunk.id,
          docId: r.chunk.docId,
          docName: r.chunk.docName,
          page: r.chunk.page,
          paragraphIdx: r.chunk.paragraphIdx,
          score: r.score,
          text: r.chunk.text,
        }));
        controller.enqueue(
          sseEvent({ type: "retrieved", chunks: retrievedForClient }),
        );

        // Stream the answer text.
        const { textStream, citationsPromise, model: usedModel } =
          generateAnswerStreaming(question, retrieved.chunks, { model, history });

        for await (const delta of textStream) {
          controller.enqueue(sseEvent({ type: "delta", text: delta }));
        }

        const citations = await citationsPromise;
        controller.enqueue(
          sseEvent({
            type: "done",
            citations,
            model: usedModel,
            resolvedQuery: retrieved.resolvedQuery,
            scopedTo: retrieved.scopedTo,
            elapsedMs: Date.now() - started,
          }),
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown error";
        console.error("Query failed", err);
        controller.enqueue(sseEvent({ type: "error", error: message }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
