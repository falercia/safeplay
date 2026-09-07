-- Safe Play v2: lobby em tempo real precisa ver entradas/saídas de jogadores.
alter publication supabase_realtime add table public.room_members;
