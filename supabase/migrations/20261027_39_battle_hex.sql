-- Классическая эра 1.0 · Бой на новых картах (шестигранники, туман войны).
--
-- Бой теперь идёт на карте из генераторов (миграции 34 и 37): космос — v1_bmap_gen,
-- земля — v1_gmap_gen. Сервер считает обзор сам и отдаёт игроку только то, что видит
-- его сторона: необнаруженных отрядов противника в ответе нет вовсе.
--
-- Правила (первая версия, будут уточняться вместе с модулями):
--   • ход — отряд один раз двигается и один раз стреляет (или делает импульс радара);
--   • движение — по клеткам с учётом цены местности (см. v1_hex_cost), не сквозь врага;
--   • огонь — цель в дальности и в обзоре стороны; прямой огонь закрывают глыбы и планета
--     (космос) или горы (земля); артиллерия бьёт навесом; укрытия снижают урон;
--   • выстрел выдаёт стрелка: до конца следующего хода его видит противник;
--   • импульс радара: обзор отряда ×2 на этот ход, сам отряд виден противнику; раз в 3 хода;
--   • «последний контакт»: сторона помнит, где видела отряд противника в последний раз.
-- Космос: в астероидах — только корветы (S) и авиация; глыбы и планета непроходимы.
-- Земля: пехота проходит горы; техника — нет; авиация летает везде; ПВО бьёт авиацию вдвое.

set lock_timeout = '15s';

-- ════════ 1. Таблицы ════════
alter table public.v1_battles add column if not exists colony_id uuid;
alter table public.v1_battles drop constraint if exists v1_battles_kind_check;
alter table public.v1_battles add constraint v1_battles_kind_check check (kind in ('war', 'intercept', 'arena', 'test', 'ground'));

alter table public.v1_battle_units add column if not exists utype text not null default 'ship';  -- ship | inf | tank | art | aa | air
alter table public.v1_battle_units add column if not exists size text not null default 'M';
alter table public.v1_battle_units add column if not exists radar int not null default 4;
alter table public.v1_battle_units add column if not exists v1_ship uuid;                           -- строка v1_fleet_ships
alter table public.v1_battle_units add column if not exists army_id uuid;
alter table public.v1_battle_units add column if not exists revealed_turn int not null default -1;  -- виден противнику до конца этого хода
alter table public.v1_battle_units add column if not exists pulse_turn int not null default -99;    -- ход последнего импульса

create table if not exists public.v1_battle_seen (
  battle_id uuid not null references public.v1_battles(id) on delete cascade,
  side      text not null,
  unit_id   uuid not null,
  x int not null, y int not null, turn_no int not null,
  primary key (battle_id, side, unit_id)
);
alter table public.v1_battle_seen enable row level security;
revoke all on public.v1_battle_seen from anon, authenticated;

insert into public.v1_settings(key, value) values ('battles', '{}'::jsonb) on conflict (key) do nothing;
update public.v1_settings set value = value || jsonb_build_object(
  'turn_minutes', coalesce((value->>'turn_minutes')::int, 10), 'retreat_turns', coalesce((value->>'retreat_turns')::int, 3),
  'retreat_minutes', coalesce((value->>'retreat_minutes')::int, 30), 'pulse_every', 3, 'shield_regen', 0.25,
  'transfer_days', 3) where key = 'battles';

-- ════════ 2. Геометрия ════════
create or replace function public.v1_hex_dist(x1 int, y1 int, x2 int, y2 int) returns int
language sql immutable parallel safe as $$
  select greatest(abs(q2 - q1), abs(r2 - r1), abs((q2 + r2) - (q1 + r1)))::int
    from (select x1 q1, y1 - (x1 - (x1 & 1)) / 2 r1, x2 q2, y2 - (x2 - (x2 & 1)) / 2 r2) z
$$;

create or replace function public.v1_map_cell(m jsonb, x int, y int) returns text
language sql immutable parallel safe as $$
  select case when x < 0 or y < 0 or x >= (m->>'w')::int or y >= (m->>'h')::int then null
              else substr(m->>'grid', y * (m->>'w')::int + x + 1, 1) end
$$;

-- Прямая между центрами свободна от клеток-преград (концы не считаются).
create or replace function public.v1_hex_los(m jsonb, x1 int, y1 int, x2 int, y2 int, blockers text) returns boolean
language plpgsql immutable as $$
declare n int := public.v1_hex_dist(x1, y1, x2, y2); i int; t numeric;
  q1 numeric := x1; r1 numeric := y1 - (x1 - (x1 & 1)) / 2; q2 numeric := x2; r2 numeric := y2 - (x2 - (x2 & 1)) / 2;
  q numeric; r numeric; s numeric; rq int; rr int; rs int; cx int; cy int;
begin
  if n < 2 then return true; end if;
  for i in 1..n - 1 loop
    t := i::numeric / n;
    q := q1 + (q2 - q1) * t + 0.000001; r := r1 + (r2 - r1) * t + 0.000001; s := -q - r;
    rq := round(q); rr := round(r); rs := round(s);
    if abs(rq - q) > abs(rr - r) and abs(rq - q) > abs(rs - s) then rq := -rr - rs;
    elsif abs(rr - r) > abs(rs - s) then rr := -rq - rs; end if;
    cx := rq; cy := rr + (rq - (rq & 1)) / 2;
    if position(coalesce(public.v1_map_cell(m, cx, cy), ' ') in blockers) > 0 then return false; end if;
  end loop;
  return true;
