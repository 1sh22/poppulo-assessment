"use client";

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  useMemo,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  Paperclip,
  Link2,
  ArrowUp,
  Square,
  X,
  FileText,
  ChevronDown,
  ExternalLink,
  Check,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

import type { DocumentMeta } from "@/lib/rag/types";
import { ingestPdfFile, ingestPdfUrl } from "@/lib/ingest-client";
import { cn } from "@/lib/utils";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputActions,
  PromptInputAction,
} from "@/components/ui/prompt-input";
import {
  ChatContainerRoot,
  ChatContainerContent,
  ChatContainerScrollAnchor,
} from "@/components/ui/chat-container";
import { ScrollButton } from "@/components/ui/scroll-button";
import { ThinkingBar } from "@/components/ui/thinking-bar";
import { Markdown } from "@/components/ui/markdown";
import { Source, SourceTrigger, SourceContent } from "@/components/ui/source";
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from "@/components/ui/reasoning";
import { Button } from "@/components/ui/button";
import {
  ChatSuggestion,
  ChatSuggestions,
  ChatSuggestionsContent,
  ChatSuggestionsDescription,
  ChatSuggestionsHeader,
  ChatSuggestionsTitle,
} from "@/components/ui/chat-suggestions";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { Components } from "react-markdown";
import { TextShimmer } from "@/components/ui/text-shimmer";

export interface ChatCitation {
  chunkId: string;
  docId: string;
  docName: string;
  page: number;
  paragraphIdx: number;
  quote: string;
  /** 1-based index matching [n] in answer text. Optional for backwards compat with old cached sessions. */
  citationNumber?: number;
}

interface RetrievedChunk {
  chunkId: string;
  docId: string;
  docName: string;
  page: number;
  paragraphIdx: number;
  score: number;
  text: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: ChatCitation[];
  retrieved?: RetrievedChunk[];
  elapsedMs?: number;
  error?: string;
  /** The standalone query actually used for retrieval (differs from content on follow-ups). */
  resolvedQuery?: string;
}

interface Props {
  documents: DocumentMeta[];
  messages: Message[];
  onMessagesChange: Dispatch<SetStateAction<Message[]>>;
  onCitationClick: (c: ChatCitation) => void;
  onIngest: () => Promise<void>;
}

const SUGGESTIONS = [
  "What is the complexity of self-attention per layer?",
  "How is DeepSeek-R1-Zero trained without supervised fine-tuning?",
  "What are the main components of the Transformer encoder?",
  "What cold-start data does DeepSeek-R1 use?",
];

