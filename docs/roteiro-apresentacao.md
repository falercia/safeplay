# Roteiro de apresentação · Safe Play POC (5 a 7 minutos)

Preparação (antes da apresentação), em https://safe-play-poc.vercel.app:
1. Duas pessoas (ou duas janelas anônimas) entram pela tela inicial (**Jogar** → nome + código de acesso do jogo). A primeira cria um mundo; a segunda entra nele pelo lobby. Essa é a tela de jogo + chat.
2. `/responsavel`: código de responsável + nome, escolher o mesmo mundo.
3. `/moderacao`: código de moderação + nome.
4. `/apresentador`: segredo do apresentador, selecionar o mundo, cenário **Risco progressivo**. Fica no notebook de quem apresenta; os avanços do roteiro entram no chat como falas dos dois jogadores.
Dispor três janelas lado a lado: mundo (jogo + chat), painel do responsável e moderação. Os códigos estão nos secrets do Supabase (GAME_ACCESS_CODE, GUARDIAN_CODE, MODERATOR_CODE, PRESENTER_SECRET).

## 0:00 · O problema em uma frase (30 s)
"Plataformas analisam frases isoladas. Aliciamento é um padrão que se constrói ao longo do tempo. O Safe Play detecta o padrão, não a frase."

## 0:30 · Conversa real (60 s)
- O segundo jogador digita "boa partida! você joga muito bem" (ou o apresentador avança a linha 1); mostrar a mensagem chegando no outro navegador sem refresh, com presença, "digitando" e o balão sobre o personagem no jogo.
- Responsável: estado **Normal**, Safety Pulse em 0.
- Ponto: "Nada aqui é suspeito. E o sistema concorda."

## 1:30 · O padrão se acumula (120 s)
- Avançar o roteiro até a linha 7 (idade, "seus pais deixam?"). Mostrar Atenção no painel do responsável, o alerta chegando ao vivo e o resumo em linguagem simples.
- Abrir "Explicar": evidências por ID, sinais, versão das regras, modelo e latência. "Explicação por evidências, não cadeia de pensamento."
- Avançar até a linha 9 (isolamento): **Alto**, caso aberto na fila do moderador com prioridade 2 e SLA. Mostrar a comparação **mensagem isolada vs padrão acumulado** no Safety Pulse.

## 3:30 · Código sintético e migração (60 s)
- Avançar até a linha 13 ("portal zp"): **Crítico**, prioridade 1, contenção sugerida. Mostrar os chips de sinais e o bônus de sequência.
- Ponto: "Nenhuma mensagem sozinha ultrapassa atenção. A combinação em ordem é que escala."

## 4:30 · Revisão humana (60 s)
- Moderador: abrir o caso, ver apenas a janela relevante, sinais com confiança e divergência regra × LLM.
- Tentar confirmar sem justificativa (bloqueado). Confirmar com justificativa.
- Responsável: a decisão e a justificativa aparecem em tempo real. Auditoria registra `case.confirm_risk`.

## 5:30 · Falha da IA sem derrubar o chat (45 s)
- Em `/apresentador`: ligar "Forçar erro na chamada" e avançar mais uma linha. O chat segue, o painel mostra "modo degradado" e o motor determinístico continua decidindo.
- Ponto: "Governança não depende do provedor de IA."

## 6:15 · Fechamento (30 s)
- `/apresentador`: status dos serviços, modelo, métricas medidas (latências, chamadas, tokens, custo) e limites declarados.
- "Errar para o alerta, com human-in-the-loop absorvendo o falso positivo antes de qualquer punição."

## Se sobrar tempo
- Cenário **Falso positivo**: atenção, caso P3, descarte com justificativa, sem reabertura.
- Cenário **Saudável**: nenhum alerta indevido.

---

# Plano B (API externa ou infraestrutura indisponível)

| Falha | O que acontece | O que fazer |
| --- | --- | --- |
| Anthropic fora do ar / chave inválida | Circuit breaker abre após 3 falhas; análises seguem por regras com `degraded_mode=true` visível | Continuar a demo; usar o painel para mostrar o modo degradado como recurso |
| Orçamento ou limite de chamadas atingido | Guarda de orçamento bloqueia a LLM; regras seguem | Mostrar em `/apresentador` "orçamento restante" e seguir |
| Supabase Realtime instável | Clientes reconectam e refazem a carga (sem duplicar) | Aguardar o chip "reconectando" voltar a "tempo real"; se persistir, recarregar a aba |
| Supabase indisponível | Aplicação não persiste | Apresentar com o roteiro acima e as capturas em `docs/capturas` (00 início, 01 mundo, 02 responsável em Alto, 03 apresentador, 04 moderação, 05 decisão refletida) |
| Sem internet no local | Nada funciona online | Rodar `pnpm dev` localmente apontando para o mesmo projeto Supabase (exige internet) ou apresentar as capturas |

As capturas são regeneradas pelos E2E (`e2e/v2-*.spec.ts`), que percorrem exatamente este roteiro contra a URL pública.
