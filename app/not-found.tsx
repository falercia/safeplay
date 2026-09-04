import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <AppShell>
      <div className="mx-auto mt-16 max-w-md text-center">
        <h1 className="font-display text-2xl font-bold">Página não encontrada</h1>
        <p className="mt-2 text-sm text-ink-300">Os painéis são acessados por links de convite gerados na Central da demonstração.</p>
        <Button asChild className="mt-6">
          <Link href="/demo">Ir para a Central</Link>
        </Button>
      </div>
    </AppShell>
  );
}