export function Chat({
  documents,
  messages,
  onMessagesChange,
  onCitationClick,
  onIngest,
}: Props) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const messagesRef = useRef<Message[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  }, []);

  const ask = useCallback(
    async (question: string) => {
      const qTrim = question.trim();
      if (!qTrim || busy) return;

      const history = messagesRef.current
        .filter((m) => !m.error && m.content.length > 0)
        .slice(-6)
        .map((m) => ({
          role: m.role,
          content: m.content,
          citedDocIds:
            m.role === "assistant" && m.citations
              ? Array.from(new Set(m.citations.map((c) => c.docId)))
              : undefined,
          // Pass retrieved chunk IDs so the server can reuse them for
          // purely stylistic follow-ups (ELI5, "make it shorter", etc.)
          // without running a fresh retrieval pass.
          citedChunkIds:
            m.role === "assistant" && m.retrieved
              ? m.retrieved.map((r) => r.chunkId)
              : undefined,
        }));

      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: qTrim,
      };
      const pendingId = crypto.randomUUID();
      const pending: Message = {
        id: pendingId,
        role: "assistant",
        content: "",
      };
      onMessagesChange((m) => [...m, userMsg, pending]);
      setInput("");
      setBusy(true);

      const abort = new AbortController();
      abortRef.current = abort;

      try {
        const res = await fetch("/api/query", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ question: qTrim, history }),
          signal: abort.signal,
        });

        if (!res.ok || !res.body) {
          const err = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(err.error ?? `Query failed (${res.status})`);
        }

        // Parse SSE stream
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let accText = "";

        outer: while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const blocks = buf.split("\n\n");
          buf = blocks.pop() ?? "";

          for (const block of blocks) {
            const dataLine = block
              .split("\n")
              .find((l) => l.startsWith("data: "));
            if (!dataLine) continue;
            let event: Record<string, unknown>;
            try {
              event = JSON.parse(dataLine.slice(6));
            } catch {
              continue;
            }

            if (event.type === "retrieved") {
              onMessagesChange((m) =>
                m.map((msg) =>
                  msg.id === pendingId
                    ? { ...msg, retrieved: event.chunks as RetrievedChunk[] }
                    : msg,
                ),
              );
            } else if (event.type === "delta") {
              accText += event.text as string;
              const snapshot = accText;
              onMessagesChange((m) =>
                m.map((msg) =>
                  msg.id === pendingId ? { ...msg, content: snapshot } : msg,
                ),
              );
            } else if (event.type === "done") {
              onMessagesChange((m) =>
                m.map((msg) =>
                  msg.id === pendingId
                    ? {
                        ...msg,
                        citations: event.citations as ChatCitation[],
                        elapsedMs: event.elapsedMs as number,
                        resolvedQuery:
                          typeof event.resolvedQuery === "string"
                            ? event.resolvedQuery
                            : undefined,
                      }
                    : msg,
                ),
              );
            } else if (event.type === "error") {
              throw new Error((event.error as string) ?? "Server error");
            }
          }
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        onMessagesChange((m) =>
          m.map((msg) =>
            msg.id === pendingId
              ? {
                  ...msg,
                  error: e instanceof Error ? e.message : "Failed to answer",
                }
              : msg,
          ),
        );
      } finally {
        abortRef.current = null;
        setBusy(false);
      }
    },
    [busy, onMessagesChange],
  );

  const handleFile = useCallback(
    async (file: File) => {
      setUploadError(null);
      setUploading(true);
      const toastId = toast.custom(() => <IngestProgressToast />, {
        duration: Infinity,
      });
      try {
        await ingestPdfFile(file);
        toast.dismiss(toastId);
        toast.success("Document ready", { description: `"${file.name}" has been ingested.` });
        await onIngest();
      } catch (e) {
        toast.dismiss(toastId);
        const msg = e instanceof Error ? e.message : "Upload failed";
        toast.error("Ingest failed", { description: msg });
        setUploadError(msg);
      } finally {
        setUploading(false);
      }
    },
    [onIngest],
  );

  const handleUrl = useCallback(async () => {
    const url = urlInput.trim();
    if (!url) return;
    setUploadError(null);
    setUploading(true);
    const toastId = toast.custom(() => <IngestProgressToast />, {
      duration: Infinity,
    });
    try {
      await ingestPdfUrl(url);
      toast.dismiss(toastId);
      toast.success("Document ready", { description: "PDF has been ingested from URL." });
      setUrlInput("");
      setShowUrlInput(false);
      await onIngest();
    } catch (e) {
      toast.dismiss(toastId);
      const msg = e instanceof Error ? e.message : "Ingest failed";
      toast.error("Ingest failed", { description: msg });
      setUploadError(msg);
    } finally {
      setUploading(false);
    }
  }, [urlInput, onIngest]);

  return (
    <div className="flex flex-col h-full">
      {/* Message area */}
      <ChatContainerRoot className="flex-1 min-h-0 relative">
        <ChatContainerContent className="py-10 px-4">
          {messages.length === 0 ? (
            <EmptyState
              hasDocs={documents.length > 0}
            />
          ) : (
            <div className="mx-auto max-w-3xl w-full space-y-8">
              {messages.map((m) => (
                <MessageItem
                  key={m.id}
                  message={m}
                  onCitation={onCitationClick}
                />
              ))}
            </div>
          )}
          <ChatContainerScrollAnchor />
        </ChatContainerContent>

        <div className="absolute bottom-4 right-4 z-10">
          <ScrollButton />
        </div>
      </ChatContainerRoot>

      {/* Input area */}
      <div className="px-4 pb-6 pt-2 shrink-0">
        <div className="mx-auto max-w-3xl w-full space-y-2">
          {uploadError && (
            <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <span className="flex-1">{uploadError}</span>
              <button onClick={() => setUploadError(null)}>
                <X className="size-3.5" />
              </button>
            </div>
          )}

          {messages.length === 0 && documents.length > 0 && (
            <div className="w-full grid grid-cols-2 gap-2">
              {SUGGESTIONS.map((s) => (
                <ChatSuggestion
                  key={s}
                  onClick={() => ask(s)}
                  className="w-full items-start"
                >
                  {s}
                </ChatSuggestion>
              ))}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = "";
            }}
          />

          <PromptInput
            value={input}
            onValueChange={setInput}
            onSubmit={() => ask(input)}
            isLoading={busy}
            className="w-full shadow-lg"
          >
            {showUrlInput && (
              <div
                className="flex items-center gap-2 border-b border-border px-4 py-2"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <Link2 className="size-3.5 text-muted-foreground shrink-0" />
                <input
                  type="url"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="Paste a PDF URL and press Enter…"
                  className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleUrl();
                    if (e.key === "Escape") {
                      setShowUrlInput(false);
                      setUrlInput("");
                    }
                  }}
                  autoFocus
                  disabled={uploading}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs shrink-0"
                  onClick={handleUrl}
                  disabled={!urlInput.trim() || uploading}
                >
                  {uploading ? "Adding…" : "Add"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 shrink-0"
                  onClick={() => {
                    setShowUrlInput(false);
                    setUrlInput("");
                  }}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            )}

            <PromptInputTextarea
              placeholder={
                documents.length === 0
                  ? "Upload a PDF or add a URL to get started…"
                  : "Ask anything about your documents…"
              }
              className="px-4 py-3 min-h-[52px]"
            />

            <PromptInputActions className="justify-between px-2 pb-2">
              <div className="flex items-center gap-1">
                <PromptInputAction tooltip="Upload PDF">
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-8 w-8 rounded-full p-0 text-muted-foreground hover:text-foreground",
                      uploading && "opacity-50 pointer-events-none",
                    )}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip className="size-4" />
                  </Button>
                </PromptInputAction>

                <PromptInputAction tooltip="Add PDF URL">
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-8 w-8 rounded-full p-0 text-muted-foreground hover:text-foreground",
                      showUrlInput && "bg-accent text-foreground",
                      uploading && "opacity-50 pointer-events-none",
                    )}
                    onClick={() => setShowUrlInput((v) => !v)}
                  >
                    <Link2 className="size-4" />
                  </Button>
                </PromptInputAction>

                {uploading && (
                  <span className="text-xs text-muted-foreground animate-pulse pl-1">
                    Ingesting…
                  </span>
                )}
              </div>

              <PromptInputAction tooltip={busy ? "Stop" : "Send"}>
                <Button
                  size="sm"
                  className="h-8 w-8 rounded-full p-0"
                  onClick={busy ? stop : () => ask(input)}
                  disabled={!busy && (!input.trim() || documents.length === 0)}
                >
                  {busy ? (
                    <Square className="size-3 fill-current" />
                  ) : (
                    <ArrowUp className="size-4" />
                  )}
                </Button>
              </PromptInputAction>
            </PromptInputActions>
          </PromptInput>

          <p className="text-center text-[11px] text-muted-foreground">
            PDF RAG · Hybrid retrieval with source citations
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─── Empty State ─────────────────────────────────────────────────────────── */

