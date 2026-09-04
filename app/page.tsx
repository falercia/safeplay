import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Gamepad2, ShieldCheck, UserCheck, Users } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";

const STEPS = [
  { n: "1", title: "Conversa real", text: "Dois jogadores conversam em navegadores diferentes, em tempo real." },
  { n: "2", title: "Padrão acumulado", text: "Regras determinísticas avaliam a janela inteira: combinação, ordem, recorrência e tempo." },
  { n: "3", title: "Risco explicável", text: "Score 0–100, nível, tendência e sinais com evidências por ID de mensagem. LLM só quando justificado." },
  { n: "4", title: "Alerta parental", text: "Resumo em linguagem simples e recomendação prática, sem acusar ninguém." },
  { n: "5", title: "Revisão humana", text: "Fila com prioridade e SLA. Nenhuma decisão punitiva é automática." },
  { n: "6", title: "Auditoria", text: "Trilha append-only com versão das regras, modelo, latência, sinais e decisão humana." },
];

export default function Home() {
  return (
    <AppShell>
      <section className="mx-auto max-w-5xl">
        <div className="grid items-center gap-8 md:grid-cols-[1fr_auto]">
          <div>
            <p className="chip mb-3 text-safe-300">MIT Professional Education · Projeto de Impacto · Grupo 1</p>
            <h1 className="font-display text-3xl font-bold leading-tight sm:text-5xl">
              Detectar o <span className="text-safe-400">padrão</span>, não a frase.
            </h1>
            <p className="mt-4 max-w-xl text-base text-ink-200">
              Safe Play identifica sinais progressivos de risco em chats de jogos, avisa responsáveis em linguagem simples, encaminha casos críticos para revisão humana e registra uma trilha auditável. Esta é uma prova de conceito acadêmica com dados 100% sintéticos.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/demo">
                  Abrir a Central da demonstração <ArrowRight />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href="https://github.com" target="_blank" rel="noopener noreferrer">
                  Ver README
                </a>
              </Button>
            </div>
          </div>
          <Image src="/brand/safe-play-logo.png" alt="Logotipo Safe Play" width={220} height={226} priority className="mx-auto hidden md:block" />
        </div>

        <ol className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="panel p-4">
              <div className="font-display text-xs font-bold text-safe-400">{s.n}</div>
              <div className="mt-1 font-semibold">{s.title}</div>
              <p className="mt-1 text-sm text-ink-300">{s.text}</p>
            </li>
          ))}
        </ol>

        <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: Gamepad2, title: "Jogadores", text: "Chat com presença, digitação e nudges de segurança.", href: "/play" },
            { icon: UserCheck, title: "Responsável", text: "Estado atual, Safety Pulse, alertas ao vivo e recomendação.", href: "/guardian" },
            { icon: Users, title: "Moderação", text: "Fila por prioridade, SLA, contexto mínimo e ações com justificativa.", href: "/moderation" },
            { icon: ShieldCheck, title: "Apresentador", text: "Sessões, cenários, links, custo e roteiro passo a passo.", href: "/demo" },
          ].map((r) => (
            <div key={r.title} className="panel p-4">
              <r.icon className="size-5 text-sky-400" />
              <div className="mt-2 font-semibold">{r.title}</div>
              <p className="text-sm text-ink-300">{r.text}</p>
              <p className="mt-2 text-[11px] text-ink-400">acesso por link de convite gerado na Central</p>
            </div>
          ))}
        </div>

        <p className="mt-12 text-xs text-ink-400">
          Limites declarados: vocabulário sintético, sem validação em escala contra dataset rotulado, apenas texto e emoji. Metas de detecção, precisão e SLA do deck são metas futuras da solução, não resultados deste POC.
        </p>
      </section>
    </AppShell>
  );
}
