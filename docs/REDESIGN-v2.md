# Safe Play v2 · redesign (decidido em 2026-09-06)

## Decisões
- Tela inicial com cara de jogo ("Arena Nimbus"), entrada por **nome + código de acesso**, lobby com **criar mundo / entrar em mundo**, e dentro do mundo apenas **jogo + chat**.
- Moderação (`/moderacao`), responsável (`/responsavel`) e apresentador (`/apresentador`) em rotas separadas, cada uma com código próprio, listando mundos ativos do servidor (nada preso ao navegador).
- Roteiro sintético continua, rodando dentro de um mundo escolhido pelo apresentador; as falas entram como um dos jogadores do mundo.
- Jogo: simulação (sem controle), estilo moderno, assets CC0 permitidos, sem reação ao risco do chat.
- Quem entra primeiro cria o mundo; quem entra depois escolhe um mundo aberto ou cria outro. Jogadores são pessoas reais (nome livre).

## Modelo (delta)
- `worlds`: id, code, name, session_id (sessão global por código de acesso), room_id, created_by_profile_id, status (`open|closed`), created_at.
- `profiles` passam a ser por pessoa (nome livre, role `player`), criados em `game-enter`.
- Códigos como secrets: `GAME_ACCESS_CODE`, `MODERATOR_CODE`, `GUARDIAN_CODE`, `PRESENTER_SECRET`.
- Edge Functions: `game-enter`, `world-create`, `world-join`, `role-login`; `send-message`, pipeline e `moderation-action` inalterados; `demo-control.advance` recebe `worldCode` e `speakerProfileId`.

## Fases
1. Schema/RLS/funções + testes SQL + deploy Supabase.
2. Assets CC0 + novo motor de cena.
3. Telas do jogador (início, entrada, lobby, mundo).
4. Rotas de moderação, responsável e apresentador.
5. E2E, Vercel, capturas, docs.
