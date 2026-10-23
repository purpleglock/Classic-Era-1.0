-- Классическая эра 1.0 · Документы, аватары, имена команды.
--   1. Согласия с документами: какую редакцию и когда принял игрок. При новой редакции
--      сайт показывает окно и не пускает дальше, пока игрок не подтвердит.
--   2. Аватары игроков: загружаются в медиатеку (папка игрока), ссылку хранит v1_profile.
--   3. Имена: команде проекта можно служебные слова («The Classical Man», «Админ …»),
--      мат и политики по-прежнему запрещены всем.

create table if not exists public.v1_consents (
  user_id     uuid not null references auth.users(id) on delete cascade,
  version     text not null,
  accepted_at timestamptz not null default now(),
  user_agent  text,
  primary key (user_id, version)
);
alter table public.v1_consents enable row level security;
drop policy if exists v1_consents_own on public.v1_consents;
create policy v1_consents_own on public.v1_consents for select to authenticated using (user_id = auth.uid() or public.v1_is_staff());
revoke insert, update, delete on public.v1_consents from anon, authenticated;
grant select on public.v1_consents to authenticated;

create or replace function public.v1_accept_docs(p_version text, p_agent text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if p_version !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'bad_version'; end if;
  insert into v1_consents(user_id, version, user_agent) values (auth.uid(), p_version, left(p_agent, 300))
  on conflict (user_id, version) do nothing;
  return jsonb_build_object('ok', true);
end $$;

create table if not exists public.v1_profile (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  avatar_url text,
  updated_at timestamptz not null default now()
);
alter table public.v1_profile enable row level security;
drop policy if exists v1_profile_read on public.v1_profile;
create policy v1_profile_read on public.v1_profile for select using (true);
revoke insert, update, delete on public.v1_profile from anon, authenticated;
grant select on public.v1_profile to anon, authenticated;

-- Аватар: только картинка из своей папки медиатеки (u/<id>/…) — чужие ссылки не принимаем.
create or replace function public.v1_set_avatar(p_url text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); okpath text;
begin
  if uid is null then raise exception 'not_signed_in'; end if;
  okpath := '/storage/v1/object/public/v1-media/u/' || uid::text || '/';
  if p_url is not null and (position(okpath in p_url) = 0 or p_url !~ '^https://[a-z0-9]+\.supabase\.co/') then
    raise exception 'bad_avatar';
  end if;
  insert into v1_profile(user_id, avatar_url, updated_at) values (uid, p_url, now())
  on conflict (user_id) do update set avatar_url = excluded.avatar_url, updated_at = now();
  update profiles set avatar_url = p_url where user_id = uid;
  return jsonb_build_object('ok', true, 'avatar_url', p_url);
end $$;

revoke execute on function public.v1_accept_docs(text, text), public.v1_set_avatar(text) from public, anon;
grant execute on function public.v1_accept_docs(text, text), public.v1_set_avatar(text) to authenticated;

create or replace function public.v1_name_problem(p_name text, p_user uuid default auth.uid()) returns text
language plpgsql stable security definer set search_path = public as $$
declare n text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')); sk text; lat text; w record;
begin
  if char_length(n) < 3 then return 'Имя короче 3 знаков.'; end if;
  if char_length(n) > 24 then return 'Имя длиннее 24 знаков.'; end if;
  if n !~ '^[A-Za-zА-Яа-яЁё0-9 ._''-]+$' then return 'Можно только буквы, цифры, пробел и знаки - _ . '''; end if;
  if n !~ '[A-Za-zА-Яа-яЁё]' then return 'В имени нужна хотя бы одна буква.'; end if;
  if n ~ '[A-Za-z]' and n ~ '[А-Яа-яЁё]' and n ~ '[A-Za-z][А-Яа-яЁё]|[А-Яа-яЁё][A-Za-z]' then return 'Не смешивайте латиницу и кириллицу в одном слове.'; end if;
  sk := public._v1_name_skel(n); lat := public._v1_name_lat(n);
  -- служебные слова («Классикал», «Админ»…) команде проекта можно: это её имена
  for w in select word, kind from v1_name_blocklist where kind <> 'reserved' or not exists (select 1 from v1_staff s where s.user_id = p_user) loop
    -- кириллическое слово сравниваем со «скелетом» имени, латинское — с латинским скелетом,
    -- и только если в имени есть латиница (иначе «Ребята» → rebata ловилось бы на ebat)
    if (w.word ~ '[а-яё]' and position(public._v1_name_skel(w.word) in sk) > 0)
       or (w.word !~ '[а-яё]' and n ~ '[A-Za-z]' and position(public._v1_name_lat(w.word) in lat) > 0) then
      return case w.kind
        when 'mat' then 'В имени есть грубое или оскорбительное слово.'
        when 'politics' then 'Имена реальных политических лидеров использовать нельзя.'
        when 'nazi' then 'Нацистская символика запрещена.'
        when 'reserved' then 'Это имя похоже на служебное — его могут принять за команду проекта.'
        else 'Это имя запрещено.' end;
    end if;
  end loop;
  if exists (select 1 from v1_names where name_key = sk and user_id is distinct from p_user) then return 'Это имя уже занято.'; end if;
  return null;
end $$;


revoke execute on function public.v1_name_problem(text, uuid) from public, anon, authenticated;
