"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  title,
  description,
  side = "center",
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { title: string; description?: string; side?: "center" | "right" }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-navy-950/70 backdrop-blur-sm data-[state=open]:animate-rise" />
      <DialogPrimitive.Content
        className={cn(
          "panel-strong fixed z-50 flex flex-col gap-4 p-5 shadow-2xl focus:outline-none",
          side === "center" && "left-1/2 top-1/2 w-[min(92vw,640px)] max-h-[88vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto",
          side === "right" && "right-0 top-0 h-full w-[min(96vw,720px)] overflow-y-auto rounded-none border-l",
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <DialogPrimitive.Title className="font-display text-lg font-semibold text-ink-50">{title}</DialogPrimitive.Title>
            {description ? <DialogPrimitive.Description className="mt-1 text-sm text-ink-300">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>}
          </div>
          <DialogPrimitive.Close className="focus-ring rounded-lg p-1.5 text-ink-300 hover:bg-white/5" aria-label="Fechar">
            <X className="size-5" />
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
