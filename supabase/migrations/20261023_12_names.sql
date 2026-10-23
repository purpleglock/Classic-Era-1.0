-- Классическая эра 1.0 · Имена игроков.
-- Игрок задаёт себе имя в «Аккаунте». Имя проверяет база (браузер можно обойти):
--   • 3–24 знака: буквы, цифры, пробел и « - _ . ' »; хотя бы одна буква;
--   • без мата и оскорблений — в том числе записанных латиницей, цифрами вместо букв
--     («x y u», «xyй», «п1зд», «fuuuck»), через пробелы и точки;
--   • без имён и прозвищ реальных политических лидеров прошлого и настоящего
--     и без нацистской символики;
--   • без «Администратор», «Команда проекта», «Классикал-Тян» и т. п. — чтобы никто
--     не выдавал себя за команду;
--   • уникально: «Ivan» и «Іvan» (с похожей буквой) считаются одним именем.
-- Менять имя можно раз в 7 дней (первое — сразу). Команда проекта может переименовать
-- игрока и пополнять список запрещённых слов в админ-панели (раздел «Пользователи»).
-- Имя записывается и туда, откуда его читают старые части игры (user_roles, profiles).

create table if not exists public.v1_names (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  name       text not null,
  name_key   text not null unique,                 -- «скелет» имени для уникальности
  changed_at timestamptz not null default now(),
  set_by     uuid                                  -- кто поставил (если команда проекта)
);
create table if not exists public.v1_name_blocklist (
  word  text primary key,                          -- в «скелетном» виде, см. _v1_name_skel
  kind  text not null check (kind in ('mat', 'politics', 'nazi', 'reserved', 'other')),
  added_by uuid,
  added_at timestamptz not null default now()
);
alter table public.v1_names enable row level security;
alter table public.v1_name_blocklist enable row level security;
drop policy if exists v1_names_read on public.v1_names;
create policy v1_names_read on public.v1_names for select using (true);
revoke insert, update, delete on public.v1_names from anon, authenticated;
grant select on public.v1_names to anon, authenticated;
revoke all on public.v1_name_blocklist from anon, authenticated;

-- «Скелет»: нижний регистр, латинские и цифровые двойники букв → кириллица, без
-- разделителей, повторы схлопнуты. «Х.у_Й», «xyй», «XУУУЙ» → «хуй».
create or replace function public._v1_name_skel(p text) returns text
language sql immutable as $$
  select regexp_replace(regexp_replace(translate(lower(p), 'ёacehkmoptxyu0134@$6b', 'еасенкмортхуиоизчасбб'), '[^а-яa-z0-9]', '', 'g'), '(.)\1+', '\1', 'g')
$$;

-- Латинский «скелет» — для слов, которые пишут латиницей (hitler, fuck, blyat).
create or replace function public._v1_name_lat(p text) returns text
language sql immutable as $$
  select regexp_replace(regexp_replace(translate(lower(p), 'абвгдеёжзийклмнопрстуфхцчшщыэюя0134@$5ьъ', 'abvgdeejziiklmnoprstufhccssyeuaoieaass'), '[^a-z]', '', 'g'), '(.)\1+', '\1', 'g')
$$;

