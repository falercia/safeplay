-- Envio de mensagem em uma única ida ao banco (membership, contenção, rate limit, idempotência e inserção).
-- Executada apenas pela service role a partir da Edge Function send-message.
create or replace function public.admin_send_message(
  p_room_code text,
  p_auth_user uuid,
  p_content text,
  p_client_msg_id text,
  p_rate_window_seconds int default 10,
  p_rate_max int default 6
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_room public.rooms%rowtype;
  v_profile uuid;
  v_count int;
  v_msg public.messages%rowtype;
begin
  select * into v_room from public.rooms where code = p_room_code;
  if not found then return jsonb_build_object('error', 'room_not_found'); end if;

  select rm.profile_id into v_profile
  from public.room_members rm
  join public.profile_bindings b on b.profile_id = rm.profile_id
  where rm.room_id = v_room.id and b.auth_user_id = p_auth_user
  limit 1;
  if v_profile is null then return jsonb_build_object('error', 'not_a_member'); end if;

  -- idempotência primeiro: reenvio do mesmo client_msg_id devolve a mensagem existente
  select * into v_msg from public.messages
   where room_id = v_room.id and sender_profile_id = v_profile and client_msg_id = p_client_msg_id;
  if found then
    return jsonb_build_object('duplicate', true, 'id', v_msg.id, 'seq', v_msg.seq, 'created_at', v_msg.created_at, 'room_id', v_room.id, 'session_id', v_room.session_id);
  end if;

  if v_room.contained then return jsonb_build_object('error', 'room_contained'); end if;

  select count(*) into v_count from public.messages
   where room_id = v_room.id and sender_profile_id = v_profile
     and created_at >= now() - make_interval(secs => p_rate_window_seconds);
  if v_count >= p_rate_max then return jsonb_build_object('error', 'rate_limited'); end if;

  insert into public.messages (room_id, session_id, sender_profile_id, content, client_msg_id, source)
  values (v_room.id, v_room.session_id, v_profile, p_content, p_client_msg_id, 'human')
  returning * into v_msg;

  return jsonb_build_object('duplicate', false, 'id', v_msg.id, 'seq', v_msg.seq, 'created_at', v_msg.created_at, 'room_id', v_room.id, 'session_id', v_room.session_id);
exception when unique_violation then
  select * into v_msg from public.messages
   where room_id = v_room.id and sender_profile_id = v_profile and client_msg_id = p_client_msg_id;
  return jsonb_build_object('duplicate', true, 'id', v_msg.id, 'seq', v_msg.seq, 'created_at', v_msg.created_at, 'room_id', v_room.id, 'session_id', v_room.session_id);
end $$;
revoke all on function public.admin_send_message(text, uuid, text, text, int, int) from public, anon, authenticated;
