"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { X, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import type { ChatCitation } from "./Chat";

// Use the worker from unpkg to avoid bundling/wiring the pdf.js worker through turbopack.
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface Props {
  citation: ChatCitation;
  onClose: () => void;
}

export function PdfPreview({ citation, onClose }: Props) {
  const [numPages, setNumPages] = useState<number>(0);
  const [page, setPage] = useState<number>(citation.page);
  const [scale, setScale] = useState<number>(1.1);
  const [width, setWidth] = useState<number>(560);
  const [loadError, setLoadError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPage(citation.page);
  }, [citation.chunkId, citation.page]);

  useEffect(() => {
    setLoadError(null);
  }, [citation.docId, citation.chunkId]);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth - 32));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fileUrl = useMemo(() => `/api/pdf/${citation.docId}`, [citation.docId]);

  const highlightWords = useMemo(
    () =>
      citation.quote
        .toLowerCase()
        .replace(/[^\w\s-]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3),
    [citation.quote],
  );

  const customTextRenderer = useMemo(
    () =>
      ({ str }: { str: string }) => {
        if (highlightWords.length === 0) return str;
        const lower = str.toLowerCase();
        if (!highlightWords.some((w) => lower.includes(w))) return str;
        let html = escapeHtml(str);
        for (const w of highlightWords) {
          const re = new RegExp(`(${escapeRegex(w)})`, "gi");
          html = html.replace(re, `<mark class="highlight-match">$1</mark>`);
        }
        return html;
      },
    [highlightWords],
  );

  return (
    <div ref={containerRef} className="flex flex-col h-full">
      <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{citation.docName}</div>
          <div className="text-xs text-zinc-500">
            Page {page} of {numPages || "…"}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded p-1 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => setPage((p) => Math.min(numPages || p + 1, p + 1))}
            disabled={numPages ? page >= numPages : false}
            className="rounded p-1 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => setScale((s) => Math.max(0.6, s - 0.15))}
            className="rounded px-2 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            −
          </button>
          <button
            onClick={() => setScale((s) => Math.min(2.2, s + 0.15))}
            className="rounded px-2 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            +
          </button>
          <button
            onClick={onClose}
            className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label="Close preview"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="border-b border-zinc-200 bg-yellow-50 px-4 py-2 text-xs italic text-zinc-700 dark:border-zinc-800 dark:bg-yellow-950/30 dark:text-yellow-100">
        “{citation.quote}”
      </div>

      <div className="flex-1 overflow-auto bg-zinc-100 p-4 dark:bg-zinc-900">
        <Document
          file={fileUrl}
          onLoadSuccess={(info) => {
            setNumPages(info.numPages);
            setLoadError(null);
          }}
          onLoadError={(err) => {
            const m = err instanceof Error ? err.message : String(err);
            if (/\b404\b|not found/i.test(m)) {
              setLoadError(
                "This document is no longer in your library. It may have been deleted. Start a new question to refresh sources.",
              );
            } else {
              setLoadError("Failed to load the PDF. The source may be unavailable.");
            }
          }}
          loading={
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading PDF…
            </div>
          }
          error={
            <p className="text-sm text-red-600 dark:text-red-400">
              {loadError ??
                "Failed to load the PDF. The source may be unavailable."}
            </p>
          }
        >
          <Page
            pageNumber={page}
            width={Math.max(320, width)}
            scale={scale}
            customTextRenderer={customTextRenderer}
            renderAnnotationLayer={false}
          />
        </Document>
      </div>
    </div>
  );
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
