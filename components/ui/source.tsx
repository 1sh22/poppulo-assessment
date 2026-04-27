"use client"

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { cn } from "@/lib/utils"
import { createContext, useContext } from "react"

const SourceContext = createContext<{
  href: string
  domain: string
} | null>(null)

function useSourceContext() {
  const ctx = useContext(SourceContext)
  if (!ctx) throw new Error("Source.* must be used inside <Source>")
  return ctx
}

export type SourceProps = {
  href: string
  children: React.ReactNode
}

export function Source({ href, children }: SourceProps) {
  let domain = ""
  try {
    domain = new URL(href).hostname
  } catch {
    domain = href.split("/").pop() || href
  }

  return (
    <SourceContext.Provider value={{ href, domain }}>
      <HoverCard>{children}</HoverCard>
    </SourceContext.Provider>
  )
}

export type SourceTriggerProps = {
  label?: string | number
  showFavicon?: boolean
  icon?: React.ReactNode
  className?: string
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void
}

export function SourceTrigger({
  label,
  showFavicon = false,
  icon,
  className,
  onClick,
}: SourceTriggerProps) {
  const { href, domain } = useSourceContext()
  const labelToShow = label ?? domain.replace("www.", "")

  return (
    <HoverCardTrigger
      delay={150}
      closeDelay={0}
      render={
        <a
          href={href}
          target={onClick ? undefined : "_blank"}
          rel="noopener noreferrer"
          onClick={onClick}
          className={cn(
            "bg-muted text-muted-foreground hover:bg-muted-foreground/30 hover:text-primary inline-flex h-6 max-w-48 items-center gap-1.5 overflow-hidden rounded-full py-0 text-xs no-underline transition-colors duration-150",
            showFavicon || icon ? "pr-2.5 pl-1.5" : "px-2.5",
            className
          )}
        />
      }
    >
      {icon ?? (showFavicon && (
        <img
          src={`https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(href)}`}
          alt="favicon"
          width={14}
          height={14}
          className="size-3.5 rounded-full shrink-0"
        />
      ))}
      <span className="truncate font-normal">{labelToShow}</span>
    </HoverCardTrigger>
  )
}

export type SourceContentProps = {
  title: string
  description: string
  icon?: React.ReactNode
  className?: string
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void
}

export function SourceContent({
  title,
  description,
  icon,
  className,
  onClick,
}: SourceContentProps) {
  return (
    <HoverCardContent className={cn("w-72 p-0 shadow-md", className)}>
      <div
        className={cn("flex flex-col gap-2 p-3", onClick && "cursor-pointer")}
        onClick={onClick}
      >
        {icon && (
          <div className="flex items-center gap-1.5">
            {icon}
            <div className="text-primary truncate text-xs font-medium">{title}</div>
          </div>
        )}
        {!icon && (
          <div className="text-foreground text-sm font-medium line-clamp-1">{title}</div>
        )}
        <div className="text-muted-foreground text-xs leading-relaxed line-clamp-4 italic">
          &ldquo;{description}&rdquo;
        </div>
      </div>
    </HoverCardContent>
  )
}
