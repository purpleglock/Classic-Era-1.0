-- Классическая эра 1.0 · Флот и войска на новом движке (первая версия).
--
-- Производство: держава заказывает корабли по своим проектам из нового
-- конструктора кораблей (v1_ships) на верфях своих колоний. Деньги — цена
-- проекта × количество; сырьё — ведомость проекта, недостающее докупается
-- по рыночной цене ×1,5. Скорость — слоты верфей державы: слот строит за
-- сутки корабль размера S; M «весит» 2, L — 4, XL — 8.
-- Готовые корабли приходят в выбранный флот или в «Резерв верфи» системы.
--
-- Корабли нового образца хранятся отдельно от старого состава флота
-- (fleets.composition): v1_fleet_ships, со снимком характеристик на момент
-- постройки. Старый сайт их не видит и не ломается. Движение флотов, бой и
-- армии — следующими шагами (новые карты сражений).

set lock_timeout = '15s';

create table if not exists public.v1_fleet_ships (
  id          uuid primary key default gen_random_uuid(),
  fleet_id    uuid not null references public.fleets(id) on delete cascade,
  faction_id  text not null,
  ship_id     uuid not null,                 -- проект v1_ships (снимок ниже живёт и без него)
  name        text not null,
  class       text not null,
  size        text not null,
  qty         int not null check (qty > 0),
  stats       jsonb not null,                -- снимок характеристик на момент постройки
  created_at  timestamptz not null default now(),
  unique (fleet_id, ship_id)
);
create index if not exists v1_fleet_ships_fid on public.v1_fleet_ships(faction_id);
alter table public.v1_fleet_ships enable row level security;
revoke all on public.v1_fleet_ships from anon, authenticated;

create table if not exists public.v1_production (
  id          uuid primary key default gen_random_uuid(),
  faction_id  text not null,
  owner_id    uuid references auth.users(id) on delete set null,
  ship_id     uuid not null,
  name        text not null,
  class       text not null,
  size        text not null,
  qty         int not null check (qty between 1 and 50),
  weight      numeric not null,
  system_id   text not null,
  fleet_id    uuid references public.fleets(id) on delete set null,
  cost_gc     numeric not null,
  market_gc   numeric not null default 0,
  res_spent   jsonb not null default '{}'::jsonb,
  stats       jsonb not null,
  status      text not null default 'queued' check (status in ('queued', 'done', 'cancelled')),
  started_at  timestamptz not null default now(),
  ready_at    timestamptz not null,
  done_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists v1_production_q on public.v1_production(faction_id, status, ready_at);
alter table public.v1_production enable row level security;
revoke all on public.v1_production from anon, authenticated;

insert into public.v1_settings(key, value) values
  ('fleet', '{"weight": {"S": 1, "M": 2, "L": 4, "XL": 8}, "market_k": 1.5, "max_qty": 50, "reserve_name": "Резерв верфи"}')
on conflict (key) do nothing;

-- Слоты верфей державы по системам
create or replace function public.v1_shipyards(p_fid text) returns table(system_id text, system_name text, colonies int, slots int)
language sql stable security definer set search_path = public as $$
  select c.system_id, max(s.name), count(distinct c.id)::int, coalesce(sum(b.slots_open), 0)::int
    from colony_buildings b join colonies c on c.id = b.colony_id
    left join map_systems s on s.id = c.system_id
   where b.faction_id = p_fid and b.btype = 'shipyard'
   group by c.system_id;
$$;
revoke execute on function public.v1_shipyards(text) from public, anon, authenticated;

-- ════════ Состояние раздела «Флот и войска» ════════
create or replace function public.v1_fleet_state() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_fid text := v1_my_faction(); cfg jsonb := coalesce((select value from v1_settings where key = 'fleet'), '{}'::jsonb);
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  return jsonb_build_object(
    'can_edit', v1_can_manage(v_fid, 'produce'),
    'settings', cfg,
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
        'id', f.id, 'name', f.name, 'status', f.status, 'system_id', f.system_id, 'system', ms.name,
        'is_station', f.is_station, 'fuel', f.fuel, 'fuel_cap', f.fuel_cap,
        'legacy', (select coalesce(jsonb_agg(jsonb_build_object('unit_id', e->>'unit_id', 'name', coalesce(e->>'unit_name', u.name), 'qty', (e->>'qty')::int,
                    'class', u.summary->>'className', 'hp', u.summary->'hp', 'damage', u.summary->'dmg', 'speed', u.summary->'speed')), '[]'::jsonb)
                   from jsonb_array_elements(f.composition) e left join faction_units u on u.id::text = e->>'unit_id'),
        'ships', (select coalesce(jsonb_agg(jsonb_build_object('ship_id', x.ship_id, 'name', x.name, 'class', x.class, 'class_name', x.stats->>'class_name', 'size', x.size, 'qty', x.qty,
                    'hp', x.stats->'hp', 'damage', x.stats->'damage', 'speed', x.stats->'speed', 'jumps', x.stats->'jumps', 'shield', x.stats->'shield') order by x.created_at), '[]'::jsonb)
                   from v1_fleet_ships x where x.fleet_id = f.id),
        'in_battle', exists (select 1 from battle_fleets bf join battles b on b.id = bf.battle_id where bf.fleet_id = f.id and b.status = 'active')
      ) order by f.created_at), '[]'::jsonb)
      from fleets f left join map_systems ms on ms.id = f.system_id where f.faction_id = v_fid),
    'queue', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'class', p.class, 'size', p.size, 'qty', p.qty,
        'system', ms.name, 'fleet', fl.name, 'cost', p.cost_gc + p.market_gc, 'started_at', p.started_at, 'ready_at', p.ready_at) order by p.ready_at), '[]'::jsonb)
      from v1_production p left join map_systems ms on ms.id = p.system_id left join fleets fl on fl.id = p.fleet_id
      where p.faction_id = v_fid and p.status = 'queued'),
    'done', (select coalesce(jsonb_agg(z), '[]'::jsonb) from (select jsonb_build_object('name', p.name, 'qty', p.qty, 'done_at', p.done_at) z
      from v1_production p where p.faction_id = v_fid and p.status = 'done' order by p.done_at desc limit 8) q),
    'armies', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'status', a.status, 'colony', c.planet_name, 'system', ms.name,
        'units', (select coalesce(jsonb_agg(jsonb_build_object('name', e->>'unit_name', 'qty', (e->>'qty')::int, 'category', e->>'category')), '[]'::jsonb)
                  from jsonb_array_elements(coalesce(a.composition, '[]'::jsonb)) e)) order by a.created_at), '[]'::jsonb)
      from armies a left join colonies c on c.id = a.colony_id left join map_systems ms on ms.id = c.system_id where a.faction_id = v_fid));
