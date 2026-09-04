import * as React from "react";
import { cn } from "@/lib/utils";
import type { Level } from "@/lib/types";
import { levelClass, levelLabel } from "@/lib/format";

export function Badge({ className, children, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn("chip", className)} {...props}>
      {children}
    </span>
  );
}

export function LevelBadge({ level, className, size = "md" }: { level: Level; className?: string; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "text-[11px] px-2 py-0.5", md: "text-xs px-2.5 py-1", lg: "text-sm px-3 py-1.5" };
  return (
    <span className={cn("chip level-badge font-bold uppercase tracking-wide", levelClass(level), sizes[size], className)} data-level={level}>
      <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: "var(--lv)" }} />
      {levelLabel(level)}
    </span>
  );
}
