# Roteiro de apresentação · Safe Play POC (5 a 7 minutos)

Preparação (antes da banca): abrir a Central (`/demo`), criar a sessão **Risco progressivo**, abrir os quatro links em janelas separadas (Jogador A, Jogador B, Responsável, Moderador) e dispor três delas lado a lado: chat do Jogador A, painel do Responsável e Central de moderação. Deixar a Central da demo no notebook do apresentador.

## 0:00 · O problema em uma frase (30 s)
"Plataformas analisam frases isoladas. Aliciamento é um padrão que se constrói ao longo do tempo. O Safe Play detecta o padrão, não a frase."

## 0:30 · Conversa real (60 s)
- Jogador B digita "boa partida! você joga muito bem"; mostrar a mensagem chegando no navegador do Jogador A sem refresh, com presença e "digitando".
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
- Na Central: ligar "Forçar erro na chamada" e avançar mais uma linha. O chat segue, o painel mostra "modo degradado" e o motor determinístico continua decidindo.
- Ponto: "Governança não depende do provedor de IA."

## 6:15 · Fechamento (30 s)
- Central da demo: métricas medidas (latências, chamadas, tokens, custo) e limites declarados.
- "Errar para o alerta, com human-in-the-loop absorvendo o falso positivo antes de qualquer punição."

## Se sobrar tempo
- Cenário **Falso positivo**: atenção, caso P3, descarte com justificativa, sem reabertura.
- Cenário **Saudável**: nenhum alerta indevido.

---

# Plano B (API externa ou infraestrutura indisponível)

| Falha | O que acontece | O que fazer |
| --- | --- | --- |
| Anthropic fora do ar / chave inválida | Circuit breaker abre após 3 falhas; análises seguem por regras com `degraded_mode=true` visível | Continuar a demo; usar o painel para mostrar o modo degradado como recurso |
| Orçamento ou limite de chamadas atingido | Guarda de orçamento bloqueia a LLM; regras seguem | Mostrar na Central "orçamento restante" e seguir |
| Supabase Realtime instável | Clientes reconectam e refazem a carga (sem duplicar) | Aguardar o chip "reconectando" voltar a "tempo real"; se persistir, recarregar a aba |
| Supabase indisponível | Aplicação não persiste | Apresentar com o roteiro acima e capturas de tela do Safety Pulse (pasta `docs/capturas`, gerar antes da banca) |
| Sem internet no local | Nada funciona online | Rodar `pnpm dev` localmente apontando para o mesmo projeto Supabase (exige internet) ou apresentar as capturas |

Sugestão: na véspera, executar o cenário progressivo até o fim e salvar capturas do Safety Pulse, do painel do responsável, da fila de moderação e do drawer de transparência.
