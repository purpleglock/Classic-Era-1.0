-- Классическая эра 1.0 · Discord-сертификация аккаунта, редактор карты,
-- закрытие дыры в хранилище картинок.
-- Запускать после 20261023_01_roles.sql.

-- ════════ 1. Discord-сертификация ════════
-- Привязка делается штатной функцией Supabase (linkIdentity). Сервер сам
-- читает привязку из auth.identities — подделать имя из браузера нельзя.
-- В Supabase: Authentication → Providers → Discord (включить, вписать
-- Client ID и Secret) и Authentication → Settings → «Allow manual linking».

create table if not exists public.v1_discord (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  discord_id   text not null unique,
  username     text,
  display_name text,
  avatar_url   text,
  linked_at    timestamptz not null default now(),
  synced_at    timestamptz not null default now()
);
alter table public.v1_discord enable row level security;
revoke all on public.v1_discord from anon, authenticated;

-- Переносит привязку из auth.identities в профиль. Вызывается после привязки
-- и после отвязки; возвращает текущий статус.
create or replace function public.v1_discord_sync() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  i record;
begin
  if uid is null then raise exception 'not_signed_in'; end if;
  select provider_id, identity_data, created_at into i
    from auth.identities where user_id = uid and provider = 'discord'
    order by created_at desc limit 1;
  if not found then
    delete from v1_discord where user_id = uid;
    return jsonb_build_object('linked', false);
  end if;
  insert into v1_discord(user_id, discord_id, username, display_name, avatar_url, linked_at, synced_at)
  values (uid, i.provider_id,
          coalesce(i.identity_data->'custom_claims'->>'username', i.identity_data->>'name', i.identity_data->>'user_name'),
          coalesce(i.identity_data->'custom_claims'->>'global_name', i.identity_data->>'full_name', i.identity_data->>'name'),
          i.identity_data->>'avatar_url', coalesce(i.created_at, now()), now())
  on conflict (user_id) do update set
    discord_id = excluded.discord_id, username = excluded.username,
    display_name = excluded.display_name, avatar_url = excluded.avatar_url, synced_at = now();
  return (select jsonb_build_object('linked', true, 'name', coalesce(display_name, username), 'username', username, 'avatar_url', avatar_url, 'linked_at', linked_at)
            from v1_discord where user_id = uid);
end $$;

-- Публичный значок: «верифицирован в Discord как M». Только имя, без ID.
create or replace function public.v1_discord_of(p_users uuid[]) returns table(user_id uuid, name text)
language sql stable security definer set search_path = public as $$
  select d.user_id, coalesce(d.display_name, d.username) from v1_discord d where d.user_id = any(p_users);
$$;

revoke execute on function public.v1_discord_sync() from public, anon;
grant execute on function public.v1_discord_sync() to authenticated;
grant execute on function public.v1_discord_of(uuid[]) to anon, authenticated;

-- Discord в своей роли (v1_my_role) — дополняем ответ.
create or replace function public.v1_my_discord() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('linked', true, 'name', coalesce(display_name, username), 'username', username, 'avatar_url', avatar_url, 'linked_at', linked_at)
                     from v1_discord where user_id = auth.uid()), jsonb_build_object('linked', false));
$$;
grant execute on function public.v1_my_discord() to authenticated;

