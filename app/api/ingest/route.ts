import { NextRequest, NextResponse } from "next/server";
import { ingestPdf } from "@/lib/rag/ingest";
import { fetchRemotePdf } from "@/lib/rag/remote-pdf";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";
    let buffer: Uint8Array;
    let name = "document.pdf";
    let autoName = false;
    let id: string | undefined;
    let existingBlobUrl: string | undefined;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json(
          { error: 'Missing "file" field.' },
          { status: 400 },
        );
      }
      if (file.size > MAX_BYTES) {
        return NextResponse.json(
          { error: `File too large (${file.size} bytes). Max is ${MAX_BYTES}.` },
          { status: 413 },
        );
      }
      if (!file.type.includes("pdf") && !file.name.toLowerCase().endsWith(".pdf")) {
        return NextResponse.json(
          { error: "Only PDF files are supported." },
          { status: 400 },
        );
      }
      buffer = new Uint8Array(await file.arrayBuffer());
      name = file.name || name;
    } else if (contentType.includes("application/json")) {
      const body = await req.json();
      if (!body.url || typeof body.url !== "string") {
        return NextResponse.json(
          { error: "Provide either multipart file or JSON { url, name? }." },
          { status: 400 },
        );
      }
      if (typeof body.id === "string" && body.id) {
        id = body.id;
      }
      if (typeof body.blobUrl === "string" && body.blobUrl) {
        existingBlobUrl = body.blobUrl;
      }
      const fetched = await fetchRemotePdf(body.url);
      buffer = fetched.buffer;
      if (buffer.byteLength > MAX_BYTES) {
        return NextResponse.json(
          { error: `File too large (${buffer.byteLength} bytes). Max is ${MAX_BYTES}.` },
          { status: 413 },
        );
      }
      if (existingBlobUrl && existingBlobUrl !== fetched.finalUrl) {
        existingBlobUrl = undefined;
      }
      if (typeof body.name === "string" && body.name) {
        name = body.name;
      } else {
        name = inferNameFromUrl(fetched.finalUrl);
        autoName = true; // name is just a URL slug — try to extract the real title from the PDF
      }
    } else {
      return NextResponse.json(
        { error: "Send multipart/form-data with 'file' or JSON { url }." },
        { status: 400 },
      );
    }

    const { doc, chunks } = await ingestPdf(name, buffer, {
      autoName,
      id,
      existingBlobUrl,
    });

    return NextResponse.json({
      document: doc,
      chunkCount: chunks.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Ingest failed", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function inferNameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    if (last) return decodeURIComponent(last);
  } catch {
    // ignore
  }
  return "document.pdf";
}
