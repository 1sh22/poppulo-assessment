"use client";

import { useCallback, useEffect, useMemo, useState, type SetStateAction } from "react";
import dynamic from "next/dynamic";
import type { DocumentMeta } from "@/lib/rag/types";
import { Chat, type ChatCitation, type Message } from "./Chat";
import { AppSidebar } from "@/components/app-sidebar";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

const PdfPreview = dynamic(
  () => import("./PdfPreview").then((m) => m.PdfPreview),
  { ssr: false }
);

interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
}

const CHAT_SESSIONS_KEY = "rag-chat-sessions-v1";
const ACTIVE_CHAT_SESSION_KEY = "rag-active-chat-session-v1";

function getSessionTitle(messages: Message[]): string {
  const firstUserMessage = messages.find((m) => m.role === "user" && m.content.trim().length > 0);
  if (!firstUserMessage) return "New chat";
  const text = firstUserMessage.content.trim();
  return text.length > 48 ? `${text.slice(0, 48)}...` : text;
}

function createSession(): ChatSession {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: "New chat",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

function sortDocuments(docs: DocumentMeta[]): DocumentMeta[] {
  return [...docs].sort((a, b) => {
    if (!!a.builtIn !== !!b.builtIn) return a.builtIn ? -1 : 1;
    return a.createdAt < b.createdAt ? 1 : -1;
  });
}

export function Workbench() {
  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCitation, setActiveCitation] = useState<ChatCitation | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionsHydrated, setSessionsHydrated] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/documents", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { documents: DocumentMeta[] };
        setDocuments(sortDocuments(data.documents));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const handleIngest = useCallback(
    async (doc: DocumentMeta) => {
      setDocuments((prev) =>
        sortDocuments([
          doc,
          ...prev.filter((existing) => existing.id !== doc.id),
        ]),
      );
      await refresh();
    },
    [refresh],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    try {
      const rawSessions = window.localStorage.getItem(CHAT_SESSIONS_KEY);
      const rawActiveSession = window.localStorage.getItem(ACTIVE_CHAT_SESSION_KEY);
      const parsedSessions = rawSessions
        ? (JSON.parse(rawSessions) as ChatSession[])
            .filter((s) => s && typeof s.id === "string" && Array.isArray(s.messages))
            .map((s) => ({
              ...s,
              title: typeof s.title === "string" ? s.title : getSessionTitle(s.messages),
              createdAt: typeof s.createdAt === "number" ? s.createdAt : Date.now(),
              updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : Date.now(),
            }))
        : [];

      if (parsedSessions.length > 0) {
        setSessions(parsedSessions);
        const stillExists = parsedSessions.some((s) => s.id === rawActiveSession);
        setActiveSessionId(stillExists ? rawActiveSession : parsedSessions[0].id);
      } else {
        const firstSession = createSession();
        setSessions([firstSession]);
        setActiveSessionId(firstSession.id);
      }
    } catch {
      const firstSession = createSession();
      setSessions([firstSession]);
      setActiveSessionId(firstSession.id);
    } finally {
      setSessionsHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!sessionsHydrated) return;
    if (sessions.length === 0) {
      const next = createSession();
      setSessions([next]);
      setActiveSessionId(next.id);
      return;
    }
    if (!activeSessionId || !sessions.some((s) => s.id === activeSessionId)) {
      setActiveSessionId(sessions[0].id);
    }
  }, [activeSessionId, sessions, sessionsHydrated]);

  useEffect(() => {
    if (!sessionsHydrated || !activeSessionId) return;
    window.localStorage.setItem(CHAT_SESSIONS_KEY, JSON.stringify(sessions));
    window.localStorage.setItem(ACTIVE_CHAT_SESSION_KEY, activeSessionId);
  }, [activeSessionId, sessions, sessionsHydrated]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [activeSessionId, sessions]
  );

  const handleMessagesChange = useCallback(
    (updater: SetStateAction<Message[]>) => {
      if (!activeSessionId) return;
      const now = Date.now();
      setSessions((prev) =>
        prev.map((session) => {
          if (session.id !== activeSessionId) return session;
          const nextMessages =
            typeof updater === "function"
              ? (updater as (current: Message[]) => Message[])(session.messages)
              : updater;
          return {
            ...session,
            messages: nextMessages,
            title: getSessionTitle(nextMessages),
            updatedAt: now,
          };
        })
      );
    },
    [activeSessionId]
  );

  const handleNewChat = useCallback(() => {
    const next = createSession();
    setSessions((prev) => [next, ...prev]);
    setActiveSessionId(next.id);
    setActiveCitation(null);
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/documents/${id}`, { method: "DELETE" });
      if (res.ok) await refresh();
    },
    [refresh]
  );

  const handleDeleteSession = useCallback(
    (id: string) => {
      if (id === activeSessionId) {
        setActiveCitation(null);
      }
      setSessions((prev) => prev.filter((s) => s.id !== id));
    },
    [activeSessionId]
  );

  return (
    <SidebarProvider className="h-screen overflow-hidden">
      <AppSidebar
        documents={documents}
        chatSessions={sessions}
        activeSessionId={activeSessionId}
        onNewChat={handleNewChat}
        onSelectSession={(sessionId) => {
          setActiveSessionId(sessionId);
          setActiveCitation(null);
        }}
        onDeleteSession={handleDeleteSession}
        loading={loading}
        onDelete={handleDelete}
      />

      <SidebarInset className="overflow-hidden">
        <div className="flex h-full overflow-hidden">
          {/* Chat column */}
          <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
            <header className="flex h-11 shrink-0 items-center border-b border-border px-3 gap-2">
              <SidebarTrigger className="-ml-0.5" />
              <div className="h-4 w-px bg-border" />
              <span className="text-sm text-muted-foreground font-medium">
                PDF RAG
              </span>
            </header>
            <div className="flex-1 min-h-0 overflow-hidden">
              <Chat
                documents={documents}
                messages={activeSession?.messages ?? []}
                onMessagesChange={handleMessagesChange}
                onCitationClick={setActiveCitation}
                onIngest={handleIngest}
              />
            </div>
          </div>

          {/* Right PDF preview panel */}
          {activeCitation && (
            <aside className="hidden lg:flex w-[480px] shrink-0 flex-col border-l border-border">
              <PdfPreview
                citation={activeCitation}
                onClose={() => setActiveCitation(null)}
              />
            </aside>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
