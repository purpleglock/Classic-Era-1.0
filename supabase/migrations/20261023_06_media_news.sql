-- Классическая эра 1.0 · Классикал-Тян, медиатека, 3D-модели, новости команды проекта.
-- Запускать после 20261023_01_roles.sql.

-- ════════ 1. Настройки сайта (Классикал-Тян и другое) ════════
create table if not exists public.v1_settings (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table public.v1_settings enable row level security;
drop policy if exists v1_settings_read on public.v1_settings;
create policy v1_settings_read on public.v1_settings for select using (true);
revoke insert, update, delete on public.v1_settings from anon, authenticated;
grant select on public.v1_settings to anon, authenticated;

-- Реплики Классикал-Тян переносим со старого сайта (только тексты и время суток;
-- старые арты не берём — их заменят новые). Арты команда загрузит в панели.
insert into public.v1_settings(key, value)
select 'tyan', jsonb_build_object(
  'speaker', 'Классикал-Тян',
  'sprites', '[]'::jsonb,
  'dialogues', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', d->>'id',
      'time', coalesce(nullif(d->>'time', ''), 'any'),
      'lines', (select coalesce(jsonb_agg(jsonb_build_object('text', l->>'text', 'sprite', '')), '[]') from jsonb_array_elements(d->'lines') l)))
    from jsonb_array_elements((s.value::jsonb)->'dialogues') d), '[]'::jsonb))
from public.site_settings s where s.key = 'wk_hero_vn'
on conflict (key) do nothing;

insert into public.v1_settings(key, value)
values ('tyan', jsonb_build_object('speaker', 'Классикал-Тян', 'sprites', '[]'::jsonb, 'dialogues',
  jsonb_build_array(jsonb_build_object('id', 'default', 'time', 'any', 'lines', jsonb_build_array(jsonb_build_object('text', 'Улыбнись. Галактика ждёт твоего хода.', 'sprite', ''))))))
on conflict (key) do nothing;

-- ════════ 2. Медиатека и 3D-модели ════════
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('v1-media', 'v1-media', true, 15728640,
        array['image/png','image/jpeg','image/webp','image/gif','image/svg+xml','audio/mpeg','audio/ogg','audio/wav','audio/webm'])
on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('v1-models', 'v1-models', true, 52428800, null)
on conflict (id) do nothing;

-- Медиатека: команда загружает куда угодно в v1-media; игроки — только в свою папку u/<id>/
-- (картинки и музыка для новостей державы). Модели — только команда.
drop policy if exists v1_media_insert on storage.objects;
drop policy if exists v1_media_change on storage.objects;
drop policy if exists v1_media_remove on storage.objects;
drop policy if exists v1_models_insert on storage.objects;
drop policy if exists v1_models_change on storage.objects;
drop policy if exists v1_models_remove on storage.objects;
create policy v1_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'v1-media' and (public.v1_is_staff() or (storage.foldername(name))[1] = 'u' and (storage.foldername(name))[2] = auth.uid()::text));
create policy v1_media_change on storage.objects for update to authenticated
  using (bucket_id = 'v1-media' and (public.v1_is_staff() or owner = auth.uid()));
create policy v1_media_remove on storage.objects for delete to authenticated
  using (bucket_id = 'v1-media' and (public.v1_is_staff() or owner = auth.uid()));
create policy v1_models_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'v1-models' and public.v1_is_staff());
create policy v1_models_change on storage.objects for update to authenticated
  using (bucket_id = 'v1-models' and public.v1_is_staff());
create policy v1_models_remove on storage.objects for delete to authenticated
  using (bucket_id = 'v1-models' and public.v1_is_staff());

