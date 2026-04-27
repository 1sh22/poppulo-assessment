import { NextRequest, NextResponse } from "next/server";
import { getDocument, removeDocument } from "@/lib/rag/documents";
import { removeDocumentFromBm25 } from "@/lib/rag/ingest";
import { deleteDocument as deleteFromQdrant } from "@/lib/rag/qdrant";
import { isProtectedDefaultDocument } from "@/lib/rag/default-docs";

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
  if (isProtectedDefaultDocument(doc)) {
    return NextResponse.json(
      { error: "Built-in sample documents cannot be deleted." },
      { status: 403 },
    );
  }
  await deleteFromQdrant(id);
  await removeDocumentFromBm25(id);
  await removeDocument(id);
  return NextResponse.json({ ok: true });
}
