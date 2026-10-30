-- ═══════════════════════════════════════════════════════════════
-- 48. Персонажи и личные финансы.
--   v1_characters    — персонажи игроков (свои, новые). 22 старых персонажа
--                      переносятся как сохранения (legacy_id), старая таблица не меняется.
--   Личный счёт      — у каждого персонажа свои ГС, отдельно от казны державы.
--   Жалованье        — правитель (право «Казна») назначает, раз в сутки из казны.
--   Переводы         — персонаж → персонаж (налог), казна → персонаж (потолок за сутки),
--                      персонаж → казна любой державы (без налога).
--   Военное положение — пока держава воюет или в её столичной системе чужая армия,
--                      выплаты из казны персонажам и повышение жалованья закрыты.
--   Падение державы  — персонаж уходит «без державы» и сохраняет все деньги;
--                      победитель получает только казну.
--   Гибель           — деньги переходят наследнику (за вычетом налога),
--                      без наследника — в казну державы персонажа, иначе сгорают.
--   Бар и ставки зрителей арены идут с личного счёта активного персонажа;
--   приз за победу над «Жнецом» — персонажу, который вёл бой.
-- ═══════════════════════════════════════════════════════════════

-- ════════ 1. Таблицы ════════
create table if not exists public.v1_characters (
  id         uuid primary key default gen_random_uuid(),
  legacy_id  uuid unique,                -- старый персонаж (characters.id), если перенесён
  owner_id   uuid not null,
  fid        text,                       -- держава; null — без державы
  name       text not null,
  name_key   text not null,
  title      text,
  bio        text,
  status     text not null default 'active' check (status in ('active', 'exile', 'dead')),
  gc         numeric not null default 0 check (gc >= 0),
  heir_id    uuid references public.v1_characters(id) on delete set null,
  created_at timestamptz not null default now(),
  died_at    timestamptz,
  death_note text
);
create index if not exists v1_characters_owner on public.v1_characters(owner_id);
create index if not exists v1_characters_fid on public.v1_characters(fid) where status <> 'dead';
create unique index if not exists v1_characters_name on public.v1_characters(name_key) where status <> 'dead';

create table if not exists public.v1_char_active (
  user_id uuid primary key,
  char_id uuid not null references public.v1_characters(id) on delete cascade
);

create table if not exists public.v1_char_salary (
  char_id uuid primary key references public.v1_characters(id) on delete cascade,
  fid     text not null,
  amount  numeric not null check (amount > 0),
  set_by  uuid,
  set_at  timestamptz not null default now()
);

create table if not exists public.v1_char_ledger (
  id      bigserial primary key,
  char_id uuid not null references public.v1_characters(id) on delete cascade,
  delta   numeric not null,
  balance numeric not null,
  kind    text not null,              -- salary, pay, send, recv, donate, inherit, death, grant, arena_bet, arena_win, arena_prize
  gross   numeric,                    -- сумма до налога (для потолков)
  fid     text,                       -- связанная держава
  other   uuid,                       -- связанный персонаж
  note    text,
  at      timestamptz not null default now()
);
create index if not exists v1_char_ledger_char on public.v1_char_ledger(char_id, id desc);
create index if not exists v1_char_ledger_pay on public.v1_char_ledger(fid, at) where kind = 'pay';

alter table public.v1_characters enable row level security;
alter table public.v1_char_active enable row level security;
alter table public.v1_char_salary enable row level security;
alter table public.v1_char_ledger enable row level security;
revoke all on public.v1_characters, public.v1_char_active, public.v1_char_salary, public.v1_char_ledger from anon, authenticated;

insert into public.v1_settings(key, value) values ('chars', '{
  "max_alive": 3,
  "tax": 0.05,
  "min_send": 1000,
  "send_cap": 2000000,
  "treasury_cap": 1000000,
  "salary_max": 200000,
  "bio_max": 1500,
  "title_max": 60
}') on conflict (key) do nothing;

-- ════════ 2. Перенос старых персонажей (только чтение старой таблицы) ════════
insert into public.v1_characters(legacy_id, owner_id, fid, name, name_key, status, created_at, died_at)
select c.id, c.owner_id,
       (select a.faction_id from faction_applications a where a.status = 'approved' and a.name = c.faction order by a.created_at limit 1),
       left(btrim(c.name), 40),
       public._v1_name_skel(btrim(c.name)),
       case when c.status = 'dead' then 'dead' else 'active' end,
       coalesce(c.created_at, now()),
       case when c.status = 'dead' then coalesce(c.updated_at, now()) end
from characters c
where c.owner_id is not null and coalesce(btrim(c.name), '') <> ''
  and not exists (select 1 from v1_characters v where v.legacy_id = c.id)
  -- живые с одинаковым именем: переносим первого, остальных — по времени
  and (c.status = 'dead' or not exists (select 1 from characters c2 where c2.status <> 'dead' and c2.id <> c.id
        and public._v1_name_skel(btrim(c2.name)) = public._v1_name_skel(btrim(c.name)) and c2.created_at < c.created_at));

-- ════════ 3. Служебные ════════
create or replace function public._v1_cv(p_key text, p_def numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select (value->>p_key)::numeric from v1_settings where key = 'chars'), p_def)
$$;

-- Имя игрока для показа
create or replace function public._v1_uname(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select name from v1_names where user_id = p_user),
                  (select nullif(display_name, '') from user_roles where user_id = p_user), 'игрок')
$$;

-- Состоит ли игрок в державе (правитель или активный участник)
create or replace function public._v1_in_faction(p_user uuid, p_fid text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_fid is not null and (
    exists (select 1 from faction_economy where faction_id = p_fid and owner_id = p_user)
    or exists (select 1 from faction_members where faction_id = p_fid and user_id = p_user and status = 'active'))
$$;

-- Держава игрока (как v1_my_faction, но для любого игрока)
create or replace function public._v1_user_faction(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select faction_id from faction_economy where owner_id = p_user order by created_at limit 1),
    (select faction_id from faction_members where user_id = p_user and status = 'active' order by created_at limit 1))
$$;

