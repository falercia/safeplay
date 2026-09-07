"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, KeyRound, Loader2, UserRound } from "lucide-react";
import { GameFrame, GamePanel } from "@/components/game/game-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { enterGame, friendlyError } from "@/lib/hooks/use-player";
import { isConfigured } from "@/lib/env";
import { loadPlayer } from "@/lib/session-store";

/** Entrada: nome (pessoa real) + código de acesso compartilhado da partida. */
export function EnterScreen() {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const saved = loadPlayer();
    if (saved) {
      setName(saved.name);
      setCode(saved.accessCode);
    }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isConfigured()) {
      setError("Aplicação sem configuração do Supabase. Veja o README.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await enterGame({ name: name.trim(), accessCode: code.trim() });
      router.replace("/lobby");
    } catch (err) {
      setError(friendlyError(err).message);
      setBusy(false);
    }
  }

  return (
    <GameFrame width="max-w-md">
      <GamePanel className="mt-[8vh]">
        <h1 className="font-display text-2xl font-bold">Quem está jogando?</h1>
        <p className="mt-1 text-sm text-ink-300">Use seu nome de verdade ou um apelido. Ele aparece para o outro jogador e para a moderação.</p>
        <form className="mt-6 flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="flex items-center gap-1.5 text-ink-200">
              <UserRound className="size-4" /> Seu nome
            </span>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} minLength={2} required autoComplete="nickname" placeholder="Ex.: Nico" data-testid="player-name" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="flex items-center gap-1.5 text-ink-200">
              <KeyRound className="size-4" /> Código de acesso
            </span>
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={40} required autoComplete="off" placeholder="Ex.: NIMBUS-2026" className="font-mono uppercase tracking-wider" data-testid="access-code" />
          </label>
          {error ? (
            <p role="alert" className="rounded-xl border border-warn-500/40 bg-warn-500/10 px-3 py-2 text-xs text-warn-300">
              {error}
            </p>
          ) : null}
          <Button type="submit" size="lg" disabled={busy || name.trim().length < 2 || !code.trim()} data-testid="enter">
            {busy ? <Loader2 className="animate-spin" /> : <ArrowRight />} {busy ? "Entrando…" : "Entrar"}
          </Button>
        </form>
      </GamePanel>
    </GameFrame>
  );
}
