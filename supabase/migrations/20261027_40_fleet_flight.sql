-- Классическая эра 1.0 · Полёт флотов и переброска армий (новый движок).
--
-- ФЛОТЫ
--   • У флота есть герб (картинка), цвет, девиз и стойка: «Стоянка» или «Оборона».
--   • Полёт — по гиперлиниям, кратчайшим по времени путём. Время плеча зависит от длины
--     трассы и самого медленного корабля. Запас хода — в плечах: у кораблей нового образца
--     он из проекта (не больше 30), у старых проектов — 8. Заправка — в своей системе с верфью
--     (сырьё со склада, недостающее — с рынка ×1,5).
--   • Закрытые границы (список держав у владельца системы) не пропускают, кроме войны.
--   • Перехват: флот противника в стойке «Оборона» останавливает пролёт через свою систему.
--   • Прибытие к врагу (война) — бой на карте системы со всеми флотами двух сторон в ней.
--     Нет врага — система противника оккупируется; своя или союзная — освобождается.
--   • Отозвать можно в пути: флот возвращается по пройденным плечам.
--   Флоты в новом полёте имеют статус 'v1_transit' — старый движок их не трогает.
-- АРМИИ
--   • Создаются на своей колонии из готовых наземных войск и авиации, с гербом и девизом.
--   • Без топлива; переброска — не дальше 2 систем по контролируемой части (свои системы
--     и оккупированные нами), в том числе в оккупированную систему врага.
--   • В системе врага армия высаживается на конкретную планету: если там стоят армии
--     защитника — наземный бой; иначе — зачистка по таймеру (столица — дольше).
--     Каждую планету, в том числе столицу, зачищают отдельно. Занятая колония — оккупация
--     (передача державе через несколько дней, пока на ней стоит армия).
-- Основная база: флоту — система (home_sys), армии — колония (home_colony).

set lock_timeout = '15s';

-- ════════ 1. Таблицы и настройки ════════
create table if not exists public.v1_fleet_meta (
  fleet_id  uuid primary key references public.fleets(id) on delete cascade,
  emblem    text,
  color     text,
  motto     text,
  stance    text not null default 'normal' check (stance in ('normal', 'defend')),
  fuel      numeric,
  fuel_cap  numeric,
  updated_at timestamptz not null default now()
);
create table if not exists public.v1_army_meta (
  army_id   uuid primary key references public.armies(id) on delete cascade,
  emblem    text,
  color     text,
  motto     text,
  sys       text,                 -- где стоит армия (система)
  dest_sys  text, dest_colony uuid,
  clear_colony uuid, clear_ready timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.v1_fleet_meta enable row level security;
alter table public.v1_army_meta enable row level security;
revoke all on public.v1_fleet_meta, public.v1_army_meta from anon, authenticated;

insert into public.v1_settings(key, value) values ('move', '{
  "leg_base": 0.5, "leg_k": 0.6, "leg_cap": 3.0,
  "legacy_jumps": 8, "max_jumps": 30,
  "army_leg_h": 1.5, "army_jumps": 2, "clear_h": 4, "clear_capital_h": 8,
  "market_k": 1.5,
  "refuel": {"S": {"Гелий-3": 1, "Метан": 1}, "M": {"Дейтерий": 2, "Углерод": 1},
             "L": {"Дейтерий": 3, "Углерод": 2}, "XL": {"Старвис": 2, "Изотопы": 1}}
}') on conflict (key) do nothing;

create or replace function public._v1_mv(p_key text, p_def numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select (value->>p_key)::numeric from v1_settings where key = 'move'), p_def)
$$;

-- ════════ 2. Карта: трассы, проходимость, пути ════════
create or replace function public.v1_lane_hours(p_a text, p_b text) returns numeric
language sql stable security definer set search_path = public as $$
  select round(least(public._v1_mv('leg_cap', 3), public._v1_mv('leg_base', 0.5) + public._v1_mv('leg_k', 0.6) *
           least(4, sqrt(power(b.x - a.x, 2) + power(b.y - a.y, 2)) / nullif((
             select avg(sqrt(power(y.x - x.x, 2) + power(y.y - x.y, 2))) from map_hyperlanes h
               join map_systems x on x.id = h.a_id join map_systems y on y.id = h.b_id), 0))), 2)
    from map_systems a, map_systems b where a.id = p_a and b.id = p_b
$$;