end $$;

/** Цена шага в клетку (null — нельзя). Космос и земля, по типу и размеру отряда. */
create or replace function public.v1_hex_cost(p_kind text, p_utype text, p_size text, c text) returns numeric
language sql immutable as $$
  select case
    when c is null then null
    when p_kind <> 'ground' then case
      when c in ('R', 'P') then null
      when c = 'a' then case when p_size = 'S' or p_utype = 'air' then 1 else null end
      when c = 'g' then 2
      when c = 'd' then case when p_size in ('L', 'XL') then 2 else 1 end
      else 1 end
    when p_utype = 'air' then 1
    when p_utype = 'inf' then case when c in ('W', 'L', 'X') then null when c in ('M', 'w') then 2 else 1 end
    else case when c in ('M', 'W', 'L', 'X', 'S', 'C') then null when c = 'r' then 0.5 when c in ('F', 'R', 'h', 'w') then 2 else 1 end
  end
$$;

-- ════════ 3. Обзор ════════
/** Видит ли сторона клетку (x, y) с отрядом типа p_ttype. Правила — как в src/lib/hexmap.js. */
create or replace function public._v1_side_sees(p_battle uuid, p_side text, p_x int, p_y int, p_ttype text default 'ship') returns boolean
language plpgsql stable security definer set search_path = public as $$
declare b record; m jsonb; u record; r numeric; d int; tc text; oc text; ground boolean;
begin
  select * into b from v1_battles where id = p_battle;
  m := b.map; if m is null then return true; end if;
  ground := b.kind = 'ground';
  tc := v1_map_cell(m, p_x, p_y);
  for u in select * from v1_battle_units where battle_id = p_battle and side = p_side and alive and not left_field loop
    d := v1_hex_dist(u.x, u.y, p_x, p_y);
    oc := v1_map_cell(m, u.x, u.y);
    if not ground then
      r := u.radar * coalesce((m->>'radar')::numeric, 1) * case when u.pulse_turn = b.turn_no then 2 else 1 end;
      if oc = 'i' then r := r * 0.5; end if;
      if tc = 'a' then r := r * 0.7; end if;
      if (case when tc = 'n' then d <= 2 else d <= r end) and (d <= 1 or v1_hex_los(m, u.x, u.y, p_x, p_y, 'P')) then return true; end if;
    else
      r := (u.radar + case when u.utype = 'air' then 1 when oc = 'M' then 2 when oc = 'h' then 1 else 0 end)
           * case when u.pulse_turn = b.turn_no then 2 else 1 end;
      if tc in ('F', 'S') and p_ttype <> 'air' then r := least(r, 2); end if;
      if d <= r and (d <= 1 or u.utype = 'air' or p_ttype = 'air' or oc = 'M' or v1_hex_los(m, u.x, u.y, p_x, p_y, 'M')) then return true; end if;
    end if;
  end loop;
  return false;
end $$;

-- ════════ 4. Отряды ════════
create or replace function public._v1_ship_size(p_class text) returns text
language sql immutable as $$
  select case when p_class ~* 'корвет|фрегат|истреб|corvette|frigate' then 'S'
              when p_class ~* 'линкор|дредноут|колосс|станц|battleship|dread' then 'XL'
              when p_class ~* 'крейсер|носител|cruiser|carrier' then 'L' else 'M' end
$$;

create or replace function public._v1_ground_type(p_cat text, p_class text, p_type text) returns text
language sql immutable as $$
  select case when p_cat = 'aviation' then 'air'
              when coalesce(p_class, '') || ' ' || coalesce(p_type, '') ~* 'пво|зенит' then 'aa'
              when coalesce(p_class, '') || ' ' || coalesce(p_type, '') ~* 'арт|сау|рсзо|миномёт|миномет|гаубиц' then 'art'
              when coalesce(p_class, '') || ' ' || coalesce(p_type, '') ~* 'пехот|штурм|десант|морпех|солдат|отряд|гвард' then 'inf'
              else 'tank' end
$$;

/** Поставить отряд на поле: свободная проходимая клетка в полосе x0..x1, ближе к строке yc. */
create or replace function public._v1_place(p_battle uuid, p_x0 int, p_x1 int, p_yc int, p_utype text, p_size text) returns int[]
language plpgsql security definer set search_path = public as $$
declare b record; cx int; cy int; dy int; step int;
begin
  select * into b from v1_battles where id = p_battle;
  for dy in 0..b.board_h loop
    foreach step in array array[1, -1] loop
      cy := p_yc + dy * step;
      if cy < 0 or cy >= b.board_h then continue; end if;
      for cx in select g from generate_series(least(p_x0, p_x1), greatest(p_x0, p_x1)) g order by abs(g - (p_x0 + p_x1) / 2.0) loop
        if v1_hex_cost(b.kind, p_utype, p_size, v1_map_cell(b.map, cx, cy)) is null then continue; end if;
        if exists (select 1 from v1_battle_units bu where bu.battle_id = p_battle and bu.alive and bu.x = cx and bu.y = cy) then continue; end if;
        return array[cx, cy];
      end loop;
    end loop;
  end loop;
  return array[p_x0, greatest(0, least(b.board_h - 1, p_yc))];