create table if not exists public.v1_media (
  id          uuid primary key default gen_random_uuid(),
  path        text not null unique,            -- путь в бакете v1-media
  url         text not null,
  name        text not null,
  mime        text,
  size        integer,
  width       integer,
  height      integer,
  tag         text not null default 'page',    -- page | tyan | news | other
  uploaded_by uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
create table if not exists public.v1_models (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        text not null check (kind in ('ship','ground','air','station','other')),
  class       text,                             -- корвет, линкор, танк, истребитель…
  path        text not null unique,             -- путь в бакете v1-models
  url         text not null,
  preview_url text,
  size        integer,
  notes       text not null default '',
  uploaded_by uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.v1_media  enable row level security;
alter table public.v1_models enable row level security;
drop policy if exists v1_media_read on public.v1_media;
drop policy if exists v1_models_read on public.v1_models;
create policy v1_media_read  on public.v1_media  for select using (true);
create policy v1_models_read on public.v1_models for select using (true);
revoke insert, update, delete on public.v1_media, public.v1_models from anon, authenticated;
grant select on public.v1_media, public.v1_models to anon, authenticated;

-- ════════ 3. Посты команды проекта: картинка-баннер ════════
alter table public.v1_posts add column if not exists image_url text;
alter table public.v1_posts add column if not exists source_news uuid;

-- ════════ 4. Действия модулей (вызываются из v1_admin_do) ════════
create or replace function public.v1_x_settings(p_action text, p_target text, p_payload jsonb) returns integer
language plpgsql security definer set search_path = public as $$
begin
  if p_action <> 'settings.save' then raise exception 'unknown_action: %', p_action; end if;
  if p_target !~ '^[a-z_]{2,40}$' then raise exception 'bad_key'; end if;
  insert into v1_settings(key, value, updated_by, updated_at) values (p_target, p_payload, auth.uid(), now())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  return 1;
end $$;

create or replace function public.v1_x_media(p_action text, p_target text, p_payload jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0; p text;
begin
  case p_action
  when 'media.add' then
    insert into v1_media(path, url, name, mime, size, width, height, tag, uploaded_by)
    values (p_payload->>'path', p_payload->>'url', coalesce(nullif(p_payload->>'name', ''), p_payload->>'path'), p_payload->>'mime',
            (p_payload->>'size')::int, (p_payload->>'width')::int, (p_payload->>'height')::int, coalesce(p_payload->>'tag', 'page'), auth.uid())
    on conflict (path) do update set name = excluded.name, url = excluded.url;
    n := 1;
  when 'media.rename' then
    update v1_media set name = p_payload->>'name' where id = p_target::uuid; get diagnostics n = row_count;
  when 'media.delete' then
    select path into p from v1_media where id = p_target::uuid;
    delete from storage.objects where bucket_id = 'v1-media' and name = p;
    delete from v1_media where id = p_target::uuid; get diagnostics n = row_count;
  else raise exception 'unknown_action: %', p_action;
  end case;
  return n;
end $$;

create or replace function public.v1_x_model(p_action text, p_target text, p_payload jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0; p text;
begin
  case p_action
  when 'model.save' then
    if coalesce(trim(p_payload->>'name'), '') = '' then raise exception 'empty_title'; end if;
    insert into v1_models(id, name, kind, class, path, url, preview_url, size, notes, uploaded_by)
    values (p_target::uuid, trim(p_payload->>'name'), coalesce(p_payload->>'kind', 'ship'), p_payload->>'class',
            p_payload->>'path', p_payload->>'url', p_payload->>'preview_url', (p_payload->>'size')::int, coalesce(p_payload->>'notes', ''), auth.uid())
    on conflict (id) do update set name = excluded.name, kind = excluded.kind, class = excluded.class,
      preview_url = coalesce(excluded.preview_url, v1_models.preview_url), notes = excluded.notes, updated_at = now(),
      path = coalesce(excluded.path, v1_models.path), url = coalesce(excluded.url, v1_models.url), size = coalesce(excluded.size, v1_models.size);
    n := 1;
  when 'model.delete' then
    select path into p from v1_models where id = p_target::uuid;
    delete from storage.objects where bucket_id = 'v1-models' and name = p;
    delete from v1_models where id = p_target::uuid; get diagnostics n = row_count;
  else raise exception 'unknown_action: %', p_action;
  end case;
  return n;
end $$;

-- Новости: перенос лорной новости в «От команды проекта».
create or replace function public.v1_x_news(p_action text, p_target text, p_payload jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0;
begin
  if p_action <> 'news.to_post' then raise exception 'unknown_action: %', p_action; end if;
  insert into v1_posts(kind, title, body, image_url, published, author_id, created_at, updated_at, source_news)
  select coalesce(p_payload->>'kind', 'lore'), f.title, coalesce(f.body, ''), f.image_url, true, auth.uid(),
         coalesce(f.published_at, f.created_at), now(), f.id
    from faction_news f where f.id = p_target::uuid
     and not exists (select 1 from v1_posts p where p.source_news = f.id);
  get diagnostics n = row_count;
  update faction_news set status = 'archived', updated_at = now() where id = p_target::uuid;
  return n;
end $$;

revoke execute on function public.v1_x_settings(text, text, jsonb), public.v1_x_media(text, text, jsonb),
                           public.v1_x_model(text, text, jsonb), public.v1_x_news(text, text, jsonb) from public, anon, authenticated;

insert into public.v1_action_policy(action, label, mode) values
  ('settings.save', 'Изменить настройки сайта (Классикал-Тян)', 'free'),
  ('media.add',     'Загрузить файл в медиатеку',               'free'),
  ('media.rename',  'Переименовать файл медиатеки',             'free'),
  ('media.delete',  'Удалить файл из медиатеки',                'approval'),
  ('model.save',    'Загрузить или изменить 3D-модель',         'free'),
  ('model.delete',  'Удалить 3D-модель',                        'approval'),
  ('news.to_post',  'Перенести новость в «От команды проекта»', 'free')
on conflict (action) do nothing;

-- ════════ 5. Нагрузка: число планет без выгрузки самих планет ════════
-- Карта грузит системы без поля planets (1,2 МБ на зрителя) и берёт только их число.
create or replace function public.v1_planet_count(public.map_systems) returns integer
language sql stable as $$
  select case when jsonb_typeof($1.planets::jsonb) = 'array' then jsonb_array_length($1.planets::jsonb) else 0 end
$$;
grant execute on function public.v1_planet_count(public.map_systems) to anon, authenticated;

-- ════════ 6. Новости держав: игрок не может одобрить свою новость сам ════════
-- Старые правила доступа разрешают владельцу менять свою новость целиком, включая статус.
-- Триггер оставляет игроку только черновик и отправку на проверку.
create or replace function public.v1_news_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- задачи базы (без вошедшего пользователя) и команда проекта — без ограничений
  if auth.uid() is null or public.v1_is_staff() or current_user_role() = any (array['superadmin','editor','moderator']) then return new; end if;
  if tg_op = 'INSERT' then
    new.status := case when new.status = 'draft' then 'draft' else 'pending' end;
    new.published_at := null; new.reviewed_by := null; new.staff_verdict := null; new.staff_grants := null;
  elsif new.status is distinct from old.status or new.published_at is distinct from old.published_at
     or new.staff_grants is distinct from old.staff_grants or new.staff_verdict is distinct from old.staff_verdict then
    if new.status not in ('draft', 'pending') then raise exception 'news_status_locked'; end if;
    new.published_at := old.published_at; new.staff_grants := old.staff_grants; new.staff_verdict := old.staff_verdict;
  end if;
  -- отредактированная одобренная новость снова уходит на проверку
  if tg_op = 'UPDATE' and old.status = 'approved' and (new.body is distinct from old.body or new.title is distinct from old.title) then
    new.status := 'pending';
  end if;
  return new;
end $$;
drop trigger if exists v1_news_guard on public.faction_news;
create trigger v1_news_guard before insert or update on public.faction_news
  for each row execute function public.v1_news_guard();