insert into public.v1_name_blocklist(word, kind) values
  -- мат и оскорбления (корни; в скелетном виде)
  ('хуй','mat'),('хуе','mat'),('хуи','mat'),('хуя','mat'),('пизд','mat'),('пезд','mat'),('ебан','mat'),('ебат','mat'),('ебал','mat'),
  ('ебуч','mat'),('ебло','mat'),('еблан','mat'),('заеб','mat'),('выеб','mat'),('уеб','mat'),('доеб','mat'),('проеб','mat'),('ебну','mat'),
  ('бляд','mat'),('блят','mat'),('бля','mat'),('мудак','mat'),('мудил','mat'),('пидор','mat'),('пидар','mat'),('педик','mat'),('гандон','mat'),
  ('залуп','mat'),('шлюх','mat'),('сучк','mat'),('сука','mat'),('дроч','mat'),
  ('fuck','mat'),('fuk','mat'),('shit','mat'),('bitch','mat'),('cunt','mat'),('nigger','mat'),('nigga','mat'),('faggot','mat'),
  ('huy','mat'),('pizd','mat'),('blyat','mat'),('blyad','mat'),('ebat','mat'),('eban','mat'),('suka','mat'),('pidor','mat'),
  ('whore','mat'),('slut','mat'),('pussy','mat'),('asshole','mat'),
  -- политические лидеры прошлого и настоящего
  ('гитлер','politics'),('hitler','politics'),('адольф','politics'),('adolf','politics'),('сталин','politics'),('stalin','politics'),
  ('ленин','politics'),('lenin','politics'),('муссолини','politics'),('мусолини','politics'),('musolini','politics'),
  ('путин','politics'),('putin','politics'),('зеленск','politics'),('zelensk','politics'),('байден','politics'),('biden','politics'),
  ('трамп','politics'),('trump','politics'),('обама','politics'),('obama','politics'),('лукашенк','politics'),('lukashenk','politics'),
  ('кимченын','politics'),('кимченир','politics'),('кимирсен','politics'),('kimjong','politics'),('kimilsung','politics'),
  ('маоцзэдун','politics'),('маоцзедун','politics'),('maozedong','politics'),('maotsetung','politics'),('полпот','politics'),('polpot','politics'),
  ('хрущев','politics'),('hrushchev','politics'),('khrushchev','politics'),('брежнев','politics'),('brezhnev','politics'),
  ('горбачев','politics'),('gorbachev','politics'),('ельцин','politics'),('jelcin','politics'),('yeltsin','politics'),
  ('навальн','politics'),('navaln','politics'),('шойгу','politics'),('shoigu','politics'),('кадыров','politics'),('kadyrov','politics'),
  ('медведевдмитр','politics'),('дмитриймедвед','politics'),('эрдоган','politics'),('erdogan','politics'),('макрон','politics'),('macron','politics'),
  ('меркель','politics'),('merkel','politics'),('цзиньпин','politics'),('xijinping','politics'),('нетаньяху','politics'),('netanyahu','politics'),
  ('хомейни','politics'),('khomeini','politics'),('хаменеи','politics'),('khamenei','politics'),('саддам','politics'),('saddam','politics'),
  ('каддафи','politics'),('gaddafi','politics'),('qaddafi','politics'),('биналаден','politics'),('бинладен','politics'),('binladen','politics'),
  ('пиночет','politics'),('pinochet','politics'),('берия','politics'),('beria','politics'),('троцк','politics'),('trotsk','politics'),
  ('черчилл','politics'),('churchill','politics'),('рузвельт','politics'),('roosevelt','politics'),('тэтчер','politics'),('thatcher','politics'),
  ('рейган','politics'),('reagan','politics'),('порошенк','politics'),('poroshenk','politics'),('янукович','politics'),('yanukovych','politics'),
  ('кастро','politics'),('castro','politics'),('чегевар','politics'),('guevar','politics'),
  ('наполеон','politics'),('napoleon','politics'),('чингисхан','politics'),('genghis','politics'),('бенладен','politics'),
  -- нацизм
  ('nazi','nazi'),('нацист','nazi'),('гиммлер','nazi'),('himmler','nazi'),('геббельс','nazi'),('goebbels','nazi'),('геринг','nazi'),('goering','nazi'),
  ('хайль','nazi'),('heil','nazi'),('зигхайль','nazi'),('siegheil','nazi'),('рейхсфюрер','nazi'),('фюрер','nazi'),('fuhrer','nazi'),('fuehrer','nazi'),
  ('waffen','nazi'),('свастик','nazi'),('swastik','nazi'),
  -- нельзя выдавать себя за команду проекта
  ('админ','reserved'),('admin','reserved'),('модератор','reserved'),('moderator','reserved'),('командапроекта','reserved'),
  ('классикал','reserved'),('clasical','reserved'),('поддержк','reserved'),('suport','reserved'),('систем','reserved'),('system','reserved')
on conflict (word) do nothing;

-- Проверка имени: null — можно, иначе текст причины.
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
  for w in select word, kind from v1_name_blocklist loop
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

