import { NextResponse } from "next/server";
import { listDocuments } from "@/lib/rag/documents";
import { ensureDefaultDocuments } from "@/lib/rag/default-docs";

export const runtime = "nodejs";

export async function GET() {
  try {
    await ensureDefaultDocuments();
  } catch (error) {
    console.error("Default document bootstrap failed", error);
  }
  const docs = await listDocuments();
  return NextResponse.json(
    { documents: docs },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
