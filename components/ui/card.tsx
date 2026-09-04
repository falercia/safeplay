import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, strong, ...props }: React.HTMLAttributes<HTMLDivElement> & { strong?: boolean }) {
  return <div className={cn(strong ? "panel-strong" : "panel", "p-4 sm:p-5", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("font-display text-sm font-semibold uppercase tracking-wider text-ink-300", className)} {...props} />;
}