-- Проверка «на лету» для поля ввода.
create or replace function public.v1_name_check(p_name text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare why text := public.v1_name_problem(p_name);
begin
  return jsonb_build_object('ok', why is null, 'reason', why);
end $$;

create or replace function public._v1_name_write(p_user uuid, p_name text, p_by uuid) returns void
language plpgsql security definer set search_path = public as $$
declare n text := btrim(regexp_replace(p_name, '\s+', ' ', 'g'));
begin
  insert into v1_names(user_id, name, name_key, changed_at, set_by) values (p_user, n, public._v1_name_skel(n), now(), p_by)
  on conflict (user_id) do update set name = excluded.name, name_key = excluded.name_key, changed_at = now(), set_by = excluded.set_by;
  -- старые части игры читают имя отсюда
  update user_roles set display_name = n where user_id = p_user;
  if not found then insert into user_roles(user_id, role, display_name) values (p_user, 'viewer', n); end if;
  update profiles set display_name = n where user_id = p_user;
end $$;

-- Игрок ставит имя себе.
create or replace function public.v1_set_name(p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); why text; last timestamptz;
begin
  if uid is null then raise exception 'not_signed_in'; end if;
  why := public.v1_name_problem(p_name, uid);
  if why is not null then raise exception 'name_rejected: %', why; end if;
  select changed_at into last from v1_names where user_id = uid;
  if last is not null and last > now() - interval '7 days' and not public.v1_is_staff() then
    raise exception 'name_cooldown: %', to_char(last + interval '7 days', 'DD.MM HH24:MI');
  end if;
  perform public._v1_name_write(uid, p_name, null);
  return jsonb_build_object('ok', true, 'name', btrim(regexp_replace(p_name, '\s+', ' ', 'g')));
end $$;

-- Действия команды проекта (через v1_admin_do): переименовать игрока, пополнить список.
create or replace function public.v1_x_names(p_action text, p_target text, p_payload jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare why text; w text;
begin
  case p_action
  when 'names.rename' then
    why := public.v1_name_problem(p_payload->>'name', p_target::uuid);
    if why is not null then raise exception 'name_rejected: %', why; end if;
    perform public._v1_name_write(p_target::uuid, p_payload->>'name', auth.uid());
  when 'names.block_add' then
    w := lower(btrim(p_target));
    if char_length(w) < 3 then raise exception 'name_rejected: Слово короче 3 букв — будет слишком много ложных срабатываний.'; end if;
    insert into v1_name_blocklist(word, kind, added_by) values (w, coalesce(p_payload->>'kind', 'other'), auth.uid()) on conflict (word) do nothing;
  when 'names.block_del' then
    delete from v1_name_blocklist where word = p_target;
  else raise exception 'unknown_action: %', p_action;
  end case;
  return 1;
end $$;

-- Список запрещённых слов — только команде проекта.
create or replace function public.v1_name_blocklist_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.v1_is_staff() then raise exception 'not_staff'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('word', word, 'kind', kind) order by kind, word), '[]'::jsonb) from v1_name_blocklist);
end $$;

revoke execute on function public._v1_name_skel(text), public._v1_name_lat(text), public._v1_name_write(uuid, text, uuid),
  public.v1_name_problem(text, uuid), public.v1_x_names(text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.v1_name_check(text), public.v1_set_name(text), public.v1_name_blocklist_list() from public, anon;
grant execute on function public.v1_name_check(text), public.v1_set_name(text), public.v1_name_blocklist_list() to authenticated;

insert into public.v1_action_policy(action, label, mode) values
  ('names.rename',    'Переименовать игрока',            'free'),
  ('names.block_add', 'Запретить слово в именах',        'free'),
  ('names.block_del', 'Убрать слово из запрещённых',     'approval')
on conflict (action) do nothing;

-- Уже стоящие имена переносим в реестр (если не противоречат правилам — проверятся при следующей смене).
insert into public.v1_names(user_id, name, name_key, changed_at)
select distinct on (r.user_id) r.user_id, r.display_name, public._v1_name_skel(r.display_name), now() - interval '8 days'
  from public.user_roles r join auth.users u on u.id = r.user_id
 where r.display_name is not null and btrim(r.display_name) <> ''
on conflict do nothing;
