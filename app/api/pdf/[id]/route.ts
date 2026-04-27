import { NextRequest, NextResponse } from "next/server";
import { getDocument } from "@/lib/rag/documents";
import { getBuffer } from "@/lib/rag/storage";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const doc = await getDocument(id);
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // When using Vercel Blob, redirect to the CDN URL.
  if (doc.blobUrl && doc.blobUrl.startsWith("https://")) {
    return NextResponse.redirect(doc.blobUrl);
  }
  const buf = await getBuffer(`pdfs/${id}.pdf`);
  if (!buf) {
    return NextResponse.json({ error: "PDF not found in storage" }, { status: 404 });
  }
  return new NextResponse(Buffer.from(buf), {
    headers: {
      "content-type": "application/pdf",
      "content-length": String(buf.byteLength),
      "cache-control": "public, max-age=3600",
    },
  });
}
