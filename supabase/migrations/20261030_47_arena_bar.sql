-- Классическая эра 1.0 · Арена на новых картах и ресторан-бар «Классикал».
--
-- АРЕНА
--   • Бои на гекс-картах нового движка: космос (проекты из конструктора) и земля (наземные
--     войска и авиация — свои и общедоступные проекты). Отряды на арене условные: настоящие
--     флоты и армии не страдают.
--   • Ростер: держава набирает отряды в пределах бюджета арены (по цене проектов).
--   • Бот «Жнец» — жёсткий: ходит первым, видит всё поле, бьёт по самой уязвимой цели,
--     держит дистанцию, бюджет у него больше. Победа над ботом — приз (раз в 12 часов).
--   • Вызов державе: обе стороны ставят одинаковую сумму (0…500 000), победитель забирает обе.
--   • Зрители ставят на исход боя (25 000…500 000) первые два хода; тотализатор, 5 % — арене.
-- БАР «Классикал» — игры на казну державы, ставка 25 000…500 000 ГС:
--   рулетка, колесо удачи (с джекпотом бара), карты таро, «21» (блекджек), кости.
--   2 % каждой проигранной ставки уходят в джекпот; джекпот выпадает на колесе.

set lock_timeout = '15s';

-- ════════ 1. Арена: таблицы и настройки ════════
alter table public.v1_battles add column if not exists arena boolean not null default false;

create table if not exists public.v1_arena_matches (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('space', 'ground')),
  a_fid text not null, b_fid text not null,            -- 'arena_bot' — бот
  roster_a jsonb not null default '[]'::jsonb, roster_b jsonb not null default '[]'::jsonb,
  stake numeric not null default 0,
  status text not null default 'pending' check (status in ('pending', 'live', 'done', 'declined', 'cancelled')),
  battle_id uuid, winner_fid text, prize numeric not null default 0,
  created_at timestamptz not null default now(), ended_at timestamptz
);
create index if not exists v1_arena_matches_st on public.v1_arena_matches(status, created_at desc);
create table if not exists public.v1_arena_bets (
  match_id uuid not null references public.v1_arena_matches(id) on delete cascade,
  fid text not null, side text not null check (side in ('a', 'b')), amount numeric not null, won numeric,
  created_at timestamptz not null default now(),
  primary key (match_id, fid)
);
alter table public.v1_arena_matches enable row level security;
alter table public.v1_arena_bets enable row level security;
revoke all on public.v1_arena_matches, public.v1_arena_bets from anon, authenticated;

insert into public.v1_settings(key, value) values ('arena', '{
  "budget": 4000000, "max_units": 8, "bot_k": 1.25, "prize": 250000, "prize_cd_h": 12,
  "stake_max": 500000, "bet_min": 25000, "bet_max": 500000, "bet_turns": 2, "house": 0.05
}') on conflict (key) do nothing;

create or replace function public._v1_av(p_key text, p_def numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select (value->>p_key)::numeric from v1_settings where key = 'arena'), p_def)
$$;

