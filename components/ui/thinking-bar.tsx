"use client"

import { TextShimmer } from "@/components/ui/text-shimmer"
import { cn } from "@/lib/utils"
import { ChevronRight } from "lucide-react"

type ThinkingBarProps = {
  className?: string
  text?: string
  onStop?: () => void
  stopLabel?: string
  onClick?: () => void
}

export function ThinkingBar({
  className,
  text = "Thinking",
  onStop,
  stopLabel = "Answer now",
  onClick,
}: ThinkingBarProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 text-sm",
        className
      )}
    >
      {onClick ? (
        <button
          className="flex items-center gap-1.5 cursor-pointer"
          onClick={onClick}
        >
          <TextShimmer className="text-sm">{text}</TextShimmer>
          <ChevronRight className="size-3.5 text-muted-foreground" />
        </button>
      ) : (
        <TextShimmer className="text-sm">{text}</TextShimmer>
      )}
      {onStop ? (
        <button
          onClick={onStop}
          className="text-muted-foreground hover:text-foreground text-xs underline transition-colors"
        >
          {stopLabel}
        </button>
      ) : null}
    </div>
  )
}
