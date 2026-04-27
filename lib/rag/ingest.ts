import { randomUUID } from "node:crypto";
import { Bm25Index, type SerializedBm25 } from "./bm25";
import { chunkParagraphs } from "./chunk";
import { embedMany } from "./embed";
import { parsePdf } from "./pdf";
import { upsertChunks } from "./qdrant";
import { getJson, putJson, putBuffer } from "./storage";
import { upsertDocument } from "./documents";
import type { Chunk, DocumentMeta } from "./types";

const BM25_KEY = "indexes/bm25.json";

async function loadBm25(): Promise<Bm25Index> {
  const data = await getJson<SerializedBm25>(BM25_KEY);
  return data ? Bm25Index.fromJSON(data) : new Bm25Index();
}

async function saveBm25(idx: Bm25Index): Promise<void> {
  await putJson(BM25_KEY, idx.toJSON());
}

export interface IngestResult {
  doc: DocumentMeta;
  chunks: Chunk[];
}

export interface IngestOptions {
  id?: string;
  /** When true, attempt to extract the paper title from the PDF body and use it
   *  as the document name instead of the caller-supplied fallback string. */
  autoName?: boolean;
  onProgress?: (stage: string, done: number, total: number) => void;
}

/** Heuristically pull the title from the first few parsed paragraphs. */
function extractTitleFromParagraphs(
  paragraphs: Array<{ text: string }>,
): string | null {
  for (const p of paragraphs.slice(0, 8)) {
    const t = p.text.trim();

    // Basic bounds
    if (t.length < 10 || t.length > 250) continue;

    const tokens = t.split(/\s+/);
    if (tokens.length < 2) continue;

    // Skip email addresses and URLs
    if (/@/.test(t) || /https?:\/\//.test(t)) continue;

    // Skip lines starting with a digit (page/section numbers, arXiv IDs, years)
    if (/^\d/.test(t)) continue;

    // Skip author-affiliation patterns: "Zhang 1 Tim" or "Khattab 1 Omar"
    // (a word followed by an isolated digit, followed by a capitalised word)
    if (/[A-Za-z]\s+\d+\s+[A-Z]/.test(t)) continue;

    // Skip lines where isolated digit tokens make up >20 % of the token count
    // (typical of "Name Name 1 Name Name 2" author lines)
    const digitTokens = tokens.filter((tok) => /^\d+$/.test(tok));
    if (digitTokens.length / tokens.length > 0.2) continue;

    // Skip lines that look like institution / affiliation blocks
    // (e.g. "MIT CSAIL, Cambridge, MA 02139")
    if (/\b(University|Institute|Laboratory|Department|School|College|Corp|Inc\.|Ltd\.)\b/i.test(t)) continue;

    return t;
  }
  return null;
}

export async function ingestPdf(
  name: string,
  buffer: Uint8Array,
  opts: IngestOptions = {},
): Promise<IngestResult> {
  const id = opts.id ?? randomUUID();
  const progress = opts.onProgress ?? (() => {});

  progress("parse", 0, 1);
  const parsed = await parsePdf(id, buffer);
  progress("parse", 1, 1);

  if (opts.autoName) {
    const extracted = extractTitleFromParagraphs(parsed.paragraphs);
    if (extracted) name = extracted;
  }

  if (parsed.paragraphs.length === 0) {
    throw new Error(
      "No text extracted. This may be a scanned / image-only PDF — OCR isn't supported yet.",
    );
  }

  const chunks = chunkParagraphs(parsed.paragraphs, name);
  if (chunks.length === 0) throw new Error("Chunking produced zero chunks.");

  progress("embed", 0, chunks.length);
  const vectors = await embedMany(
    chunks.map((c) => c.text),
    (done, total) => progress("embed", done, total),
  );

  progress("index", 0, 1);
  await upsertChunks(chunks, vectors);

  const bm25 = await loadBm25();
  bm25.addChunks(chunks);
  await saveBm25(bm25);
  progress("index", 1, 1);

  progress("store", 0, 1);
  const blobUrl = await putBuffer(`pdfs/${id}.pdf`, buffer, "application/pdf");
  progress("store", 1, 1);

  const doc: DocumentMeta = {
    id,
    name,
    pageCount: parsed.pageCount,
    chunkCount: chunks.length,
    bytes: buffer.byteLength,
    createdAt: new Date().toISOString(),
    blobUrl,
  };
  await upsertDocument(doc);

  return { doc, chunks };
}

export async function getBm25(): Promise<Bm25Index> {
  return loadBm25();
}

/** Remove a document’s chunks from the sparse index so they cannot be retrieved after delete. */
export async function removeDocumentFromBm25(docId: string): Promise<void> {
  const bm25 = await loadBm25();
  bm25.removeByDocId(docId);
  await saveBm25(bm25);
}
