import { NextResponse } from "next/server";
import { listDocuments } from "@/lib/rag/documents";

export const runtime = "nodejs";

export async function GET() {
  const docs = await listDocuments();
  return NextResponse.json({ documents: docs });
}