function EmptyState({
  hasDocs,
}: {
  hasDocs: boolean;
}) {
  return (
    <div className="mx-auto max-w-2xl w-full flex flex-col items-center justify-center py-8 px-4">
      <div className="text-center space-y-3">
        <h2 className="text-3xl font-semibold tracking-tight">
          {hasDocs ? "What would you like to know?" : "Ask questions of your PDFs"}
        </h2>
        {!hasDocs && (
          <p className="text-muted-foreground text-sm max-w-md mx-auto">
            Upload a PDF using the 📎 button or paste a URL using the 🔗 button
            in the input below.
          </p>
        )}
      </div>

    </div>
  );
}

/* ─── Message Item ────────────────────────────────────────────────────────── */

function MessageItem({
  message,
  onCitation,
}: {
  message: Message;
  onCitation: (c: ChatCitation) => void;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-2xl bg-primary px-4 py-3 text-sm text-primary-foreground leading-relaxed">
          {message.content}
        </div>
      </div>
    );
  }

  if (message.error) {
    return (
      <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
        {message.error}
      </div>
    );
  }

  if (!message.content) {
    return (
      <div className="py-2 pl-1">
        <ThinkingBar text="Searching your documents and generating answer" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Answer text with inline citations */}
      <div className="text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none">
        <AnswerText
          text={message.content}
          citations={message.citations ?? []}
          onCitation={onCitation}
        />
        {message.elapsedMs !== undefined && (
          <p className="text-[11px] text-muted-foreground mt-3 not-prose">
            {message.elapsedMs} ms
          </p>
        )}
      </div>

      {/* Sources */}
      {message.citations && message.citations.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            Sources
          </p>
          <div className="flex flex-wrap gap-1.5">
            {message.citations.map((c, i) => (
              <Source key={`${c.chunkId}-${c.citationNumber ?? i}`} href="#">
                <SourceTrigger
                  label={`${c.citationNumber ?? i + 1} · ${c.docName.replace(/\.pdf$/i, "")} · p.${c.page}`}
                  icon={
                    <FileText className="size-3 shrink-0 text-muted-foreground" />
                  }
                  onClick={(e) => {
                    e.preventDefault();
                    onCitation(c);
                  }}
                />
                <SourceContent
                  title={`${c.docName} — page ${c.page}`}
                  description={c.quote}
                  icon={
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                  }
                  onClick={() => onCitation(c)}
                />
              </Source>
            ))}
          </div>
        </div>
      )}

      {/* Retrieved passages */}
      {message.retrieved && message.retrieved.length > 0 && (
        <Reasoning className="w-full">
          <ReasoningTrigger className="text-xs text-muted-foreground gap-1.5">
            <span>View retrieved passages · {message.retrieved.length}</span>
          </ReasoningTrigger>
          <ReasoningContent className="mt-2" contentClassName="not-prose">
            <div className="space-y-1">
              {message.retrieved.map((r, i) => (
                <PassageCard
                  key={r.chunkId}
                  passage={r}
                  index={i}
                  onViewInPdf={onCitation}
                />
              ))}
            </div>
          </ReasoningContent>
        </Reasoning>
      )}
    </div>
  );
}