end $$;

create or replace function public._v1_add_unit(p_battle uuid, p_side text, p_fid text, p_name text, p_class text, p_qty int, p_stats jsonb,
  p_utype text, p_size text, p_radar int, p_fleet uuid, p_comp int, p_v1ship uuid, p_army uuid, p_x0 int, p_x1 int, p_yc int) returns void
language plpgsql security definer set search_path = public as $$
declare hp numeric := greatest(1, coalesce((p_stats->>'hp')::numeric, 100)); sh numeric := greatest(0, coalesce((p_stats->>'shield')::numeric, 0)) * greatest(1, p_qty);
  pos int[];
begin
  if coalesce(p_qty, 0) <= 0 then return; end if;
  pos := public._v1_place(p_battle, p_x0, p_x1, p_yc, p_utype, p_size);
  insert into v1_battle_units(battle_id, side, faction_id, fleet_id, design_id, comp_index, name, class, qty, qty_start, hp, hp_ship, shield, shield_max,
                              stats, x, y, utype, size, radar, v1_ship, army_id)
  values (p_battle, p_side, p_fid, p_fleet, null, p_comp, coalesce(p_name, 'Отряд'), coalesce(p_class, ''), p_qty, p_qty, hp * p_qty, hp, sh, sh,
          p_stats, pos[1], pos[2], p_utype, p_size, greatest(1, p_radar), p_v1ship, p_army);
end $$;

/** Отряды флота: старые проекты (состав) и корабли нового образца. Характеристики — к шкале новых карт. */
create or replace function public._v1_fleet_units(p_battle uuid, p_side text, p_fleet uuid, p_x0 int, p_x1 int, p_yc int) returns int
language plpgsql security definer set search_path = public as $$
declare fl fleets; el jsonb; i int := 0; s jsonb; n int := 0; x record; cls text;
begin
  select * into fl from fleets where id = p_fleet;
  for el in select value from jsonb_array_elements(coalesce(fl.composition, '[]'::jsonb)) loop
    if coalesce((el->>'qty')::int, 0) > 0 and nullif(el->>'unit_id', '') is not null then
      select summary, coalesce(summary->>'className', '') into s, cls from faction_units where id = (el->>'unit_id')::uuid;
      s := coalesce(s, '{}'::jsonb);
      perform public._v1_add_unit(p_battle, p_side, fl.faction_id, coalesce(el->>'unit_name', 'Отряд'), cls, (el->>'qty')::int,
        jsonb_build_object('hp', coalesce((s->>'hp')::numeric, 100), 'shield', coalesce((s->>'shield')::numeric, 0), 'armor', coalesce((s->>'armor')::numeric, 0),
          'dmg', coalesce((s->>'dmg')::numeric, 0), 'rng', greatest(1, least(8, round(coalesce((s->>'rng')::numeric, 5) * 0.4))),
          'speed', greatest(1, least(6, round(coalesce((s->>'speed')::numeric, 4) * 0.5)))),
        'ship', public._v1_ship_size(cls), greatest(2, least(7, round(coalesce((s->>'radar')::numeric, 8) * 0.45)))::int,
        fl.id, i, null, null, p_x0, p_x1, p_yc + n);
      n := n + 1;
    end if;
    i := i + 1;
  end loop;
  for x in select * from v1_fleet_ships where fleet_id = p_fleet and qty > 0 loop
    perform public._v1_add_unit(p_battle, p_side, fl.faction_id, x.name, coalesce(x.stats->>'class_name', x.class), x.qty,
      jsonb_build_object('hp', coalesce((x.stats->>'hp')::numeric, 100), 'shield', coalesce((x.stats->>'shield')::numeric, 0), 'armor', 0,
        'dmg', coalesce((x.stats->>'damage')::numeric, 0), 'rng', greatest(1, least(8, round(coalesce((x.stats->>'dalnost')::numeric, 5)))),
        'speed', greatest(1, least(6, round(coalesce((x.stats->>'speed')::numeric, 3))))),
      'ship', coalesce(x.size, 'M'), greatest(2, least(8, round(coalesce((x.stats->>'radar')::numeric, 4))))::int,
      fl.id, null, x.id, null, p_x0, p_x1, p_yc + n);
    n := n + 1;
  end loop;
  return n;
end $$;

