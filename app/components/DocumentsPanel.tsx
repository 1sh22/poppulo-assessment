"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Trash2, Upload, FileText, Loader2, Link as LinkIcon } from "lucide-react";
import type { DocumentMeta } from "@/lib/rag/types";
import { cn, formatBytes } from "@/lib/utils";

interface Props {
  documents: DocumentMeta[];
  loading: boolean;
  onChange: () => void | Promise<void>;
}

export function DocumentsPanel({ documents, loading, onChange }: Props) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");

  const ingestFile = useCallback(
    async (file: File) => {
      setError(null);
      setUploading(true);
      try {
        const body = new FormData();
        body.set("file", file);
        const res = await fetch("/api/ingest", { method: "POST", body });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error ?? `Upload failed (${res.status})`);
        }
        await onChange();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [onChange],
  );

  const ingestUrl = useCallback(async () => {
    const url = urlInput.trim();
    if (!url) return;
    setError(null);
    setUploading(true);
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `Ingest failed (${res.status})`);
      }
      setUrlInput("");
      await onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ingest failed");
    } finally {
      setUploading(false);
    }
  }, [urlInput, onChange]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { "application/pdf": [".pdf"] },
    multiple: false,
    disabled: uploading,
    onDrop: async (files) => {
      const file = files[0];
      if (file) await ingestFile(file);
    },
  });

  const onDelete = useCallback(
    async (id: string) => {
      if (!confirm("Delete this document and its chunks?")) return;
      const res = await fetch(`/api/documents/${id}`, { method: "DELETE" });
      if (res.ok) await onChange();
    },
    [onChange],
  );

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="p-4 space-y-3">
        <div
          {...getRootProps()}
          className={cn(
            "border-2 border-dashed rounded-lg px-3 py-6 text-center text-sm transition-colors cursor-pointer",
            isDragActive
              ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30"
              : "border-zinc-300 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-600",
            uploading && "opacity-60 cursor-not-allowed",
          )}
        >
          <input {...getInputProps()} />
          {uploading ? (
            <div className="flex items-center justify-center gap-2 text-zinc-600 dark:text-zinc-300">
              <Loader2 className="h-4 w-4 animate-spin" /> Ingesting…
            </div>
          ) : (
            <div className="text-zinc-600 dark:text-zinc-300 flex flex-col items-center gap-1.5">
              <Upload className="h-4 w-4" />
              <div>
                <span className="font-medium">Drop a PDF</span> or click to browse
              </div>
              <div className="text-[11px] text-zinc-500">Max 25 MB, text-based PDFs only</div>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <LinkIcon className="absolute left-2 top-2.5 h-3.5 w-3.5 text-zinc-400" />
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="or paste a PDF URL"
              className="w-full rounded-md border border-zinc-300 bg-white pl-7 pr-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
              disabled={uploading}
              onKeyDown={(e) => {
                if (e.key === "Enter") ingestUrl();
              }}
            />
          </div>
          <button
            onClick={ingestUrl}
            disabled={uploading || !urlInput}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Fetch
          </button>
        </div>

        {error && (
          <div className="rounded-md bg-red-50 text-red-700 px-3 py-2 text-xs dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}
      </div>

      <div className="px-4 pb-2 text-xs font-medium text-zinc-500 uppercase tracking-wide">
        Documents
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {loading && documents.length === 0 ? (
          <div className="px-3 py-2 text-sm text-zinc-500">Loading…</div>
        ) : documents.length === 0 ? (
          <div className="px-3 py-2 text-sm text-zinc-500">
            No documents yet. Upload a PDF to get started.
          </div>
        ) : (
          <ul className="space-y-1">
            {documents.map((doc) => (
              <li
                key={doc.id}
                className="group flex items-start gap-2 rounded-md px-2 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                <FileText className="h-4 w-4 mt-0.5 text-zinc-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate" title={doc.name}>
                    {doc.name}
                  </div>
                  <div className="text-[11px] text-zinc-500">
                    {doc.pageCount} pages · {doc.chunkCount} chunks · {formatBytes(doc.bytes)}
                  </div>
                </div>
                <button
                  onClick={() => onDelete(doc.id)}
                  className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-500 transition-opacity"
                  aria-label={`Delete ${doc.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
