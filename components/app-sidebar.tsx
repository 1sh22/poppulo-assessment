"use client";

import { useState } from "react";
import { Brain, ChevronDown, FileText, MessageSquarePlus, Trash2 } from "lucide-react";
import type { DocumentMeta } from "@/lib/rag/types";
import { cn, formatBytes } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from "@/components/ui/sidebar";

interface Props {
  documents: DocumentMeta[];
  chatSessions: Array<{
    id: string;
    title: string;
    updatedAt: number;
    messages: unknown[];
  }>;
  activeSessionId: string | null;
  onNewChat: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  loading: boolean;
  onDelete: (id: string) => void;
}

function formatLastUpdated(ts: number): string {
  const deltaMs = Date.now() - ts;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (deltaMs < minute) return "just now";
  if (deltaMs < hour) return `${Math.floor(deltaMs / minute)}m ago`;
  if (deltaMs < day) return `${Math.floor(deltaMs / hour)}h ago`;
  return `${Math.floor(deltaMs / day)}d ago`;
}

type DeleteTarget =
  | { type: "chat"; id: string; title: string }
  | { type: "document"; id: string; name: string };

export function AppSidebar({
  documents,
  chatSessions,
  activeSessionId,
  onNewChat,
  onSelectSession,
  onDeleteSession,
  loading,
  onDelete,
}: Props) {
  const [documentsOpen, setDocumentsOpen] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const sortedSessions = [...chatSessions].sort((a, b) => b.updatedAt - a.updatedAt);

  const closeDeleteDialog = () => {
    setDeleteTarget(null);
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    if (deleteTarget.type === "chat") {
      onDeleteSession(deleteTarget.id);
    } else {
      onDelete(deleteTarget.id);
    }
    setDeleteTarget(null);
  };

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-1 py-1">
          <div className="size-7 rounded-lg bg-transparent flex items-center justify-center shrink-0">
            <Brain className="size-4 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-none tracking-tight truncate">
              PDF RAG
            </p>
            <p className="text-[10px] text-sidebar-foreground/50 mt-0.5 truncate">
              poppulo assignment
            </p>
          </div>
        </div>
        <Button className="w-full" size="sm" onClick={onNewChat}>
          <MessageSquarePlus className="size-4" />
          New chat
        </Button>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Chats</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {sortedSessions.map((session) => (
                <SidebarMenuItem key={session.id}>
                  <SidebarMenuButton
                    isActive={session.id === activeSessionId}
                    className="h-auto items-start py-2 group/item"
                    onClick={() => onSelectSession(session.id)}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium leading-tight" title={session.title}>
                        {session.title}
                      </p>
                      <p className="text-[10px] text-sidebar-foreground/50 mt-0.5">
                        {session.messages.length} message
                        {session.messages.length === 1 ? "" : "s"} · {formatLastUpdated(session.updatedAt)}
                      </p>
                    </div>
                  </SidebarMenuButton>
                  <SidebarMenuAction
                    showOnHover
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget({
                        type: "chat",
                        id: session.id,
                        title: session.title,
                      });
                    }}
                    aria-label={`Delete ${session.title}`}
                    className="text-sidebar-foreground/40 hover:text-destructive top-2"
                  >
                    <Trash2 className="size-3.5" />
                  </SidebarMenuAction>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <Collapsible open={documentsOpen} onOpenChange={setDocumentsOpen}>
            <CollapsibleTrigger
              className={cn(
                "flex w-full h-8 shrink-0 items-center justify-between gap-2 rounded-md px-2",
                "text-left text-xs font-medium text-sidebar-foreground/70",
                "ring-sidebar-ring outline-hidden transition-[margin,opacity] duration-200 ease-linear",
                "group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0",
                "hover:bg-sidebar-accent/50 focus-visible:ring-2",
              )}
            >
              <span className="min-w-0 flex items-center gap-1.5 truncate">
                <FileText className="size-3.5 shrink-0 text-sidebar-foreground/60" />
                Documents
                {documents.length > 0 && (
                  <span className="text-[10px] font-normal text-sidebar-foreground/50 tabular-nums">
                    ({documents.length})
                  </span>
                )}
              </span>
              <ChevronDown
                className={cn(
                  "size-3.5 shrink-0 text-sidebar-foreground/50 transition-transform duration-200",
                  documentsOpen && "rotate-180",
                )}
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <SidebarGroupContent>
                {loading && documents.length === 0 ? (
                  <SidebarMenu>
                    {Array.from({ length: 3 }).map((_, i) => (
                      <SidebarMenuItem key={i}>
                        <SidebarMenuSkeleton showIcon />
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                ) : documents.length === 0 ? (
                  <p className="px-2 py-3 text-xs text-sidebar-foreground/50 leading-relaxed">
                    No documents yet.
                    <br />
                    Upload a PDF or paste a URL in the chat input.
                  </p>
                ) : (
                  <SidebarMenu>
                    {documents.map((doc) => (
                      <SidebarMenuItem key={doc.id}>
                        <SidebarMenuButton className="h-auto items-start py-2 group/item">
                          <FileText className="size-4 shrink-0 mt-0.5 text-sidebar-foreground/60" />
                          <div className="min-w-0 flex-1">
                            <p
                              className="truncate text-sm font-medium leading-tight"
                              title={doc.name}
                            >
                              {doc.name}
                            </p>
                            <p className="text-[10px] text-sidebar-foreground/50 mt-0.5">
                              {doc.pageCount}p · {doc.chunkCount} chunks ·{" "}
                              {formatBytes(doc.bytes)}
                            </p>
                          </div>
                        </SidebarMenuButton>
                        <SidebarMenuAction
                          showOnHover
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTarget({
                              type: "document",
                              id: doc.id,
                              name: doc.name,
                            });
                          }}
                          aria-label={`Delete ${doc.name}`}
                          className="text-sidebar-foreground/40 hover:text-destructive top-2"
                        >
                          <Trash2 className="size-3.5" />
                        </SidebarMenuAction>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                )}
              </SidebarGroupContent>
            </CollapsibleContent>
          </Collapsible>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <p className="px-2 py-1 text-[10px] text-sidebar-foreground/50">
          {documents.length} document{documents.length === 1 ? "" : "s"} indexed
        </p>
      </SidebarFooter>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton>
          {deleteTarget && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {deleteTarget.type === "chat"
                    ? "Delete this chat?"
                    : "Delete this document?"}
                </DialogTitle>
                <DialogDescription>
                  {deleteTarget.type === "chat" ? (
                    <>
                      <span className="font-medium text-foreground">
                        {deleteTarget.title}
                      </span>{" "}
                      will be removed, including all messages. This cannot be
                      undone.
                    </>
                  ) : (
                    <>
                      <span className="font-medium text-foreground">
                        {deleteTarget.name}
                      </span>{" "}
                      and all of its search chunks will be removed from the
                      index. This cannot be undone.
                    </>
                  )}
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={closeDeleteDialog}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={confirmDelete}
                >
                  Delete
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Sidebar>
  );
}