/** Отряды армии: наземная техника, пехота и авиация из состава армии. */
create or replace function public._v1_army_units(p_battle uuid, p_side text, p_army uuid, p_x0 int, p_x1 int, p_yc int) returns int
language plpgsql security definer set search_path = public as $$
declare a armies; el jsonb; i int := 0; s jsonb; n int := 0; cls text; ty text; ut text;
begin
  select * into a from armies where id = p_army;
  for el in select value from jsonb_array_elements(coalesce(a.composition, '[]'::jsonb)) loop
    if coalesce((el->>'qty')::int, 0) > 0 and nullif(el->>'unit_id', '') is not null then
      select summary, coalesce(summary->>'className', ''), coalesce(summary->>'typeName', '') into s, cls, ty from faction_units where id = (el->>'unit_id')::uuid;
      s := coalesce(s, '{}'::jsonb);
      ut := public._v1_ground_type(coalesce(el->>'category', 'ground'), coalesce(nullif(cls, ''), el->>'unit_name'), ty);
      perform public._v1_add_unit(p_battle, p_side, a.faction_id, coalesce(el->>'unit_name', 'Отряд'), coalesce(nullif(cls, ''), ty), (el->>'qty')::int,
        jsonb_build_object('hp', coalesce((s->>'hp')::numeric, 100), 'shield', coalesce((s->>'shield')::numeric, 0), 'armor', coalesce((s->>'armor')::numeric, 0),
          'dmg', coalesce((s->>'dmg')::numeric, 0),
          'rng', greatest(1, least(8, round(coalesce((s->>'rng')::numeric, 4) * case when ut = 'art' then 0.5 else 0.35 end))),
          'speed', case when ut = 'air' then 5 else greatest(1, least(5, round(coalesce((s->>'speed')::numeric, 3) * 0.6))) end),
        ut, 'M', case ut when 'air' then 4 when 'art' then 2 else 3 end,
        null, i, null, a.id, p_x0, p_x1, p_yc + n);
      n := n + 1;
    end if;
    i := i + 1;
  end loop;
  return n;
end $$;

