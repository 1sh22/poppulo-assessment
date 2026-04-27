"use client";

import { upload } from "@vercel/blob/client";
import type { DocumentMeta } from "@/lib/rag/types";

const MAX_BYTES = 25 * 1024 * 1024;
const VERCEL_BODY_LIMIT_BYTES = 4.5 * 1024 * 1024;

interface IngestResponse {
  document: DocumentMeta;
  chunkCount: number;
}

export async function ingestPdfFile(file: File): Promise<IngestResponse> {
  validatePdfFile(file);

  if (!isLikelyLocalhost()) {
    try {
      return await ingestViaBlob(file);
    } catch (error) {
      if (file.size > VERCEL_BODY_LIMIT_BYTES) {
        throw error;
      }
    }
  }

  return ingestViaMultipart(file);
}

export async function ingestPdfUrl(url: string): Promise<IngestResponse> {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error("Enter a PDF URL first.");
  }

  const res = await fetch("/api/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: trimmed }),
  });

  return assertOk(res, `Ingest failed (${res.status})`);
}

function validatePdfFile(file: File) {
  if (file.size > MAX_BYTES) {
    throw new Error(`File too large (${file.size} bytes). Max is ${MAX_BYTES}.`);
  }

  const lower = file.name.toLowerCase();
  if (!file.type.includes("pdf") && !lower.endsWith(".pdf")) {
    throw new Error("Only PDF files are supported.");
  }
}

async function ingestViaMultipart(file: File): Promise<IngestResponse> {
  const body = new FormData();
  body.set("file", file);

  const res = await fetch("/api/ingest", { method: "POST", body });
  return assertOk(res, `Upload failed (${res.status})`);
}

async function ingestViaBlob(file: File): Promise<IngestResponse> {
  const docId = crypto.randomUUID();
  const blob = await upload(`pdfs/${docId}.pdf`, file, {
    access: "public",
    contentType: "application/pdf",
    handleUploadUrl: "/api/blob/upload",
    multipart: file.size > VERCEL_BODY_LIMIT_BYTES,
  });

  const res = await fetch("/api/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: docId,
      name: file.name,
      url: blob.url,
      blobUrl: blob.url,
    }),
  });

  return assertOk(res, `Upload failed (${res.status})`);
}

async function assertOk(res: Response, fallbackMessage: string): Promise<IngestResponse> {
  const err = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.ok) return err as IngestResponse;
  throw new Error(err.error ?? fallbackMessage);
}

function isLikelyLocalhost() {
  if (typeof window === "undefined") return false;
  return (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  );
}
