"use client";

import { upload } from "@vercel/blob/client";

const MAX_BYTES = 25 * 1024 * 1024;
const VERCEL_BODY_LIMIT_BYTES = 4.5 * 1024 * 1024;

export async function ingestPdfFile(file: File): Promise<void> {
  validatePdfFile(file);

  if (!isLikelyLocalhost()) {
    try {
      await ingestViaBlob(file);
      return;
    } catch (error) {
      if (file.size > VERCEL_BODY_LIMIT_BYTES) {
        throw error;
      }
    }
  }

  await ingestViaMultipart(file);
}

export async function ingestPdfUrl(url: string): Promise<void> {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error("Enter a PDF URL first.");
  }

  const res = await fetch("/api/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: trimmed }),
  });

  await assertOk(res, `Ingest failed (${res.status})`);
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

async function ingestViaMultipart(file: File) {
  const body = new FormData();
  body.set("file", file);

  const res = await fetch("/api/ingest", { method: "POST", body });
  await assertOk(res, `Upload failed (${res.status})`);
}

async function ingestViaBlob(file: File) {
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

  await assertOk(res, `Upload failed (${res.status})`);
}

async function assertOk(res: Response, fallbackMessage: string) {
  if (res.ok) return;
  const err = (await res.json().catch(() => ({}))) as { error?: string };
  throw new Error(err.error ?? fallbackMessage);
}

function isLikelyLocalhost() {
  if (typeof window === "undefined") return false;
  return (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  );
}