/** Можно ли войти в систему: флоту — с учётом закрытых границ; армии — только контролируемая часть. */
create or replace function public.v1_sys_open(p_fid text, p_sys text, p_mode text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare own text; occ text;
begin
  select faction into own from map_systems where id = p_sys;
  select occupier_fid into occ from system_occupation where system_id = p_sys;
  if p_mode = 'army' then
    return (own = p_fid and (occ is null or occ = p_fid)) or occ = p_fid;
  end if;
  if own is null or own = p_fid or v1_at_war(own, p_fid) then return true; end if;
  return not coalesce((select borders_closed_fids ? p_fid from faction_economy where faction_id = own), false);
end $$;

/**
 * Кратчайшие по времени пути из системы (Дейкстра по гиперлиниям).
 * p_to — только до этой системы; p_max — не больше стольких плеч.
 */
create or replace function public._v1_paths(p_from text, p_fid text, p_mode text, p_to text default null, p_max int default 99)
returns table(sys text, hours numeric, jumps int, path text[])
language plpgsql stable security definer set search_path = public as $$
declare ids text[]; n int; dist numeric[]; prev int[]; jmp int[]; done boolean[]; open boolean[];
  ea int[]; eb int[]; ew numeric[]; st int[]; s int; t int; i int; e int; best numeric; cand numeric; p text[]; k int;
begin
  select array_agg(id order by id) into ids from map_systems;
  n := array_length(ids, 1);
  s := array_position(ids, p_from); if s is null then return; end if;
  t := case when p_to is null then null else array_position(ids, p_to) end;
  -- все плечи разом: вес — часы (флот) или 1 (армия); рёбра упорядочены по исходной системе
  with av as (select coalesce(avg(sqrt(power(y.x - x.x, 2) + power(y.y - x.y, 2))), 1) v from map_hyperlanes h
                join map_systems x on x.id = h.a_id join map_systems y on y.id = h.b_id),
       ln as (select h.a_id a, h.b_id b from map_hyperlanes h union all select h.b_id, h.a_id from map_hyperlanes h)
  select array_agg(array_position(ids, ln.a) order by ln.a, ln.b), array_agg(array_position(ids, ln.b) order by ln.a, ln.b),
         array_agg(case when p_mode = 'army' then 1 else round(least(public._v1_mv('leg_cap', 3), public._v1_mv('leg_base', 0.5) + public._v1_mv('leg_k', 0.6) *
           least(4, sqrt(power(y.x - x.x, 2) + power(y.y - x.y, 2)) / nullif((select v from av), 0))), 2) end order by ln.a, ln.b)
    into ea, eb, ew
    from ln join map_systems x on x.id = ln.a join map_systems y on y.id = ln.b;
  -- начало рёбер каждой системы
  st := array_fill(0, array[n + 1]);
  for e in reverse coalesce(array_length(ea, 1), 0)..1 loop st[ea[e]] := e; end loop;
  dist := array_fill(1e9::numeric, array[n]); prev := array_fill(0, array[n]); jmp := array_fill(0, array[n]);
  done := array_fill(false, array[n]);
  select array_agg(v1_sys_open(p_fid, id, p_mode) order by id) into open from map_systems;
  dist[s] := 0;
  loop
    best := 1e9; k := null;
    for i in 1..n loop if not done[i] and dist[i] < best then best := dist[i]; k := i; end if; end loop;
    exit when k is null;
    done[k] := true;
    exit when t is not null and k = t;
    if jmp[k] >= p_max then continue; end if;
    if st[k] = 0 then continue; end if;
    e := st[k];
    while e <= array_length(ea, 1) and ea[e] = k loop
      if not done[eb[e]] and open[eb[e]] then
        cand := dist[k] + coalesce(ew[e], 2);
        if cand < dist[eb[e]] then dist[eb[e]] := cand; prev[eb[e]] := k; jmp[eb[e]] := jmp[k] + 1; end if;
      end if;
      e := e + 1;
    end loop;
  end loop;
  for i in 1..n loop
    if i = s or dist[i] >= 1e9 or (t is not null and i <> t) then continue; end if;
    p := array[ids[i]]; k := i;
    while prev[k] <> 0 loop k := prev[k]; p := ids[k] || p; end loop;
    sys := ids[i]; hours := round(dist[i], 2); jumps := jmp[i]; path := p;
    return next;
  end loop;
end $$;

-- ════════ 3. Флот: запас хода, скорость, занятость ════════
create or replace function public.v1_fleet_prof(p_fleet uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare legacy int; nv int; mj numeric; ms numeric; sz jsonb;
begin
  select coalesce(sum((e->>'qty')::int), 0) into legacy from fleets f, jsonb_array_elements(coalesce(f.composition, '[]'::jsonb)) e where f.id = p_fleet;
  select coalesce(sum(qty), 0), min(nullif((stats->>'jumps')::numeric, 0)), min(nullif((stats->>'speed')::numeric, 0)),
         coalesce(jsonb_object_agg(size, n) filter (where size is not null), '{}'::jsonb)
    into nv, mj, ms, sz
    from (select x.*, sum(qty) over (partition by size) n from v1_fleet_ships x where fleet_id = p_fleet) z;
  return jsonb_build_object('legacy', legacy, 'v1', nv, 'ships', legacy + nv, 'sizes', sz,
    'cap', case when legacy > 0 and nv > 0 then least(public._v1_mv('legacy_jumps', 8), coalesce(mj, 10))
                when nv > 0 then least(public._v1_mv('max_jumps', 30), greatest(1, coalesce(mj, 10)))
                else public._v1_mv('legacy_jumps', 8) end,
    'k', case when ms is null then 1 else greatest(0.6, least(1.8, 4.0 / ms)) end);
end $$;

/** Карточка флота: создаётся при первом обращении; запас хода не больше бака. */
create or replace function public._v1_fleet_meta(p_fleet uuid) returns v1_fleet_meta
language plpgsql security definer set search_path = public as $$
declare m v1_fleet_meta; cap numeric := (public.v1_fleet_prof(p_fleet)->>'cap')::numeric;
begin
  insert into v1_fleet_meta(fleet_id, fuel, fuel_cap) values (p_fleet, cap, cap) on conflict (fleet_id) do nothing;
  update v1_fleet_meta set fuel_cap = cap, fuel = least(coalesce(fuel, cap), cap) where fleet_id = p_fleet and fuel_cap is distinct from cap;
  select * into m from v1_fleet_meta where fleet_id = p_fleet;
  return m;
end $$;

create or replace function public._v1_fleet_busy(p_fleet uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select bu.battle_id from v1_battle_units bu join v1_battles b on b.id = bu.battle_id
      where bu.fleet_id = p_fleet and b.status = 'active' and bu.alive and not bu.left_field limit 1),
    (select bf.battle_id from battle_fleets bf join battles b on b.id = bf.battle_id where bf.fleet_id = p_fleet and b.status = 'active' limit 1))
$$;

create or replace function public._v1_fleet_mine(p_fleet uuid, p_perm text default 'fleet') returns fleets
language plpgsql security definer set search_path = public as $$
declare f fleets; v_fid text := v1_my_faction();
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  select * into f from fleets where id = p_fleet and faction_id = v_fid for update;
  if f.id is null then raise exception 'fleet_not_found'; end if;
  if not (v1_can_manage(v_fid, p_perm) or v1_can_manage(v_fid, 'produce')) then raise exception 'forbidden'; end if;
  return f;
end $$;

-- ════════ 4. Флот: игроку ════════
create or replace function public.v1_fleet_new(p_system text, p_name text, p_emblem text default null, p_color text default null, p_motto text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare fid uuid;
begin
  fid := public.v1_fleet_create(p_system, p_name);
  perform public._v1_fleet_meta(fid);
  update v1_fleet_meta set emblem = nullif(btrim(coalesce(p_emblem, '')), ''), color = nullif(btrim(coalesce(p_color, '')), ''),
         motto = left(nullif(btrim(coalesce(p_motto, '')), ''), 120) where fleet_id = fid;
  return fid;
end $$;

create or replace function public.v1_fleet_meta_save(p_fleet uuid, p_name text, p_emblem text, p_color text, p_motto text) returns boolean
language plpgsql security definer set search_path = public as $$
declare f fleets := public._v1_fleet_mine(p_fleet); nm text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if char_length(nm) < 2 or char_length(nm) > 48 then raise exception 'fleet_name'; end if;
  if coalesce(p_emblem, '') <> '' and p_emblem !~ '^https://' then raise exception 'bad_emblem'; end if;
  update fleets set name = nm where id = f.id;
  perform public._v1_fleet_meta(f.id);
  update v1_fleet_meta set emblem = nullif(btrim(coalesce(p_emblem, '')), ''), color = nullif(btrim(coalesce(p_color, '')), ''),
         motto = left(nullif(btrim(coalesce(p_motto, '')), ''), 120), updated_at = now() where fleet_id = f.id;
  return true;
end $$;

create or replace function public.v1_fleet_stance(p_fleet uuid, p_stance text) returns boolean
language plpgsql security definer set search_path = public as $$
declare f fleets := public._v1_fleet_mine(p_fleet);
begin
  if p_stance not in ('normal', 'defend') then raise exception 'bad_stance'; end if;
  perform public._v1_fleet_meta(f.id);
  update v1_fleet_meta set stance = p_stance, updated_at = now() where fleet_id = f.id;
  return true;
end $$;

create or replace function public.v1_fleet_base(p_fleet uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare f fleets := public._v1_fleet_mine(p_fleet);
begin
  if f.status <> 'idle' or f.system_id is null then raise exception 'fleet_not_idle'; end if;
  if (select faction from map_systems where id = f.system_id) is distinct from f.faction_id then raise exception 'base_own_only'; end if;
  update fleets set home_sys = f.system_id where id = f.id;
  return true;
end $$;

/** Куда может долететь флот с текущим запасом хода: система, время, плечи, путь. */
create or replace function public.v1_fleet_targets(p_fleet uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f fleets := public._v1_fleet_mine(p_fleet); m v1_fleet_meta; k numeric;
begin
  if f.status <> 'idle' or f.system_id is null then raise exception 'fleet_not_idle'; end if;
  m := public._v1_fleet_meta(f.id); k := (public.v1_fleet_prof(f.id)->>'k')::numeric;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', p.sys, 'name', s.name, 'hours', round(p.hours * k, 1), 'jumps', p.jumps,
            'owner', s.faction, 'owner_name', case when s.faction is null then null else v1_fname(s.faction) end,
            'war', s.faction is not null and v1_at_war(s.faction, f.faction_id),
            'path', (select jsonb_agg(ms.name order by o) from unnest(p.path) with ordinality u(x, o) join map_systems ms on ms.id = u.x))
          order by p.hours), '[]'::jsonb)
     from public._v1_paths(f.system_id, f.faction_id, 'fleet', null, floor(coalesce(m.fuel, 0))::int) p join map_systems s on s.id = p.sys
    where p.jumps <= floor(coalesce(m.fuel, 0)));