/* ─── Passage Card ────────────────────────────────────────────────────────── */

function PassageCard({
  passage,
  index,
  onViewInPdf,
}: {
  passage: RetrievedChunk;
  index: number;
  onViewInPdf: (c: ChatCitation) => void;
}) {
  const [open, setOpen] = useState(false);

  const handleViewInPdf = () => {
    // Build a ChatCitation from the retrieved chunk so PdfPreview can show it.
    const firstSentence =
      passage.text
        .split(/(?<=[.!?])\s+/)
        .find((s) => s.trim().length > 20)
        ?.trim() ?? passage.text.slice(0, 120).trim();
    onViewInPdf({
      chunkId: passage.chunkId,
      docId: passage.docId,
      docName: passage.docName,
      page: passage.page,
      paragraphIdx: passage.paragraphIdx ?? 0,
      quote: firstSentence,
    });
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-lg border border-border overflow-hidden">
        <CollapsibleTrigger className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/50 transition-colors text-left cursor-pointer">
          <div className="flex items-center gap-2 text-[11px] min-w-0">
            <span className="font-semibold text-muted-foreground tabular-nums shrink-0">
              #{index + 1}
            </span>
            <span className="font-medium text-foreground truncate">
              {passage.docName.replace(/\.pdf$/i, "")}
            </span>
            <span className="text-muted-foreground shrink-0">
              · p.{passage.page}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-3">
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {passage.score.toFixed(3)}
            </span>
            <ChevronDown
              className={cn(
                "size-3 text-muted-foreground transition-transform duration-200",
                open && "rotate-180",
              )}
            />
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-3 pb-3 pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground leading-relaxed">
              {passage.text}
            </p>
            <button
              onClick={handleViewInPdf}
              className="mt-2 flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <ExternalLink className="size-3" />
              View in PDF
            </button>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

/* ─── Ingest Progress Toast ───────────────────────────────────────────────── */

const INGEST_STEPS = [
  { label: "Processing document", delay: 0 },
  { label: "Extracting text from PDF", delay: 1800 },
  { label: "Breaking into chunks", delay: 4000 },
  { label: "Generating embeddings", delay: 7000 },
  { label: "Updating search index", delay: 10000 },
];

function IngestProgressToast() {
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    const timers = INGEST_STEPS.slice(1).map(({ delay }, i) =>
      window.setTimeout(() => setCurrentStep(i + 1), delay),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="rounded-xl border border-border bg-background p-4 w-[320px] shadow-xl">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <Loader2 className="size-3.5 animate-spin text-primary shrink-0" />
        <span className="text-sm font-semibold text-foreground">
          Ingesting document
        </span>
      </div>

      {/* Step chain */}
      <div className="flex flex-col gap-0">
        {INGEST_STEPS.map((step, i) => {
          const isDone = i < currentStep;
          const isCurrent = i === currentStep;
          const isPending = i > currentStep;

          return (
            <div key={step.label} className="flex items-start gap-0">
              {/* Connector column */}
              <div className="flex flex-col items-center mr-3">
                <div
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full border transition-colors duration-300 shrink-0",
                    isDone
                      ? "border-green-500 bg-green-500/10"
                      : isCurrent
                        ? "border-primary bg-primary/10"
                        : "border-border bg-transparent",
                  )}
                >
                  {isDone ? (
                    <Check className="size-2.5 text-green-500" />
                  ) : isCurrent ? (
                    <ChevronRight className="size-2.5 text-primary" />
                  ) : (
                    <div className="size-1.5 rounded-full bg-border" />
                  )}
                </div>
                {/* Vertical line between steps */}
                {i < INGEST_STEPS.length - 1 && (
                  <div
                    className={cn(
                      "w-px flex-1 my-0.5 transition-colors duration-500",
                      isDone ? "bg-green-500/30" : "bg-border/50",
                    )}
                    style={{ minHeight: 14 }}
                  />
                )}
              </div>

              {/* Step label */}
              <div className={cn("pb-3 pt-0.5", i === INGEST_STEPS.length - 1 && "pb-0")}>
                {isCurrent ? (
                  <TextShimmer
                    className="text-xs font-medium"
                    duration={2.5}
                    spread={25}
                  >
                    {step.label}
                  </TextShimmer>
                ) : (
                  <span
                    className={cn(
                      "text-xs transition-opacity duration-300",
                      isDone
                        ? "text-muted-foreground"
                        : "text-muted-foreground/40",
                    )}
                  >
                    {step.label}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Answer Text — renders markdown with inline citation badges ──────────── */

/**
 * Pre-processes the answer text by replacing [n] citation markers with
 * backtick-wrapped sentinel tokens (%%CITE_n%%) that Markdown treats as
 * inline code. A custom `code` component then renders them as clickable badges
 * — always inline within the bullet, never on a new line.
 */
function AnswerText({
  text,
  citations,
  onCitation,
}: {
  text: string;
  citations: ChatCitation[];
  onCitation: (c: ChatCitation) => void;
}) {
  // Strip literal "[n]" placeholders the model sometimes emits when it
  // misreads the prompt template (the letter n, not a digit).
  const cleaned = text.replace(/\[n(?:\s*,\s*[a-z])*\]/gi, "");

  // Replace [1], [2,3], etc. with inline code sentinel tokens.
  const processed = cleaned.replace(
    /\[(\d+(?:\s*,\s*\d+)*)\]/g,
    (_, nums: string) =>
      nums
        .split(",")
        .map((n) => `\`%%CITE_${n.trim()}%%\``)
        .join(" "),
  );

  // Build a map from citation number → citation for O(1) lookup.
  // For new data, citationNumber is set by the server (handles non-contiguous [1],[3],[4]).
  // For old cached sessions without citationNumber, fall back to scanning the answer
  // text for [n] markers in order and mapping them to the citation array by position.
  const citationMap = useMemo(() => {
    const map = new Map<number, ChatCitation>();

    // Check if all citations carry citationNumber (new data).
    const allHaveNumber = citations.every((c) => c.citationNumber !== undefined);
    if (allHaveNumber) {
      for (const c of citations) map.set(c.citationNumber!, c);
      return map;
    }

    // Legacy fallback: scan text for [n] markers in appearance order and
    // pair each unique n with the next citation in the array by position.
    const nums: number[] = [];
    const re = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      for (const part of match[1].split(",")) {
        const n = parseInt(part.trim(), 10);
        if (!nums.includes(n)) nums.push(n);
      }
    }
    nums.forEach((n, i) => {
      if (citations[i]) map.set(n, citations[i]);
    });
    return map;
  }, [citations, text]);

  const citationComponents: Partial<Components> = {
    code({ children }) {
      const s = String(children);
      const m = s.match(/^%%CITE_(\d+)%%$/);
      if (m) {
        const n = parseInt(m[1], 10);
        const cite = citationMap.get(n);
        if (cite) {
          return (
            <span
              className="citation-mark"
              role="button"
              onClick={() => onCitation(cite)}
              title={`${cite.docName} · p.${cite.page}`}
            >
              {n}
            </span>
          );
        }
        // Citation not yet resolved (still streaming) — show dimmed badge.
        return <span className="citation-mark opacity-50">{n}</span>;
      }
      return <code>{children}</code>;
    },
  };

  return <Markdown components={citationComponents}>{processed}</Markdown>;
}
