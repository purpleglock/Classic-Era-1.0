-- Классическая эра 1.0 · Торговые корабли и караваны.
--
-- ТОРГОВЫЕ КОРАБЛИ. Список задаёт команда проекта в админке (settings.trade.ships) — из общедоступных
-- проектов реестра и проектов конструктора. Эти проекты может строить любая держава на своих верфях.
-- Караваном считается флот, в котором ТОЛЬКО торговые корабли; другие корабли груз не возят.
-- Вместимость = сумма «груза» кораблей (из проекта; если в проекте нет — по размеру корабля).
--
-- СДЕЛКА. Продавец предлагает покупателю: ресурс, количество, цена за всё, система доставки
-- (одна из систем покупателя). Покупатель соглашается — его деньги уходят в залог.
-- Продавец грузит товар в караван и отправляет его (можно с флотом сопровождения — он летит
-- тем же графиком). Караван летит по гиперлиниям как обычный флот и тратит запас хода.
-- Прибытие в систему доставки: товар — покупателю, залог — продавцу, караван сам летит домой.
-- ПЕРЕХВАТ: флот противника (война) в стойке «Оборона» останавливает караван на пролёте.
-- Если рядом есть свой боевой флот — начинается бой; если нет — груз достаётся перехватчику,
-- сделка сорвана, залог возвращается покупателю. Караван в чужой системе ничего не оккупирует.

set lock_timeout = '15s';

alter table public.v1_fleet_meta add column if not exists cargo jsonb;
alter table public.v1_fleet_meta add column if not exists deal_id uuid;

create table if not exists public.v1_trade_deals (
  id uuid primary key default gen_random_uuid(),
  seller_fid text not null, buyer_fid text not null,
  res text not null, qty numeric not null check (qty > 0), price numeric not null check (price >= 0),
  to_sys text not null,
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'loaded', 'done', 'declined', 'cancelled', 'lost')),
  fleet_id uuid,
  note text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists v1_trade_deals_s on public.v1_trade_deals(seller_fid, status);
create index if not exists v1_trade_deals_b on public.v1_trade_deals(buyer_fid, status);
alter table public.v1_trade_deals enable row level security;
revoke all on public.v1_trade_deals from anon, authenticated;

insert into public.v1_settings(key, value) values ('trade', '{
  "ships": [], "cargo_by_size": {"S": 200, "M": 600, "L": 1500, "XL": 4000}, "max_deals": 10
}') on conflict (key) do nothing;

-- ════════ 1. Торговые проекты ════════
/** Проект торгового корабля из списка команды проекта, в виде, удобном верфи. */
create or replace function public._v1_trade_design(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e jsonb; s v1_ships; u faction_units; cfg jsonb := coalesce((select value from v1_settings where key = 'trade'), '{}'::jsonb); sz text; cls text;
begin
  select value into e from jsonb_array_elements(coalesce(cfg->'ships', '[]'::jsonb)) where value->>'id' = p_id::text limit 1;
  if e is null then return null; end if;
  if coalesce(e->>'src', 'v1') = 'v1' then
    select * into s from v1_ships where id = p_id;
    if s.id is null then return null; end if;
    return jsonb_build_object('id', s.id, 'src', 'v1', 'name', s.name, 'class', s.class,
      'stats', s.stats || jsonb_build_object('registrable', true, 'cargo', coalesce((s.stats->>'cargo')::numeric, (cfg->'cargo_by_size'->>coalesce(s.stats->>'size', 'M'))::numeric, 600)));
  end if;
  select * into u from faction_units where id = p_id and faction_id is null and category = 'ship';
  if u.id is null then return null; end if;
  cls := coalesce(u.summary->>'className', 'Грузовой корабль');
  sz := case when cls ~* 'корвет|катер|малый|лёгк' then 'S' when cls ~* 'линкор|тяжёл|дредноут|носитель' then 'XL' when cls ~* 'крейсер|крупн' then 'L' else 'M' end;
  return jsonb_build_object('id', u.id, 'src', 'unit', 'name', u.name, 'class', cls,
    'stats', jsonb_build_object('class_name', cls, 'size', sz, 'registrable', true,
      'cost', coalesce((u.summary->>'cost')::numeric, 0), 'bill', coalesce(u.summary->'bill', '{}'::jsonb),
      'hp', coalesce((u.summary->>'hp')::numeric, 1000), 'damage', coalesce((u.summary->>'dmg')::numeric, 0),
      'speed', coalesce((u.summary->>'speed')::numeric, 4), 'radar', coalesce((u.summary->>'radar')::numeric, 3),
      'shield', coalesce((u.summary->>'shield')::numeric, 0), 'jumps', 8,
      'cargo', coalesce((u.summary->>'cargo')::numeric, (cfg->'cargo_by_size'->>sz)::numeric, 600)));
end $$;

create or replace function public.v1_trade_designs() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(d) filter (where d is not null), '[]'::jsonb)
    from (select public._v1_trade_design((e->>'id')::uuid) d
            from v1_settings s, jsonb_array_elements(coalesce(s.value->'ships', '[]'::jsonb)) e where s.key = 'trade') z
