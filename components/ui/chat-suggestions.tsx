"use client"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type DivProps = React.ComponentProps<"div">

function ChatSuggestions({ className, ...props }: DivProps) {
  return <div className={cn("w-full space-y-3", className)} {...props} />
}

function ChatSuggestionsHeader({ className, ...props }: DivProps) {
  return (
    <div
      className={cn("flex flex-col items-center text-center gap-1", className)}
      {...props}
    />
  )
}

function ChatSuggestionsTitle({ className, ...props }: DivProps) {
  return (
    <div
      className={cn("text-sm font-medium text-foreground", className)}
      {...props}
    />
  )
}

function ChatSuggestionsDescription({ className, ...props }: DivProps) {
  return (
    <div className={cn("text-xs text-muted-foreground", className)} {...props} />
  )
}

function ChatSuggestionsContent({ className, ...props }: DivProps) {
  return (
    <div
      className={cn("flex flex-wrap items-center justify-center gap-2.5", className)}
      {...props}
    />
  )
}

function ChatSuggestion({
  className,
  children,
  ...props
}: React.ComponentProps<"button">) {
  return (
    <Button
      variant="outline"
      size="lg"
      className={cn(
        "h-auto min-h-10 rounded-xl px-4 py-2.5 text-sm leading-snug whitespace-normal text-left",
        className
      )}
      {...props}
    >
      {children}
    </Button>
  )
}

export {
  ChatSuggestion,
  ChatSuggestions,
  ChatSuggestionsContent,
  ChatSuggestionsDescription,
  ChatSuggestionsHeader,
  ChatSuggestionsTitle,
}