end $$;
grant execute on function public.v1_fleet_state() to authenticated;

-- ════════ Заказ на верфи ════════
create or replace function public.v1_production_order(p_ship uuid, p_qty int, p_system text, p_fleet uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_fid text := v1_my_faction();
  cfg jsonb := coalesce((select value from v1_settings where key = 'fleet'), '{}'::jsonb);
  sh v1_ships; st jsonb; sz text; w numeric; cap numeric; hours numeric;
  eco faction_economy; stock jsonb; spent jsonb := '{}'::jsonb; k text; v jsonb; need numeric; have numeric; short numeric;
  market numeric := 0; price numeric; cost numeric; start_at timestamptz; ready timestamptz; oid uuid;
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(v_fid, 'produce') then raise exception 'forbidden'; end if;
  if p_qty is null or p_qty < 1 or p_qty > coalesce((cfg->>'max_qty')::int, 50) then raise exception 'prod_qty'; end if;
  select * into sh from v1_ships where id = p_ship and faction_id = v_fid;
  if sh.id is null then raise exception 'ship_not_found'; end if;
  st := sh.stats;
  if not coalesce((st->>'registrable')::boolean, false) then raise exception 'prod_design_broken'; end if;
  if not exists (select 1 from v1_shipyards(v_fid) y where y.system_id = p_system and y.slots > 0) then raise exception 'prod_no_shipyard'; end if;
  if p_fleet is not null and not exists (select 1 from fleets where id = p_fleet and faction_id = v_fid) then raise exception 'fleet_not_found'; end if;

  sz := coalesce(st->>'size', 'M');
  w := coalesce((cfg->'weight'->>sz)::numeric, 2);
  select coalesce(sum(slots), 0) into cap from v1_shipyards(v_fid);
  hours := greatest(1, w * p_qty * 24 / greatest(cap, 1));

  -- сырьё: со склада, недостающее — с рынка ×1,5
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
      price := coalesce((select m.price from market_resources m where m.name = k), (select m.base_price from market_resources m where m.name = k), 10);
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
  values (v_fid, auth.uid(), sh.id, sh.name, sh.class, sz, p_qty, w * p_qty, p_system, p_fleet, cost, market, spent, st, start_at, ready)
  returning id into oid;
  return jsonb_build_object('id', oid, 'cost', cost, 'market', market, 'ready_at', ready, 'hours', round(hours, 1));
end $$;
revoke execute on function public.v1_production_order(uuid, int, text, uuid) from public, anon;
grant execute on function public.v1_production_order(uuid, int, text, uuid) to authenticated;

-- Отмена заказа: деньги и списанное сырьё возвращаются полностью; очередь за ним сдвигается.
create or replace function public.v1_production_cancel(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction(); p v1_production; k text; v jsonb; stock jsonb; shift interval;
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(v_fid, 'produce') then raise exception 'forbidden'; end if;
  select * into p from v1_production where id = p_id and faction_id = v_fid and status = 'queued' for update;
  if p.id is null then raise exception 'prod_not_found'; end if;
  select coalesce(resources, '{}'::jsonb) into stock from faction_economy where faction_id = v_fid for update;
  for k, v in select * from jsonb_each(p.res_spent) loop
    stock := jsonb_set(stock, array[k], to_jsonb(coalesce((stock->>k)::numeric, 0) + (v #>> '{}')::numeric));
  end loop;
  update faction_economy set gc = gc + p.cost_gc + p.market_gc, resources = stock where faction_id = v_fid;
  update v1_production set status = 'cancelled', done_at = now() where id = p.id;
  shift := p.ready_at - greatest(p.started_at, now());
  if shift > interval '0' then
    update v1_production set started_at = started_at - shift, ready_at = ready_at - shift
     where faction_id = v_fid and status = 'queued' and ready_at > p.ready_at;
  end if;
  return true;
end $$;
revoke execute on function public.v1_production_cancel(uuid) from public, anon;
grant execute on function public.v1_production_cancel(uuid) to authenticated;

-- ════════ Сдача готовых кораблей ════════
create or replace function public.v1_production_tick() returns int
language plpgsql security definer set search_path = public as $$
declare p v1_production; target uuid; nm text; n int := 0;
  cfg jsonb := coalesce((select value from v1_settings where key = 'fleet'), '{}'::jsonb);
begin
  for p in select * from v1_production where status = 'queued' and ready_at <= now() order by ready_at for update skip locked loop
    target := null;
    if p.fleet_id is not null then
      select id into target from fleets where id = p.fleet_id and faction_id = p.faction_id;
    end if;
    if target is null then
      nm := coalesce(cfg->>'reserve_name', 'Резерв верфи') || ' · ' || coalesce((select name from map_systems where id = p.system_id), p.system_id);
      select id into target from fleets where faction_id = p.faction_id and system_id = p.system_id and name = nm limit 1;
      if target is null then
        insert into fleets(faction_id, owner_id, name, status, system_id, home_sys, composition)
        values (p.faction_id, p.owner_id, nm, 'idle', p.system_id, p.system_id, '[]'::jsonb) returning id into target;
      end if;
    end if;
    insert into v1_fleet_ships(fleet_id, faction_id, ship_id, name, class, size, qty, stats)
    values (target, p.faction_id, p.ship_id, p.name, p.class, p.size, p.qty, p.stats)
    on conflict (fleet_id, ship_id) do update set qty = v1_fleet_ships.qty + excluded.qty, stats = excluded.stats, name = excluded.name;
    update v1_production set status = 'done', done_at = now(), fleet_id = target where id = p.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.v1_production_tick() from public, anon, authenticated;

do $$ begin
  perform cron.unschedule('v1-production-tick') where exists (select 1 from cron.job where jobname = 'v1-production-tick');
  perform cron.schedule('v1-production-tick', '*/10 * * * *', 'select public.v1_production_tick()');
end $$;

-- ════════ Управление флотами ════════
create or replace function public.v1_fleet_rename(p_fleet uuid, p_name text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction(); nm text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if v_fid is null or not v1_can_manage(v_fid, 'produce') then raise exception 'forbidden'; end if;
  if char_length(nm) < 2 or char_length(nm) > 48 then raise exception 'fleet_name'; end if;
  update fleets set name = nm where id = p_fleet and faction_id = v_fid;
  if not found then raise exception 'fleet_not_found'; end if;
  return true;
end $$;

-- Перевод кораблей нового образца между флотами одной системы (p_qty null — все).
create or replace function public.v1_fleet_transfer(p_from uuid, p_to uuid, p_ship uuid, p_qty int default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction(); a fleets; b fleets; x v1_fleet_ships; q int;
begin
  if v_fid is null or not v1_can_manage(v_fid, 'produce') then raise exception 'forbidden'; end if;
  select * into a from fleets where id = p_from and faction_id = v_fid;
  select * into b from fleets where id = p_to and faction_id = v_fid;
  if a.id is null or b.id is null or a.id = b.id then raise exception 'fleet_not_found'; end if;
  if a.system_id is distinct from b.system_id or a.status <> 'idle' or b.status <> 'idle' then raise exception 'fleet_not_together'; end if;
  if exists (select 1 from battle_fleets bf join battles bt on bt.id = bf.battle_id where bf.fleet_id in (a.id, b.id) and bt.status = 'active') then
    raise exception 'fleet_in_battle';
  end if;
  select * into x from v1_fleet_ships where fleet_id = a.id and ship_id = p_ship for update;
  if x.id is null then raise exception 'fleet_ship_missing'; end if;
  q := least(x.qty, coalesce(p_qty, x.qty));
  if q < 1 then raise exception 'prod_qty'; end if;
  insert into v1_fleet_ships(fleet_id, faction_id, ship_id, name, class, size, qty, stats)
  values (b.id, v_fid, x.ship_id, x.name, x.class, x.size, q, x.stats)
  on conflict (fleet_id, ship_id) do update set qty = v1_fleet_ships.qty + excluded.qty;
  if q = x.qty then delete from v1_fleet_ships where id = x.id; else update v1_fleet_ships set qty = qty - q where id = x.id; end if;
  return true;
end $$;

-- Новый пустой флот в системе, где у державы есть флот или верфь.
create or replace function public.v1_fleet_create(p_system text, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction(); nm text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')); fid uuid;
begin
  if v_fid is null or not v1_can_manage(v_fid, 'produce') then raise exception 'forbidden'; end if;
  if char_length(nm) < 2 or char_length(nm) > 48 then raise exception 'fleet_name'; end if;
  if not exists (select 1 from fleets where faction_id = v_fid and system_id = p_system)
     and not exists (select 1 from v1_shipyards(v_fid) y where y.system_id = p_system) then
    raise exception 'fleet_bad_system';
  end if;
  insert into fleets(faction_id, owner_id, name, status, system_id, home_sys, composition)
  values (v_fid, auth.uid(), nm, 'idle', p_system, p_system, '[]'::jsonb) returning id into fid;
  return fid;
end $$;

-- Распустить можно только пустой флот (без кораблей старого и нового образца).
create or replace function public.v1_fleet_disband(p_fleet uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction(); f fleets;
begin
  if v_fid is null or not v1_can_manage(v_fid, 'produce') then raise exception 'forbidden'; end if;
  select * into f from fleets where id = p_fleet and faction_id = v_fid;
  if f.id is null then raise exception 'fleet_not_found'; end if;
  if jsonb_array_length(coalesce(f.composition, '[]'::jsonb)) > 0 or exists (select 1 from v1_fleet_ships where fleet_id = f.id) then
    raise exception 'fleet_not_empty';
  end if;
  if exists (select 1 from v1_production where fleet_id = f.id and status = 'queued') then raise exception 'fleet_has_orders'; end if;
  delete from fleets where id = f.id;
  return true;
end $$;

revoke execute on function public.v1_fleet_rename(uuid, text), public.v1_fleet_transfer(uuid, uuid, uuid, int),
  public.v1_fleet_create(text, text), public.v1_fleet_disband(uuid) from public, anon;
grant execute on function public.v1_fleet_rename(uuid, text), public.v1_fleet_transfer(uuid, uuid, uuid, int),
  public.v1_fleet_create(text, text), public.v1_fleet_disband(uuid) to authenticated;
