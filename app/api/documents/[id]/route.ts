import { NextRequest, NextResponse } from "next/server";
import { getDocument, removeDocument } from "@/lib/rag/documents";
import { removeDocumentFromBm25 } from "@/lib/rag/ingest";
import { deleteDocument as deleteFromQdrant } from "@/lib/rag/qdrant";

export const runtime = "nodejs";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const doc = await getDocument(id);
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await deleteFromQdrant(id);
  await removeDocumentFromBm25(id);
  await removeDocument(id);
  return NextResponse.json({ ok: true });
}