-- ════════ 2. Ростер: проекты и цены ════════
/** Проект для арены: {id, name, class, cost, utype, size, radar, stats} или null, если недоступен державе. */
create or replace function public._v1_arena_design(p_fid text, p_kind text, p_id uuid, p_any boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s v1_ships; u faction_units; cls text; ty text; ut text;
begin
  if p_kind = 'space' then
    select * into s from v1_ships where id = p_id and (p_any or faction_id = p_fid) and coalesce((stats->>'registrable')::boolean, false);
    if s.id is null and p_any then
      -- боту годятся и проекты реестра старого образца
      select * into u from faction_units where id = p_id and category = 'ship';
      if u.id is null then return null; end if;
      cls := coalesce(u.summary->>'className', 'Корабль');
      return jsonb_build_object('id', u.id, 'name', u.name, 'class', cls, 'cost', greatest(1, coalesce((u.summary->>'cost')::numeric, 1)),
        'utype', 'ship', 'size', public._v1_ship_size(cls), 'radar', greatest(2, least(7, round(coalesce((u.summary->>'radar')::numeric, 8) * 0.45)))::int,
        'stats', jsonb_build_object('hp', coalesce((u.summary->>'hp')::numeric, 100), 'shield', coalesce((u.summary->>'shield')::numeric, 0),
          'armor', coalesce((u.summary->>'armor')::numeric, 0), 'dmg', coalesce((u.summary->>'dmg')::numeric, 0),
          'rng', greatest(1, least(8, round(coalesce((u.summary->>'rng')::numeric, 5) * 0.4))),
          'speed', greatest(1, least(6, round(coalesce((u.summary->>'speed')::numeric, 4) * 0.5)))));
    end if;
    if s.id is null then return null; end if;
    return jsonb_build_object('id', s.id, 'name', s.name, 'class', coalesce(s.stats->>'class_name', s.class), 'cost', greatest(1, coalesce((s.stats->>'cost')::numeric, 1)),
      'utype', 'ship', 'size', coalesce(s.stats->>'size', 'M'), 'radar', greatest(2, least(8, round(coalesce((s.stats->>'radar')::numeric, 4))))::int,
      'stats', jsonb_build_object('hp', coalesce((s.stats->>'hp')::numeric, 100), 'shield', coalesce((s.stats->>'shield')::numeric, 0), 'armor', 0,
        'dmg', coalesce((s.stats->>'damage')::numeric, 0), 'rng', greatest(1, least(8, round(coalesce((s.stats->>'dalnost')::numeric, 5)))),
        'speed', greatest(1, least(6, round(coalesce((s.stats->>'speed')::numeric, 3))))));
  end if;
  select * into u from faction_units where id = p_id and category in ('ground', 'aviation') and (p_any or faction_id = p_fid or faction_id is null);
  if u.id is null then return null; end if;
  cls := coalesce(u.summary->>'className', ''); ty := coalesce(u.summary->>'typeName', '');
  ut := public._v1_ground_type(u.category, coalesce(nullif(cls, ''), u.name), ty);
  return jsonb_build_object('id', u.id, 'name', u.name, 'class', coalesce(nullif(cls, ''), ty), 'cost', greatest(1, coalesce((u.summary->>'cost')::numeric, 1)),
    'utype', ut, 'size', 'M', 'radar', case ut when 'air' then 4 when 'art' then 2 else 3 end,
    'stats', jsonb_build_object('hp', coalesce((u.summary->>'hp')::numeric, 100), 'shield', coalesce((u.summary->>'shield')::numeric, 0),
      'armor', coalesce((u.summary->>'armor')::numeric, 0), 'dmg', coalesce((u.summary->>'dmg')::numeric, 0),
      'rng', greatest(1, least(8, round(coalesce((u.summary->>'rng')::numeric, 4) * case when ut = 'art' then 0.5 else 0.35 end))),
      'speed', case when ut = 'air' then 5 else greatest(1, least(5, round(coalesce((u.summary->>'speed')::numeric, 3) * 0.6))) end));
end $$;

/** Проверить ростер: [{id, qty}] → [{design…, qty}], цена в пределах бюджета. */
create or replace function public._v1_arena_roster(p_fid text, p_kind text, p_roster jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare el jsonb; d jsonb; q int; total numeric := 0; out jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_roster) <> 'array' or jsonb_array_length(p_roster) = 0 then raise exception 'arena_roster_empty'; end if;
  if jsonb_array_length(p_roster) > public._v1_av('max_units', 8) then raise exception 'arena_roster_big: %', public._v1_av('max_units', 8)::int; end if;
  for el in select value from jsonb_array_elements(p_roster) loop
    q := greatest(0, least(500, coalesce((el->>'qty')::int, 0)));
    if q = 0 then continue; end if;
    d := public._v1_arena_design(p_fid, p_kind, (el->>'id')::uuid);
    if d is null then raise exception 'arena_bad_design'; end if;
    total := total + (d->>'cost')::numeric * q;
    out := out || jsonb_build_array(d || jsonb_build_object('qty', q));
  end loop;
  if jsonb_array_length(out) = 0 then raise exception 'arena_roster_empty'; end if;
  if total > public._v1_av('budget', 4000000) then raise exception 'arena_budget: % %', round(total), public._v1_av('budget', 4000000)::bigint; end if;
  return out;
end $$;

/** Ростер бота: случайные проекты всех держав на бюджет × bot_k. */
create or replace function public._v1_arena_bot_roster(p_kind text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare budget numeric := public._v1_av('budget', 4000000) * public._v1_av('bot_k', 1.25); out jsonb := '[]'::jsonb; r record; d jsonb; q int; n int := 0;
begin
  for r in select z.id from (select id from v1_ships where p_kind = 'space' and coalesce((stats->>'registrable')::boolean, false) and coalesce((stats->>'damage')::numeric, 0) > 0
            union all select id from faction_units where p_kind = 'space' and category = 'ship' and coalesce((summary->>'dmg')::numeric, 0) > 0
              and coalesce((summary->>'className'), '') !~* 'станц'
            union all select id from faction_units where p_kind = 'ground' and category in ('ground', 'aviation') and coalesce((summary->>'dmg')::numeric, 0) > 0) z
           order by random() limit 20 loop
    exit when n >= public._v1_av('max_units', 8) - 2 or budget <= 0;
    d := public._v1_arena_design(null, p_kind, r.id, true);
    if d is null then continue; end if;
    q := floor(budget * 0.35 / (d->>'cost')::numeric);
    if q < 1 and (d->>'cost')::numeric <= budget then q := 1; end if;
    if q < 1 then continue; end if;
    q := least(q, 200);
    out := out || jsonb_build_array(d || jsonb_build_object('qty', q));
    budget := budget - q * (d->>'cost')::numeric; n := n + 1;
  end loop;
  return out;
end $$;

-- ════════ 3. Создание боя арены ════════
create or replace function public._v1_arena_battle(p_match uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare mt v1_arena_matches; m jsonb; b uuid; w int; h int; sys text; pid int; el jsonb; n int; side text; ros jsonb; fid text; x0 int; x1 int; kind text;
begin
  select * into mt from v1_arena_matches where id = p_match for update;
  if mt.kind = 'space' then
    select id into sys from map_systems order by random() limit 1;
    m := v1_bmap_gen(sys, floor(random() * 2147483647)::bigint, null, 'm'); kind := 'arena';
  else
    select system_id, planet_pid into sys, pid from colonies where planet_pid is not null order by random() limit 1;
    m := v1_gmap_gen(sys, pid, floor(random() * 2147483647)::bigint, 'm'); kind := 'ground';
  end if;
  w := (m->>'w')::int; h := (m->>'h')::int;
  insert into v1_battles(kind, system_id, board_w, board_h, turn_deadline, map, arena, side_to_move)
  values (kind, sys, w, h, now() + make_interval(mins => public._v1_bset('turn_minutes', 10)::int), m, true, 'a') returning id into b;
  foreach side in array array['a', 'b'] loop
    fid := case when side = 'a' then mt.a_fid else mt.b_fid end;
    ros := case when side = 'a' then mt.roster_a else mt.roster_b end;
    insert into v1_battle_sides(battle_id, side, faction_id, role, ai) values (b, side, fid, case when side = 'a' then 'attacker' else 'defender' end, fid = 'arena_bot');
    x0 := case when side = 'a' then 0 else w - 3 end; x1 := case when side = 'a' then 2 else w - 1 end;
    if mt.kind = 'ground' then x0 := case when side = 'a' then 0 else w - 6 end; x1 := case when side = 'a' then 4 else w - 1 end; end if;
    n := 0;
    for el in select value from jsonb_array_elements(ros) loop
      perform public._v1_add_unit(b, side, fid, el->>'name', el->>'class', (el->>'qty')::int, el->'stats', el->>'utype', el->>'size', (el->>'radar')::int,
        null, null, null, null, x0, x1, h / 2 - 3 + n * 2);
      n := n + 1;
    end loop;
  end loop;
  update v1_arena_matches set battle_id = b, status = 'live' where id = mt.id;
  perform public._v1_blog(b, null, 'Арена: бой начался' || case when mt.b_fid = 'arena_bot' or mt.a_fid = 'arena_bot' then ' — против «Жнеца».' else '.' end);
  -- бот ходит первым
  if mt.a_fid = 'arena_bot' then perform public._v1_bot_turn(b); end if;
  return b;
end $$;

create or replace function public._v1_arena_me() returns text
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction();
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  if not (v1_can_manage(v_fid, 'fleet') or v1_can_manage(v_fid, 'produce') or v1_can_manage(v_fid, 'army')) then raise exception 'forbidden'; end if;
  return v_fid;
end $$;

create or replace function public.v1_arena_fight_bot(p_kind text, p_roster jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_fid text := public._v1_arena_me(); ros jsonb; bot jsonb; mid uuid;
begin
  if p_kind not in ('space', 'ground') then raise exception 'arena_kind'; end if;
  if exists (select 1 from v1_arena_matches where v_fid in (a_fid, b_fid) and status = 'live') then raise exception 'arena_busy'; end if;
  ros := public._v1_arena_roster(v_fid, p_kind, p_roster);
  bot := public._v1_arena_bot_roster(p_kind);
  if jsonb_array_length(bot) = 0 then raise exception 'arena_no_bot'; end if;
  insert into v1_arena_matches(kind, a_fid, b_fid, roster_a, roster_b, status) values (p_kind, 'arena_bot', v_fid, bot, ros, 'pending')
  returning id into mid;
  return public._v1_arena_battle(mid);
end $$;

create or replace function public.v1_arena_challenge(p_target text, p_kind text, p_roster jsonb, p_stake numeric) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_fid text := public._v1_arena_me(); ros jsonb; st numeric := greatest(0, round(coalesce(p_stake, 0))); mid uuid;
begin
  if p_kind not in ('space', 'ground') then raise exception 'arena_kind'; end if;
  if p_target is null or p_target = v_fid or not exists (select 1 from faction_economy where faction_id = p_target) then raise exception 'bad_target'; end if;
  if st > public._v1_av('stake_max', 500000) then raise exception 'arena_stake: %', public._v1_av('stake_max', 500000)::bigint; end if;
  if exists (select 1 from v1_arena_matches where a_fid = v_fid and b_fid = p_target and status = 'pending') then raise exception 'arena_dup'; end if;
  ros := public._v1_arena_roster(v_fid, p_kind, p_roster);
  if st > 0 then
    update faction_economy set gc = gc - st where faction_id = v_fid and gc >= st;
    if not found then raise exception 'prod_no_money: %', st::bigint; end if;
  end if;
  insert into v1_arena_matches(kind, a_fid, b_fid, roster_a, stake) values (p_kind, v_fid, p_target, ros, st) returning id into mid;
  return mid;
end $$;

create or replace function public.v1_arena_answer(p_match uuid, p_accept boolean, p_roster jsonb default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_fid text := public._v1_arena_me(); mt v1_arena_matches; ros jsonb;
begin
  select * into mt from v1_arena_matches where id = p_match and status = 'pending' and v_fid in (a_fid, b_fid) for update;
  if mt.id is null then raise exception 'arena_gone'; end if;
  if not p_accept or v_fid = mt.a_fid then
    update faction_economy set gc = gc + mt.stake where faction_id = mt.a_fid;
    update v1_arena_matches set status = case when v_fid = mt.a_fid then 'cancelled' else 'declined' end, ended_at = now() where id = mt.id;
    return null;
  end if;
  if exists (select 1 from v1_arena_matches where v_fid in (a_fid, b_fid) and status = 'live') then raise exception 'arena_busy'; end if;
  ros := public._v1_arena_roster(v_fid, mt.kind, p_roster);
  if mt.stake > 0 then
    update faction_economy set gc = gc - mt.stake where faction_id = v_fid and gc >= mt.stake;
    if not found then raise exception 'prod_no_money: %', mt.stake::bigint; end if;
  end if;
  update v1_arena_matches set roster_b = ros where id = mt.id;
  return public._v1_arena_battle(mt.id);
end $$;

create or replace function public.v1_arena_bet(p_match uuid, p_side text, p_amount numeric) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction(); mt v1_arena_matches; t int; amt numeric := round(coalesce(p_amount, 0));
begin
  if v_fid is null or not (v1_can_manage(v_fid, 'trade') or v1_can_manage(v_fid, 'produce')) then raise exception 'forbidden'; end if;
  select * into mt from v1_arena_matches where id = p_match and status = 'live';
  if mt.id is null then raise exception 'arena_gone'; end if;
  if v_fid in (mt.a_fid, mt.b_fid) then raise exception 'arena_bet_own'; end if;
  select turn_no into t from v1_battles where id = mt.battle_id;
  if t > public._v1_av('bet_turns', 2) then raise exception 'arena_bet_closed'; end if;
  if p_side not in ('a', 'b') then raise exception 'bad_side'; end if;
  if amt < public._v1_av('bet_min', 25000) or amt > public._v1_av('bet_max', 500000) then
    raise exception 'bet_range: % %', public._v1_av('bet_min', 25000)::bigint, public._v1_av('bet_max', 500000)::bigint;
  end if;
  if exists (select 1 from v1_arena_bets where match_id = mt.id and fid = v_fid) then raise exception 'arena_bet_dup'; end if;
  update faction_economy set gc = gc - amt where faction_id = v_fid and gc >= amt;
  if not found then raise exception 'prod_no_money: %', amt::bigint; end if;
  insert into v1_arena_bets(match_id, fid, side, amount) values (mt.id, v_fid, p_side, amt);
  return true;
end $$;

/** Итоги боя арены: приз за победу над ботом, ставка вызова, тотализатор зрителей. */
create or replace function public._v1_arena_settle(p_battle uuid) returns void
language plpgsql security definer set search_path = public as $$
declare mt v1_arena_matches; b record; wfid text; pool numeric; wpool numeric; bt record; v_prize numeric := 0; house numeric := public._v1_av('house', 0.05);
begin
  select * into mt from v1_arena_matches where battle_id = p_battle and status = 'live' for update;
  if mt.id is null then return; end if;
  select * into b from v1_battles where id = p_battle;
  wfid := case b.winner_side when 'a' then mt.a_fid when 'b' then mt.b_fid end;
  -- вызов: победитель забирает обе ставки, ничья — ставки назад
  if mt.stake > 0 then
    if wfid is null then
      update faction_economy set gc = gc + mt.stake where faction_id in (mt.a_fid, mt.b_fid);
    elsif wfid <> 'arena_bot' then
      update faction_economy set gc = gc + mt.stake * 2 where faction_id = wfid;
    end if;
  end if;
  -- победа над ботом — приз, не чаще раза в N часов
  if wfid is not null and wfid <> 'arena_bot' and 'arena_bot' in (mt.a_fid, mt.b_fid)
     and not exists (select 1 from v1_arena_matches x where x.winner_fid = wfid and x.prize > 0 and x.ended_at > now() - make_interval(hours => public._v1_av('prize_cd_h', 12)::int)) then
    v_prize := public._v1_av('prize', 250000);
    update faction_economy set gc = gc + v_prize where faction_id = wfid;
  end if;
  -- тотализатор
  select coalesce(sum(amount), 0), coalesce(sum(amount) filter (where side = b.winner_side), 0) into pool, wpool from v1_arena_bets where match_id = mt.id;
  for bt in select * from v1_arena_bets where match_id = mt.id loop
    if b.winner_side is null or wpool = 0 then
      update faction_economy set gc = gc + bt.amount where faction_id = bt.fid;
      update v1_arena_bets set won = bt.amount where match_id = mt.id and fid = bt.fid;
    elsif bt.side = b.winner_side then
      update faction_economy set gc = gc + round(bt.amount + (pool - wpool) * bt.amount / wpool * (1 - house)) where faction_id = bt.fid;
      update v1_arena_bets set won = round(bt.amount + (pool - wpool) * bt.amount / wpool * (1 - house)) where match_id = mt.id and fid = bt.fid;
    else
      update v1_arena_bets set won = 0 where match_id = mt.id and fid = bt.fid;
    end if;
  end loop;
  update v1_arena_matches set status = 'done', winner_fid = wfid, prize = v_prize, ended_at = now() where id = mt.id;
  perform v1_bulletin('Арена: ' || case when wfid is null then 'ничья' when wfid = 'arena_bot' then 'победа «Жнеца»' else 'победа державы «' || v1_fname(wfid) || '»' end,
    format('%s бой на арене: %s против %s.%s', case mt.kind when 'space' then 'Космический' else 'Наземный' end,
      case when mt.a_fid = 'arena_bot' then '«Жнец»' else '«' || v1_fname(mt.a_fid) || '»' end,
      case when mt.b_fid = 'arena_bot' then '«Жнец»' else '«' || v1_fname(mt.b_fid) || '»' end,
      case when v_prize > 0 then ' Приз арены — ' || to_char(v_prize, 'FM999G999G990') || ' ГС.' else '' end),
    (select coalesce(jsonb_agg(x), '[]'::jsonb) from unnest(array[mt.a_fid, mt.b_fid]) x where x <> 'arena_bot'));
end $$;

-- ════════ 4. Ход отряда без проверки прав (для игрока и для бота) ════════
create or replace function public._v1_battle_do(p_battle uuid, p_side text, p_unit uuid, p_kind text, p_x int, p_y int, p_target uuid, p_omni boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare me text := p_side; b record; u record; t record; d int; dmg numeric; through numeric; armor numeric; lost int; tc text; uc text; k numeric := 1; blk text;
begin
  select * into b from v1_battles where id = p_battle;
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
    if not p_omni and b.map is not null and t.revealed_turn < b.turn_no and not public._v1_side_sees(p_battle, me, t.x, t.y, t.utype) then raise exception 'target_hidden'; end if;
    d := case when b.map is null then greatest(abs(t.x - u.x), abs(t.y - u.y)) else v1_hex_dist(u.x, u.y, t.x, t.y) end;
    if d > (u.stats->>'rng')::int then raise exception 'out_of_range'; end if;
    if b.map is not null then
      uc := v1_map_cell(b.map, u.x, u.y); tc := v1_map_cell(b.map, t.x, t.y);
      blk := case when b.kind = 'ground' then 'M' else 'RP' end;
      if not (u.utype in ('art', 'air') or t.utype = 'air' or (b.kind = 'ground' and uc = 'M')) and not v1_hex_los(b.map, u.x, u.y, t.x, t.y, blk) then
        raise exception 'no_line_of_fire';
      end if;
      if b.kind <> 'ground' then
        if tc = 'a' then k := k * 0.75; elsif tc = 'd' then k := k * 0.9; end if;
      elsif t.utype <> 'air' then
        if tc = 'S' or tc = 'C' then k := k * 0.6; elsif tc = 'F' then k := k * 0.75; end if;
      end if;
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
    update v1_battle_units set fired = true, revealed_turn = b.turn_no + 1 where id = u.id;
    perform public._v1_blog(p_battle, me, u.name || ' → ' || t.name || ': ' || round(dmg) || ' урона' ||
      case when lost > 0 then ', потеряно: ' || lost else '' end || '.', jsonb_build_object('from', u.id, 'to', t.id));
    perform public._v1_battle_check_end(p_battle);
  else
    raise exception 'unknown_act';
  end if;
end $$;

create or replace function public.v1_battle_act(p_battle uuid, p_unit uuid, p_kind text, p_x integer default null, p_y integer default null, p_target uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text; b record;
begin
  select * into b from v1_battles where id = p_battle;
  me := coalesce(public._v1_my_side(p_battle), case when public.v1_is_staff() and b.kind = 'test' then b.side_to_move end);
  if me is null then raise exception 'not_in_battle'; end if;
  perform public._v1_battle_do(p_battle, me, p_unit, p_kind, p_x, p_y, p_target, false);
  return public.v1_battle_state(p_battle);
end $$;

-- ════════ 5. Бот «Жнец» ════════
/** Куда отряд дойдёт за ход: клетки и цена пути (сквозь врага нельзя, на занятую — нельзя). */
create or replace function public._v1_reach_cells(p_battle uuid, p_unit uuid) returns table(x int, y int)
language plpgsql stable security definer set search_path = public as $$
declare b record; u record; w int; h int; best numeric[]; q int[]; nq int[]; i int; ix int; iy int; nx int; ny int; c numeric; dirs int[]; k int; budget numeric; foes int[]; busy int[];
begin
  select * into b from v1_battles where id = p_battle;
  select * into u from v1_battle_units where id = p_unit;
  w := b.board_w; h := b.board_h; budget := (u.stats->>'speed')::numeric;
  select coalesce(array_agg(bu.y * w + bu.x) filter (where bu.side <> u.side), '{}'), coalesce(array_agg(bu.y * w + bu.x), '{}') into foes, busy
    from v1_battle_units bu where bu.battle_id = p_battle and bu.alive and not bu.left_field;
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
  for i in 1..w * h loop
    if best[i] < 9999 and not ((i - 1) = any(busy)) then x := (i - 1) % w; y := (i - 1) / w; return next; end if;
  end loop;
end $$;

/** Может ли отряд с клетки (x, y) бить цель t: дальность и линия огня. */
create or replace function public._v1_can_hit(p_battle uuid, p_unit uuid, p_x int, p_y int, p_target uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare b record; u record; t record; blk text;
begin
  select * into b from v1_battles where id = p_battle;
  select * into u from v1_battle_units where id = p_unit;
  select * into t from v1_battle_units where id = p_target;
  if v1_hex_dist(p_x, p_y, t.x, t.y) > (u.stats->>'rng')::int then return false; end if;
  if b.map is null or u.utype in ('art', 'air') or t.utype = 'air' or (b.kind = 'ground' and v1_map_cell(b.map, p_x, p_y) = 'M') then return true; end if;
  blk := case when b.kind = 'ground' then 'M' else 'RP' end;
  return v1_hex_los(b.map, p_x, p_y, t.x, t.y, blk);
end $$;

/**
 * Ход бота. Видит всё поле. Каждый отряд (сначала самые сильные):
 *   1) если может ударить с места — бьёт самую уязвимую цель (больше урона на её остаток прочности);
 *   2) идёт туда, откуда достанет цель, держась как можно дальше от вражеских стволов;
 *      если никого не достать — сближается с ближайшим врагом;
 *   3) если ещё не стрелял — стреляет с новой позиции.
 */
create or replace function public._v1_bot_turn(p_battle uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b record; me text; u record; t record; tgt uuid; best_score numeric; sc numeric; c record; v_bx int; v_by int; danger numeric; dmin int; fired boolean; n int := 0;
begin
  select * into b from v1_battles where id = p_battle;
  if b.status <> 'active' then return; end if;
  select side into me from v1_battle_sides where battle_id = p_battle and ai and side = b.side_to_move limit 1;
  if me is null then return; end if;
  for u in select * from v1_battle_units where battle_id = p_battle and side = me and alive and not left_field
            order by (stats->>'dmg')::numeric * qty desc loop
    exit when (select status from v1_battles where id = p_battle) <> 'active';
    fired := false;
    -- 1) удар с места
    tgt := null; best_score := -1;
    for t in select * from v1_battle_units where battle_id = p_battle and side <> me and alive and not left_field loop
      if public._v1_can_hit(p_battle, u.id, u.x, u.y, t.id) then
        sc := (u.stats->>'dmg')::numeric * u.qty / greatest(1, t.hp + t.shield) + (t.stats->>'dmg')::numeric * t.qty / 1e6;
        if sc > best_score then best_score := sc; tgt := t.id; end if;
      end if;
    end loop;
    if tgt is not null then
      begin perform public._v1_battle_do(p_battle, me, u.id, 'fire', null, null, tgt, true); fired := true; exception when others then null; end;
    end if;
    exit when (select status from v1_battles where id = p_battle) <> 'active';
    -- 2) позиция: достать цель, держась дальше от врага
    v_bx := null; best_score := -1e9;
    for c in select * from public._v1_reach_cells(p_battle, u.id) loop
      select min(v1_hex_dist(c.x, c.y, e.x, e.y)), coalesce(sum(case when v1_hex_dist(c.x, c.y, e.x, e.y) <= (e.stats->>'rng')::int then (e.stats->>'dmg')::numeric * e.qty else 0 end), 0)
        into dmin, danger from v1_battle_units e where e.battle_id = p_battle and e.side <> me and e.alive and not e.left_field;
      if dmin is null then exit; end if;
      sc := - dmin * 10 - danger / greatest(1, u.hp) * 40;
      if exists (select 1 from v1_battle_units e where e.battle_id = p_battle and e.side <> me and e.alive and not e.left_field and public._v1_can_hit(p_battle, u.id, c.x, c.y, e.id)) then
        sc := sc + 1000 + dmin * 25;     -- достаёт: чем дальше, тем лучше (держит дистанцию)
      end if;
      if sc > best_score then best_score := sc; v_bx := c.x; v_by := c.y; end if;
    end loop;
    if v_bx is not null and (v_bx <> u.x or v_by <> u.y) then
      begin perform public._v1_battle_do(p_battle, me, u.id, 'move', v_bx, v_by, null, true); exception when others then null; end;
    end if;
    exit when (select status from v1_battles where id = p_battle) <> 'active';
    -- 3) удар с новой позиции
    if not fired then
      select * into u from v1_battle_units where id = u.id;
      tgt := null; best_score := -1;
      for t in select * from v1_battle_units where battle_id = p_battle and side <> me and alive and not left_field loop
        if public._v1_can_hit(p_battle, u.id, u.x, u.y, t.id) then
          sc := (u.stats->>'dmg')::numeric * u.qty / greatest(1, t.hp + t.shield);
          if sc > best_score then best_score := sc; tgt := t.id; end if;
        end if;
      end loop;
      if tgt is not null then
        begin perform public._v1_battle_do(p_battle, me, u.id, 'fire', null, null, tgt, true); exception when others then null; end;
      end if;
    end if;
    n := n + 1;
  end loop;
  if (select status from v1_battles where id = p_battle) = 'active' then
    perform public._v1_blog(p_battle, me, '«Жнец» завершил ход.');
    perform public._v1_battle_advance(p_battle);
  end if;
end $$;

-- ход переходит к боту — бот ходит сразу
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
    update v1_battle_units bu set shield = least(shield_max, shield + shield_max * public._v1_bset('shield_regen', 0.25))
     where battle_id = p_battle and alive and coalesce(v1_map_cell(b.map, bu.x, bu.y), '.') <> 'i';
    update v1_battle_units bu set shield = shield * 0.9 where battle_id = p_battle and alive and v1_map_cell(b.map, bu.x, bu.y) = 'f';
  end if;
  if public._v1_battle_check_end(p_battle) then return; end if;
  update v1_battle_units set moved = false, fired = false where battle_id = p_battle and side = nxt;
  update v1_battles set side_to_move = nxt, turn_deadline = now() + make_interval(mins => public._v1_bset('turn_minutes', 10)::int) where id = p_battle;
  if exists (select 1 from v1_battle_sides where battle_id = p_battle and side = nxt and ai) then
    perform public._v1_bot_turn(p_battle);
  end if;
end $$;

-- исход: арена считается отдельно и никого не оккупирует
create or replace function public._v1_battle_outcome(p_battle uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b record; wf text; c colonies; a uuid; f uuid;
begin
  select * into b from v1_battles where id = p_battle;
  if b.arena then perform public._v1_arena_settle(p_battle); return; end if;
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
  else
    select fleet_id into f from v1_battle_units where battle_id = p_battle and side = b.winner_side and alive and fleet_id is not null limit 1;
    if f is not null then perform public._v1_occupy_check(wf, b.system_id, f); end if;
  end if;
end $$;

-- ════════ 6. Арена: состояние ════════
create or replace function public.v1_arena_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction();
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  return jsonb_build_object(
    'fid', v_fid, 'settings', (select value from v1_settings where key = 'arena'),
    'can', v1_can_manage(v_fid, 'fleet') or v1_can_manage(v_fid, 'produce') or v1_can_manage(v_fid, 'army'),
    'gc', (select gc from faction_economy where faction_id = v_fid),
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
                  'my_bet', (select jsonb_build_object('side', side, 'amount', amount, 'won', won) from v1_arena_bets where match_id = m.id and fid = v_fid),
                  'at', coalesce(m.ended_at, m.created_at)) order by m.created_at desc), '[]'::jsonb)
                from (select * from v1_arena_matches where status in ('pending', 'live') and (status = 'live' or v_fid in (a_fid, b_fid))
                      union all (select * from v1_arena_matches where status = 'done' order by ended_at desc limit 15)) m),
    'factions', (select coalesce(jsonb_agg(jsonb_build_object('id', fe.faction_id, 'name', v1_fname(fe.faction_id)) order by v1_fname(fe.faction_id)), '[]'::jsonb)
                 from faction_economy fe where fe.faction_id <> v_fid and exists (select 1 from colonies c where c.faction_id = fe.faction_id)));
end $$;

-- ════════ 7. Бар «Классикал» ════════
create table if not exists public.v1_bar_log (
  id bigserial primary key, fid text not null, game text not null, bet numeric not null, payout numeric not null,
  detail jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index if not exists v1_bar_log_fid on public.v1_bar_log(fid, id desc);
create index if not exists v1_bar_log_at on public.v1_bar_log(created_at desc);
create table if not exists public.v1_bar_pot (id int primary key default 1 check (id = 1), jackpot numeric not null default 0);
insert into public.v1_bar_pot(id, jackpot) values (1, 1000000) on conflict (id) do nothing;
create table if not exists public.v1_bar_bj (
  id uuid primary key default gen_random_uuid(), fid text not null, bet numeric not null,
  deck jsonb not null, player jsonb not null, dealer jsonb not null,
  status text not null default 'play' check (status in ('play', 'done')), doubled boolean not null default false,
  result text, payout numeric, created_at timestamptz not null default now()
);
create unique index if not exists v1_bar_bj_one on public.v1_bar_bj(fid) where status = 'play';
alter table public.v1_bar_log enable row level security;
alter table public.v1_bar_pot enable row level security;
alter table public.v1_bar_bj enable row level security;
revoke all on public.v1_bar_log, public.v1_bar_pot, public.v1_bar_bj from anon, authenticated;

insert into public.v1_settings(key, value) values ('bar', '{
  "min": 25000, "max": 500000, "jackpot_k": 0.02, "jackpot_seed": 1000000, "cooldown_s": 2
}') on conflict (key) do nothing;

create or replace function public._v1_bv(p_key text, p_def numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select (value->>p_key)::numeric from v1_settings where key = 'bar'), p_def)
$$;

/** Принять ставку: права, пределы, казна, частота. Возвращает держава. */
create or replace function public._v1_bar_take(p_bet numeric) returns text
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction(); bet numeric := round(coalesce(p_bet, 0));
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  if not (v1_can_manage(v_fid, 'trade') or v1_can_manage(v_fid, 'produce')) then raise exception 'forbidden'; end if;
  if bet < public._v1_bv('min', 25000) or bet > public._v1_bv('max', 500000) then
    raise exception 'bet_range: % %', public._v1_bv('min', 25000)::bigint, public._v1_bv('max', 500000)::bigint;
  end if;
  if exists (select 1 from v1_bar_log where fid = v_fid and created_at > now() - make_interval(secs => public._v1_bv('cooldown_s', 2))) then raise exception 'bar_slow'; end if;
  update faction_economy set gc = gc - bet where faction_id = v_fid and gc >= bet;
  if not found then raise exception 'prod_no_money: %', bet::bigint; end if;
  return v_fid;
end $$;

create or replace function public._v1_bar_pay(p_fid text, p_game text, p_bet numeric, p_payout numeric, p_detail jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pay numeric := greatest(0, round(coalesce(p_payout, 0)));
begin
  if pay > 0 then update faction_economy set gc = gc + pay where faction_id = p_fid; end if;
  if pay < p_bet then update v1_bar_pot set jackpot = jackpot + round((p_bet - pay) * public._v1_bv('jackpot_k', 0.02)) where id = 1; end if;
  insert into v1_bar_log(fid, game, bet, payout, detail) values (p_fid, p_game, p_bet, pay, coalesce(p_detail, '{}'::jsonb));
  return coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('bet', p_bet, 'payout', pay, 'net', pay - p_bet,
    'gc', (select gc from faction_economy where faction_id = p_fid), 'jackpot', (select jackpot from v1_bar_pot where id = 1));
end $$;

/** Рулетка (европейская, 0–36). Ставки: число ×36, красное/чёрное, чёт/нечет, 1–18/19–36 ×2, дюжина ×3. */
create or replace function public.v1_bar_roulette(p_bet numeric, p_kind text, p_value int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare fid text; n int := floor(random() * 37)::int; red int[] := array[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]; win boolean; k numeric;
begin
  if p_kind not in ('num', 'red', 'black', 'even', 'odd', 'low', 'high', 'dozen') then raise exception 'bad_side'; end if;
  if p_kind = 'num' and (p_value is null or p_value not between 0 and 36) then raise exception 'bar_bad_value'; end if;
  if p_kind = 'dozen' and (p_value is null or p_value not between 1 and 3) then raise exception 'bar_bad_value'; end if;
  fid := public._v1_bar_take(p_bet);
  win := case p_kind
    when 'num' then n = p_value
    when 'red' then n = any(red) when 'black' then n > 0 and not n = any(red)
    when 'even' then n > 0 and n % 2 = 0 when 'odd' then n % 2 = 1
    when 'low' then n between 1 and 18 when 'high' then n between 19 and 36
    when 'dozen' then n between (p_value - 1) * 12 + 1 and p_value * 12 end;
  k := case p_kind when 'num' then 36 when 'dozen' then 3 else 2 end;
  return public._v1_bar_pay(fid, 'roulette', round(p_bet), case when win then round(p_bet) * k else 0 end,
    jsonb_build_object('number', n, 'color', case when n = 0 then 'green' when n = any(red) then 'red' else 'black' end, 'win', win, 'kind', p_kind, 'value', p_value));
end $$;

/** Колесо удачи: 30 секторов — 16 пустых, 6 × ×1,5, 4 × ×2, 2 × ×3, 1 × ×5, 1 — джекпот бара. */
create or replace function public.v1_bar_wheel(p_bet numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare fid text; seg int := floor(random() * 30)::int; k numeric; jp numeric := 0; label text;
begin
  fid := public._v1_bar_take(p_bet);
  k := case when seg < 16 then 0 when seg < 22 then 1.5 when seg < 26 then 2 when seg < 28 then 3 when seg = 28 then 5 else 0 end;
  if seg = 29 then
    select jackpot into jp from v1_bar_pot where id = 1 for update;
    update v1_bar_pot set jackpot = public._v1_bv('jackpot_seed', 1000000) where id = 1;
    perform v1_bulletin('Джекпот бара «Классикал»', format('Держава «%s» сорвала джекпот на колесе удачи: %s ГС.', v1_fname(fid), to_char(jp, 'FM999G999G990')), jsonb_build_array(fid));
  end if;
  label := case when seg = 29 then 'ДЖЕКПОТ' when k = 0 then 'пусто' else '×' || replace(k::text, '.', ',') end;
  return public._v1_bar_pay(fid, 'wheel', round(p_bet), round(p_bet) * k + jp, jsonb_build_object('segment', seg, 'label', label, 'mult', k, 'jackpot_won', jp));
end $$;

/** Карты таро: колода 78. Угадать старший аркан (×3,4), масть (×5,3) или точный старший аркан (×70). */
create or replace function public.v1_bar_tarot(p_bet numeric, p_guess text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare fid text; c int := floor(random() * 78)::int; major text[] := array['Шут','Маг','Верховная Жрица','Императрица','Император','Иерофант','Влюблённые',
  'Колесница','Сила','Отшельник','Колесо Фортуны','Справедливость','Повешенный','Смерть','Умеренность','Дьявол','Башня','Звезда','Луна','Солнце','Суд','Мир'];
  suits text[] := array['wands','cups','swords','pentacles']; suit_ru text[] := array['Жезлов','Кубков','Мечей','Пентаклей'];
  ranks text[] := array['Туз','Двойка','Тройка','Четвёрка','Пятёрка','Шестёрка','Семёрка','Восьмёрка','Девятка','Десятка','Паж','Рыцарь','Королева','Король'];
  nm text; kind text; k numeric := 0; si int;
begin
  if not (p_guess in ('major', 'wands', 'cups', 'swords', 'pentacles') or p_guess ~ '^m([0-9]|1[0-9]|2[01])$') then raise exception 'bar_bad_value'; end if;
  fid := public._v1_bar_take(p_bet);
  if c < 22 then nm := major[c + 1]; kind := 'major';
  else si := (c - 22) / 14; nm := ranks[(c - 22) % 14 + 1] || ' ' || suit_ru[si + 1]; kind := suits[si + 1];
  end if;
  if p_guess = 'major' and kind = 'major' then k := 3.4;
  elsif p_guess = kind and kind <> 'major' then k := 5.3;
  elsif p_guess ~ '^m' and kind = 'major' and substr(p_guess, 2)::int = c then k := 70;
  end if;
  return public._v1_bar_pay(fid, 'tarot', round(p_bet), round(p_bet) * k, jsonb_build_object('card', c, 'name', nm, 'kind', kind, 'guess', p_guess, 'mult', k, 'win', k > 0));
end $$;

/** Кости: два кубика. Меньше 7 / больше 7 — ×2,3; ровно 7 — ×5,7; дубль — ×5,7. */
create or replace function public.v1_bar_dice(p_bet numeric, p_kind text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare fid text; d1 int := 1 + floor(random() * 6)::int; d2 int := 1 + floor(random() * 6)::int; s int; win boolean; k numeric;
begin
  if p_kind not in ('under', 'over', 'seven', 'double') then raise exception 'bad_side'; end if;
  fid := public._v1_bar_take(p_bet);
  s := d1 + d2;
  win := case p_kind when 'under' then s < 7 when 'over' then s > 7 when 'seven' then s = 7 else d1 = d2 end;
  k := case when not win then 0 when p_kind in ('under', 'over') then 2.3 else 5.7 end;
  return public._v1_bar_pay(fid, 'dice', round(p_bet), round(p_bet) * k, jsonb_build_object('d1', d1, 'd2', d2, 'sum', s, 'kind', p_kind, 'win', win));
end $$;

-- «21» (блекджек): одна колода на раздачу; дилер добирает до 17; блекджек платит 3:2.
create or replace function public._v1_bj_val(p_cards jsonb) returns int
language sql immutable as $$
  with c as (select (v #>> '{}')::int % 13 r from jsonb_array_elements(p_cards) v),
       s as (select sum(case when r = 0 then 11 when r >= 9 then 10 else r + 1 end) total, count(*) filter (where r = 0) aces from c)
  select (select case when total > 21 then
            (select total - 10 * least(aces, ceil((total - 21) / 10.0)::int)) else total end)::int from s
$$;

create or replace function public._v1_bj_view(p_game uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', g.id, 'bet', g.bet, 'status', g.status, 'doubled', g.doubled, 'result', g.result, 'payout', g.payout,
    'player', g.player, 'player_val', public._v1_bj_val(g.player),
    'dealer', case when g.status = 'play' then jsonb_build_array(g.dealer->0) else g.dealer end,
    'dealer_val', case when g.status = 'play' then public._v1_bj_val(jsonb_build_array(g.dealer->0)) else public._v1_bj_val(g.dealer) end)
  from v1_bar_bj g where g.id = p_game
$$;

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
  v := public._v1_bar_pay(g.fid, 'blackjack', g.bet, round(g.bet * k), jsonb_build_object('result', res));
  return public._v1_bj_view(g.id) || jsonb_build_object('gc', v->'gc', 'jackpot', v->'jackpot', 'net', v->'net');
end $$;

create or replace function public.v1_bar_bj_start(p_bet numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_fid text; deck jsonb; gid uuid; pv int; dv int;
begin
  if exists (select 1 from v1_bar_bj g where g.fid = v1_my_faction() and g.status = 'play') then raise exception 'bj_active'; end if;
  v_fid := public._v1_bar_take(p_bet);
  select jsonb_agg(c order by random()) into deck from generate_series(0, 51) c;
  insert into v1_bar_bj(fid, bet, deck, player, dealer)
  values (v_fid, round(p_bet), deck - 0 - 0 - 0 - 0, jsonb_build_array(deck->0, deck->2), jsonb_build_array(deck->1, deck->3)) returning id into gid;
  pv := public._v1_bj_val(jsonb_build_array(deck->0, deck->2)); dv := public._v1_bj_val(jsonb_build_array(deck->1, deck->3));
  if pv = 21 then return public._v1_bj_finish(gid, case when dv = 21 then 'push' else 'blackjack' end); end if;
  return public._v1_bj_view(gid);
end $$;

create or replace function public.v1_bar_bj_act(p_game uuid, p_act text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g v1_bar_bj; v_fid text := v1_my_faction();
begin
  select * into g from v1_bar_bj where id = p_game and fid = v_fid and status = 'play' for update;
  if g.id is null then raise exception 'bj_gone'; end if;
  if p_act = 'hit' then
    update v1_bar_bj set player = player || (deck->0), deck = deck - 0 where id = g.id;
    if public._v1_bj_val((select player from v1_bar_bj where id = g.id)) >= 21 then return public._v1_bj_finish(g.id); end if;
    return public._v1_bj_view(g.id);
  elsif p_act = 'double' then
    if jsonb_array_length(g.player) <> 2 then raise exception 'bj_double_two'; end if;
    update faction_economy set gc = gc - g.bet where faction_id = v_fid and gc >= g.bet;
    if not found then raise exception 'prod_no_money: %', g.bet::bigint; end if;
    update v1_bar_bj set player = player || (deck->0), deck = deck - 0, bet = bet * 2, doubled = true where id = g.id;
    return public._v1_bj_finish(g.id);
  elsif p_act = 'stand' then
    return public._v1_bj_finish(g.id);
  end if;
  raise exception 'bad_side';
end $$;

create or replace function public.v1_bar_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction();
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  return jsonb_build_object(
    'fid', v_fid, 'can', v1_can_manage(v_fid, 'trade') or v1_can_manage(v_fid, 'produce'),
    'gc', (select gc from faction_economy where faction_id = v_fid),
    'settings', (select value from v1_settings where key = 'bar'),
    'jackpot', (select jackpot from v1_bar_pot where id = 1),
    'bj', (select public._v1_bj_view(id) from v1_bar_bj where fid = v_fid and status = 'play' limit 1),
    'mine', (select coalesce(jsonb_agg(jsonb_build_object('game', l.game, 'bet', l.bet, 'payout', l.payout, 'at', l.created_at) order by l.id desc), '[]'::jsonb)
             from (select * from v1_bar_log where fid = v_fid order by id desc limit 20) l),
    'today', (select jsonb_build_object('bets', coalesce(sum(bet), 0), 'payout', coalesce(sum(payout), 0), 'games', count(*))
              from v1_bar_log where fid = v_fid and created_at > date_trunc('day', now())),
    'wins', (select coalesce(jsonb_agg(jsonb_build_object('who', v1_fname(l.fid), 'game', l.game, 'payout', l.payout, 'at', l.created_at) order by l.payout desc), '[]'::jsonb)
             from (select * from v1_bar_log where created_at > now() - interval '1 day' and payout >= bet * 3 order by payout desc limit 8) l));
end $$;

-- ════════ 8. Права ════════
alter table public.v1_battles drop constraint if exists v1_battles_kind_check;
alter table public.v1_battles add constraint v1_battles_kind_check check (kind in ('war', 'intercept', 'arena', 'test', 'ground'));
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('_v1_av', '_v1_arena_design', '_v1_arena_roster', '_v1_arena_bot_roster', '_v1_arena_battle', '_v1_arena_me', '_v1_arena_settle',
                                '_v1_battle_do', '_v1_reach_cells', '_v1_can_hit', '_v1_bot_turn', '_v1_battle_advance', '_v1_battle_outcome',
                                '_v1_bv', '_v1_bar_take', '_v1_bar_pay', '_v1_bj_val', '_v1_bj_view', '_v1_bj_finish') loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
  for f in select p.oid::regprocedure sig from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('v1_arena_fight_bot', 'v1_arena_challenge', 'v1_arena_answer', 'v1_arena_bet', 'v1_arena_state', 'v1_battle_act',
                                'v1_bar_roulette', 'v1_bar_wheel', 'v1_bar_tarot', 'v1_bar_dice', 'v1_bar_bj_start', 'v1_bar_bj_act', 'v1_bar_state') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;