$$;

/** Для команды проекта: из чего выбирать торговые корабли. */
create or replace function public.v1_trade_ship_candidates() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.v1_is_staff() then raise exception 'not_staff'; end if;
  return jsonb_build_object(
    'chosen', coalesce((select value->'ships' from v1_settings where key = 'trade'), '[]'::jsonb),
    'public', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'src', 'unit', 'name', u.name, 'class', u.summary->>'className',
                 'cargo', u.summary->'cargo', 'cost', u.summary->'cost') order by u.name), '[]'::jsonb)
               from faction_units u where u.faction_id is null and u.category = 'ship'),
    'designs', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'src', 'v1', 'name', s.name, 'class', s.stats->>'class_name',
                 'faction', v1_fname(s.faction_id), 'cargo', s.stats->'cargo', 'cost', s.stats->'cost', 'ok', coalesce((s.stats->>'registrable')::boolean, false)) order by s.updated_at desc), '[]'::jsonb)
                from v1_ships s));
end $$;

-- ════════ 2. Верфь: свои проекты и торговые ════════
create or replace function public.v1_production_order(p_ship uuid, p_qty int, p_system text, p_fleet uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_fid text := v1_my_faction();
  cfg jsonb := coalesce((select value from v1_settings where key = 'fleet'), '{}'::jsonb);
  dsg jsonb; st jsonb; sz text; w numeric; cap numeric; hours numeric;
  eco faction_economy; stock jsonb; spent jsonb := '{}'::jsonb; k text; v jsonb; need numeric; have numeric; short numeric;
  market numeric := 0; price numeric; cost numeric; start_at timestamptz; ready timestamptz; oid uuid;
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(v_fid, 'produce') then raise exception 'forbidden'; end if;
  if p_qty is null or p_qty < 1 or p_qty > coalesce((cfg->>'max_qty')::int, 50) then raise exception 'prod_qty'; end if;
  select jsonb_build_object('id', s.id, 'name', s.name, 'class', s.class, 'stats', s.stats) into dsg from v1_ships s where s.id = p_ship and s.faction_id = v_fid;
  if dsg is null then dsg := public._v1_trade_design(p_ship); end if;
  if dsg is null then raise exception 'ship_not_found'; end if;
  st := dsg->'stats';
  if not coalesce((st->>'registrable')::boolean, false) then raise exception 'prod_design_broken'; end if;
  if not exists (select 1 from v1_shipyards(v_fid) y where y.system_id = p_system and y.slots > 0) then raise exception 'prod_no_shipyard'; end if;
  if p_fleet is not null and not exists (select 1 from fleets where id = p_fleet and faction_id = v_fid) then raise exception 'fleet_not_found'; end if;

  sz := coalesce(st->>'size', 'M');
  w := coalesce((cfg->'weight'->>sz)::numeric, 2);
  select coalesce(sum(slots), 0) into cap from v1_shipyards(v_fid);
  hours := greatest(1, w * p_qty * 24 / greatest(cap, 1));

  select * into eco from faction_economy where faction_id = v_fid for update;
  stock := coalesce(eco.resources, '{}'::jsonb);
  for k, v in select * from jsonb_each(coalesce(st->'bill', '{}'::jsonb)) loop
    need := ceil((v #>> '{}')::numeric * p_qty);
    have := greatest(0, coalesce((stock->>k)::numeric, 0));
    short := greatest(0, need - have);
    if need - short > 0 then
      stock := jsonb_set(stock, array[k], to_jsonb(have - (need - short)));
      spent := spent || jsonb_build_object(k, need - short);
    end if;
    if short > 0 then
      price := coalesce(public._v1_price(k), (select m.base_price from market_resources m where m.name = k), 10);
      market := market + short * price * coalesce((cfg->>'market_k')::numeric, 1.5);
    end if;
  end loop;
  cost := coalesce((st->>'cost')::numeric, 0) * p_qty;
  market := round(market);
  if coalesce(eco.gc, 0) < cost + market then raise exception 'prod_no_money: %', round(cost + market); end if;
  update faction_economy set gc = gc - cost - market, resources = stock where faction_id = v_fid;

  select greatest(now(), coalesce(max(ready_at), now())) into start_at from v1_production where faction_id = v_fid and status = 'queued';
  ready := start_at + make_interval(secs => hours * 3600);
  insert into v1_production(faction_id, owner_id, ship_id, name, class, size, qty, weight, system_id, fleet_id, cost_gc, market_gc, res_spent, stats, started_at, ready_at)
  values (v_fid, auth.uid(), (dsg->>'id')::uuid, dsg->>'name', dsg->>'class', sz, p_qty, w * p_qty, p_system, p_fleet, cost, market, spent, st, start_at, ready)
  returning id into oid;
  return jsonb_build_object('id', oid, 'cost', cost, 'market', market, 'ready_at', ready, 'hours', round(hours, 1));
end $$;

-- ════════ 3. Караван: флот только из торговых кораблей ════════
create or replace function public._v1_trade_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg((e->>'id')::uuid), '{}') from v1_settings s, jsonb_array_elements(coalesce(s.value->'ships', '[]'::jsonb)) e where s.key = 'trade'
$$;
create or replace function public._v1_is_caravan(p_fleet uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from v1_fleet_ships where fleet_id = p_fleet and qty > 0)
     and not exists (select 1 from v1_fleet_ships where fleet_id = p_fleet and qty > 0 and not (ship_id = any(public._v1_trade_ids())))
     and not exists (select 1 from fleets f, jsonb_array_elements(coalesce(f.composition, '[]'::jsonb)) e where f.id = p_fleet and coalesce((e->>'qty')::int, 0) > 0)
$$;
create or replace function public._v1_cargo_cap(p_fleet uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(x.qty * coalesce((x.stats->>'cargo')::numeric,
           (select (value->'cargo_by_size'->>coalesce(x.size, 'M'))::numeric from v1_settings where key = 'trade'), 600)), 0)
    from v1_fleet_ships x where x.fleet_id = p_fleet
$$;

/** Полёт без проверки прав (для своих функций): путь по гиперлиниям, запас хода, график. */
create or replace function public._v1_fleet_go(p_fleet uuid, p_dest text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f fleets; m v1_fleet_meta; pr jsonb; r record; k numeric; t timestamptz := now(); sched jsonb; i int; h numeric;
begin
  select * into f from fleets where id = p_fleet for update;
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

create or replace function public.v1_fleet_send(p_fleet uuid, p_dest text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f fleets := public._v1_fleet_mine(p_fleet);
begin
  return public._v1_fleet_go(f.id, p_dest);
end $$;

-- ════════ 4. Сделки ════════
create or replace function public._v1_trade_me() returns text
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction();
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  if not (v1_can_manage(v_fid, 'trade') or v1_can_manage(v_fid, 'produce')) then raise exception 'forbidden'; end if;
  return v_fid;
end $$;
create or replace function public._v1_tlog(p_fid text, p_title text, p_body text) returns void
language sql security definer set search_path = public as $$
  insert into v1_trade_log(faction_id, title, body) values (p_fid, left(p_title, 200), p_body)
$$;

create or replace function public.v1_deal_propose(p_buyer text, p_res text, p_qty numeric, p_price numeric, p_to_sys text, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_fid text := public._v1_trade_me(); did uuid; q numeric := floor(coalesce(p_qty, 0));
begin
  if p_buyer is null or p_buyer = v_fid or not exists (select 1 from faction_economy where faction_id = p_buyer) then raise exception 'bad_target'; end if;
  if not exists (select 1 from v1_market where name = p_res) then raise exception 'bad_resource'; end if;
  if q < 1 or coalesce(p_price, -1) < 0 then raise exception 'bad_qty: %', 1000000; end if;
  if v1_at_war(v_fid, p_buyer) then raise exception 'deal_at_war'; end if;
  if not (exists (select 1 from map_systems where id = p_to_sys and faction = p_buyer) or exists (select 1 from colonies where system_id = p_to_sys and faction_id = p_buyer)) then
    raise exception 'deal_bad_system';
  end if;
  if (select count(*) from v1_trade_deals where seller_fid = v_fid and status in ('proposed', 'accepted', 'loaded'))
     >= coalesce((select (value->>'max_deals')::int from v1_settings where key = 'trade'), 10) then raise exception 'deal_limit'; end if;
  insert into v1_trade_deals(seller_fid, buyer_fid, res, qty, price, to_sys, note) values (v_fid, p_buyer, p_res, q, round(p_price), p_to_sys, left(nullif(btrim(coalesce(p_note, '')), ''), 200))
  returning id into did;
  perform public._v1_tlog(p_buyer, 'Предложение сделки', format('Держава «%s» предлагает %s × %s за %s ГС с доставкой в %s.', v1_fname(v_fid), p_res, q, round(p_price),
    (select name from map_systems where id = p_to_sys)));
  return did;
end $$;

create or replace function public.v1_deal_answer(p_deal uuid, p_accept boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_fid text := public._v1_trade_me(); d v1_trade_deals;
begin
  select * into d from v1_trade_deals where id = p_deal and buyer_fid = v_fid and status = 'proposed' for update;
  if d.id is null then raise exception 'deal_gone'; end if;
  if not p_accept then
    update v1_trade_deals set status = 'declined', updated_at = now() where id = d.id;
    perform public._v1_tlog(d.seller_fid, 'Сделка отклонена', format('Держава «%s» отказалась: %s × %s.', v1_fname(v_fid), d.res, d.qty));
    return true;
  end if;
  update faction_economy set gc = gc - d.price where faction_id = v_fid and gc >= d.price;
  if not found then raise exception 'prod_no_money: %', d.price::bigint; end if;
  update v1_trade_deals set status = 'accepted', updated_at = now() where id = d.id;
  perform public._v1_tlog(d.seller_fid, 'Сделка принята', format('Держава «%s» внесла залог %s ГС: %s × %s. Отправьте караван.', v1_fname(v_fid), d.price, d.res, d.qty));
  return true;
end $$;

create or replace function public.v1_deal_cancel(p_deal uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_fid text := public._v1_trade_me(); d v1_trade_deals;
begin
  select * into d from v1_trade_deals where id = p_deal and v_fid in (seller_fid, buyer_fid) and status in ('proposed', 'accepted') for update;
  if d.id is null then raise exception 'deal_gone'; end if;
  if d.status = 'accepted' then update faction_economy set gc = gc + d.price where faction_id = d.buyer_fid; end if;
  update v1_trade_deals set status = 'cancelled', updated_at = now() where id = d.id;
  perform public._v1_tlog(case when v_fid = d.seller_fid then d.buyer_fid else d.seller_fid end, 'Сделка отменена',
    format('Держава «%s» отменила сделку: %s × %s.%s', v1_fname(v_fid), d.res, d.qty, case when d.status = 'accepted' then ' Залог возвращён покупателю.' else '' end));
  return true;
end $$;

/** Погрузить товар и отправить караван (можно с флотом сопровождения из той же системы). */
create or replace function public.v1_caravan_send(p_deal uuid, p_fleet uuid, p_escort uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_fid text := public._v1_trade_me(); d v1_trade_deals; f fleets; e fleets; r jsonb; re jsonb;
begin
  select * into d from v1_trade_deals where id = p_deal and seller_fid = v_fid and status = 'accepted' for update;
  if d.id is null then raise exception 'deal_gone'; end if;
  select * into f from fleets where id = p_fleet and faction_id = v_fid for update;
  if f.id is null then raise exception 'fleet_not_found'; end if;
  if not public._v1_is_caravan(f.id) then raise exception 'caravan_only_trade'; end if;
  perform public._v1_fleet_meta(f.id);
  if (select cargo from v1_fleet_meta where fleet_id = f.id) is not null then raise exception 'caravan_loaded'; end if;
  if public._v1_cargo_cap(f.id) < d.qty then raise exception 'caravan_small: %', floor(public._v1_cargo_cap(f.id)); end if;
  if coalesce((select (resources->>d.res)::numeric from faction_economy where faction_id = v_fid), 0) < d.qty then raise exception 'not_enough_res'; end if;
  if p_escort is not null then
    select * into e from fleets where id = p_escort and faction_id = v_fid;
    if e.id is null or e.system_id is distinct from f.system_id or e.status <> 'idle' then raise exception 'escort_same_system'; end if;
    if public._v1_is_caravan(e.id) then raise exception 'escort_is_caravan'; end if;
  end if;
  r := public._v1_fleet_go(f.id, d.to_sys);          -- проверит путь и запас хода до погрузки
  if p_escort is not null then
    re := public._v1_fleet_go(e.id, d.to_sys);
    -- сопровождение и караван идут одним графиком — по самому медленному
    update fleets x set route_at = y.route_at, arrive_at = y.arrive_at
      from (select route_at, arrive_at from fleets where id in (f.id, e.id) order by arrive_at desc limit 1) y
     where x.id in (f.id, e.id);
  end if;
  perform public._v1_stock_add(v_fid, d.res, -d.qty);
  update v1_fleet_meta set cargo = jsonb_build_object('res', d.res, 'qty', d.qty, 'deal', d.id), deal_id = d.id, updated_at = now() where fleet_id = f.id;
  update v1_trade_deals set status = 'loaded', fleet_id = f.id, updated_at = now() where id = d.id;
  perform public._v1_tlog(d.buyer_fid, 'Караван в пути', format('Держава «%s» отправила %s × %s, в пути ~%s ч.', v1_fname(v_fid), d.res, d.qty,
    round(extract(epoch from (select arrive_at from fleets where id = f.id) - now()) / 3600, 1)));
  return jsonb_build_object('arrive_at', (select arrive_at from fleets where id = f.id), 'escort', p_escort is not null);
end $$;

-- ════════ 5. Прибытие: доставка, перехват, бой, оккупация ════════
create or replace function public._v1_fleet_after_land(p_fleet uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare f fleets; foes uuid[]; mine uuid[]; b uuid; m v1_fleet_meta; d v1_trade_deals; caravan boolean; robber text; escort boolean;
begin
  select * into f from fleets where id = p_fleet;
  if f.system_id is null or not public._v1_fleet_has_ships(f.id) then return null; end if;
  select * into m from v1_fleet_meta where fleet_id = f.id;
  caravan := public._v1_is_caravan(f.id);
  select coalesce(array_agg(x.id), '{}') into foes from fleets x
   where x.system_id = f.system_id and x.status = 'idle' and x.faction_id <> f.faction_id and v1_at_war(x.faction_id, f.faction_id)
     and public._v1_fleet_busy(x.id) is null and public._v1_fleet_has_ships(x.id) and not public._v1_is_caravan(x.id);

  if array_length(foes, 1) > 0 then
    select coalesce(array_agg(x.id), '{}') into mine from fleets x
     where x.system_id = f.system_id and x.status = 'idle' and x.faction_id = f.faction_id
       and public._v1_fleet_busy(x.id) is null and public._v1_fleet_has_ships(x.id);
    escort := exists (select 1 from unnest(mine) z where not public._v1_is_caravan(z));
    if caravan and not escort then
      -- беззащитный караван: груз достаётся перехватчику
      if m.cargo is not null then
        select faction_id into robber from fleets where id = foes[1];
        perform public._v1_stock_add(robber, m.cargo->>'res', (m.cargo->>'qty')::numeric);
        select * into d from v1_trade_deals where id = m.deal_id for update;
        if d.id is not null and d.status = 'loaded' then
          update faction_economy set gc = gc + d.price where faction_id = d.buyer_fid;
          update v1_trade_deals set status = 'lost', updated_at = now() where id = d.id;
          perform public._v1_tlog(d.buyer_fid, 'Караван перехвачен', format('Груз %s × %s захвачен державой «%s». Залог возвращён.', d.res, d.qty, v1_fname(robber)));
        end if;
        perform public._v1_tlog(f.faction_id, 'Караван перехвачен', format('В системе %s флот «%s» забрал груз %s × %s.',
          (select name from map_systems where id = f.system_id), v1_fname(robber), m.cargo->>'res', m.cargo->>'qty'));
        perform public._v1_tlog(robber, 'Захвачен караван', format('Наш флот в системе %s перехватил караван державы «%s»: %s × %s.',
          (select name from map_systems where id = f.system_id), v1_fname(f.faction_id), m.cargo->>'res', m.cargo->>'qty'));
        perform v1_bulletin('Перехвачен караван', format('В системе %s флот державы «%s» перехватил караван державы «%s».',
          (select name from map_systems where id = f.system_id), v1_fname(robber), v1_fname(f.faction_id)), jsonb_build_array(robber, f.faction_id));
        update v1_fleet_meta set cargo = null, deal_id = null where fleet_id = f.id;
      end if;
      return null;
    end if;
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

  -- доставка груза
  if m.cargo is not null and m.deal_id is not null then
    select * into d from v1_trade_deals where id = m.deal_id for update;
    if d.id is not null and d.status = 'loaded' and d.to_sys = f.system_id then
      perform public._v1_stock_add(d.buyer_fid, d.res, d.qty);
      update faction_economy set gc = gc + d.price where faction_id = d.seller_fid;
      update v1_trade_deals set status = 'done', updated_at = now() where id = d.id;
      update v1_fleet_meta set cargo = null, deal_id = null where fleet_id = f.id;
      perform public._v1_tlog(d.buyer_fid, 'Груз доставлен', format('%s × %s от державы «%s» на складе.', d.res, d.qty, v1_fname(d.seller_fid)));
      perform public._v1_tlog(d.seller_fid, 'Сделка закрыта', format('Груз %s × %s доставлен, получено %s ГС. Караван возвращается.', d.res, d.qty, d.price));
      begin perform public._v1_fleet_go(f.id, f.home_sys); exception when others then null; end;
      return null;
    end if;
  end if;
  if not caravan then perform public._v1_occupy_check(f.faction_id, f.system_id, f.id); end if;
  return null;
end $$;

-- ════════ 6. Состояние раздела «Торговля» ════════
create or replace function public.v1_trade_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction();
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  return jsonb_build_object(
    'fid', v_fid, 'can', v1_can_manage(v_fid, 'trade') or v1_can_manage(v_fid, 'produce'),
    'live', public._v1_econ_live(), 'settings', public._v1_econ_cfg(),
    'gc', (select gc from faction_economy where faction_id = v_fid),
    'stock', (select coalesce(resources, '{}'::jsonb) from faction_economy where faction_id = v_fid),
    'cap', public._v1_store_cap(v_fid),
    'market', (select coalesce(jsonb_agg(jsonb_build_object('name', m.name, 'price', public._v1_price(m.name), 'base', m.base, 'rarity', public._v1_rar(m.name),
                 'v1', m.price, 'hist', (select coalesce(jsonb_agg(h.price order by h.day), '[]'::jsonb) from v1_market_history h where h.name = m.name and h.day > current_date - 14))
                 order by public._v1_price(m.name) desc), '[]'::jsonb) from v1_market m),
    'lots', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'side', x.side, 'res', x.res, 'qty', x.qty, 'left', x.qty_left, 'price', x.price,
               'mine', x.faction_id = v_fid, 'owner', v1_fname(x.faction_id), 'expires', x.expires_at) order by x.res, x.price), '[]'::jsonb)
             from v1_exchange x where x.status = 'open' and x.expires_at > now()),
    'deals', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'role', case when d.seller_fid = v_fid then 'seller' else 'buyer' end,
               'partner', v1_fname(case when d.seller_fid = v_fid then d.buyer_fid else d.seller_fid end), 'res', d.res, 'qty', d.qty, 'price', d.price,
               'to', (select name from map_systems where id = d.to_sys), 'status', d.status, 'note', d.note, 'fleet', (select name from fleets where id = d.fleet_id),
               'arrive_at', (select arrive_at from fleets where id = d.fleet_id and status = 'v1_transit'), 'at', d.updated_at) order by d.updated_at desc), '[]'::jsonb)
              from (select * from v1_trade_deals where v_fid in (seller_fid, buyer_fid) order by updated_at desc limit 40) d),
    'caravans', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'system_id', f.system_id, 'system', (select name from map_systems where id = f.system_id),
                  'status', f.status, 'dest', (select name from map_systems where id = f.dest_sys), 'arrive_at', f.arrive_at,
                  'cap', public._v1_cargo_cap(f.id), 'cargo', m.cargo, 'fuel', m.fuel, 'fuel_cap', m.fuel_cap,
                  'busy', public._v1_fleet_busy(f.id) is not null) order by f.name), '[]'::jsonb)
                 from fleets f left join v1_fleet_meta m on m.fleet_id = f.id where f.faction_id = v_fid and public._v1_is_caravan(f.id)),
    'escorts', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'system_id', f.system_id)), '[]'::jsonb)
                from fleets f where f.faction_id = v_fid and f.status = 'idle' and f.system_id is not null and not coalesce(f.is_station, false)
                  and public._v1_fleet_has_ships(f.id) and not public._v1_is_caravan(f.id)),
    'designs', public.v1_trade_designs(),
    'factions', (select coalesce(jsonb_agg(jsonb_build_object('id', fe.faction_id, 'name', v1_fname(fe.faction_id), 'war', v1_at_war(v_fid, fe.faction_id),
                  'systems', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.name), '[]'::jsonb) from map_systems s
                              where s.faction = fe.faction_id or s.id in (select system_id from colonies where faction_id = fe.faction_id)))
                  order by v1_fname(fe.faction_id)), '[]'::jsonb)
                 from faction_economy fe where fe.faction_id <> v_fid and exists (select 1 from colonies c where c.faction_id = fe.faction_id)),
    'log', (select coalesce(jsonb_agg(jsonb_build_object('title', l.title, 'body', l.body, 'at', l.created_at) order by l.id desc), '[]'::jsonb)
            from (select * from v1_trade_log where faction_id = v_fid order by id desc limit 40) l));
end $$;

-- ════════ 7. Права ════════
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('_v1_trade_design', '_v1_trade_ids', '_v1_is_caravan', '_v1_cargo_cap', '_v1_fleet_go', '_v1_trade_me', '_v1_tlog', '_v1_fleet_after_land') loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
  for f in select p.oid::regprocedure sig from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('v1_trade_designs', 'v1_trade_ship_candidates', 'v1_production_order', 'v1_fleet_send', 'v1_deal_propose', 'v1_deal_answer',
                                'v1_deal_cancel', 'v1_caravan_send', 'v1_trade_state') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;
