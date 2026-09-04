import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Logotipo oficial extraído como PNG com transparência do PDF da proposta (640x800, ativo embutido, não recorte de página).
 * Substituir por SVG oficial em public/brand quando disponível.
 */
export function Logo({ size = 36, withWordmark = true, className, href = "/" }: { size?: number; withWordmark?: boolean; className?: string; href?: string | null }) {
  const content = (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <Image src="/brand/safe-play-mark.png" alt="Safe Play" width={size} height={Math.round(size * 0.64)} priority className="h-auto" style={{ width: size }} />
      {withWordmark ? (
        <span className="font-display text-lg font-bold leading-none tracking-tight text-ink-50">
          safe<span className="text-safe-400">play</span>
        </span>
      ) : null}
    </span>
  );
  return href ? (
    <Link href={href} className="focus-ring rounded-lg" aria-label="Safe Play, início">
      {content}
    </Link>
  ) : (
    content
  );
}