-- ════════ 2. Редактор карты для команды проекта ════════
-- Вызывается из v1_admin_do: 'map.system.save', 'map.lane.add' и т. д.
-- Проверка прав и одобрение суперадмина — в v1_admin_do.
create or replace function public.v1_x_map(p_action text, p_target text, p_payload jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer := 0;
  a text; b text;
begin
  case p_action
  when 'map.system.save' then
    if coalesce(trim(p_payload->>'name'), '') = '' then raise exception 'empty_title'; end if;
    if p_target !~ '^sys_[a-z0-9]{4,16}$' then raise exception 'bad_system_id'; end if;
    insert into map_systems(id, name, star_type, x, y, is_giant, description, planets, multi)
    values (p_target, trim(p_payload->>'name'), coalesce(p_payload->>'star_type', 'yellow'),
            (p_payload->>'x')::numeric, (p_payload->>'y')::numeric,
            coalesce((p_payload->>'is_giant')::boolean, false), coalesce(p_payload->>'description', ''),
            coalesce(p_payload->'planets', '[]'::jsonb), true)
    on conflict (id) do update set
      name = excluded.name, star_type = excluded.star_type,
      x = coalesce((p_payload->>'x')::numeric, map_systems.x), y = coalesce((p_payload->>'y')::numeric, map_systems.y),
      is_giant = excluded.is_giant, description = excluded.description,
      planets = coalesce(p_payload->'planets', map_systems.planets);
    n := 1;

  when 'map.system.move' then
    update map_systems set x = (p_payload->>'x')::numeric, y = (p_payload->>'y')::numeric where id = p_target;
    get diagnostics n = row_count;

  when 'map.system.owner' then
    update map_systems set faction = nullif(p_payload->>'faction', '') where id = p_target;
    get diagnostics n = row_count;

  when 'map.system.delete' then
    if exists (select 1 from colonies where system_id = p_target)
       or exists (select 1 from map_systems where id = p_target and faction is not null)
       or exists (select 1 from outposts where system_id = p_target)
       or exists (select 1 from fleets where system_id = p_target) then
      raise exception 'system_in_use';
    end if;
    delete from map_hyperlanes where a_id = p_target or b_id = p_target;
    update map_sectors set system_ids = array_remove(system_ids, p_target) where p_target = any(system_ids);
    delete from map_systems where id = p_target;
    get diagnostics n = row_count;

  when 'map.lane.add' then
    a := p_payload->>'a'; b := p_payload->>'b';
    if a is null or b is null or a = b then raise exception 'bad_lane'; end if;
    if (select count(*) from map_systems where id in (a, b)) <> 2 then raise exception 'bad_lane'; end if;
    if exists (select 1 from map_hyperlanes where (a_id = a and b_id = b) or (a_id = b and b_id = a)) then raise exception 'lane_exists'; end if;
    insert into map_hyperlanes(a_id, b_id) values (a, b);
    n := 1;

  when 'map.lane.delete' then
    delete from map_hyperlanes where id = p_target::uuid;
    get diagnostics n = row_count;

  when 'map.sector.save' then
    if coalesce(trim(p_payload->>'name'), '') = '' then raise exception 'empty_title'; end if;
    insert into map_sectors(id, name, color, lore, system_ids)
    values (p_target::uuid, trim(p_payload->>'name'), coalesce(p_payload->>'color', 'rgba(233,185,73,0.45)'), coalesce(p_payload->>'lore', ''),
            coalesce(array(select jsonb_array_elements_text(p_payload->'system_ids')), '{}'))
    on conflict (id) do update set name = excluded.name, color = excluded.color, lore = excluded.lore, system_ids = excluded.system_ids;
    n := 1;

  when 'map.sector.delete' then
    delete from map_sectors where id = p_target::uuid;
    get diagnostics n = row_count;

  else
    raise exception 'unknown_action: %', p_action;
  end case;
  return n;
end $$;
revoke execute on function public.v1_x_map(text, text, jsonb) from public, anon, authenticated;

insert into public.v1_action_policy(action, label, mode) values
  ('map.system.save',   'Создать или изменить систему на карте', 'free'),
  ('map.system.move',   'Перенести систему на карте',            'free'),
  ('map.system.owner',  'Сменить владельца системы',             'approval'),
  ('map.system.delete', 'Удалить систему с карты',               'approval'),
  ('map.lane.add',      'Проложить гиперпуть',                   'free'),
  ('map.lane.delete',   'Удалить гиперпуть',                     'approval'),
  ('map.sector.save',   'Создать или изменить сектор',           'free'),
  ('map.sector.delete', 'Удалить сектор',                        'approval')
on conflict (action) do nothing;

-- Старые правила давали старым ролям писать в таблицы карты напрямую, в обход
-- одобрений. Новый сайт пишет только через v1_admin_do. Прямую запись закрываем,
-- когда старый сайт отключён: раскомментируйте эти строки при переходе.
-- drop policy if exists "write" on public.map_systems;
-- drop policy if exists "write" on public.map_hyperlanes;
-- drop policy if exists "write" on public.map_sectors;

-- ════════ 3. Хранилище картинок ════════
-- Сейчас любой вошедший пользователь может удалить или подменить ЛЮБУЮ картинку
-- (гербы, арты вики). Оставляем это только владельцу файла и команде проекта.
drop policy if exists "auth delete wiki-images" on storage.objects;
drop policy if exists "auth update wiki-images" on storage.objects;
drop policy if exists "auth delete images" on storage.objects;
drop policy if exists "auth update images" on storage.objects;
drop policy if exists "auth delete ability-icons" on storage.objects;
drop policy if exists "auth update ability-icons" on storage.objects;
drop policy if exists v1_objects_owner_delete on storage.objects;
drop policy if exists v1_objects_owner_update on storage.objects;
create policy v1_objects_owner_delete on storage.objects for delete to authenticated
  using (bucket_id in ('wiki-images','images','ability-icons') and (owner = auth.uid() or public.v1_is_staff()));
create policy v1_objects_owner_update on storage.objects for update to authenticated
  using (bucket_id in ('wiki-images','images','ability-icons') and (owner = auth.uid() or public.v1_is_staff()));