/** Военное положение: держава воюет или в её столичной системе стоит чужая армия. */
create or replace function public._v1_martial(p_fid text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_fid is not null and (
    exists (select 1 from wars w join war_sides s on s.war_id = w.id where w.status = 'active' and s.fid = p_fid)
    or exists (select 1 from wars w where w.status = 'active' and p_fid in (w.attacker_fid, w.defender_fid))
    or exists (select 1 from colonies cap
               where cap.faction_id = p_fid and cap.is_capital
                 and (exists (select 1 from v1_army_meta am join armies a on a.id = am.army_id
                              where am.sys = cap.system_id and a.faction_id is distinct from p_fid)
                      or exists (select 1 from armies a join colonies c on c.id = a.colony_id
                                 where c.system_id = cap.system_id and a.faction_id is distinct from p_fid))))
$$;

/** Движение по личному счёту. Отрицательный остаток невозможен. */
create or replace function public._v1_char_move(p_char uuid, p_delta numeric, p_kind text, p_note text default null,
  p_fid text default null, p_other uuid default null, p_gross numeric default null) returns numeric
language plpgsql security definer set search_path = public as $$
declare bal numeric; d numeric := round(coalesce(p_delta, 0));
begin
  update v1_characters set gc = gc + d where id = p_char and gc + d >= 0 returning gc into bal;
  if bal is null then raise exception 'char_no_money: %', (-d)::bigint; end if;
  insert into v1_char_ledger(char_id, delta, balance, kind, gross, fid, other, note)
  values (p_char, d, bal, p_kind, p_gross, p_fid, p_other, p_note);
  return bal;
end $$;

/** Сверка с державами: персонаж игрока, который больше не состоит в своей державе,
    уходит «без державы» с деньгами. Жалованье снимается. */
create or replace function public._v1_char_sync(p_user uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select c.* from v1_characters c
            where c.status = 'active' and (p_user is null or c.owner_id = p_user)
              and (c.fid is null or not public._v1_in_faction(c.owner_id, c.fid)) loop
    update v1_characters set status = 'exile', fid = null where id = r.id;
    delete from v1_char_salary where char_id = r.id;
    insert into v1_char_ledger(char_id, delta, balance, kind, fid, note)
    values (r.id, 0, r.gc, 'exile', r.fid,
      case when r.fid is null then 'Без державы.'
           when not v1_is_active_faction(r.fid) then 'Держава «' || v1_fname(r.fid) || '» пала. Личный счёт сохранён.'
           else 'Покинул державу «' || v1_fname(r.fid) || '». Личный счёт сохранён.' end);
    n := n + 1;
  end loop;
  -- жалованье только у персонажей своей державы
  delete from v1_char_salary s using v1_characters c where c.id = s.char_id and (c.status <> 'active' or c.fid is distinct from s.fid);
  return n;
end $$;

/** Мой персонаж (проверка владения и что он жив). */
create or replace function public._v1_my_char(p_char uuid) returns v1_characters
language plpgsql security definer set search_path = public as $$
declare c v1_characters;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if exists (select 1 from user_roles where user_id = auth.uid() and coalesce(is_banned, false)) then raise exception 'forbidden'; end if;
  select * into c from v1_characters where id = p_char and owner_id = auth.uid() for update;
  if c.id is null then raise exception 'char_not_yours'; end if;
  if c.status = 'dead' then raise exception 'char_dead'; end if;
  return c;
end $$;

/** Активный персонаж вошедшего игрока (для бара и арены). */
create or replace function public._v1_active_char() returns v1_characters
language plpgsql security definer set search_path = public as $$
declare c v1_characters;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if exists (select 1 from user_roles where user_id = auth.uid() and coalesce(is_banned, false)) then raise exception 'forbidden'; end if;
  perform public._v1_char_sync(auth.uid());
  select c2.* into c from v1_char_active a join v1_characters c2 on c2.id = a.char_id
   where a.user_id = auth.uid() and c2.owner_id = auth.uid() and c2.status <> 'dead';
  if c.id is null then
    select * into c from v1_characters where owner_id = auth.uid() and status <> 'dead' order by created_at limit 1;
    if c.id is not null then
      insert into v1_char_active(user_id, char_id) values (auth.uid(), c.id)
      on conflict (user_id) do update set char_id = excluded.char_id;
    end if;
  end if;
  return c;
end $$;

create or replace function public._v1_char_name_problem(p_name text, p_self uuid default null) returns text
language plpgsql stable security definer set search_path = public as $$
declare why text := public.v1_name_problem(p_name, auth.uid()); n text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if why = 'Это имя уже занято.' then why := 'Так зовут одного из игроков — выберите другое имя.'; end if;
  if why is null and exists (select 1 from v1_characters where name_key = public._v1_name_skel(n) and status <> 'dead' and id is distinct from p_self) then
    why := 'Персонаж с таким именем уже есть.';
  end if;
  return why;
end $$;

-- ════════ 4. Персонаж: создание, правка, выбор, наследник, гибель ════════
create or replace function public.v1_char_create(p_name text, p_title text default null, p_bio text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); why text; n text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')); v_fid text; cid uuid;
begin
  if uid is null then raise exception 'not_signed_in'; end if;
  if exists (select 1 from user_roles where user_id = uid and coalesce(is_banned, false)) then raise exception 'forbidden'; end if;
  perform public._v1_char_sync(uid);
  if (select count(*) from v1_characters where owner_id = uid and status <> 'dead') >= public._v1_cv('max_alive', 3) then
    raise exception 'char_limit: %', public._v1_cv('max_alive', 3)::int;
  end if;
  why := public._v1_char_name_problem(n);
  if why is not null then raise exception 'name_rejected: %', why; end if;
  if char_length(coalesce(p_title, '')) > public._v1_cv('title_max', 60) or char_length(coalesce(p_bio, '')) > public._v1_cv('bio_max', 1500) then
    raise exception 'char_text_long';
  end if;
  v_fid := public._v1_user_faction(uid);
  insert into v1_characters(owner_id, fid, name, name_key, title, bio, status)
  values (uid, v_fid, n, public._v1_name_skel(n), nullif(btrim(coalesce(p_title, '')), ''), nullif(btrim(coalesce(p_bio, '')), ''),
          case when v_fid is null then 'exile' else 'active' end)
  returning id into cid;
  insert into v1_char_active(user_id, char_id) values (uid, cid) on conflict (user_id) do nothing;
  return cid;
end $$;

create or replace function public.v1_char_edit(p_char uuid, p_name text, p_title text, p_bio text) returns boolean
language plpgsql security definer set search_path = public as $$
declare c v1_characters := public._v1_my_char(p_char); why text; n text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if n <> c.name then
    why := public._v1_char_name_problem(n, c.id);
    if why is not null then raise exception 'name_rejected: %', why; end if;
  end if;
  if char_length(coalesce(p_title, '')) > public._v1_cv('title_max', 60) or char_length(coalesce(p_bio, '')) > public._v1_cv('bio_max', 1500) then
    raise exception 'char_text_long';
  end if;
  update v1_characters set name = n, name_key = public._v1_name_skel(n),
    title = nullif(btrim(coalesce(p_title, '')), ''), bio = nullif(btrim(coalesce(p_bio, '')), '') where id = c.id;
  return true;
end $$;

create or replace function public.v1_char_use(p_char uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare c v1_characters := public._v1_my_char(p_char);
begin
  insert into v1_char_active(user_id, char_id) values (auth.uid(), c.id) on conflict (user_id) do update set char_id = excluded.char_id;
  return true;
end $$;

/** Вольный персонаж поступает на службу державе своего игрока. */
create or replace function public.v1_char_join(p_char uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare c v1_characters := public._v1_my_char(p_char); v_fid text := public._v1_user_faction(auth.uid());
begin
  if c.status <> 'exile' then raise exception 'char_not_exile'; end if;
  if v_fid is null then raise exception 'no_faction'; end if;
  update v1_characters set status = 'active', fid = v_fid where id = c.id;
  insert into v1_char_ledger(char_id, delta, balance, kind, fid, note) values (c.id, 0, c.gc, 'join', v_fid, 'Поступил на службу державе «' || v1_fname(v_fid) || '».');
  return true;
end $$;

create or replace function public.v1_char_heir(p_char uuid, p_heir uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare c v1_characters := public._v1_my_char(p_char);
begin
  if p_heir is not null and (p_heir = c.id or not exists (select 1 from v1_characters where id = p_heir and status <> 'dead')) then
    raise exception 'char_bad_heir';
  end if;
  update v1_characters set heir_id = p_heir where id = c.id;
  return true;
end $$;

/** Гибель персонажа (решает владелец; команда проекта — по итогам события). Необратимо. */
create or replace function public._v1_char_die(p_char uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c v1_characters; h v1_characters; tax numeric; net numeric; dest text := 'burn';
begin
  select * into c from v1_characters where id = p_char for update;
  if c.id is null or c.status = 'dead' then raise exception 'char_dead'; end if;
  select * into h from v1_characters where id = c.heir_id and status <> 'dead';
  if c.gc > 0 then
    perform public._v1_char_move(c.id, -c.gc, 'death', 'Гибель персонажа.');
    if h.id is not null then
      tax := round(c.gc * public._v1_cv('tax', 0.05)); net := c.gc - tax;
      perform public._v1_char_move(h.id, net, 'inherit', 'Наследство от ' || c.name || '.', c.fid, c.id, c.gc);
      dest := 'heir';
    elsif c.fid is not null and exists (select 1 from faction_economy where faction_id = c.fid) then
      update faction_economy set gc = gc + c.gc where faction_id = c.fid;
      dest := 'treasury';
    end if;
  end if;
  update v1_characters set status = 'dead', died_at = now(), death_note = nullif(btrim(coalesce(p_note, '')), ''), heir_id = null where id = c.id;
  update v1_characters set heir_id = null where heir_id = c.id;
  delete from v1_char_salary where char_id = c.id;
  delete from v1_char_active where char_id = c.id;
  return jsonb_build_object('dest', dest, 'amount', c.gc, 'heir', h.name, 'net', net);
end $$;

create or replace function public.v1_char_die(p_char uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c v1_characters;
begin
  if public.v1_is_staff() then
    return public._v1_char_die(p_char, p_note);
  end if;
  c := public._v1_my_char(p_char);
  return public._v1_char_die(c.id, p_note);
end $$;

-- ════════ 5. Деньги ════════
/** Перевод персонаж → персонаж. Налог сгорает, дневной потолок на отправителя. */
create or replace function public.v1_char_send(p_from uuid, p_to uuid, p_amount numeric, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c v1_characters := public._v1_my_char(p_from); t v1_characters; amt numeric := round(coalesce(p_amount, 0)); tax numeric; used numeric; cap numeric := public._v1_cv('send_cap', 2000000);
begin
  select * into t from v1_characters where id = p_to and status <> 'dead';
  if t.id is null or t.id = c.id then raise exception 'char_bad_target'; end if;
  if amt < public._v1_cv('min_send', 1000) then raise exception 'char_min: %', public._v1_cv('min_send', 1000)::bigint; end if;
  select coalesce(sum(-delta), 0) into used from v1_char_ledger where char_id = c.id and kind = 'send' and at >= date_trunc('day', now());
  if used + amt > cap then raise exception 'char_cap: %', greatest(0, cap - used)::bigint; end if;
  tax := round(amt * public._v1_cv('tax', 0.05));
  perform public._v1_char_move(c.id, -amt, 'send', left(p_note, 140), t.fid, t.id, amt);
  perform public._v1_char_move(t.id, amt - tax, 'recv', left(p_note, 140), c.fid, c.id, amt);
  return jsonb_build_object('sent', amt, 'tax', tax, 'got', amt - tax);
end $$;

/** Пожертвование персонажа в казну любой державы. Без налога. */
create or replace function public.v1_char_donate(p_char uuid, p_fid text, p_amount numeric) returns numeric
language plpgsql security definer set search_path = public as $$
declare c v1_characters := public._v1_my_char(p_char); amt numeric := round(coalesce(p_amount, 0));
begin
  if not exists (select 1 from faction_economy where faction_id = p_fid) or not v1_is_active_faction(p_fid) then raise exception 'faction_unknown'; end if;
  if amt < public._v1_cv('min_send', 1000) then raise exception 'char_min: %', public._v1_cv('min_send', 1000)::bigint; end if;
  perform public._v1_char_move(c.id, -amt, 'donate', 'В казну державы «' || v1_fname(p_fid) || '».', p_fid);
  update faction_economy set gc = gc + amt where faction_id = p_fid;
  return amt;
end $$;

/** Выплата из казны персонажу своей державы. Право «Казна», потолок за сутки, налог, военное положение. */
create or replace function public.v1_char_pay(p_char uuid, p_amount numeric, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction(); t v1_characters; amt numeric := round(coalesce(p_amount, 0)); tax numeric; used numeric; cap numeric := public._v1_cv('treasury_cap', 1000000);
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(v_fid, 'treasury') then raise exception 'forbidden'; end if;
  perform public._v1_char_sync();
  select * into t from v1_characters where id = p_char and status = 'active' and fid = v_fid for update;
  if t.id is null then raise exception 'char_bad_target'; end if;
  if public._v1_martial(v_fid) then raise exception 'char_martial'; end if;
  if amt < public._v1_cv('min_send', 1000) then raise exception 'char_min: %', public._v1_cv('min_send', 1000)::bigint; end if;
  select coalesce(sum(gross), 0) into used from v1_char_ledger where kind = 'pay' and fid = v_fid and at >= date_trunc('day', now());
  if used + amt > cap then raise exception 'char_cap: %', greatest(0, cap - used)::bigint; end if;
  update faction_economy set gc = gc - amt where faction_id = v_fid and gc >= amt;
  if not found then raise exception 'prod_no_money: %', amt::bigint; end if;
  tax := round(amt * public._v1_cv('tax', 0.05));
  perform public._v1_char_move(t.id, amt - tax, 'pay', coalesce(left(p_note, 140), 'Выплата из казны.'), v_fid, null, amt);
  return jsonb_build_object('paid', amt, 'tax', tax, 'got', amt - tax);
end $$;

/** Жалованье: 0 — снять. Во время военного положения можно только снизить. */
create or replace function public.v1_char_salary_set(p_char uuid, p_amount numeric) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction(); amt numeric := round(coalesce(p_amount, 0)); cur numeric;
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(v_fid, 'treasury') then raise exception 'forbidden'; end if;
  if not exists (select 1 from v1_characters where id = p_char and status = 'active' and fid = v_fid) then raise exception 'char_bad_target'; end if;
  if amt < 0 or amt > public._v1_cv('salary_max', 200000) then raise exception 'char_salary_max: %', public._v1_cv('salary_max', 200000)::bigint; end if;
  select amount into cur from v1_char_salary where char_id = p_char;
  if amt > coalesce(cur, 0) and public._v1_martial(v_fid) then raise exception 'char_martial'; end if;
  if amt = 0 then delete from v1_char_salary where char_id = p_char;
  else
    insert into v1_char_salary(char_id, fid, amount, set_by) values (p_char, v_fid, amt, auth.uid())
    on conflict (char_id) do update set amount = excluded.amount, fid = excluded.fid, set_by = excluded.set_by, set_at = now();
  end if;
  return true;
end $$;

/** Награда или списание от команды проекта (события). Записывается в журнал. */
create or replace function public.v1_char_grant(p_char uuid, p_amount numeric, p_note text) returns numeric
language plpgsql security definer set search_path = public as $$
declare amt numeric := round(coalesce(p_amount, 0));
begin
  if not public.v1_is_staff() then raise exception 'not_staff'; end if;
  if amt = 0 or coalesce(btrim(p_note), '') = '' then raise exception 'char_grant_note'; end if;
  if not exists (select 1 from v1_characters where id = p_char and status <> 'dead') then raise exception 'char_bad_target'; end if;
  return public._v1_char_move(p_char, amt, 'grant', 'Команда проекта: ' || left(btrim(p_note), 140));
end $$;

/** Суточная выплата жалованья. Казне не хватает — выплата пропускается и пишется в журнал. */
create or replace function public.v1_char_payday() returns int
language plpgsql security definer set search_path = public as $$
declare s record; n int := 0; c v1_characters;
begin
  perform public._v1_char_sync();
  for s in select * from v1_char_salary order by fid, set_at loop
    select * into c from v1_characters where id = s.char_id and status = 'active' and fid = s.fid;
    continue when c.id is null;
    update faction_economy set gc = gc - s.amount where faction_id = s.fid and gc >= s.amount;
    if found then
      perform public._v1_char_move(c.id, s.amount, 'salary', 'Жалованье.', s.fid, null, s.amount);
      n := n + 1;
    else
      insert into v1_char_ledger(char_id, delta, balance, kind, fid, note) values (c.id, 0, c.gc, 'salary_miss', s.fid, 'Казне не хватило на жалованье.');
    end if;
  end loop;
  return n;
end $$;

do $$
begin
  perform cron.unschedule('v1-char-payday') where exists (select 1 from cron.job where jobname = 'v1-char-payday');
  perform cron.schedule('v1-char-payday', '17 0 * * *', 'select public.v1_char_payday()');
end $$;

-- ════════ 6. Чтение ════════
create or replace function public._v1_char_card(c v1_characters, p_full boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'title', c.title, 'bio', c.bio, 'status', c.status,
    'fid', c.fid, 'faction', case when c.fid is not null then v1_fname(c.fid) end, 'owner', public._v1_uname(c.owner_id),
    'legacy', c.legacy_id is not null, 'created_at', c.created_at, 'died_at', c.died_at, 'death_note', c.death_note)
  || case when p_full then jsonb_build_object('gc', c.gc, 'heir', c.heir_id, 'heir_name', (select name from v1_characters h where h.id = c.heir_id),
       'salary', (select amount from v1_char_salary where char_id = c.id),
       'sent_today', (select coalesce(sum(-delta), 0) from v1_char_ledger where char_id = c.id and kind = 'send' and at >= date_trunc('day', now())))
     else '{}'::jsonb end
$$;

create or replace function public.v1_char_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_fid text; act v1_characters; can_t boolean;
begin
  if uid is null then raise exception 'not_signed_in'; end if;
  perform public._v1_char_sync(uid);
  act := public._v1_active_char();
  v_fid := public._v1_user_faction(uid);
  can_t := v_fid is not null and v1_can_manage(v_fid, 'treasury');
  return jsonb_build_object(
    'settings', (select value from v1_settings where key = 'chars'),
    'staff', public.v1_is_staff(),
    'active', act.id,
    'mine', (select coalesce(jsonb_agg(public._v1_char_card(c, true) order by c.status = 'dead', c.created_at), '[]'::jsonb) from v1_characters c where c.owner_id = uid),
    'faction', case when v_fid is not null then jsonb_build_object('id', v_fid, 'name', v1_fname(v_fid), 'can_treasury', can_t,
       'martial', public._v1_martial(v_fid),
       'gc', case when can_t then (select gc from faction_economy where faction_id = v_fid) end,
       'paid_today', case when can_t then (select coalesce(sum(gross), 0) from v1_char_ledger where kind = 'pay' and fid = v_fid and at >= date_trunc('day', now())) end,
       'salaries', case when can_t then (select coalesce(sum(amount), 0) from v1_char_salary where fid = v_fid) end,
       'chars', (select coalesce(jsonb_agg(public._v1_char_card(c, false) || jsonb_build_object('salary', case when can_t then (select amount from v1_char_salary where char_id = c.id) end)
                  order by c.name), '[]'::jsonb) from v1_characters c where c.fid = v_fid and c.status = 'active')) end,
    'factions', (select coalesce(jsonb_agg(jsonb_build_object('id', a.faction_id, 'name', a.name) order by a.name), '[]'::jsonb)
                 from faction_applications a where a.status = 'approved' and exists (select 1 from faction_economy e where e.faction_id = a.faction_id)));
end $$;

create or replace function public.v1_char_ledger_read(p_char uuid, p_limit int default 40) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (exists (select 1 from v1_characters where id = p_char and owner_id = auth.uid()) or public.v1_is_staff()) then raise exception 'char_not_yours'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('at', l.at, 'delta', l.delta, 'balance', l.balance, 'kind', l.kind, 'note', l.note,
            'faction', case when l.fid is not null then v1_fname(l.fid) end, 'other', (select name from v1_characters o where o.id = l.other)) order by l.id desc), '[]'::jsonb)
          from (select * from v1_char_ledger where char_id = p_char order by id desc limit least(greatest(coalesce(p_limit, 40), 1), 200)) l);
end $$;

/** Справочник персонажей: имя, титул, держава. Баланс видит только команда проекта. */
create or replace function public.v1_char_directory(p_q text default null, p_dead boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare st boolean := public.v1_is_staff(); q text := nullif(btrim(coalesce(p_q, '')), '');
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  return (select coalesce(jsonb_agg(public._v1_char_card(c, st) order by c.name), '[]'::jsonb) from (
    select * from v1_characters c
     where (p_dead or c.status <> 'dead')
       and (q is null or c.name ilike '%' || q || '%' or coalesce(c.title, '') ilike '%' || q || '%' or (c.fid is not null and v1_fname(c.fid) ilike '%' || q || '%'))
     order by c.name limit 80) c);
end $$;

-- ════════ 7. Бар — с личного счёта активного персонажа ════════
alter table public.v1_bar_log add column if not exists char_id uuid references public.v1_characters(id) on delete set null;
alter table public.v1_bar_log alter column fid drop not null;
create index if not exists v1_bar_log_char on public.v1_bar_log(char_id, id desc);
alter table public.v1_bar_bj add column if not exists char_id uuid references public.v1_characters(id) on delete cascade;
alter table public.v1_bar_bj alter column fid drop not null;
create unique index if not exists v1_bar_bj_one_char on public.v1_bar_bj(char_id) where status = 'play';
drop index if exists public.v1_bar_bj_one;

drop function if exists public._v1_bar_take(numeric);
drop function if exists public._v1_bar_pay(text, text, numeric, numeric, jsonb);

/** Принять ставку: активный персонаж, пределы, личный счёт, частота. */
create or replace function public._v1_bar_take(p_bet numeric) returns uuid
language plpgsql security definer set search_path = public as $$
declare c v1_characters := public._v1_active_char(); bet numeric := round(coalesce(p_bet, 0));
begin
  if c.id is null then raise exception 'char_none'; end if;
  if bet < public._v1_bv('min', 25000) or bet > public._v1_bv('max', 500000) then
    raise exception 'bet_range: % %', public._v1_bv('min', 25000)::bigint, public._v1_bv('max', 500000)::bigint;
  end if;
  if exists (select 1 from v1_bar_log where char_id = c.id and created_at > now() - make_interval(secs => public._v1_bv('cooldown_s', 2))) then raise exception 'bar_slow'; end if;
  update v1_characters set gc = gc - bet where id = c.id and gc >= bet;
  if not found then raise exception 'char_no_money: %', bet::bigint; end if;
  return c.id;
end $$;

create or replace function public._v1_bar_pay(p_char uuid, p_game text, p_bet numeric, p_payout numeric, p_detail jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pay numeric := greatest(0, round(coalesce(p_payout, 0)));
begin
  if pay > 0 then update v1_characters set gc = gc + pay where id = p_char; end if;
  if pay < p_bet then update v1_bar_pot set jackpot = jackpot + round((p_bet - pay) * public._v1_bv('jackpot_k', 0.02)) where id = 1; end if;
  insert into v1_bar_log(fid, char_id, game, bet, payout, detail)
  values ((select fid from v1_characters where id = p_char), p_char, p_game, p_bet, pay, coalesce(p_detail, '{}'::jsonb));
  return coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('bet', p_bet, 'payout', pay, 'net', pay - p_bet,
    'gc', (select gc from v1_characters where id = p_char), 'jackpot', (select jackpot from v1_bar_pot where id = 1));
end $$;

create or replace function public._v1_char_label(p_char uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select c.name || case when c.fid is not null then ' («' || v1_fname(c.fid) || '»)' else '' end from v1_characters c where c.id = p_char), 'гость')
$$;

create or replace function public.v1_bar_roulette(p_bet numeric, p_kind text, p_value int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cid uuid; n int := floor(random() * 37)::int; red int[] := array[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]; win boolean; k numeric;
begin
  if p_kind not in ('num', 'red', 'black', 'even', 'odd', 'low', 'high', 'dozen') then raise exception 'bad_side'; end if;
  if p_kind = 'num' and (p_value is null or p_value not between 0 and 36) then raise exception 'bar_bad_value'; end if;
  if p_kind = 'dozen' and (p_value is null or p_value not between 1 and 3) then raise exception 'bar_bad_value'; end if;
  cid := public._v1_bar_take(p_bet);
  win := case p_kind
    when 'num' then n = p_value
    when 'red' then n = any(red) when 'black' then n > 0 and not n = any(red)
    when 'even' then n > 0 and n % 2 = 0 when 'odd' then n % 2 = 1
    when 'low' then n between 1 and 18 when 'high' then n between 19 and 36
    when 'dozen' then n between (p_value - 1) * 12 + 1 and p_value * 12 end;
  k := case p_kind when 'num' then 36 when 'dozen' then 3 else 2 end;
  return public._v1_bar_pay(cid, 'roulette', round(p_bet), case when win then round(p_bet) * k else 0 end,
    jsonb_build_object('number', n, 'color', case when n = 0 then 'green' when n = any(red) then 'red' else 'black' end, 'win', win, 'kind', p_kind, 'value', p_value));
end $$;

create or replace function public.v1_bar_wheel(p_bet numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cid uuid; seg int := floor(random() * 30)::int; k numeric; jp numeric := 0; label text;
begin
  cid := public._v1_bar_take(p_bet);
  k := case when seg < 16 then 0 when seg < 22 then 1.5 when seg < 26 then 2 when seg < 28 then 3 when seg = 28 then 5 else 0 end;
  if seg = 29 then
    select jackpot into jp from v1_bar_pot where id = 1 for update;
    update v1_bar_pot set jackpot = public._v1_bv('jackpot_seed', 1000000) where id = 1;
    perform v1_bulletin('Джекпот бара «Классикал»', format('%s срывает джекпот на колесе удачи: %s ГС.', public._v1_char_label(cid), to_char(jp, 'FM999G999G990')),
      coalesce((select jsonb_build_array(fid) from v1_characters where id = cid and fid is not null), '[]'::jsonb));
  end if;
  label := case when seg = 29 then 'ДЖЕКПОТ' when k = 0 then 'пусто' else '×' || replace(k::text, '.', ',') end;
  return public._v1_bar_pay(cid, 'wheel', round(p_bet), round(p_bet) * k + jp, jsonb_build_object('segment', seg, 'label', label, 'mult', k, 'jackpot_won', jp));
end $$;

create or replace function public.v1_bar_tarot(p_bet numeric, p_guess text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cid uuid; c int := floor(random() * 78)::int; major text[] := array['Шут','Маг','Верховная Жрица','Императрица','Император','Иерофант','Влюблённые',
  'Колесница','Сила','Отшельник','Колесо Фортуны','Справедливость','Повешенный','Смерть','Умеренность','Дьявол','Башня','Звезда','Луна','Солнце','Суд','Мир'];
  suits text[] := array['wands','cups','swords','pentacles']; suit_ru text[] := array['Жезлов','Кубков','Мечей','Пентаклей'];
  ranks text[] := array['Туз','Двойка','Тройка','Четвёрка','Пятёрка','Шестёрка','Семёрка','Восьмёрка','Девятка','Десятка','Паж','Рыцарь','Королева','Король'];
  nm text; kind text; k numeric := 0; si int;
begin
  if not (p_guess in ('major', 'wands', 'cups', 'swords', 'pentacles') or p_guess ~ '^m([0-9]|1[0-9]|2[01])$') then raise exception 'bar_bad_value'; end if;
  cid := public._v1_bar_take(p_bet);
  if c < 22 then nm := major[c + 1]; kind := 'major';
  else si := (c - 22) / 14; nm := ranks[(c - 22) % 14 + 1] || ' ' || suit_ru[si + 1]; kind := suits[si + 1];
  end if;
  if p_guess = 'major' and kind = 'major' then k := 3.4;
  elsif p_guess = kind and kind <> 'major' then k := 5.3;
  elsif p_guess ~ '^m' and kind = 'major' and substr(p_guess, 2)::int = c then k := 70;
  end if;
  return public._v1_bar_pay(cid, 'tarot', round(p_bet), round(p_bet) * k, jsonb_build_object('card', c, 'name', nm, 'kind', kind, 'guess', p_guess, 'mult', k, 'win', k > 0));
end $$;

create or replace function public.v1_bar_dice(p_bet numeric, p_kind text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cid uuid; d1 int := 1 + floor(random() * 6)::int; d2 int := 1 + floor(random() * 6)::int; s int; win boolean; k numeric;
begin
  if p_kind not in ('under', 'over', 'seven', 'double') then raise exception 'bad_side'; end if;
  cid := public._v1_bar_take(p_bet);
  s := d1 + d2;
  win := case p_kind when 'under' then s < 7 when 'over' then s > 7 when 'seven' then s = 7 else d1 = d2 end;
  k := case when not win then 0 when p_kind in ('under', 'over') then 2.3 else 5.7 end;
  return public._v1_bar_pay(cid, 'dice', round(p_bet), round(p_bet) * k, jsonb_build_object('d1', d1, 'd2', d2, 'sum', s, 'kind', p_kind, 'win', win));
end $$;

create or replace function public._v1_bj_finish(p_game uuid, p_force_result text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g v1_bar_bj; pv int; dv int; res text; k numeric; v jsonb;
begin
  select * into g from v1_bar_bj where id = p_game for update;
  pv := public._v1_bj_val(g.player);
  if p_force_result is null and pv <= 21 then
    while public._v1_bj_val(g.dealer) < 17 loop
      g.dealer := g.dealer || (g.deck->0); g.deck := g.deck - 0;
    end loop;
  end if;
  dv := public._v1_bj_val(g.dealer);
  res := coalesce(p_force_result, case when pv > 21 then 'bust' when dv > 21 or pv > dv then 'win' when pv = dv then 'push' else 'lose' end);
  k := case res when 'blackjack' then 2.5 when 'win' then 2 when 'push' then 1 else 0 end;
  update v1_bar_bj set dealer = g.dealer, deck = g.deck, status = 'done', result = res, payout = round(g.bet * k) where id = g.id;
  v := public._v1_bar_pay(g.char_id, 'blackjack', g.bet, round(g.bet * k), jsonb_build_object('result', res));
  return public._v1_bj_view(g.id) || jsonb_build_object('gc', v->'gc', 'jackpot', v->'jackpot', 'net', v->'net');
end $$;

create or replace function public.v1_bar_bj_start(p_bet numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cid uuid; deck jsonb; gid uuid; pv int; dv int; act v1_characters := public._v1_active_char();
begin
  if act.id is null then raise exception 'char_none'; end if;
  if exists (select 1 from v1_bar_bj g where g.char_id = act.id and g.status = 'play') then raise exception 'bj_active'; end if;
  cid := public._v1_bar_take(p_bet);
  select jsonb_agg(c order by random()) into deck from generate_series(0, 51) c;
  insert into v1_bar_bj(fid, char_id, bet, deck, player, dealer)
  values (act.fid, cid, round(p_bet), deck - 0 - 0 - 0 - 0, jsonb_build_array(deck->0, deck->2), jsonb_build_array(deck->1, deck->3)) returning id into gid;
  pv := public._v1_bj_val(jsonb_build_array(deck->0, deck->2)); dv := public._v1_bj_val(jsonb_build_array(deck->1, deck->3));
  if pv = 21 then return public._v1_bj_finish(gid, case when dv = 21 then 'push' else 'blackjack' end); end if;
  return public._v1_bj_view(gid);
end $$;

create or replace function public.v1_bar_bj_act(p_game uuid, p_act text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g v1_bar_bj;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select b.* into g from v1_bar_bj b join v1_characters c on c.id = b.char_id
   where b.id = p_game and c.owner_id = auth.uid() and b.status = 'play' for update of b;
  if g.id is null then raise exception 'bj_gone'; end if;
  if p_act = 'hit' then
    update v1_bar_bj set player = player || (deck->0), deck = deck - 0 where id = g.id;
    if public._v1_bj_val((select player from v1_bar_bj where id = g.id)) >= 21 then return public._v1_bj_finish(g.id); end if;
    return public._v1_bj_view(g.id);
  elsif p_act = 'double' then
    if jsonb_array_length(g.player) <> 2 then raise exception 'bj_double_two'; end if;
    update v1_characters set gc = gc - g.bet where id = g.char_id and gc >= g.bet;
    if not found then raise exception 'char_no_money: %', g.bet::bigint; end if;
    update v1_bar_bj set player = player || (deck->0), deck = deck - 0, bet = bet * 2, doubled = true where id = g.id;
    return public._v1_bj_finish(g.id);
  elsif p_act = 'stand' then
    return public._v1_bj_finish(g.id);
  end if;
  raise exception 'bad_side';
end $$;

create or replace function public.v1_bar_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare act v1_characters := public._v1_active_char();
begin
  return jsonb_build_object(
    'char', case when act.id is not null then jsonb_build_object('id', act.id, 'name', act.name, 'faction', case when act.fid is not null then v1_fname(act.fid) end) end,
    'chars', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.created_at), '[]'::jsonb) from v1_characters c where c.owner_id = auth.uid() and c.status <> 'dead'),
    'can', act.id is not null,
    'gc', act.gc,
    'settings', (select value from v1_settings where key = 'bar'),
    'jackpot', (select jackpot from v1_bar_pot where id = 1),
    'bj', (select public._v1_bj_view(id) from v1_bar_bj where char_id = act.id and status = 'play' limit 1),
    'mine', (select coalesce(jsonb_agg(jsonb_build_object('game', l.game, 'bet', l.bet, 'payout', l.payout, 'at', l.created_at) order by l.id desc), '[]'::jsonb)
             from (select * from v1_bar_log where char_id = act.id order by id desc limit 20) l),
    'today', (select jsonb_build_object('bets', coalesce(sum(bet), 0), 'payout', coalesce(sum(payout), 0), 'games', count(*))
              from v1_bar_log where char_id = act.id and created_at > date_trunc('day', now())),
    'wins', (select coalesce(jsonb_agg(jsonb_build_object('who', case when l.char_id is not null then public._v1_char_label(l.char_id) else v1_fname(l.fid) end,
               'game', l.game, 'payout', l.payout, 'at', l.created_at) order by l.payout desc), '[]'::jsonb)
             from (select * from v1_bar_log where created_at > now() - interval '1 day' and payout >= bet * 3 order by payout desc limit 8) l));
end $$;

-- ════════ 8. Арена: ставки зрителей и приз — личные ════════
alter table public.v1_arena_bets add column if not exists char_id uuid references public.v1_characters(id) on delete set null;
alter table public.v1_arena_bets drop constraint if exists v1_arena_bets_pkey;
alter table public.v1_arena_bets alter column fid drop not null;
create unique index if not exists v1_arena_bets_char on public.v1_arena_bets(match_id, char_id);
alter table public.v1_arena_matches add column if not exists by_char uuid references public.v1_characters(id) on delete set null;

create or replace function public.v1_arena_bet(p_match uuid, p_side text, p_amount numeric) returns boolean
language plpgsql security definer set search_path = public as $$
declare c v1_characters := public._v1_active_char(); mt v1_arena_matches; t int; amt numeric := round(coalesce(p_amount, 0));
begin
  if c.id is null then raise exception 'char_none'; end if;
  select * into mt from v1_arena_matches where id = p_match and status = 'live';
  if mt.id is null then raise exception 'arena_gone'; end if;
  if c.fid is not null and c.fid in (mt.a_fid, mt.b_fid) then raise exception 'arena_bet_own'; end if;
  select turn_no into t from v1_battles where id = mt.battle_id;
  if t > public._v1_av('bet_turns', 2) then raise exception 'arena_bet_closed'; end if;
  if p_side not in ('a', 'b') then raise exception 'bad_side'; end if;
  if amt < public._v1_av('bet_min', 25000) or amt > public._v1_av('bet_max', 500000) then
    raise exception 'bet_range: % %', public._v1_av('bet_min', 25000)::bigint, public._v1_av('bet_max', 500000)::bigint;
  end if;
  if exists (select 1 from v1_arena_bets where match_id = mt.id and char_id = c.id) then raise exception 'arena_bet_dup'; end if;
  perform public._v1_char_move(c.id, -amt, 'arena_bet', 'Ставка на арене.', c.fid);
  insert into v1_arena_bets(match_id, fid, char_id, side, amount) values (mt.id, c.fid, c.id, p_side, amt);
  return true;
end $$;

create or replace function public.v1_arena_fight_bot(p_kind text, p_roster jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_fid text := public._v1_arena_me(); ros jsonb; bot jsonb; mid uuid; act v1_characters := public._v1_active_char();
begin
  if p_kind not in ('space', 'ground') then raise exception 'arena_kind'; end if;
  if exists (select 1 from v1_arena_matches where v_fid in (a_fid, b_fid) and status = 'live') then raise exception 'arena_busy'; end if;
  ros := public._v1_arena_roster(v_fid, p_kind, p_roster);
  bot := public._v1_arena_bot_roster(p_kind);
  if jsonb_array_length(bot) = 0 then raise exception 'arena_no_bot'; end if;
  insert into v1_arena_matches(kind, a_fid, b_fid, roster_a, roster_b, status, by_char)
  values (p_kind, 'arena_bot', v_fid, bot, ros, 'pending', case when act.fid = v_fid and act.status = 'active' then act.id end)
  returning id into mid;
  return public._v1_arena_battle(mid);
end $$;

create or replace function public._v1_arena_settle(p_battle uuid) returns void
language plpgsql security definer set search_path = public as $$
declare mt v1_arena_matches; b record; wfid text; pool numeric; wpool numeric; bt record; v_prize numeric := 0; house numeric := public._v1_av('house', 0.05); win numeric;
begin
  select * into mt from v1_arena_matches where battle_id = p_battle and status = 'live' for update;
  if mt.id is null then return; end if;
  select * into b from v1_battles where id = p_battle;
  wfid := case b.winner_side when 'a' then mt.a_fid when 'b' then mt.b_fid end;
  -- вызов державы: ставки из казны, победитель забирает обе, ничья — назад
  if mt.stake > 0 then
    if wfid is null then
      update faction_economy set gc = gc + mt.stake where faction_id in (mt.a_fid, mt.b_fid);
    elsif wfid <> 'arena_bot' then
      update faction_economy set gc = gc + mt.stake * 2 where faction_id = wfid;
    end if;
  end if;
  -- победа над ботом — приз персонажу, который вёл бой (иначе в казну), не чаще раза в N часов
  if wfid is not null and wfid <> 'arena_bot' and 'arena_bot' in (mt.a_fid, mt.b_fid)
     and not exists (select 1 from v1_arena_matches x where x.winner_fid = wfid and x.prize > 0 and x.ended_at > now() - make_interval(hours => public._v1_av('prize_cd_h', 12)::int)) then
    v_prize := public._v1_av('prize', 250000);
    if mt.by_char is not null and exists (select 1 from v1_characters where id = mt.by_char and status <> 'dead') then
      perform public._v1_char_move(mt.by_char, v_prize, 'arena_prize', 'Победа над «Жнецом».', wfid);
    else
      update faction_economy set gc = gc + v_prize where faction_id = wfid;
    end if;
  end if;
  -- тотализатор: личные счета
  select coalesce(sum(amount), 0), coalesce(sum(amount) filter (where side = b.winner_side), 0) into pool, wpool from v1_arena_bets where match_id = mt.id;
  for bt in select * from v1_arena_bets where match_id = mt.id loop
    if b.winner_side is null or wpool = 0 then win := bt.amount;
    elsif bt.side = b.winner_side then win := round(bt.amount + (pool - wpool) * bt.amount / wpool * (1 - house));
    else win := 0;
    end if;
    update v1_arena_bets set won = win where match_id = mt.id and char_id is not distinct from bt.char_id and fid is not distinct from bt.fid;
    if win > 0 then
      if bt.char_id is not null and exists (select 1 from v1_characters where id = bt.char_id) then
        perform public._v1_char_move(bt.char_id, win, 'arena_win', case when win = bt.amount and (b.winner_side is null or wpool = 0) then 'Ставка возвращена.' else 'Выигрыш ставки на арене.' end);
      elsif bt.fid is not null then
        update faction_economy set gc = gc + win where faction_id = bt.fid;
      end if;
    end if;
  end loop;
  update v1_arena_matches set status = 'done', winner_fid = wfid, prize = v_prize, ended_at = now() where id = mt.id;
  perform v1_bulletin('Арена: ' || case when wfid is null then 'ничья' when wfid = 'arena_bot' then 'победа «Жнеца»' else 'победа державы «' || v1_fname(wfid) || '»' end,
    format('%s бой на арене: %s против %s.%s', case mt.kind when 'space' then 'Космический' else 'Наземный' end,
      case when mt.a_fid = 'arena_bot' then '«Жнец»' else '«' || v1_fname(mt.a_fid) || '»' end,
      case when mt.b_fid = 'arena_bot' then '«Жнец»' else '«' || v1_fname(mt.b_fid) || '»' end,
      case when v_prize > 0 then ' Приз арены — ' || to_char(v_prize, 'FM999G999G990') || ' ГС' ||
        case when mt.by_char is not null then ', его получает ' || (select name from v1_characters where id = mt.by_char) else '' end || '.' else '' end),
    (select coalesce(jsonb_agg(x), '[]'::jsonb) from unnest(array[mt.a_fid, mt.b_fid]) x where x <> 'arena_bot'));
end $$;

create or replace function public.v1_arena_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction(); act v1_characters := public._v1_active_char();
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  return jsonb_build_object(
    'fid', v_fid, 'settings', (select value from v1_settings where key = 'arena'),
    'can', v1_can_manage(v_fid, 'fleet') or v1_can_manage(v_fid, 'produce') or v1_can_manage(v_fid, 'army'),
    'gc', (select gc from faction_economy where faction_id = v_fid),
    'char', case when act.id is not null then jsonb_build_object('id', act.id, 'name', act.name, 'gc', act.gc, 'fid', act.fid) end,
    'prize_ready', not exists (select 1 from v1_arena_matches x where x.winner_fid = v_fid and x.prize > 0
                                and x.ended_at > now() - make_interval(hours => public._v1_av('prize_cd_h', 12)::int)),
    'space', (select coalesce(jsonb_agg(d order by (d->>'cost')::numeric), '[]'::jsonb) from (
               select public._v1_arena_design(v_fid, 'space', s.id) d from v1_ships s where s.faction_id = v_fid) z where d is not null),
    'ground', (select coalesce(jsonb_agg(d || jsonb_build_object('public', pub) order by (d->>'cost')::numeric), '[]'::jsonb) from (
               select public._v1_arena_design(v_fid, 'ground', u.id) d, u.faction_id is null pub from faction_units u
                where u.category in ('ground', 'aviation') and (u.faction_id = v_fid or u.faction_id is null)) z where d is not null),
    'matches', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'status', m.status, 'stake', m.stake, 'battle', m.battle_id,
                  'a', case when m.a_fid = 'arena_bot' then '«Жнец»' else v1_fname(m.a_fid) end, 'b', case when m.b_fid = 'arena_bot' then '«Жнец»' else v1_fname(m.b_fid) end,
                  'mine', v_fid in (m.a_fid, m.b_fid), 'incoming', m.b_fid = v_fid and m.status = 'pending', 'outgoing', m.a_fid = v_fid and m.status = 'pending',
                  'winner', case when m.winner_fid = 'arena_bot' then '«Жнец»' else v1_fname(m.winner_fid) end, 'won', m.winner_fid = v_fid, 'prize', m.prize,
                  'turn', (select turn_no from v1_battles where id = m.battle_id),
                  'bets', (select jsonb_build_object('a', coalesce(sum(amount) filter (where side = 'a'), 0), 'b', coalesce(sum(amount) filter (where side = 'b'), 0)) from v1_arena_bets where match_id = m.id),
                  'my_bet', (select jsonb_build_object('side', side, 'amount', amount, 'won', won) from v1_arena_bets where match_id = m.id and char_id = act.id),
                  'at', coalesce(m.ended_at, m.created_at)) order by m.created_at desc), '[]'::jsonb)
                from (select * from v1_arena_matches where status in ('pending', 'live') and (status = 'live' or v_fid in (a_fid, b_fid))
                      union all (select * from v1_arena_matches where status = 'done' order by ended_at desc limit 15)) m),
    'factions', (select coalesce(jsonb_agg(jsonb_build_object('id', fe.faction_id, 'name', v1_fname(fe.faction_id)) order by v1_fname(fe.faction_id)), '[]'::jsonb)
                 from faction_economy fe where fe.faction_id <> v_fid and exists (select 1 from colonies c where c.faction_id = fe.faction_id)));
end $$;

-- ════════ 9. Права ════════
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('_v1_cv', '_v1_uname', '_v1_in_faction', '_v1_user_faction', '_v1_martial', '_v1_char_move', '_v1_char_sync',
                                '_v1_my_char', '_v1_active_char', '_v1_char_name_problem', '_v1_char_die', '_v1_char_card', '_v1_char_label',
                                '_v1_bar_take', '_v1_bar_pay', '_v1_bj_finish', '_v1_arena_settle', 'v1_char_payday') loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
  for f in select p.oid::regprocedure sig from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('v1_char_create', 'v1_char_edit', 'v1_char_use', 'v1_char_join', 'v1_char_heir', 'v1_char_die',
                                'v1_char_send', 'v1_char_donate', 'v1_char_pay', 'v1_char_salary_set', 'v1_char_grant',
                                'v1_char_state', 'v1_char_ledger_read', 'v1_char_directory',
                                'v1_bar_roulette', 'v1_bar_wheel', 'v1_bar_tarot', 'v1_bar_dice', 'v1_bar_bj_start', 'v1_bar_bj_act', 'v1_bar_state',
                                'v1_arena_bet', 'v1_arena_fight_bot', 'v1_arena_state') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;

-- первая сверка: персонажи игроков, которые уже не в своей державе, уходят «без державы»
select public._v1_char_sync();