end $$;

create or replace function public.v1_fleet_send(p_fleet uuid, p_dest text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f fleets := public._v1_fleet_mine(p_fleet); m v1_fleet_meta; pr jsonb; r record; k numeric; t timestamptz := now(); sched jsonb; i int; h numeric;
begin
  if f.status <> 'idle' or f.system_id is null then raise exception 'fleet_not_idle'; end if;
  if coalesce(f.is_station, false) then raise exception 'station_fixed'; end if;
  if public._v1_fleet_busy(f.id) is not null then raise exception 'fleet_in_battle'; end if;
  if p_dest = f.system_id then raise exception 'fleet_already_there'; end if;
  pr := public.v1_fleet_prof(f.id);
  if (pr->>'ships')::int = 0 then raise exception 'fleet_empty'; end if;
  m := public._v1_fleet_meta(f.id); k := (pr->>'k')::numeric;
  select * into r from public._v1_paths(f.system_id, f.faction_id, 'fleet', p_dest);
  if r.sys is null then raise exception 'no_route'; end if;
  if r.jumps > coalesce(m.fuel, 0) then raise exception 'no_fuel: % %', r.jumps, floor(coalesce(m.fuel, 0)); end if;
  sched := jsonb_build_array(t);
  for i in 1..array_length(r.path, 1) - 1 loop
    h := coalesce(v1_lane_hours(r.path[i], r.path[i + 1]), 2) * k;
    t := t + make_interval(secs => h * 3600); sched := sched || to_jsonb(t);
  end loop;
  update fleets set status = 'v1_transit', from_sys = f.system_id, dest_sys = p_dest, system_id = null,
         depart_at = now(), arrive_at = t, route = to_jsonb(r.path), route_at = sched where id = f.id;
  update v1_fleet_meta set fuel = fuel - r.jumps, updated_at = now() where fleet_id = f.id;
  return jsonb_build_object('arrive_at', t, 'hours', round(extract(epoch from t - now()) / 3600, 1), 'jumps', r.jumps, 'fuel', m.fuel - r.jumps);
end $$;

/** Отозвать в пути: назад по пройденным плечам за то же время, непройденные плечи — в бак. */
create or replace function public.v1_fleet_recall(p_fleet uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f fleets := public._v1_fleet_mine(p_fleet); n int; i int; idx int := 0; back jsonb := '[]'; sched jsonb; t timestamptz := now(); el interval;
begin
  if f.status <> 'v1_transit' then raise exception 'fleet_not_moving'; end if;
  n := jsonb_array_length(f.route);
  for i in 0..n - 2 loop
    if (f.route_at->>i)::timestamptz <= now() then idx := i; end if;
  end loop;
  -- путь назад: от ближайшей следующей системы через пройденные к исходной
  for i in reverse idx + 1..0 loop back := back || (f.route->i); end loop;
  el := now() - (f.route_at->>idx)::timestamptz;
  sched := jsonb_build_array(t); t := t + el; sched := sched || to_jsonb(t);
  for i in reverse idx..1 loop
    t := t + ((f.route_at->>i)::timestamptz - (f.route_at->>(i - 1))::timestamptz); sched := sched || to_jsonb(t);
  end loop;
  update fleets set dest_sys = f.from_sys, from_sys = f.route->>(idx + 1), route = back, route_at = sched, depart_at = now(), arrive_at = t where id = f.id;
  update v1_fleet_meta set fuel = least(fuel_cap, fuel + greatest(0, (n - 1) - (idx + 1))), updated_at = now() where fleet_id = f.id;
  return jsonb_build_object('arrive_at', t);
end $$;

/** Заправка в своей системе с верфью: сырьё по размеру кораблей, недостающее — с рынка ×1,5. */
create or replace function public.v1_fleet_refuel(p_fleet uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f fleets := public._v1_fleet_mine(p_fleet); m v1_fleet_meta; pr jsonb; need numeric; cfg jsonb; bill jsonb := '{}'; sz text; cnt numeric;
  k text; v jsonb; stock jsonb; eco faction_economy; have numeric; take numeric; market numeric := 0; price numeric;
begin
  if f.status <> 'idle' or f.system_id is null then raise exception 'fleet_not_idle'; end if;
  if not exists (select 1 from v1_shipyards(f.faction_id) y where y.system_id = f.system_id) then
    raise exception 'refuel_needs_shipyard';
  end if;
  m := public._v1_fleet_meta(f.id); need := greatest(0, m.fuel_cap - m.fuel);
  if need <= 0 then return jsonb_build_object('fuel', m.fuel); end if;
  pr := public.v1_fleet_prof(f.id);
  cfg := (select value->'refuel' from v1_settings where key = 'move');
  for sz, cnt in select key, (value #>> '{}')::numeric from jsonb_each(coalesce(pr->'sizes', '{}'::jsonb)) union all select 'M', (pr->>'legacy')::numeric loop
    if cnt <= 0 then continue; end if;
    for k, v in select * from jsonb_each(coalesce(cfg->sz, cfg->'M')) loop
      bill := jsonb_set(bill, array[k], to_jsonb(coalesce((bill->>k)::numeric, 0) + (v #>> '{}')::numeric * cnt * need));
    end loop;
  end loop;
  select * into eco from faction_economy where faction_id = f.faction_id for update;
  stock := coalesce(eco.resources, '{}');
  for k, v in select * from jsonb_each(bill) loop
    have := greatest(0, coalesce((stock->>k)::numeric, 0)); take := least(have, (v #>> '{}')::numeric);
    stock := jsonb_set(stock, array[k], to_jsonb(have - take));
    if (v #>> '{}')::numeric > take then
      price := coalesce((select coalesce(mr.price, mr.base_price) from market_resources mr where mr.name = k), 10);
      market := market + ((v #>> '{}')::numeric - take) * price * public._v1_mv('market_k', 1.5);
    end if;
  end loop;
  market := round(market);
  if coalesce(eco.gc, 0) < market then raise exception 'prod_no_money: %', market; end if;
  update faction_economy set resources = stock, gc = gc - market where faction_id = f.faction_id;
  update v1_fleet_meta set fuel = fuel_cap, updated_at = now() where fleet_id = f.id;
  return jsonb_build_object('fuel', m.fuel_cap, 'bill', bill, 'market', market);
end $$;

-- ════════ 5. Прибытие, перехват, бой, оккупация ════════
create or replace function public._v1_fleet_has_ships(p_fleet uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from fleets f, jsonb_array_elements(coalesce(f.composition, '[]'::jsonb)) e where f.id = p_fleet and coalesce((e->>'qty')::int, 0) > 0)
      or exists (select 1 from v1_fleet_ships where fleet_id = p_fleet and qty > 0)
$$;

create or replace function public._v1_occupy_check(p_fid text, p_sys text, p_fleet uuid) returns void
language plpgsql security definer set search_path = public as $$
declare own text; occ system_occupation; sname text;
begin
  select faction, name into own, sname from map_systems where id = p_sys;
  if own is null then return; end if;
  select * into occ from system_occupation where system_id = p_sys;
  if occ.system_id is not null then
    if p_fid = own or (v1_at_war(p_fid, occ.occupier_fid) and not v1_at_war(p_fid, own)) then
      delete from system_occupation where system_id = p_sys;
      perform v1_bulletin('Система освобождена: ' || coalesce(sname, p_sys),
        format('Флот державы «%s» вошёл в систему %s — оккупация «%s» снята.', v1_fname(p_fid), coalesce(sname, p_sys), v1_fname(occ.occupier_fid)),
        jsonb_build_array(p_fid, own, occ.occupier_fid));
      return;
    end if;
  end if;
  if p_fid = own or not v1_at_war(p_fid, own) then return; end if;
  if occ.system_id is not null and occ.occupier_fid = p_fid then return; end if;
  insert into system_occupation(system_id, occupier_fid, owner_fid, fleet_id, since) values (p_sys, p_fid, own, p_fleet, now())
  on conflict (system_id) do update set occupier_fid = excluded.occupier_fid, owner_fid = excluded.owner_fid, fleet_id = excluded.fleet_id, since = now();
  perform v1_bulletin('Оккупация: ' || coalesce(sname, p_sys),
    format('Флот державы «%s» занял систему %s, принадлежащую «%s».', v1_fname(p_fid), coalesce(sname, p_sys), v1_fname(own)),
    jsonb_build_array(p_fid, own));
end $$;

/** После посадки: враг в системе — бой со всеми флотами двух сторон; иначе — оккупация/освобождение. */
create or replace function public._v1_fleet_after_land(p_fleet uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare f fleets; foes uuid[]; mine uuid[]; b uuid;
begin
  select * into f from fleets where id = p_fleet;
  if f.system_id is null or not public._v1_fleet_has_ships(f.id) then return null; end if;
  select coalesce(array_agg(x.id), '{}') into foes from fleets x
   where x.system_id = f.system_id and x.status = 'idle' and x.faction_id <> f.faction_id and v1_at_war(x.faction_id, f.faction_id)
     and public._v1_fleet_busy(x.id) is null and public._v1_fleet_has_ships(x.id);
  if array_length(foes, 1) > 0 then
    select coalesce(array_agg(x.id), '{}') into mine from fleets x
     where x.system_id = f.system_id and x.status = 'idle' and x.faction_id = f.faction_id
       and public._v1_fleet_busy(x.id) is null and public._v1_fleet_has_ships(x.id);
    begin
      b := public._v1_space_battle('war', f.system_id, mine, foes);
      perform v1_bulletin('Сражение в системе ' || coalesce((select name from map_systems where id = f.system_id), f.system_id),
        format('Флоты «%s» вступили в бой с «%s».', v1_fname(f.faction_id),
          (select string_agg(distinct v1_fname(faction_id), ', ') from fleets where id = any(foes))),
        (select jsonb_agg(distinct faction_id) from fleets where id = any(mine || foes)));
      return b;
    exception when others then
      raise warning 'бой не начат: %', sqlerrm;
    end;
  end if;
  perform public._v1_occupy_check(f.faction_id, f.system_id, f.id);
  return null;
end $$;

create or replace function public._v1_fleet_arrive(p_fleet uuid) returns void
language plpgsql security definer set search_path = public as $$
declare f fleets; p text[]; n int; i int; stop int; s text;
begin
  select * into f from fleets where id = p_fleet for update;
  if f.status <> 'v1_transit' then return; end if;
  p := array(select jsonb_array_elements_text(coalesce(f.route, jsonb_build_array(f.from_sys, f.dest_sys))));
  n := array_length(p, 1); stop := n;
  for i in 2..n loop
    s := p[i];
    if not v1_sys_open(f.faction_id, s, 'fleet') then stop := i - 1; exit; end if;
    -- перехват: флот врага в стойке «Оборона» не пропускает через свою систему
    if i < n and exists (select 1 from fleets x join v1_fleet_meta m on m.fleet_id = x.id and m.stance = 'defend'
                          where x.system_id = s and x.status = 'idle' and v1_at_war(x.faction_id, f.faction_id)
                            and public._v1_fleet_busy(x.id) is null and public._v1_fleet_has_ships(x.id)) then
      stop := i; exit;
    end if;
  end loop;
  update fleets set status = 'idle', system_id = p[stop], from_sys = null, dest_sys = null, depart_at = null, arrive_at = null,
         route = null, route_at = null where id = f.id;
  perform public._v1_fleet_meta(f.id);
  update v1_fleet_meta set fuel = least(fuel_cap, fuel + (n - stop)), updated_at = now() where fleet_id = f.id;
  perform public._v1_fleet_after_land(f.id);
end $$;

-- ════════ 6. Армии ════════
create or replace function public._v1_army_meta(p_army uuid) returns v1_army_meta
language plpgsql security definer set search_path = public as $$
declare m v1_army_meta;
begin
  insert into v1_army_meta(army_id, sys) select a.id, c.system_id from armies a left join colonies c on c.id = a.colony_id where a.id = p_army
  on conflict (army_id) do nothing;
  update v1_army_meta am set sys = c.system_id from armies a join colonies c on c.id = a.colony_id
   where am.army_id = p_army and a.id = p_army and am.sys is distinct from c.system_id;
  select * into m from v1_army_meta where army_id = p_army;
  return m;
end $$;

create or replace function public._v1_army_mine(p_army uuid) returns armies
language plpgsql security definer set search_path = public as $$
declare a armies; v_fid text := v1_my_faction();
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  select * into a from armies where id = p_army and faction_id = v_fid for update;
  if a.id is null then raise exception 'army_not_found'; end if;
  if not (v1_can_manage(v_fid, 'army') or v1_can_manage(v_fid, 'produce')) then raise exception 'forbidden'; end if;
  return a;
end $$;

/** Новая армия на своей колонии из готовых наземных войск и авиации державы. */
create or replace function public.v1_army_new(p_colony uuid, p_name text, p_units jsonb, p_emblem text default null, p_color text default null, p_motto text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction(); c colonies; nm text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  el jsonb; want int; have int; rem int; r record; take int; comp jsonb := '[]'; uname text; ucat text; aid uuid;
begin
  if v_fid is null or not (v1_can_manage(v_fid, 'army') or v1_can_manage(v_fid, 'produce')) then raise exception 'forbidden'; end if;
  select * into c from colonies where id = p_colony and faction_id = v_fid;
  if c.id is null then raise exception 'army_own_colony'; end if;
  if char_length(nm) < 2 or char_length(nm) > 48 then raise exception 'army_name'; end if;
  for el in select value from jsonb_array_elements(coalesce(p_units, '[]')) loop
    want := greatest(0, coalesce((el->>'qty')::int, 0));
    if want = 0 or nullif(el->>'unit_id', '') is null then continue; end if;
    select coalesce(sum(qty), 0), max(unit_name), max(category) into have, uname, ucat from unit_production
     where faction_id = v_fid and status = 'done' and category in ('ground', 'aviation') and unit_id = (el->>'unit_id')::uuid;
    if have < want then raise exception 'army_units: % % %', coalesce(uname, '?'), want, have; end if;
    rem := want;
    for r in select id, qty from unit_production where faction_id = v_fid and status = 'done' and category in ('ground', 'aviation')
               and unit_id = (el->>'unit_id')::uuid order by qty for update loop
      exit when rem = 0;
      take := least(rem, r.qty);
      if take = r.qty then delete from unit_production where id = r.id; else update unit_production set qty = qty - take where id = r.id; end if;
      rem := rem - take;
    end loop;
    comp := comp || jsonb_build_array(jsonb_build_object('unit_id', el->>'unit_id', 'unit_name', uname, 'qty', want, 'category', ucat));
  end loop;
  if jsonb_array_length(comp) = 0 then raise exception 'army_empty'; end if;
  insert into armies(faction_id, owner_id, name, status, colony_id, home_colony, composition)
  values (v_fid, auth.uid(), nm, 'idle', c.id, c.id, comp) returning id into aid;
  insert into v1_army_meta(army_id, emblem, color, motto, sys)
  values (aid, nullif(btrim(coalesce(p_emblem, '')), ''), nullif(btrim(coalesce(p_color, '')), ''), left(nullif(btrim(coalesce(p_motto, '')), ''), 120), c.system_id);
  return aid;
end $$;

create or replace function public.v1_army_meta_save(p_army uuid, p_name text, p_emblem text, p_color text, p_motto text) returns boolean
language plpgsql security definer set search_path = public as $$
declare a armies := public._v1_army_mine(p_army); nm text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if char_length(nm) < 2 or char_length(nm) > 48 then raise exception 'army_name'; end if;
  if coalesce(p_emblem, '') <> '' and p_emblem !~ '^https://' then raise exception 'bad_emblem'; end if;
  update armies set name = nm where id = a.id;
  perform public._v1_army_meta(a.id);
  update v1_army_meta set emblem = nullif(btrim(coalesce(p_emblem, '')), ''), color = nullif(btrim(coalesce(p_color, '')), ''),
         motto = left(nullif(btrim(coalesce(p_motto, '')), ''), 120), updated_at = now() where army_id = a.id;
  return true;
end $$;

create or replace function public.v1_army_base(p_army uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare a armies := public._v1_army_mine(p_army);
begin
  if a.status <> 'idle' or a.colony_id is null or (select faction_id from colonies where id = a.colony_id) <> a.faction_id then raise exception 'base_own_only'; end if;
  update armies set home_colony = a.colony_id where id = a.id;
  return true;
end $$;

/** Куда можно перебросить армию: не дальше 2 систем по контролируемой части. */
create or replace function public.v1_army_targets(p_army uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a armies := public._v1_army_mine(p_army); m v1_army_meta := public._v1_army_meta(p_army);
begin
  if a.status <> 'idle' or m.sys is null then raise exception 'army_not_idle'; end if;
  return (select coalesce(jsonb_agg(z order by (z->>'hours')::numeric), '[]'::jsonb) from (
    select jsonb_build_object('id', t.sys, 'name', s.name, 'jumps', t.jumps, 'hours', t.jumps * public._v1_mv('army_leg_h', 1.5),
      'occupied', s.faction is distinct from a.faction_id,
      'colonies', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.planet_name, 'own', c.faction_id = a.faction_id, 'capital', c.is_capital) order by c.planet_name), '[]'::jsonb)
                    from colonies c where c.system_id = t.sys)) z
      from (select sys, jumps from public._v1_paths(m.sys, a.faction_id, 'army', null, public._v1_mv('army_jumps', 2)::int)
            union all select m.sys, 0) t
      join map_systems s on s.id = t.sys
     where t.jumps <= public._v1_mv('army_jumps', 2)) q);
end $$;

create or replace function public.v1_army_move(p_army uuid, p_dest text, p_colony uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a armies := public._v1_army_mine(p_army); m v1_army_meta := public._v1_army_meta(p_army); r record; h numeric;
begin
  if a.status <> 'idle' or m.sys is null then raise exception 'army_not_idle'; end if;
  if exists (select 1 from v1_battle_units bu join v1_battles b on b.id = bu.battle_id where bu.army_id = a.id and b.status = 'active' and bu.alive) then
    raise exception 'army_in_battle';
  end if;
  if p_colony is not null and not exists (select 1 from colonies where id = p_colony and system_id = p_dest and faction_id = a.faction_id) then
    raise exception 'army_own_colony';
  end if;
  if p_dest = m.sys then
    update armies set colony_id = p_colony where id = a.id;
    return jsonb_build_object('instant', true);
  end if;
  if not v1_sys_open(a.faction_id, p_dest, 'army') then raise exception 'army_not_controlled'; end if;
  select * into r from public._v1_paths(m.sys, a.faction_id, 'army', p_dest, public._v1_mv('army_jumps', 2)::int);
  if r.sys is null or r.jumps > public._v1_mv('army_jumps', 2) then raise exception 'army_too_far'; end if;
  h := r.jumps * public._v1_mv('army_leg_h', 1.5);
  update armies set status = 'v1_transit', colony_id = null, depart_at = now(), arrive_at = now() + make_interval(secs => h * 3600) where id = a.id;
  update v1_army_meta set dest_sys = p_dest, dest_colony = p_colony, updated_at = now() where army_id = a.id;
  return jsonb_build_object('hours', h, 'arrive_at', now() + make_interval(secs => h * 3600));
end $$;

/** Высадка на планету врага в системе, где стоит армия: защитники есть — бой; нет — зачистка по таймеру. */
create or replace function public.v1_army_land(p_army uuid, p_colony uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a armies := public._v1_army_mine(p_army); m v1_army_meta := public._v1_army_meta(p_army); c colonies; defs uuid[]; b uuid; h numeric;
begin
  if a.status <> 'idle' then raise exception 'army_not_idle'; end if;
  if not exists (select 1 from jsonb_array_elements(a.composition) e where coalesce((e->>'qty')::int, 0) > 0) then raise exception 'army_empty'; end if;
  select * into c from colonies where id = p_colony;
  if c.id is null or c.system_id is distinct from m.sys then raise exception 'land_same_system'; end if;
  if c.faction_id = a.faction_id then raise exception 'land_own_colony'; end if;
  if not v1_at_war(a.faction_id, c.faction_id) then raise exception 'land_not_at_war'; end if;
  if not v1_sys_open(a.faction_id, c.system_id, 'army') then raise exception 'army_not_controlled'; end if;
  if exists (select 1 from colony_occupation where colony_id = c.id and occupier_fid = a.faction_id) then raise exception 'land_already_taken'; end if;
  if exists (select 1 from v1_battles where colony_id = c.id and status = 'active') then raise exception 'land_battle_on'; end if;
  select coalesce(array_agg(x.id), '{}') into defs from armies x
   where x.colony_id = c.id and x.status = 'idle' and x.faction_id = c.faction_id
     and exists (select 1 from jsonb_array_elements(x.composition) e where coalesce((e->>'qty')::int, 0) > 0);
  if array_length(defs, 1) > 0 then
    b := public._v1_ground_battle(c.id, array[a.id], defs);
    perform v1_bulletin('Высадка на ' || coalesce(c.planet_name, 'колонию'),
      format('Армия «%s» державы «%s» высадилась на колонию «%s» — защитники приняли бой.', a.name, v1_fname(a.faction_id), c.planet_name),
      jsonb_build_array(a.faction_id, c.faction_id));
    return jsonb_build_object('battle', b);
  end if;
  h := case when c.is_capital then public._v1_mv('clear_capital_h', 8) else public._v1_mv('clear_h', 4) end;
  update armies set status = 'v1_clearing', colony_id = null where id = a.id;
  update v1_army_meta set clear_colony = c.id, clear_ready = now() + make_interval(secs => h * 3600), updated_at = now() where army_id = a.id;
  perform v1_bulletin('Зачистка: ' || coalesce(c.planet_name, 'колония'),
    format('Армия «%s» державы «%s» высадилась на %s «%s» и зачищает её (~%s ч).', a.name, v1_fname(a.faction_id),
      case when c.is_capital then 'столицу' else 'колонию' end, c.planet_name, h),
    jsonb_build_array(a.faction_id, c.faction_id));
  return jsonb_build_object('clear_ready', now() + make_interval(secs => h * 3600), 'hours', h);
end $$;

create or replace function public.v1_army_cancel(p_army uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare a armies := public._v1_army_mine(p_army);
begin
  if a.status <> 'v1_clearing' then raise exception 'army_not_clearing'; end if;
  update armies set status = 'idle' where id = a.id;
  update v1_army_meta set clear_colony = null, clear_ready = null where army_id = a.id;
  return true;
end $$;

/** Распустить армию можно на своей колонии: войска возвращаются в резерв державы. */
create or replace function public.v1_army_disband(p_army uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare a armies := public._v1_army_mine(p_army); el jsonb;
begin
  if a.status <> 'idle' or a.colony_id is null or (select faction_id from colonies where id = a.colony_id) <> a.faction_id then raise exception 'army_disband_home'; end if;
  for el in select value from jsonb_array_elements(coalesce(a.composition, '[]')) loop
    if coalesce((el->>'qty')::int, 0) > 0 then
      insert into unit_production(faction_id, owner_id, unit_id, unit_name, category, qty, status, line, ready_at)
      values (a.faction_id, auth.uid(), (el->>'unit_id')::uuid, el->>'unit_name', coalesce(el->>'category', 'ground'), (el->>'qty')::int, 'done', 'army_return', now());
    end if;
  end loop;
  delete from armies where id = a.id;
  return true;
end $$;

/** Колония занята: оккупация (передача державе через несколько дней, пока на ней стоит армия). */
create or replace function public._v1_colony_taken(p_army uuid, p_colony uuid, p_battle uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare a armies; c colonies;
begin
  select * into a from armies where id = p_army;
  select * into c from colonies where id = p_colony;
  if a.id is null or c.id is null or c.faction_id = a.faction_id then return; end if;
  insert into colony_occupation(colony_id, occupier_fid, owner_fid, battle_id, since, transfer_at)
  values (c.id, a.faction_id, c.faction_id, p_battle, now(), now() + make_interval(days => public._v1_bset('transfer_days', 3)::int))
  on conflict (colony_id) do update set occupier_fid = excluded.occupier_fid, owner_fid = excluded.owner_fid, battle_id = excluded.battle_id,
    since = now(), transfer_at = excluded.transfer_at;
  update armies set status = 'idle', colony_id = c.id where id = a.id;
  update v1_army_meta set sys = c.system_id, clear_colony = null, clear_ready = null, updated_at = now() where army_id = a.id;
  perform v1_bulletin(case when c.is_capital then 'Столица пала: ' else 'Колония занята: ' end || coalesce(c.planet_name, ''),
    format('Армия «%s» державы «%s» зачистила %s «%s» державы «%s». Через %s дн. колония перейдёт к захватчику, если армия удержит её.',
      a.name, v1_fname(a.faction_id), case when c.is_capital then 'столицу' else 'колонию' end, c.planet_name, v1_fname(c.faction_id),
      public._v1_bset('transfer_days', 3)::int),
    jsonb_build_array(a.faction_id, c.faction_id));
end $$;

-- ════════ 7. Тик: прибытия, переброски, зачистки ════════
create or replace function public.v1_fleet_tick() returns jsonb
language plpgsql security definer set search_path = public as $$
declare f uuid; a record; n1 int := 0; n2 int := 0; n3 int := 0;
begin
  for f in select id from fleets where status = 'v1_transit' and arrive_at <= now() order by arrive_at limit 200 loop
    begin perform public._v1_fleet_arrive(f); n1 := n1 + 1;
    exception when others then raise warning 'прибытие флота %: %', f, sqlerrm; end;
  end loop;
  for a in select ar.id, am.dest_sys, am.dest_colony from armies ar join v1_army_meta am on am.army_id = ar.id
            where ar.status = 'v1_transit' and ar.arrive_at <= now() loop
    update armies set status = 'idle', colony_id = a.dest_colony, depart_at = null, arrive_at = null where id = a.id;
    update v1_army_meta set sys = a.dest_sys, dest_sys = null, dest_colony = null where army_id = a.id;
    n2 := n2 + 1;
  end loop;
  for a in select ar.id, ar.faction_id, am.clear_colony from armies ar join v1_army_meta am on am.army_id = ar.id
            where ar.status = 'v1_clearing' and am.clear_ready <= now() loop
    -- за это время подошли защитники — бой вместо тихой зачистки
    if exists (select 1 from armies x where x.colony_id = a.clear_colony and x.status = 'idle' and x.faction_id <> a.faction_id
                 and exists (select 1 from jsonb_array_elements(x.composition) e where coalesce((e->>'qty')::int, 0) > 0)) then
      update armies set status = 'idle' where id = a.id;
      update v1_army_meta set clear_colony = null, clear_ready = null where army_id = a.id;
      begin
        perform public._v1_ground_battle(a.clear_colony, array[a.id],
          (select array_agg(x.id) from armies x where x.colony_id = a.clear_colony and x.status = 'idle' and x.faction_id <> a.faction_id));
      exception when others then raise warning 'наземный бой не начат: %', sqlerrm; end;
    else
      perform public._v1_colony_taken(a.id, a.clear_colony, null);
    end if;
    n3 := n3 + 1;
  end loop;
  return jsonb_build_object('fleets', n1, 'armies', n2, 'cleared', n3);
end $$;

do $$ begin
  perform cron.unschedule('v1-fleet-tick') where exists (select 1 from cron.job where jobname = 'v1-fleet-tick');
  perform cron.schedule('v1-fleet-tick', '* * * * *', 'select public.v1_fleet_tick()');
end $$;

-- ════════ 8. Состояние раздела «Флот и войска» ════════
create or replace function public.v1_fleet_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction(); cfg jsonb := coalesce((select value from v1_settings where key = 'fleet'), '{}'::jsonb); f uuid; a uuid;
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  for f in select id from fleets where faction_id = v_fid loop perform public._v1_fleet_meta(f); end loop;
  for a in select id from armies where faction_id = v_fid loop perform public._v1_army_meta(a); end loop;
  return jsonb_build_object(
    'can_edit', v1_can_manage(v_fid, 'fleet') or v1_can_manage(v_fid, 'produce'),
    'can_army', v1_can_manage(v_fid, 'army') or v1_can_manage(v_fid, 'produce'),
    'settings', cfg, 'fid', v_fid,
    'gc', (select gc from faction_economy where faction_id = v_fid),
    'stock', (select coalesce(resources, '{}'::jsonb) from faction_economy where faction_id = v_fid),
    'prices', (select coalesce(jsonb_object_agg(name, price), '{}'::jsonb) from market_resources),
    'shipyards', (select coalesce(jsonb_agg(jsonb_build_object('system_id', y.system_id, 'name', y.system_name, 'slots', y.slots, 'colonies', y.colonies) order by y.slots desc), '[]'::jsonb)
      from v1_shipyards(v_fid) y),
    'capacity', (select coalesce(sum(slots), 0) from v1_shipyards(v_fid)),
    'designs', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'class', s.class,
        'class_name', s.stats->>'class_name', 'size', s.stats->>'size', 'ok', coalesce((s.stats->>'registrable')::boolean, false),
        'cost', s.stats->'cost', 'bill', s.stats->'bill', 'hp', s.stats->'hp', 'damage', s.stats->'damage', 'speed', s.stats->'speed',
        'shield', s.stats->'shield', 'jumps', s.stats->'jumps') order by s.created_at), '[]'::jsonb)
      from v1_ships s where s.faction_id = v_fid),
    'fleets', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', fl.id, 'name', fl.name, 'status', fl.status, 'system_id', fl.system_id, 'system', ms.name,
        'home_sys', fl.home_sys, 'home', hs.name, 'is_station', fl.is_station,
        'emblem', m.emblem, 'color', m.color, 'motto', m.motto, 'stance', m.stance, 'fuel', m.fuel, 'fuel_cap', m.fuel_cap,
        'flight', case when fl.status in ('v1_transit', 'transit') then jsonb_build_object(
            'from', (select name from map_systems where id = fl.from_sys), 'to', (select name from map_systems where id = fl.dest_sys),
            'depart_at', fl.depart_at, 'arrive_at', fl.arrive_at, 'old', fl.status = 'transit',
            'route', (select jsonb_agg(x.name order by o) from jsonb_array_elements_text(coalesce(fl.route, '[]')) with ordinality r(s, o) join map_systems x on x.id = r.s),
            'route_at', fl.route_at) end,
        'legacy', (select coalesce(jsonb_agg(jsonb_build_object('unit_id', e->>'unit_id', 'name', coalesce(e->>'unit_name', u.name), 'qty', (e->>'qty')::int,
                    'class', u.summary->>'className', 'hp', u.summary->'hp', 'damage', u.summary->'dmg', 'speed', u.summary->'speed')), '[]'::jsonb)
                   from jsonb_array_elements(fl.composition) e left join faction_units u on u.id::text = e->>'unit_id'),
        'ships', (select coalesce(jsonb_agg(jsonb_build_object('ship_id', x.ship_id, 'name', x.name, 'class', x.class, 'class_name', x.stats->>'class_name', 'size', x.size, 'qty', x.qty,
                    'hp', x.stats->'hp', 'damage', x.stats->'damage', 'speed', x.stats->'speed', 'jumps', x.stats->'jumps', 'shield', x.stats->'shield') order by x.created_at), '[]'::jsonb)
                   from v1_fleet_ships x where x.fleet_id = fl.id),
        'battle', public._v1_fleet_busy(fl.id),
        'in_battle', public._v1_fleet_busy(fl.id) is not null,
        'shipyard_here', fl.system_id in (select y.system_id from v1_shipyards(v_fid) y)
      ) order by fl.created_at), '[]'::jsonb)
      from fleets fl left join map_systems ms on ms.id = fl.system_id left join map_systems hs on hs.id = fl.home_sys
      left join v1_fleet_meta m on m.fleet_id = fl.id where fl.faction_id = v_fid),
    'queue', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'class', p.class, 'size', p.size, 'qty', p.qty,
        'system', ms.name, 'fleet', fl.name, 'cost', p.cost_gc + p.market_gc, 'started_at', p.started_at, 'ready_at', p.ready_at) order by p.ready_at), '[]'::jsonb)
      from v1_production p left join map_systems ms on ms.id = p.system_id left join fleets fl on fl.id = p.fleet_id
      where p.faction_id = v_fid and p.status = 'queued'),
    'done', (select coalesce(jsonb_agg(z), '[]'::jsonb) from (select jsonb_build_object('name', p.name, 'qty', p.qty, 'done_at', p.done_at) z
      from v1_production p where p.faction_id = v_fid and p.status = 'done' order by p.done_at desc limit 8) q),
    'armies', (select coalesce(jsonb_agg(jsonb_build_object('id', ar.id, 'name', ar.name, 'status', ar.status,
        'colony_id', ar.colony_id, 'colony', c.planet_name, 'colony_own', c.faction_id = v_fid,
        'sys', m.sys, 'system', ms.name, 'home', hc.planet_name, 'home_colony', ar.home_colony,
        'emblem', m.emblem, 'color', m.color, 'motto', m.motto,
        'dest', (select name from map_systems where id = m.dest_sys), 'arrive_at', ar.arrive_at,
        'clearing', case when ar.status = 'v1_clearing' then jsonb_build_object('colony', (select planet_name from colonies where id = m.clear_colony), 'ready', m.clear_ready) end,
        'battle', (select bu.battle_id from v1_battle_units bu join v1_battles b on b.id = bu.battle_id where bu.army_id = ar.id and b.status = 'active' limit 1),
        'enemy_here', (select coalesce(jsonb_agg(jsonb_build_object('id', ec.id, 'name', ec.planet_name, 'capital', ec.is_capital, 'owner', v1_fname(ec.faction_id),
                         'war', v1_at_war(ec.faction_id, v_fid), 'taken', exists (select 1 from colony_occupation o where o.colony_id = ec.id and o.occupier_fid = v_fid),
                         'defended', exists (select 1 from armies x where x.colony_id = ec.id and x.status = 'idle' and x.faction_id = ec.faction_id))), '[]'::jsonb)
                       from colonies ec where ec.system_id = m.sys and ec.faction_id <> v_fid),
        'units', (select coalesce(jsonb_agg(jsonb_build_object('unit_id', e->>'unit_id', 'name', e->>'unit_name', 'qty', (e->>'qty')::int, 'category', e->>'category')), '[]'::jsonb)
                  from jsonb_array_elements(coalesce(ar.composition, '[]'::jsonb)) e)) order by ar.created_at), '[]'::jsonb)
      from armies ar left join v1_army_meta m on m.army_id = ar.id left join colonies c on c.id = ar.colony_id
      left join map_systems ms on ms.id = m.sys left join colonies hc on hc.id = ar.home_colony where ar.faction_id = v_fid),
    'pool', (select coalesce(jsonb_agg(jsonb_build_object('unit_id', unit_id, 'name', nm, 'category', cat, 'qty', q) order by nm), '[]'::jsonb)
      from (select unit_id, max(unit_name) nm, max(category) cat, sum(qty) q from unit_production
             where faction_id = v_fid and status = 'done' and category in ('ground', 'aviation') group by unit_id) z where q > 0),
    'colonies', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.planet_name, 'system_id', c.system_id, 'system', ms.name, 'capital', c.is_capital)
                   order by c.is_capital desc, ms.name, c.planet_name), '[]'::jsonb)
      from colonies c left join map_systems ms on ms.id = c.system_id where c.faction_id = v_fid),
    'battles', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'kind', b.kind, 'system', (select name from map_systems where id = b.system_id),
                  'turn', b.turn_no, 'my_turn', b.side_to_move = s.side, 'colony', (select planet_name from colonies where id = b.colony_id)) order by b.created_at desc), '[]'::jsonb)
      from v1_battles b join v1_battle_sides s on s.battle_id = b.id and s.faction_id = v_fid where b.status = 'active'));
end $$;

-- ════════ 9. Права ════════
grant execute on function public.v1_fleet_state(), public.v1_fleet_new(text, text, text, text, text), public.v1_fleet_meta_save(uuid, text, text, text, text),
  public.v1_fleet_stance(uuid, text), public.v1_fleet_base(uuid), public.v1_fleet_targets(uuid), public.v1_fleet_send(uuid, text),
  public.v1_fleet_recall(uuid), public.v1_fleet_refuel(uuid),
  public.v1_army_new(uuid, text, jsonb, text, text, text), public.v1_army_meta_save(uuid, text, text, text, text), public.v1_army_base(uuid),
  public.v1_army_targets(uuid), public.v1_army_move(uuid, text, uuid), public.v1_army_land(uuid, uuid), public.v1_army_cancel(uuid),
  public.v1_army_disband(uuid), public.v1_lane_hours(text, text) to authenticated;
