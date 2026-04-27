import { NextResponse } from "next/server";
import { listDocuments } from "@/lib/rag/documents";
import { ensureDefaultDocuments } from "@/lib/rag/default-docs";

export const runtime = "nodejs";

export async function GET() {
  await ensureDefaultDocuments();
  const docs = await listDocuments();
  return NextResponse.json({ documents: docs });
}
