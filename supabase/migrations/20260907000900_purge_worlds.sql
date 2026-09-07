-- Safe Play v2: limpeza de mundos (apresentador). Apagar a sala cascateia mensagens, avaliações, alertas, casos, auditoria e o próprio mundo.
create or replace function public.admin_delete_world(p_world uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_room uuid;
begin
  select room_id into v_room from public.worlds where id = p_world;
  if v_room is null then return; end if;
  perform set_config('app.allow_reset', 'on', true);
  update public.usage_ledger set room_id = null, job_id = null where room_id = v_room;
  delete from public.rooms where id = v_room;
end $$;
revoke all on function public.admin_delete_world(uuid) from public, anon, authenticated;

create or replace function public.admin_purge_closed_worlds() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; w record;
begin
  for w in select id from public.worlds where status = 'closed' loop
    perform public.admin_delete_world(w.id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.admin_purge_closed_worlds() from public, anon, authenticated;