-- ════════ 5. Создание боёв ════════
/** Космический бой: флоты стороны A (атакующие) против флотов стороны B, на карте системы. */
create or replace function public._v1_space_battle(p_kind text, p_system text, p_a uuid[], p_b uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare m jsonb; b uuid; w int; h int; f uuid; n int; fid text; side text; ids uuid[]; total int;
begin
  m := v1_bmap_gen(p_system, floor(random() * 2147483647)::bigint, null, 'm');
  w := (m->>'w')::int; h := (m->>'h')::int;
  insert into v1_battles(kind, system_id, board_w, board_h, turn_deadline, map)
  values (p_kind, p_system, w, h, now() + make_interval(mins => public._v1_bset('turn_minutes', 10)::int), m) returning id into b;
  foreach side in array array['a', 'b'] loop
    ids := case when side = 'a' then p_a else p_b end; total := 0;
    for fid in select distinct faction_id from fleets where id = any(ids) loop
      insert into v1_battle_sides(battle_id, side, faction_id, role) values (b, side, fid, case when side = 'a' then 'attacker' else 'defender' end)
      on conflict do nothing;
    end loop;
    foreach f in array ids loop
      n := public._v1_fleet_units(b, side, f, case when side = 'a' then 0 else w - 3 end, case when side = 'a' then 2 else w - 1 end, h / 2 - 2 + total);
      total := total + n;
    end loop;
    if total = 0 then raise exception 'empty_fleet'; end if;
  end loop;
  perform public._v1_blog(b, null, 'Бой начался в системе ' || coalesce((select name from map_systems where id = p_system), p_system) || '.');
  return b;
end $$;

/** Наземный бой за колонию: армии атакующего высаживаются слева, защитники стоят у колонии справа. */
create or replace function public._v1_ground_battle(p_colony uuid, p_a uuid[], p_b uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare c colonies; m jsonb; b uuid; w int; h int; a uuid; n int; fid text; tot int := 0; cx int; cy int;
begin
  select * into c from colonies where id = p_colony;
  m := v1_gmap_gen(c.system_id, c.planet_pid, floor(random() * 2147483647)::bigint, 'm');
  w := (m->>'w')::int; h := (m->>'h')::int; cx := (m->'colony'->>0)::int; cy := (m->'colony'->>1)::int;
  insert into v1_battles(kind, system_id, board_w, board_h, turn_deadline, map, colony_id)
  values ('ground', c.system_id, w, h, now() + make_interval(mins => public._v1_bset('turn_minutes', 10)::int), m, p_colony) returning id into b;
  for fid in select distinct faction_id from armies where id = any(p_a) loop
    insert into v1_battle_sides(battle_id, side, faction_id, role) values (b, 'a', fid, 'attacker') on conflict do nothing;
  end loop;
  insert into v1_battle_sides(battle_id, side, faction_id, role) values (b, 'b', c.faction_id, 'defender') on conflict do nothing;
  foreach a in array p_a loop
    n := public._v1_army_units(b, 'a', a, 0, 5, h / 2 - 3 + tot); tot := tot + n;
  end loop;
  if tot = 0 then raise exception 'empty_army'; end if;
  tot := 0;
  foreach a in array coalesce(p_b, '{}') loop
    n := public._v1_army_units(b, 'b', a, greatest(0, cx - 3), least(w - 1, cx + 2), cy - 1 + tot); tot := tot + n;
  end loop;
  perform public._v1_blog(b, null, 'Высадка на колонию ' || coalesce('«' || c.planet_name || '»', '') || ': бой начался.');
  return b;
end $$;

-- Тестовый бой команды проекта — тоже на новой карте.
create or replace function public.v1_battle_create(p_kind text, p_system text, p_fleets_a uuid[], p_fleets_b uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare b uuid;
begin
  if not public.v1_is_staff() then raise exception 'not_staff'; end if;
  if coalesce(array_length(p_fleets_a, 1), 0) = 0 or coalesce(array_length(p_fleets_b, 1), 0) = 0 then raise exception 'need_two_sides'; end if;
  b := public._v1_space_battle(coalesce(p_kind, 'test'), p_system, p_fleets_a, p_fleets_b);
  update v1_battles set created_by = auth.uid() where id = b;
  return b;
end $$;

-- ════════ 6. Что видит игрок ════════
create or replace function public.v1_battle_state(p_battle uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare me text; staff boolean := public.v1_is_staff(); b record; seen uuid[] := '{}'; vu record; v_full boolean;
begin
  select * into b from v1_battles where id = p_battle;
  if b.id is null then raise exception 'battle_not_found'; end if;
  me := public._v1_my_side(p_battle);
  if me is null and not staff then raise exception 'not_in_battle'; end if;
  v_full := me is null and staff;   -- команда проекта, не участвуя, видит всё
  if me is not null then
    for vu in select * from v1_battle_units where battle_id = p_battle and side <> me and alive and not left_field loop
      if vu.revealed_turn >= b.turn_no or public._v1_side_sees(p_battle, me, vu.x, vu.y, vu.utype) then
        seen := seen || vu.id;
        insert into v1_battle_seen(battle_id, side, unit_id, x, y, turn_no) values (p_battle, me, vu.id, vu.x, vu.y, b.turn_no)
        on conflict (battle_id, side, unit_id) do update set x = excluded.x, y = excluded.y, turn_no = excluded.turn_no;
      end if;
    end loop;
  end if;
  return jsonb_build_object(
    'battle', to_jsonb(b) - 'created_by', 'me', me, 'staff', staff,
    'system', (select name from map_systems where id = b.system_id),
    'colony', (select planet_name from colonies where id = b.colony_id),
    'sides', (select jsonb_agg(jsonb_build_object('side', s.side, 'faction_id', s.faction_id, 'role', s.role, 'status', s.status,
                'retreat_at_turn', s.retreat_at_turn, 'name', v1_fname(s.faction_id))) from v1_battle_sides s where s.battle_id = p_battle),
    'units', (select coalesce(jsonb_agg(
                case when v_full or u.side = me then to_jsonb(u) - 'battle_id'
                else jsonb_build_object('id', u.id, 'side', u.side, 'name', u.name, 'class', u.class, 'utype', u.utype, 'size', u.size,
                       'x', u.x, 'y', u.y, 'alive', u.alive, 'left_field', u.left_field, 'qty', u.qty, 'revealed', u.revealed_turn >= b.turn_no,
                       'wear', round((1 - u.hp / nullif(u.hp_ship * u.qty_start, 0)) * 10) * 10, 'shielded', u.shield > 0)
                end order by u.side, u.y, u.x), '[]'::jsonb)
              from v1_battle_units u where u.battle_id = p_battle and (v_full or u.side = me or u.id = any(seen) or not u.alive)),
    'contacts', (select coalesce(jsonb_agg(jsonb_build_object('unit', s.unit_id, 'x', s.x, 'y', s.y, 'turn', s.turn_no,
                   'name', (select name from v1_battle_units where id = s.unit_id))), '[]'::jsonb)
                 from v1_battle_seen s where s.battle_id = p_battle and s.side = me and not (s.unit_id = any(seen))
                   and exists (select 1 from v1_battle_units x where x.id = s.unit_id and x.alive and not x.left_field)),
    'pulse_every', public._v1_bset('pulse_every', 3),
    'log', (select coalesce(jsonb_agg(l order by l.id), '[]'::jsonb) from (
              select id, turn_no, side, text, at from v1_battle_log where battle_id = p_battle order by id desc limit 40) l));
end $$;

-- ════════ 7. Действия отряда ════════
/** Дойдёт ли отряд до клетки за свой ход (цена местности, без прохода сквозь врага). */
create or replace function public._v1_can_reach(p_battle uuid, p_unit uuid, p_tx int, p_ty int) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare b record; u record; w int; h int; best numeric[]; q int[]; nq int[]; i int; ix int; iy int; nx int; ny int; c numeric; dirs int[]; k int; budget numeric; foes int[];
begin
  select * into b from v1_battles where id = p_battle;
  select * into u from v1_battle_units where id = p_unit;
  w := b.board_w; h := b.board_h; budget := (u.stats->>'speed')::numeric;
  if v1_hex_dist(u.x, u.y, p_tx, p_ty) > budget * 2 then return false; end if;
  select coalesce(array_agg(bu.y * w + bu.x), '{}') into foes from v1_battle_units bu where bu.battle_id = p_battle and bu.alive and not bu.left_field and bu.side <> u.side;
  best := array_fill(9999::numeric, array[w * h]);
  best[u.y * w + u.x + 1] := 0; q := array[u.y * w + u.x];
  while coalesce(array_length(q, 1), 0) > 0 loop
    nq := '{}';
    foreach i in array q loop
      ix := i % w; iy := i / w;
      dirs := case when ix % 2 = 0 then array[1,-1, 1,0, -1,-1, -1,0, 0,-1, 0,1] else array[1,0, 1,1, -1,0, -1,1, 0,-1, 0,1] end;
      for k in 0..5 loop
        nx := ix + dirs[k * 2 + 1]; ny := iy + dirs[k * 2 + 2];
        if nx < 0 or ny < 0 or nx >= w or ny >= h then continue; end if;
        if (ny * w + nx) = any(foes) then continue; end if;
        c := v1_hex_cost(b.kind, u.utype, u.size, v1_map_cell(b.map, nx, ny));
        if c is null then continue; end if;
        if best[i + 1] + c <= budget and best[i + 1] + c < best[ny * w + nx + 1] then
          best[ny * w + nx + 1] := best[i + 1] + c; nq := nq || (ny * w + nx);
        end if;
      end loop;
    end loop;
    q := nq;
  end loop;
  return best[p_ty * w + p_tx + 1] <= budget;
end $$;

create or replace function public.v1_battle_act(p_battle uuid, p_unit uuid, p_kind text, p_x integer default null, p_y integer default null, p_target uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text; b record; u record; t record; d int; dmg numeric; through numeric; armor numeric; lost int; tc text; uc text; k numeric := 1; blk text;
begin
  select * into b from v1_battles where id = p_battle;
  me := coalesce(public._v1_my_side(p_battle), case when public.v1_is_staff() and b.kind = 'test' then b.side_to_move end);
  if me is null then raise exception 'not_in_battle'; end if;
  if b.status <> 'active' then raise exception 'battle_over'; end if;
  if b.side_to_move <> me then raise exception 'not_your_turn'; end if;
  select * into u from v1_battle_units where id = p_unit and battle_id = p_battle for update;
  if u.id is null or u.side <> me or not u.alive or u.left_field then raise exception 'bad_unit'; end if;

  if p_kind = 'move' then
    if u.moved then raise exception 'already_moved'; end if;
    if p_x not between 0 and b.board_w - 1 or p_y not between 0 and b.board_h - 1 then raise exception 'off_board'; end if;
    if exists (select 1 from v1_battle_units where battle_id = p_battle and alive and not left_field and x = p_x and y = p_y) then raise exception 'cell_busy'; end if;
    if b.map is not null then
      if v1_hex_cost(b.kind, u.utype, u.size, v1_map_cell(b.map, p_x, p_y)) is null then raise exception 'cell_blocked'; end if;
      if not public._v1_can_reach(p_battle, u.id, p_x, p_y) then raise exception 'too_far'; end if;
    else
      d := greatest(abs(p_x - u.x), abs(p_y - u.y));
      if d = 0 or d > (u.stats->>'speed')::int then raise exception 'too_far'; end if;
    end if;
    update v1_battle_units set x = p_x, y = p_y, moved = true where id = u.id;
    perform public._v1_blog(p_battle, me, u.name || ' сменил позицию.');

  elsif p_kind = 'pulse' then
    if b.kind = 'ground' and u.utype <> 'air' then raise exception 'pulse_space_only'; end if;
    if u.fired then raise exception 'already_fired'; end if;
    if u.pulse_turn > b.turn_no - public._v1_bset('pulse_every', 3) then raise exception 'pulse_cooldown'; end if;
    update v1_battle_units set pulse_turn = b.turn_no, revealed_turn = b.turn_no, fired = true where id = u.id;
    perform public._v1_blog(p_battle, me, u.name || ': импульс радара — обзор удвоен, отряд себя выдал.');

  elsif p_kind = 'fire' then
    if u.fired then raise exception 'already_fired'; end if;
    select * into t from v1_battle_units where id = p_target and battle_id = p_battle for update;
    if t.id is null or t.side = me or not t.alive or t.left_field then raise exception 'bad_target'; end if;
    if b.map is not null and t.revealed_turn < b.turn_no and not public._v1_side_sees(p_battle, me, t.x, t.y, t.utype) then raise exception 'target_hidden'; end if;
    d := case when b.map is null then greatest(abs(t.x - u.x), abs(t.y - u.y)) else v1_hex_dist(u.x, u.y, t.x, t.y) end;
    if d > (u.stats->>'rng')::int then raise exception 'out_of_range'; end if;
    if b.map is not null then
      uc := v1_map_cell(b.map, u.x, u.y); tc := v1_map_cell(b.map, t.x, t.y);
      blk := case when b.kind = 'ground' then 'M' else 'RP' end;
      -- прямой огонь закрывают преграды; артиллерия бьёт навесом; авиация — сверху
      if not (u.utype in ('art', 'air') or t.utype = 'air' or (b.kind = 'ground' and uc = 'M')) and not v1_hex_los(b.map, u.x, u.y, t.x, t.y, blk) then
        raise exception 'no_line_of_fire';
      end if;
      -- укрытия
      if b.kind <> 'ground' then
        if tc = 'a' then k := k * 0.75; elsif tc = 'd' then k := k * 0.9; end if;
      elsif t.utype <> 'air' then
        if tc = 'S' or tc = 'C' then k := k * 0.6; elsif tc = 'F' then k := k * 0.75; end if;
      end if;
      -- ПВО и авиация
      if t.utype = 'air' then k := k * case when u.utype = 'aa' then 2 when u.utype = 'air' then 1 else 0.3 end;
      elsif u.utype = 'aa' then k := k * 0.5; end if;
    end if;
    dmg := greatest(0, (u.stats->>'dmg')::numeric) * u.qty * k;
    through := greatest(0, dmg - t.shield);
    armor := least(0.8, greatest(0, coalesce((t.stats->>'armor')::numeric, 0)) / 1000);
    through := through * (1 - armor);
    update v1_battle_units set shield = greatest(0, t.shield - dmg), hp = greatest(0, t.hp - through),
           qty = greatest(0, ceil(greatest(0, t.hp - through) / t.hp_ship))::int, alive = (t.hp - through) > 0
     where id = t.id;
    lost := t.qty - greatest(0, ceil(greatest(0, t.hp - through) / t.hp_ship))::int;
    -- выстрел выдаёт стрелка до конца следующего хода
    update v1_battle_units set fired = true, revealed_turn = b.turn_no + 1 where id = u.id;
    perform public._v1_blog(p_battle, me, u.name || ' → ' || t.name || ': ' || round(dmg) || ' урона' ||
      case when lost > 0 then ', потеряно: ' || lost else '' end || '.', jsonb_build_object('from', u.id, 'to', t.id));
    perform public._v1_battle_check_end(p_battle);
  else
    raise exception 'unknown_act';
  end if;
  return public.v1_battle_state(p_battle);
end $$;

-- ════════ 8. Итоги боя ════════
-- Потери и выжившие возвращаются во флоты (старый состав и корабли нового образца) и армии.
create or replace function public._v1_battle_writeback(p_battle uuid, p_side text default null) returns void
language plpgsql security definer set search_path = public as $$
declare k text; fl record; comp jsonb; u record;
begin
  select kind into k from v1_battles where id = p_battle;
  if k = 'test' then return; end if;
  for fl in select distinct un.fleet_id from v1_battle_units un
             where un.battle_id = p_battle and un.fleet_id is not null and un.comp_index is not null and (p_side is null or un.side = p_side) loop
    select composition into comp from fleets where id = fl.fleet_id for update;
    if comp is null then continue; end if;
    for u in select comp_index, qty, alive from v1_battle_units where battle_id = p_battle and fleet_id = fl.fleet_id and comp_index is not null loop
      comp := jsonb_set(comp, array[u.comp_index::text, 'qty'], to_jsonb(case when u.alive then u.qty else 0 end));
    end loop;
    update fleets set composition = (select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements(comp) e where coalesce((e->>'qty')::int, 0) > 0)
     where id = fl.fleet_id;
  end loop;
  for u in select v1_ship, qty, alive from v1_battle_units where battle_id = p_battle and v1_ship is not null and (p_side is null or side = p_side) loop
    if u.alive and u.qty > 0 then update v1_fleet_ships set qty = u.qty where id = u.v1_ship;
    else delete from v1_fleet_ships where id = u.v1_ship; end if;
  end loop;
  for fl in select distinct army_id from v1_battle_units where battle_id = p_battle and army_id is not null and (p_side is null or side = p_side) loop
    select composition into comp from armies where id = fl.army_id for update;
    if comp is null then continue; end if;
    for u in select comp_index, qty, alive from v1_battle_units where battle_id = p_battle and army_id = fl.army_id and comp_index is not null loop
      comp := jsonb_set(comp, array[u.comp_index::text, 'qty'], to_jsonb(case when u.alive then u.qty else 0 end));
    end loop;
    update armies set composition = (select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements(comp) e where coalesce((e->>'qty')::int, 0) > 0)
     where id = fl.army_id;
  end loop;
end $$;

-- Последствия: победа в войне у системы — оккупация (если флоты победителя остались),
-- победа атакующего на земле — колония занята и армия встаёт на ней.
create or replace function public._v1_battle_outcome(p_battle uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b record; wf text; c colonies; a uuid; f uuid;
begin
  select * into b from v1_battles where id = p_battle;
  if b.kind = 'test' or b.winner_side is null then return; end if;
  select faction_id into wf from v1_battle_sides where battle_id = p_battle and side = b.winner_side and status = 'won' order by role limit 1;
  if wf is null then return; end if;
  if b.kind = 'ground' then
    select * into c from colonies where id = b.colony_id;
    if c.id is null then return; end if;
    if b.winner_side = 'a' then
      select army_id into a from v1_battle_units where battle_id = p_battle and side = 'a' and alive and army_id is not null limit 1;
      if a is not null then perform public._v1_colony_taken(a, c.id, p_battle); end if;
    end if;
    -- проигравшие армии без единого юнита остаются пустыми — держава распустит сама
  else
    select fleet_id into f from v1_battle_units where battle_id = p_battle and side = b.winner_side and alive and fleet_id is not null limit 1;
    if f is not null then perform public._v1_occupy_check(wf, b.system_id, f); end if;
  end if;
end $$;

create or replace function public._v1_battle_check_end(p_battle uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare a_on int; b_on int; a_st text; b_st text; win text; why text;
begin
  select count(*) filter (where side = 'a' and alive and not left_field), count(*) filter (where side = 'b' and alive and not left_field)
    into a_on, b_on from v1_battle_units where battle_id = p_battle;
  select max(status) filter (where side = 'a'), max(status) filter (where side = 'b') into a_st, b_st from v1_battle_sides where battle_id = p_battle;
  if a_on > 0 and b_on > 0 then return false; end if;
  if a_on = 0 and b_on = 0 then win := null; why := 'обе стороны покинули поле';
  elsif a_on = 0 then win := 'b'; why := case when a_st = 'retreated' then 'сторона A отступила' else 'сторона A разбита' end;
  else win := 'a'; why := case when b_st = 'retreated' then 'сторона B отступила' else 'сторона B разбита' end;
  end if;
  update v1_battle_sides set status = 'defeated' where battle_id = p_battle and status in ('fighting', 'retreating') and side is distinct from win;
  update v1_battle_sides set status = 'won' where battle_id = p_battle and side = win and status in ('fighting', 'retreating');
  update v1_battles set status = 'done', winner_side = win, ended_at = now(), turn_deadline = null, result = jsonb_build_object('why', why) where id = p_battle;
  perform public._v1_blog(p_battle, win, 'Бой окончен: ' || why || '.');
  perform public._v1_battle_writeback(p_battle);
  perform public._v1_battle_outcome(p_battle);
  return true;
end $$;

-- Отступление: флоты улетают в соседнюю систему новым полётом; армии остаются в системе, сойдя с планеты.
create or replace function public._v1_battle_leave(p_battle uuid, p_side text) returns void
language plpgsql security definer set search_path = public as $$
declare s record; b record; fl uuid; mins int; ar uuid;
begin
  select * into b from v1_battles where id = p_battle;
  mins := public._v1_bset('retreat_minutes', 30)::int;
  for s in select * from v1_battle_sides where battle_id = p_battle and side = p_side and status = 'retreating' loop
    update v1_battle_units set left_field = true where battle_id = p_battle and side = p_side and alive;
    update v1_battle_sides set status = 'retreated', left_at = now() where battle_id = p_battle and side = p_side and faction_id = s.faction_id;
    if b.kind = 'test' then continue; end if;
    perform public._v1_battle_writeback(p_battle, p_side);
    if b.kind = 'ground' then
      for ar in select distinct army_id from v1_battle_units where battle_id = p_battle and side = p_side and faction_id = s.faction_id and army_id is not null loop
        update armies set colony_id = null, status = 'idle' where id = ar;
        update v1_army_meta set sys = b.system_id where army_id = ar;
      end loop;
    elsif s.retreat_dest is not null then
      for fl in select distinct fleet_id from v1_battle_units where battle_id = p_battle and side = p_side and faction_id = s.faction_id and fleet_id is not null loop
        update fleets set status = 'v1_transit', from_sys = b.system_id, dest_sys = s.retreat_dest, system_id = null,
               route = jsonb_build_array(b.system_id, s.retreat_dest), route_at = jsonb_build_array(now(), now() + make_interval(mins => mins)),
               depart_at = now(), arrive_at = now() + make_interval(mins => mins)
         where id = fl;
      end loop;
    end if;
    perform public._v1_blog(p_battle, p_side, case when b.kind = 'ground' then 'Отряды отступили с планеты.' else
      'Отряды отступили с поля и уходят в систему ' || coalesce((select name from map_systems where id = s.retreat_dest), s.retreat_dest, '—') || ' (~' || mins || ' мин).' end);
  end loop;
end $$;

create or replace function public._v1_battle_advance(p_battle uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b record; nxt text; s record;
begin
  select * into b from v1_battles where id = p_battle for update;
  if b.status <> 'active' then return; end if;
  nxt := case when b.side_to_move = 'a' then 'b' else 'a' end;
  if nxt = 'a' then
    update v1_battles set turn_no = turn_no + 1 where id = p_battle;
    for s in select distinct side from v1_battle_sides where battle_id = p_battle and status = 'retreating' and retreat_at_turn <= b.turn_no + 1 loop
      perform public._v1_battle_leave(p_battle, s.side);
    end loop;
    -- щиты восстанавливаются (в ионном шторме — нет)
    update v1_battle_units bu set shield = least(shield_max, shield + shield_max * public._v1_bset('shield_regen', 0.25))
     where battle_id = p_battle and alive and coalesce(v1_map_cell(b.map, bu.x, bu.y), '.') <> 'i';
    -- корона звезды снимает 10 % щита
    update v1_battle_units bu set shield = shield * 0.9 where battle_id = p_battle and alive and v1_map_cell(b.map, bu.x, bu.y) = 'f';
  end if;
  if public._v1_battle_check_end(p_battle) then return; end if;
  update v1_battle_units set moved = false, fired = false where battle_id = p_battle and side = nxt;
  update v1_battles set side_to_move = nxt, turn_deadline = now() + make_interval(mins => public._v1_bset('turn_minutes', 10)::int) where id = p_battle;
end $$;

-- ════════ 9. Права и таймер ════════
-- новые функции закрыты по умолчанию (миграция 36); игроку открываем только эти
grant execute on function public.v1_battle_state(uuid), public.v1_battle_act(uuid, uuid, text, integer, integer, uuid), public.v1_battle_create(text, text, uuid[], uuid[]) to authenticated;
grant execute on function public.v1_hex_dist(int, int, int, int), public.v1_map_cell(jsonb, int, int) to authenticated;

do $$ begin
  perform cron.unschedule('v1-battle-tick') where exists (select 1 from cron.job where jobname = 'v1-battle-tick');
  perform cron.schedule('v1-battle-tick', '* * * * *', 'select public.v1_battle_tick()');
end $$;
