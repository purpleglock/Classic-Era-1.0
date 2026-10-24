-- Классическая эра 1.0 · автоматическая роль в Discord-сервере.
-- Как только игрок привязывает Discord на сайте, бот проекта выдаёт ему роль
-- «Игрок» и снимает «Гость». При отвязке — наоборот.
--
-- Устройство: триггер на v1_discord → net.http_post → edge-функция
-- `discord-roles` → Discord API (PUT/DELETE роли). Токен бота хранится только
-- в секретах edge-функций (DISCORD_BOT_TOKEN). Функцию защищает секрет вызова
-- из Vault (discord_hook_secret); функция сверяет его через v1_discord_hook_check.
-- ID сервера и ролей — в v1_settings, ключ 'discord'; правятся в админ-панели.

alter table public.v1_discord
  add column if not exists role_status text,
  add column if not exists role_at timestamptz;

insert into public.v1_settings(key, value)
values ('discord', '{"enabled": false, "guild": "", "role_player": "", "role_guest": ""}')
on conflict (key) do nothing;

-- Отправляет задание боту. Ничего не делает, пока выдача ролей не включена.
create or replace function public.v1_discord_role_push(p_uid uuid, p_discord_id text, p_linked boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  s jsonb := (select value from v1_settings where key = 'discord');
  sec text;
  r_add text; r_del text;
begin
  if s is null or not coalesce((s->>'enabled')::boolean, false) or coalesce(s->>'guild', '') = '' then
    return false;
  end if;
  select decrypted_secret into sec from vault.decrypted_secrets where name = 'discord_hook_secret';
  if sec is null then return false; end if;
  r_add := nullif(case when p_linked then s->>'role_player' else s->>'role_guest' end, '');
  r_del := nullif(case when p_linked then s->>'role_guest' else s->>'role_player' end, '');
  perform net.http_post(
    url := 'https://pgngkkiiopymvrcozvvr.supabase.co/functions/v1/discord-roles',
    body := jsonb_build_object('user_id', p_uid, 'discord_id', p_discord_id, 'linked', p_linked,
                               'guild', s->>'guild', 'add', r_add, 'remove', r_del),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', sec),
    timeout_milliseconds := 10000);
  if p_linked then
    update v1_discord set role_status = 'pending', role_at = now() where user_id = p_uid;
  end if;
  return true;
end $$;
revoke execute on function public.v1_discord_role_push(uuid, text, boolean) from public, anon, authenticated;

create or replace function public.v1_discord_role_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform v1_discord_role_push(old.user_id, old.discord_id, false);
    return old;
  end if;
  if tg_op = 'UPDATE' and old.discord_id is not distinct from new.discord_id then return new; end if;
  if tg_op = 'UPDATE' then perform v1_discord_role_push(old.user_id, old.discord_id, false); end if;
  perform v1_discord_role_push(new.user_id, new.discord_id, true);
  return new;
end $$;

drop trigger if exists v1_discord_role on public.v1_discord;
create trigger v1_discord_role after insert or update of discord_id or delete on public.v1_discord
  for each row execute function public.v1_discord_role_trg();

-- Кнопка «Получить роль» в аккаунте: если игрок зашёл на сервер позже привязки.
create or replace function public.v1_discord_role_retry() returns jsonb
language plpgsql security definer set search_path = public as $$
declare d record;
begin
  select * into d from v1_discord where user_id = auth.uid();
  if not found then raise exception 'discord_not_linked'; end if;
  if d.role_at > now() - interval '30 seconds' and d.role_status = 'pending' then
    return jsonb_build_object('status', 'pending');
  end if;
  if not v1_discord_role_push(d.user_id, d.discord_id, true) then
    return jsonb_build_object('status', 'off');
  end if;
  return jsonb_build_object('status', 'pending');
end $$;
revoke execute on function public.v1_discord_role_retry() from public, anon;
grant execute on function public.v1_discord_role_retry() to authenticated;

-- Статус роли — в ответе v1_my_discord.
create or replace function public.v1_my_discord() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('linked', true, 'name', coalesce(display_name, username), 'username', username,
                                             'avatar_url', avatar_url, 'linked_at', linked_at,
                                             'role_status', role_status, 'role_at', role_at,
                                             'roles_on', coalesce((select (value->>'enabled')::boolean from v1_settings where key = 'discord'), false))
                     from v1_discord where user_id = auth.uid()), jsonb_build_object('linked', false));
$$;
grant execute on function public.v1_my_discord() to authenticated;

-- Команда проекта: выдать роли всем, кто уже привязал Discord.
create or replace function public.v1_discord_role_backfill() returns integer
language plpgsql security definer set search_path = public as $$
declare d record; n integer := 0;
begin
  if not v1_is_superadmin() then raise exception 'forbidden'; end if;
  for d in select user_id, discord_id from v1_discord loop
    if v1_discord_role_push(d.user_id, d.discord_id, true) then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke execute on function public.v1_discord_role_backfill() from public, anon;
grant execute on function public.v1_discord_role_backfill() to authenticated;

-- Edge-функция сверяет секрет вызова с Vault (только под service_role),
-- поэтому вписывать его в секреты функции не нужно.
create or replace function public.v1_discord_hook_check(p_secret text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'discord_hook_secret' and decrypted_secret = p_secret);
$$;
revoke execute on function public.v1_discord_hook_check(text) from public, anon, authenticated;
grant execute on function public.v1_discord_hook_check(text) to service_role;
