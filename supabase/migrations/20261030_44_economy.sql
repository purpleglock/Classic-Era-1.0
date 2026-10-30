-- Классическая эра 1.0 · Собственный суточный тик экономики, добыча, рынок и биржа заявок.
--
-- ТИК (v1_economy_tick, каждый день в 00:09 UTC). Пока settings.economy.live = false, он работает
-- в режиме ПРОСМОТРА: считает сутки каждой державы и пишет итог в v1_econ_ledger, но ничего
-- не начисляет — деньги, склад и население ведёт старый тик. В день переезда одна миграция
-- выключает старый тик (economy-daily-tick) и ставит live = true.
--
-- Что считает тик за сутки:
--   • постройки: фабрики и торговые хабы — ГС, храмы своей веры — ГС, лаборатории — науку,
--     бюро разведки — очки агентов (1 очко = новый агент, до предела агентов);
--   • множители: курс державы, класс мира колонии (работа / наука / население),
--     порядок колонии (волнения ×0,75, восстание — 0), обеспечение товарами (×0,9…1,1);
--   • ДОБЫЧА: шахта копает выбранные залежи своей колонии.
--       выход = слоты × ставка редкости × богатство залежи × вид шахты × курс × мир × порядок,
--       делится поровну между выбранными залежами. Обычная шахта берёт обычное и необычное,
--       глубокая — ещё и редкое, экзотическая — редкое, эпическое и легендарное;
--   • куда идёт ресурс — решает держава: «на склад» или «на рынок»; у склада есть порог:
--     всё, что выше порога, продаётся. Склад имеет предел (база + склады × инфраструктура);
--     что не влезло — сбывается по дешёвке (40 % цены);
--   • фабрика товаров ест воду и сырьё под спрос населения; население растёт от соцбюджета
--     и товаров до потолка ячеек × класс мира; бюджет снимает апкип;
--   • затем — исследования (v1_research_step) и стройки (v1_projects_step).
-- РЫНОК: цена каждого ресурса тянется к базовой (10 % в сутки) и держится в пределах 50–200 %
--   базы; продажи держав давят цену вниз, покупки — вверх. Комиссия рынка 4 %.
-- БИРЖА ЗАЯВОК: держава выставляет «продам» или «куплю» с ценой; товар или деньги лежат
--   в залоге; другая держава исполняет заявку целиком или частью. Комиссия 4 % с продавца.

set lock_timeout = '15s';

-- ════════ 1. Таблицы и настройки ════════
create table if not exists public.v1_market (
  name text primary key,
  base numeric not null,
  price numeric not null,
  supply numeric not null default 0,       -- продано рынку с прошлого тика
  demand numeric not null default 0,       -- куплено у рынка с прошлого тика
  updated_at timestamptz not null default now()
);
create table if not exists public.v1_market_history (
  name text not null, day date not null, price numeric not null, supply numeric, demand numeric,
  primary key (name, day)
);
create table if not exists public.v1_res_policy (
  faction_id text not null, res text not null,
  mode text not null default 'store' check (mode in ('store', 'sell')),
  keep numeric check (keep is null or keep >= 0),
  updated_at timestamptz not null default now(),
  primary key (faction_id, res)
);
create table if not exists public.v1_econ_ledger (
  id bigserial primary key,
  faction_id text not null,
  at timestamptz not null default now(),
  days int not null,
  live boolean not null,
  data jsonb not null
);
create index if not exists v1_econ_ledger_fid on public.v1_econ_ledger(faction_id, at desc);
create table if not exists public.v1_agent_pts (faction_id text primary key, pts numeric not null default 0);
create table if not exists public.v1_exchange (
  id uuid primary key default gen_random_uuid(),
  faction_id text not null,
  side text not null check (side in ('sell', 'buy')),
  res text not null,
  qty numeric not null check (qty > 0),
  qty_left numeric not null,
  price numeric not null check (price > 0),
  status text not null default 'open' check (status in ('open', 'done', 'cancelled', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists v1_exchange_open on public.v1_exchange(status, res);
create table if not exists public.v1_trade_log (
  id bigserial primary key, faction_id text not null, title text not null, body text, created_at timestamptz not null default now()
);
create index if not exists v1_trade_log_fid on public.v1_trade_log(faction_id, id desc);

alter table public.v1_market enable row level security;
alter table public.v1_market_history enable row level security;
alter table public.v1_res_policy enable row level security;
alter table public.v1_econ_ledger enable row level security;
alter table public.v1_agent_pts enable row level security;
alter table public.v1_exchange enable row level security;
alter table public.v1_trade_log enable row level security;
revoke all on public.v1_market, public.v1_market_history, public.v1_res_policy, public.v1_econ_ledger, public.v1_agent_pts,
  public.v1_exchange, public.v1_trade_log from anon, authenticated;

-- рынок нового движка стартует от нынешних цен, сразу в пределах 50–200 % базы
insert into public.v1_market(name, base, price)
select name, coalesce(nullif(base_price, 0), 1), least(2 * coalesce(nullif(base_price, 0), 1), greatest(0.5 * coalesce(nullif(base_price, 0), 1), coalesce(price, base_price, 1)))
  from public.market_resources on conflict (name) do nothing;

insert into public.v1_settings(key, value) values ('economy', '{
  "live": false,
  "store_base": 1000, "store_per_slot": 500, "infra": [0.8, 0.9, 1, 1.15, 1.3], "robot_store": 1.5,
  "dump_k": 0.4, "fee": 0.04, "buy_k": 1.08, "trade_max": 20000, "exchange_days": 7,
  "income": {"factory": 340, "trade": 170, "temple": 185},
  "science": {"science": 1, "sci_giant": 3, "sci_anomaly": 5},
  "agent_pts": 0.1,
  "mine": {
    "base": {"common": 8, "uncommon": 4, "rare": 2, "epic": 0.8, "legendary": 0.25},
    "kind": {"mining": 1, "mining_deep": 1.4, "mining_exotic": 1.8},
    "allow": {"mining": ["common", "uncommon"], "mining_deep": ["common", "uncommon", "rare"], "mining_exotic": ["rare", "epic", "legendary"]},
    "rich": {"следы": 0.5, "мало": 0.8, "умеренно": 1, "много": 1.3, "очень много": 1.6, "колоссально": 2}
  },
  "order": {"unrest": 0.75, "rebellion": 0},
  "world": {
    "std": [1, 1, 1], "ideal": [1.15, 1.15, 1.3], "terrestrial": [1, 1, 1], "oceanic": [0.9, 1.1, 1.1], "desert": [1, 0.9, 0.9],
    "cryo": [0.9, 1, 0.85], "lava": [1.2, 0.8, 0.6], "volcanic": [1.15, 0.85, 0.7], "gasgiant": [1.1, 0.9, 0.6], "hotgiant": [1.2, 0.8, 0.5],
    "icegiant": [1.05, 0.95, 0.6], "micro": [0.8, 1, 0.7], "exotic": [1, 1.2, 0.8], "anomaly": [0.9, 1.4, 0.8], "belt": [1.25, 0.8, 0.6]
  },
  "goods": {"div": 600, "per_slot": 10, "water": 0.6, "raw": 0.4, "min": 0.9, "max": 1.1},
  "pop": {"cap": 100, "floor": 10, "growth": [-0.01, 0, 0.01, 0.02, 0.03], "goods": 0.01, "shrink": 0.02},
  "market": {"pull": 0.1, "min": 0.5, "max": 2, "k": 0.25, "npc": {"common": 3000, "uncommon": 1200, "rare": 400, "epic": 120, "legendary": 30}}
}') on conflict (key) do nothing;

-- ════════ 2. Справочные функции ════════
create or replace function public._v1_econ_cfg() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select value from v1_settings where key = 'economy'), '{}'::jsonb)
$$;
create or replace function public._v1_econ_live() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((public._v1_econ_cfg()->>'live')::boolean, false)
$$;
create or replace function public._v1_rar(p_name text, p_r text default null) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(p_r, ''), (select rarity from resource_rarity where name = p_name), 'common')
$$;
/** Цена ресурса: после переезда — рынок нового движка, до него — нынешняя цена рынка. */
create or replace function public._v1_price(p_name text) returns numeric
language sql stable security definer set search_path = public as $$
  select case when public._v1_econ_live() then (select price from v1_market where name = p_name)
              else (select coalesce(price, base_price) from market_resources where name = p_name) end
$$;
create or replace function public._v1_store_cap(p_fid text) returns numeric
language sql stable security definer set search_path = public as $$
  with c as (select public._v1_econ_cfg() v)
  select round((coalesce((c.v->>'store_base')::numeric, 1000)
          + coalesce((select sum(slots_open) from colony_buildings where faction_id = p_fid and btype = 'warehouse'), 0) * coalesce((c.v->>'store_per_slot')::numeric, 500))
          * coalesce((c.v->'infra'->>(least(4, greatest(0, (select infra from v1_budget_row(p_fid))))::int))::numeric, 1)
          * case when v1_is_robot(p_fid) then coalesce((c.v->>'robot_store')::numeric, 1.5) else 1 end) from c
$$;
create or replace function public._v1_stock_used(p_stock jsonb) returns numeric
language sql immutable as $$
  select coalesce(sum(greatest(0, (value #>> '{}')::numeric)), 0) from jsonb_each(coalesce(p_stock, '{}'::jsonb)) where jsonb_typeof(value) = 'number'
$$;
/** Множитель мира колонии: 0 — работа, 1 — наука, 2 — население. */
create or replace function public._v1_world(p_kind text, p_idx int) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((public._v1_econ_cfg()->'world'->coalesce(p_kind, 'std')->>p_idx)::numeric, 1)
$$;
create or replace function public._v1_order_k(p_colony uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((public._v1_econ_cfg()->'order'->>(select stage from v1_colony_order where colony_id = p_colony))::numeric, 1)
$$;

/** Население колонии через d суток: рост к потолку (ячейки × 100 × мир); сверх потолка — убыль не быстрее 2 % в сутки. */
create or replace function public._v1_pop_next(p_pop numeric, p_cells numeric, p_world numeric, p_growth numeric, p_days int) returns numeric
language sql stable security definer set search_path = public as $$
  with c as (select public._v1_econ_cfg()->'pop' v),
       k as (select round(p_cells * coalesce((c.v->>'cap')::numeric, 100) * p_world) cap, p_cells * coalesce((c.v->>'floor')::numeric, 10) fl,
                    coalesce((c.v->>'shrink')::numeric, 0.02) sh from c)
  select greatest(k.fl, case when p_pop > k.cap then greatest(k.cap, round(p_pop * power(1 - k.sh, p_days)))
                             else least(k.cap, round(p_pop * power(1 + p_growth, p_days))) end) from k
$$;

/** Шахты державы: что копает каждая постройка и сколько в сутки (без учёта склада и продаж). */
create or replace function public._v1_mines(p_fid text, p_kinds jsonb default null)
returns table(colony_id uuid, colony text, building_id uuid, btype text, slots int, res text, rarity text, rich text, allowed boolean, picked boolean, rate numeric)
language plpgsql stable security definer set search_path = public as $$
declare cfg jsonb := public._v1_econ_cfg(); m numeric := coalesce((v1_faction_mods(p_fid)->>'mine')::numeric, 1);
begin
  return query
  with b as (
    select cb.id bid, cb.colony_id cid, c.planet_name cname, cb.btype bt, greatest(0, coalesce(cb.slots_open, 1)) sl,
           coalesce(cb.mining_targets, '[]'::jsonb) tg, c.resources rs,
           public._v1_world(coalesce(p_kinds->>c.id::text, v1_world_kind(c.id)), 0) * public._v1_order_k(c.id) wk
      from colony_buildings cb join colonies c on c.id = cb.colony_id and c.faction_id = p_fid
     where cb.faction_id = p_fid and cb.btype in ('mining', 'mining_deep', 'mining_exotic')),
  d as (
    select b.*, e->>'name' rn, public._v1_rar(e->>'name', e->>'r') rr, coalesce(e->>'amt', 'умеренно') ra,
           coalesce(cfg->'mine'->'allow'->b.bt, '[]'::jsonb) ? public._v1_rar(e->>'name', e->>'r') ok
      from b, jsonb_array_elements(coalesce(b.rs, '[]'::jsonb)) e),
  p as (
    select d.*, d.ok and (jsonb_array_length(d.tg) = 0 or d.tg ? d.rn) pk from d)
  select p.cid, p.cname, p.bid, p.bt, p.sl, p.rn, p.rr, p.ra, p.ok, p.pk,
         case when p.pk then round(p.sl * coalesce((cfg->'mine'->'base'->>p.rr)::numeric, 1)
                * coalesce((cfg->'mine'->'rich'->>p.ra)::numeric, 1) * coalesce((cfg->'mine'->'kind'->>p.bt)::numeric, 1) * m * p.wk
                / greatest(1, (select count(*) from p p2 where p2.bid = p.bid and p2.pk)), 2) else 0 end
    from p order by p.cname, p.bt, p.rn;
end $$;

-- ════════ 3. Сутки державы ════════
/**
 * Считает сутки державы. p_mode: 'forecast' — только посчитать (страница «Добыча»),
 * 'shadow' — посчитать и записать итог (режим просмотра), 'live' — начислить по-настоящему.
 */
create or replace function public._v1_econ(p_fid text, p_days int, p_mode text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cfg jsonb := public._v1_econ_cfg(); eco faction_economy; mods jsonb; robot boolean; bud faction_budget; d int := greatest(1, coalesce(p_days, 1));
  kinds jsonb := '{}'::jsonb; r record; m_gc numeric; faith uuid;
  g_fac numeric := 0; g_trade numeric := 0; g_temple numeric := 0; sci numeric := 0; intel numeric := 0;
  mined jsonb := '{}'::jsonb; to_store jsonb := '{}'::jsonb; sold jsonb := '{}'::jsonb; dumped jsonb := '{}'::jsonb;
  stock jsonb; cap numeric; used numeric; want numeric; free numeric; k text; v numeric; q numeric; pol record; ff numeric;
  g_sales numeric := 0; g_dump numeric := 0; upkeep numeric; fee numeric := coalesce((cfg->>'fee')::numeric, 0.04);
  demand numeric := 0; gf numeric := 0; made numeric := 0; need numeric; take numeric; cov numeric := 1; welfare numeric := 1;
  pop0 numeric; pop1 numeric; growth numeric; net numeric; v_pts numeric; spawned int := 0; ledger jsonb; price numeric;
begin
  select * into eco from faction_economy where faction_id = p_fid for update;
  if eco.faction_id is null then return null; end if;
  if p_mode = 'live' then
    perform v1_projects_step(p_fid);
    perform v1_budget_slots(p_fid);
    update unit_production set status = 'done' where faction_id = p_fid and status = 'queued' and ready_at <= now();
  end if;
  mods := v1_faction_mods(p_fid); robot := v1_is_robot(p_fid); bud := v1_budget_row(p_fid);
  m_gc := coalesce((mods->>'gc')::numeric, 1);
  faith := v1_state_faith_id(p_fid);
  select coalesce(jsonb_object_agg(c.id::text, v1_world_kind(c.id)), '{}'::jsonb) into kinds from colonies c where c.faction_id = p_fid;

  -- постройки
  for r in select cb.btype, greatest(0, coalesce(cb.slots_open, 1)) sl, cb.faith_id,
                  public._v1_world(kinds->>c.id::text, 0) * public._v1_order_k(c.id) wk, public._v1_world(kinds->>c.id::text, 1) ws
             from colony_buildings cb join colonies c on c.id = cb.colony_id and c.faction_id = p_fid where cb.faction_id = p_fid loop
    if r.btype = 'factory' then g_fac := g_fac + r.sl * coalesce((cfg->'income'->>'factory')::numeric, 200) * r.wk;
    elsif r.btype = 'trade' then g_trade := g_trade + r.sl * coalesce((cfg->'income'->>'trade')::numeric, 100) * r.wk;
    elsif r.btype = 'temple' and faith is not null and (r.faith_id is null or r.faith_id = faith) then
      g_temple := g_temple + r.sl * coalesce((cfg->'income'->>'temple')::numeric, 150) * r.wk;
    elsif cfg->'science' ? r.btype then sci := sci + r.sl * (cfg->'science'->>r.btype)::numeric * r.ws;
    elsif r.btype = 'intel' then intel := intel + r.sl;
    end if;
  end loop;

  -- добыча
  for r in select x.res, sum(x.rate) rate from public._v1_mines(p_fid, kinds) x where x.picked and x.rate > 0 group by x.res loop
    mined := mined || jsonb_build_object(r.res, round(r.rate * d));
  end loop;
  for k, v in select key, (value #>> '{}')::numeric from jsonb_each(mined) loop
    if exists (select 1 from v1_res_policy rp where rp.faction_id = p_fid and rp.res = k and rp.mode = 'sell') then
      sold := sold || jsonb_build_object(k, v);
    else
      to_store := to_store || jsonb_build_object(k, v);
    end if;
  end loop;

  -- товары: вода и сырьё под спрос населения
  stock := coalesce(eco.resources, '{}'::jsonb);
  demand := case when robot then 0 else v1_pop(p_fid) / coalesce((cfg->'goods'->>'div')::numeric, 600) * d end;
  select coalesce(sum(slots_open), 0) into gf from colony_buildings where faction_id = p_fid and btype = 'goodsfab';
  if demand > 0 and gf > 0 then
    made := least(demand, gf * coalesce((cfg->'goods'->>'per_slot')::numeric, 10) * d);
    -- вода: лёд или жидкая вода; сырьё: железо или силикаты (сначала склад, затем свежая добыча)
    for k, need in select z.a, z.b from (values ('water', made * coalesce((cfg->'goods'->>'water')::numeric, 0.6)), ('raw', made * coalesce((cfg->'goods'->>'raw')::numeric, 0.4))) z(a, b) loop
      declare nm text;
      begin
        foreach nm in array case when k = 'water' then array['Лёд', 'Жидкая вода'] else array['Железо', 'Силикаты'] end loop
          exit when need <= 0;
          take := least(need, greatest(0, coalesce((stock->>nm)::numeric, 0)));
          if take > 0 then stock := jsonb_set(stock, array[nm], to_jsonb(coalesce((stock->>nm)::numeric, 0) - take)); need := need - take; end if;
          take := least(need, greatest(0, coalesce((to_store->>nm)::numeric, 0)));
          if take > 0 then to_store := jsonb_set(to_store, array[nm], to_jsonb((to_store->>nm)::numeric - take)); need := need - take; end if;
        end loop;
        if need > 0 then made := made - need / case when k = 'water' then coalesce((cfg->'goods'->>'water')::numeric, 0.6) else coalesce((cfg->'goods'->>'raw')::numeric, 0.4) end; end if;
      end;
    end loop;
    made := greatest(0, made);
  end if;
  cov := case when robot then 1 when demand > 0 then least(1, made / demand) else 1 end;
  welfare := case when robot then 1 else coalesce((cfg->'goods'->>'min')::numeric, 0.9)
             + (coalesce((cfg->'goods'->>'max')::numeric, 1.1) - coalesce((cfg->'goods'->>'min')::numeric, 0.9)) * cov end;

  -- склад: ложится только в свободное место, остальное — сбыт по дешёвке
  cap := public._v1_store_cap(p_fid);
  used := public._v1_stock_used(stock);
  want := public._v1_stock_used(to_store);
  free := greatest(0, cap - used);
  ff := case when want > 0 then least(1, free / want) else 1 end;
  for k, v in select key, (value #>> '{}')::numeric from jsonb_each(to_store) loop
    q := floor(v * ff);
    if q > 0 then stock := jsonb_set(stock, array[k], to_jsonb(coalesce((stock->>k)::numeric, 0) + q)); end if;
    if v - q > 0 then dumped := dumped || jsonb_build_object(k, v - q); end if;
  end loop;
  -- порог склада: всё, что выше, — на рынок
  for pol in select res, keep from v1_res_policy where faction_id = p_fid and keep is not null loop
    q := coalesce((stock->>pol.res)::numeric, 0) - pol.keep;
    if q > 0 then
      stock := jsonb_set(stock, array[pol.res], to_jsonb(pol.keep));
      sold := jsonb_set(sold, array[pol.res], to_jsonb(coalesce((sold->>pol.res)::numeric, 0) + q));
    end if;
  end loop;
  for k, v in select key, (value #>> '{}')::numeric from jsonb_each(sold) loop
    price := coalesce(public._v1_price(k), 1);
    g_sales := g_sales + v * price * (1 - fee);
  end loop;
  for k, v in select key, (value #>> '{}')::numeric from jsonb_each(dumped) loop
    price := coalesce(public._v1_price(k), 1);
    g_dump := g_dump + v * price * coalesce((cfg->>'dump_k')::numeric, 0.4);
  end loop;

  -- деньги
  g_fac := round(g_fac * m_gc * welfare * d); g_trade := round(g_trade * m_gc * welfare * d); g_temple := round(g_temple * m_gc * welfare * d);
  g_sales := round(g_sales); g_dump := round(g_dump);
  upkeep := round(coalesce(v1_budget_upkeep(p_fid), 0) * d);
  net := g_fac + g_trade + g_temple + g_sales + g_dump - upkeep;
  sci := round((sci * coalesce((mods->>'science')::numeric, 1) + coalesce((mods->>'sci_flat')::numeric, 0)) * d, 2);
  v_pts := round((intel * coalesce((cfg->>'agent_pts')::numeric, 0.1) + coalesce((mods->>'agents_flat')::numeric, 0) * 0.1) * d, 2);

  -- население
  growth := coalesce((cfg->'pop'->'growth'->>(least(4, greatest(0, case when robot then bud.industry else bud.social end)))::int)::numeric, 0)
            + case when robot then 0 else coalesce((cfg->'pop'->>'goods')::numeric, 0.01) * cov end;
  select coalesce(sum(coalesce(pop, coalesce(cells, 0) * 50)), 0) into pop0 from colonies where faction_id = p_fid;
  select coalesce(sum(public._v1_pop_next(coalesce(pop, coalesce(cells, 0) * 50), coalesce(cells, 0), public._v1_world(kinds->>id::text, 2), growth, d)), 0)
    into pop1 from colonies where faction_id = p_fid;

  ledger := jsonb_build_object('days', d, 'mode', p_mode,
    'income', jsonb_build_object('factory', g_fac, 'trade', g_trade, 'temple', g_temple, 'sales', g_sales, 'dump', g_dump, 'upkeep', upkeep, 'net', net),
    'science', sci, 'agent_pts', v_pts, 'welfare', round(welfare, 3),
    'goods', jsonb_build_object('demand', round(demand), 'made', round(made), 'cov', round(cov, 3), 'slots', gf),
    'mined', mined, 'stored', (select coalesce(jsonb_object_agg(key, (value #>> '{}')::numeric - coalesce((dumped->>key)::numeric, 0)), '{}'::jsonb) from jsonb_each(to_store)),
    'sold', sold, 'dumped', dumped,
    'store', jsonb_build_object('cap', cap, 'before', round(used), 'after', round(public._v1_stock_used(stock))),
    'pop', jsonb_build_object('before', pop0, 'after', pop1, 'growth', round(growth, 4)),
    'gc_before', eco.gc);

  if p_mode in ('shadow', 'live') then
    -- рынок чувствует продажи (в режиме просмотра — только цены нового рынка)
    for k, v in select key, (value #>> '{}')::numeric from jsonb_each(sold) union all select key, (value #>> '{}')::numeric from jsonb_each(dumped) loop
      update v1_market set supply = supply + v where name = k;
    end loop;
  end if;

  if p_mode = 'live' then
    update faction_economy set gc = greatest(0, gc + net), science = coalesce(science, 0) + sci, resources = stock,
           last_tick = coalesce(last_tick, now()) + make_interval(days => d)
     where faction_id = p_fid;
    update colonies c set pop = public._v1_pop_next(coalesce(c.pop, coalesce(c.cells, 0) * 50), coalesce(c.cells, 0), public._v1_world(kinds->>c.id::text, 2), growth, d)
     where c.faction_id = p_fid;
    -- агенты из бюро разведки
    insert into v1_agent_pts(faction_id, pts) values (p_fid, v_pts) on conflict (faction_id) do update set pts = v1_agent_pts.pts + excluded.pts;
    while (select ap.pts from v1_agent_pts ap where ap.faction_id = p_fid) >= 1
          and (select count(*) from spy_agents where faction_id = p_fid and not coalesce(captive, false)) < public._v1_iv('max_agents', 20) loop
      perform public._v1_recruits(p_fid);
      insert into spy_agents(faction_id, owner_id, first_name, last_name, hired_at, created_at, ready_at, xp, level)
      select p_fid, eco.owner_id, r2.first_name, r2.last_name, now(), now(), now(), 0, 1 from v1_spy_recruits r2 where r2.faction_id = p_fid order by r2.created_at limit 1;
      delete from v1_spy_recruits where id = (select id from v1_spy_recruits where faction_id = p_fid order by created_at limit 1);
      update v1_agent_pts ap set pts = ap.pts - 1 where ap.faction_id = p_fid;
      spawned := spawned + 1;
    end loop;
    ledger := ledger || jsonb_build_object('agents_new', spawned);
    perform v1_research_step(p_fid);
  end if;
  if p_mode in ('shadow', 'live') then
    insert into v1_econ_ledger(faction_id, days, live, data) values (p_fid, d, p_mode = 'live', ledger);
    delete from v1_econ_ledger where faction_id = p_fid and id not in (select id from v1_econ_ledger where faction_id = p_fid order by id desc limit 30);
  end if;
  return ledger;
end $$;

-- ════════ 4. Рынок нового движка ════════
create or replace function public.v1_market_tick() returns int
language plpgsql security definer set search_path = public as $$
declare cfg jsonb := coalesce(public._v1_econ_cfg()->'market', '{}'::jsonb); r record; npc numeric; ratio numeric; p numeric; n int := 0; live boolean := public._v1_econ_live();
begin
  for r in select * from v1_market for update loop
    npc := coalesce((cfg->'npc'->>public._v1_rar(r.name))::numeric, 1000);
    ratio := (r.demand + npc) / greatest(1, r.supply + npc);
    p := r.price * power(ratio, coalesce((cfg->>'k')::numeric, 0.25));
    p := p + (r.base - p) * coalesce((cfg->>'pull')::numeric, 0.1);
    p := round(least(r.base * coalesce((cfg->>'max')::numeric, 2), greatest(r.base * coalesce((cfg->>'min')::numeric, 0.5), p)), 2);
    insert into v1_market_history(name, day, price, supply, demand) values (r.name, current_date, p, r.supply, r.demand)
    on conflict (name, day) do update set price = excluded.price, supply = excluded.supply, demand = excluded.demand;
    update v1_market set price = p, supply = 0, demand = 0, updated_at = now() where name = r.name;
    if live then update market_resources set price = p where name = r.name; end if;
    n := n + 1;
  end loop;
  delete from v1_market_history where day < current_date - 60;
  return n;
end $$;

create or replace function public._v1_exchange_expire() returns int
language plpgsql security definer set search_path = public as $$
declare x v1_exchange; n int := 0;
begin
  for x in select * from v1_exchange where status = 'open' and expires_at <= now() for update loop
    perform public._v1_exchange_refund(x.id, 'expired'); n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.v1_economy_tick() returns jsonb
language plpgsql security definer set search_path = public as $$
declare f record; n int := 0; live boolean := public._v1_econ_live(); d int;
begin
  for f in select faction_id, last_tick from faction_economy where exists (select 1 from colonies c where c.faction_id = faction_economy.faction_id) loop
    begin
      if live then
        d := floor(extract(epoch from (now() - coalesce(f.last_tick, now() - interval '1 day'))) / 86400);
        if d >= 1 then perform public._v1_econ(f.faction_id, d, 'live'); n := n + 1; end if;
      else
        perform public._v1_econ(f.faction_id, 1, 'shadow'); n := n + 1;
      end if;
    exception when others then raise warning 'экономика %: %', f.faction_id, sqlerrm;
    end;
  end loop;
  perform public.v1_market_tick();
  perform public._v1_exchange_expire();
  return jsonb_build_object('factions', n, 'live', live);
end $$;

-- ════════ 5. Добыча: игроку ════════
create or replace function public._v1_econ_me(p_manage boolean default true) returns text
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction();
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  if p_manage and not (v1_can_manage(v_fid, 'trade') or v1_can_manage(v_fid, 'produce')) then raise exception 'forbidden'; end if;
  return v_fid;
end $$;

create or replace function public.v1_mining_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_fid text := public._v1_econ_me(false); kinds jsonb; fc jsonb;
begin
  select coalesce(jsonb_object_agg(c.id::text, v1_world_kind(c.id)), '{}'::jsonb) into kinds from colonies c where c.faction_id = v_fid;
  fc := public._v1_econ(v_fid, 1, 'forecast');
  return jsonb_build_object(
    'fid', v_fid, 'can', v1_can_manage(v_fid, 'trade') or v1_can_manage(v_fid, 'produce'),
    'live', public._v1_econ_live(), 'next', v1_next_tick(),
    'settings', public._v1_econ_cfg(),
    'stock', (select coalesce(resources, '{}'::jsonb) from faction_economy where faction_id = v_fid),
    'cap', public._v1_store_cap(v_fid),
    'policy', (select coalesce(jsonb_object_agg(res, jsonb_build_object('mode', mode, 'keep', keep)), '{}'::jsonb) from v1_res_policy where faction_id = v_fid),
    'prices', (select coalesce(jsonb_object_agg(m.name, jsonb_build_object('price', public._v1_price(m.name), 'base', m.base, 'rarity', public._v1_rar(m.name))), '{}'::jsonb) from v1_market m),
    'mines', (select coalesce(jsonb_agg(jsonb_build_object('colony_id', x.colony_id, 'colony', x.colony, 'building', x.building_id, 'btype', x.btype, 'slots', x.slots,
               'res', x.res, 'rarity', x.rarity, 'rich', x.rich, 'allowed', x.allowed, 'picked', x.picked, 'rate', x.rate)), '[]'::jsonb)
              from public._v1_mines(v_fid, kinds) x),
    'deposits', (select coalesce(jsonb_agg(jsonb_build_object('colony_id', c.id, 'colony', c.planet_name, 'system', s.name, 'kind', kinds->>c.id::text,
                  'res', e->>'name', 'rarity', public._v1_rar(e->>'name', e->>'r'), 'rich', coalesce(e->>'amt', 'умеренно'),
                  'mined', exists (select 1 from colony_buildings b where b.colony_id = c.id and b.btype in ('mining', 'mining_deep', 'mining_exotic')))
                  order by c.planet_name), '[]'::jsonb)
                 from colonies c left join map_systems s on s.id = c.system_id, jsonb_array_elements(coalesce(c.resources, '[]'::jsonb)) e where c.faction_id = v_fid),
    'forecast', fc,
    'shadow', (select data || jsonb_build_object('at', at) from v1_econ_ledger where faction_id = v_fid order by id desc limit 1),
    'old', (select jsonb_build_object('at', tick_at, 'net', gc_net, 'build', gc_build, 'market', gc_market, 'export', gc_export, 'mined', mined, 'lost', mined_lost)
              from income_history where faction_id = v_fid order by tick_at desc limit 1),
    'needs', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
               select key k, sum((value #>> '{}')::numeric) n from v1_ships s, jsonb_each(coalesce(s.stats->'bill', '{}'::jsonb))
                where s.faction_id = v_fid and coalesce((s.stats->>'registrable')::boolean, false) group by key) z));
end $$;

create or replace function public.v1_res_policy_set(p_res text, p_mode text, p_keep numeric default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_fid text := public._v1_econ_me();
begin
  if not exists (select 1 from v1_market where name = p_res) then raise exception 'bad_resource'; end if;
  if p_mode not in ('store', 'sell') then raise exception 'bad_mode'; end if;
  if p_mode = 'store' and p_keep is null then
    delete from v1_res_policy where faction_id = v_fid and res = p_res;
  else
    insert into v1_res_policy(faction_id, res, mode, keep) values (v_fid, p_res, p_mode, case when p_keep is null then null else greatest(0, round(p_keep)) end)
    on conflict (faction_id, res) do update set mode = excluded.mode, keep = excluded.keep, updated_at = now();
  end if;
  return true;
end $$;

/** Какие залежи копает шахта (пусто — все доступные ей залежи колонии). */
create or replace function public.v1_mine_targets(p_building uuid, p_targets text[]) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_fid text := public._v1_econ_me(); b colony_buildings; c colonies; allow jsonb; t text;
begin
  select * into b from colony_buildings where id = p_building and faction_id = v_fid and btype in ('mining', 'mining_deep', 'mining_exotic');
  if b.id is null then raise exception 'mine_not_found'; end if;
  select * into c from colonies where id = b.colony_id;
  allow := coalesce(public._v1_econ_cfg()->'mine'->'allow'->b.btype, '[]'::jsonb);
  foreach t in array coalesce(p_targets, '{}') loop
    if not exists (select 1 from jsonb_array_elements(coalesce(c.resources, '[]'::jsonb)) e where e->>'name' = t and allow ? public._v1_rar(e->>'name', e->>'r')) then
      raise exception 'mine_bad_target: %', t;
    end if;
  end loop;
  update colony_buildings set mining_targets = to_jsonb(coalesce(p_targets, '{}')) where id = b.id;
  return true;
end $$;

-- ════════ 6. Торговля: рынок и биржа ════════
create or replace function public._v1_stock_add(p_fid text, p_res text, p_qty numeric) returns void
language sql security definer set search_path = public as $$
  update faction_economy set resources = jsonb_set(coalesce(resources, '{}'::jsonb), array[p_res],
         to_jsonb(greatest(0, coalesce((resources->>p_res)::numeric, 0) + p_qty))) where faction_id = p_fid
$$;

create or replace function public.v1_market_trade(p_res text, p_qty numeric, p_side text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_fid text := public._v1_econ_me(); cfg jsonb := public._v1_econ_cfg(); eco faction_economy; q numeric := floor(coalesce(p_qty, 0)); p numeric; sum_gc numeric;
begin
  if q < 1 or q > coalesce((cfg->>'trade_max')::numeric, 20000) then raise exception 'bad_qty: %', coalesce((cfg->>'trade_max')::numeric, 20000)::int; end if;
  p := public._v1_price(p_res);
  if p is null then raise exception 'bad_resource'; end if;
  select * into eco from faction_economy where faction_id = v_fid for update;
  if p_side = 'sell' then
    if coalesce((eco.resources->>p_res)::numeric, 0) < q then raise exception 'not_enough_res'; end if;
    sum_gc := round(q * p * (1 - coalesce((cfg->>'fee')::numeric, 0.04)));
    perform public._v1_stock_add(v_fid, p_res, -q);
    update faction_economy set gc = gc + sum_gc where faction_id = v_fid;
    update v1_market set supply = supply + q where name = p_res;
  elsif p_side = 'buy' then
    sum_gc := round(q * p * coalesce((cfg->>'buy_k')::numeric, 1.08));
    if coalesce(eco.gc, 0) < sum_gc then raise exception 'prod_no_money: %', sum_gc::bigint; end if;
    if public._v1_stock_used(eco.resources) + q > public._v1_store_cap(v_fid) then raise exception 'store_full'; end if;
    perform public._v1_stock_add(v_fid, p_res, q);
    update faction_economy set gc = gc - sum_gc where faction_id = v_fid;
    update v1_market set demand = demand + q where name = p_res;
  else raise exception 'bad_side';
  end if;
  return jsonb_build_object('gc', sum_gc, 'price', p);
end $$;

create or replace function public._v1_exchange_refund(p_lot uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare x v1_exchange;
begin
  select * into x from v1_exchange where id = p_lot and status = 'open' for update;
  if x.id is null then return; end if;
  if x.qty_left > 0 then
    if x.side = 'sell' then perform public._v1_stock_add(x.faction_id, x.res, x.qty_left);
    else update faction_economy set gc = gc + round(x.qty_left * x.price) where faction_id = x.faction_id; end if;
  end if;
  update v1_exchange set status = p_status where id = x.id;
end $$;

create or replace function public.v1_exchange_post(p_side text, p_res text, p_qty numeric, p_price numeric) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_fid text := public._v1_econ_me(); cfg jsonb := public._v1_econ_cfg(); eco faction_economy; q numeric := floor(coalesce(p_qty, 0)); pr numeric := round(coalesce(p_price, 0), 2); lid uuid;
begin
  if not exists (select 1 from v1_market where name = p_res) then raise exception 'bad_resource'; end if;
  if q < 1 or q > coalesce((cfg->>'trade_max')::numeric, 20000) then raise exception 'bad_qty: %', coalesce((cfg->>'trade_max')::numeric, 20000)::int; end if;
  if pr <= 0 then raise exception 'bad_price'; end if;
  if (select count(*) from v1_exchange where faction_id = v_fid and status = 'open') >= 20 then raise exception 'exchange_limit'; end if;
  select * into eco from faction_economy where faction_id = v_fid for update;
  if p_side = 'sell' then
    if coalesce((eco.resources->>p_res)::numeric, 0) < q then raise exception 'not_enough_res'; end if;
    perform public._v1_stock_add(v_fid, p_res, -q);
  elsif p_side = 'buy' then
    if coalesce(eco.gc, 0) < round(q * pr) then raise exception 'prod_no_money: %', round(q * pr)::bigint; end if;
    update faction_economy set gc = gc - round(q * pr) where faction_id = v_fid;
  else raise exception 'bad_side';
  end if;
  insert into v1_exchange(faction_id, side, res, qty, qty_left, price, expires_at)
  values (v_fid, p_side, p_res, q, q, pr, now() + make_interval(days => coalesce((cfg->>'exchange_days')::int, 7))) returning id into lid;
  return lid;
end $$;

create or replace function public.v1_exchange_fill(p_lot uuid, p_qty numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_fid text := public._v1_econ_me(); cfg jsonb := public._v1_econ_cfg(); x v1_exchange; eco faction_economy; q numeric; pay numeric; fee numeric := coalesce((cfg->>'fee')::numeric, 0.04);
begin
  select * into x from v1_exchange where id = p_lot and status = 'open' for update;
  if x.id is null or x.expires_at <= now() then raise exception 'lot_gone'; end if;
  if x.faction_id = v_fid then raise exception 'lot_own'; end if;
  q := least(x.qty_left, floor(coalesce(p_qty, x.qty_left)));
  if q < 1 then raise exception 'bad_qty: %', x.qty_left::int; end if;
  pay := round(q * x.price);
  select * into eco from faction_economy where faction_id = v_fid for update;
  if x.side = 'sell' then
    -- я покупаю: плачу, получаю товар; продавцу — деньги без комиссии
    if coalesce(eco.gc, 0) < pay then raise exception 'prod_no_money: %', pay::bigint; end if;
    if public._v1_stock_used(eco.resources) + q > public._v1_store_cap(v_fid) then raise exception 'store_full'; end if;
    update faction_economy set gc = gc - pay where faction_id = v_fid;
    perform public._v1_stock_add(v_fid, x.res, q);
    update faction_economy set gc = gc + round(pay * (1 - fee)) where faction_id = x.faction_id;
  else
    -- я продаю: отдаю товар, получаю деньги из залога
    if coalesce((eco.resources->>x.res)::numeric, 0) < q then raise exception 'not_enough_res'; end if;
    perform public._v1_stock_add(v_fid, x.res, -q);
    update faction_economy set gc = gc + round(pay * (1 - fee)) where faction_id = v_fid;
    perform public._v1_stock_add(x.faction_id, x.res, q);
  end if;
  update v1_exchange set qty_left = qty_left - q, status = case when qty_left - q <= 0 then 'done' else status end where id = x.id;
  insert into v1_trade_log(faction_id, title, body) values
    (x.faction_id, case when x.side = 'sell' then 'Биржа: продано' else 'Биржа: куплено' end,
     format('%s × %s по %s ГС — держава «%s».', x.res, q, x.price, v1_fname(v_fid))),
    (v_fid, case when x.side = 'sell' then 'Биржа: куплено' else 'Биржа: продано' end,
     format('%s × %s по %s ГС — держава «%s».', x.res, q, x.price, v1_fname(x.faction_id)));
  return jsonb_build_object('qty', q, 'gc', pay);
end $$;

create or replace function public.v1_exchange_cancel(p_lot uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_fid text := public._v1_econ_me();
begin
  if not exists (select 1 from v1_exchange where id = p_lot and faction_id = v_fid and status = 'open') then raise exception 'lot_gone'; end if;
  perform public._v1_exchange_refund(p_lot, 'cancelled');
  return true;
end $$;

-- ════════ 7. Права и таймер ════════
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('_v1_econ_cfg', '_v1_econ_live', '_v1_rar', '_v1_price', '_v1_store_cap', '_v1_stock_used', '_v1_world', '_v1_order_k',
                                '_v1_mines', '_v1_pop_next', '_v1_econ', 'v1_market_tick', '_v1_exchange_expire', 'v1_economy_tick', '_v1_econ_me', '_v1_stock_add', '_v1_exchange_refund') loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
  for f in select p.oid::regprocedure sig from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('v1_mining_state', 'v1_res_policy_set', 'v1_mine_targets', 'v1_market_trade', 'v1_exchange_post', 'v1_exchange_fill', 'v1_exchange_cancel') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
  perform cron.unschedule('v1-economy-tick') where exists (select 1 from cron.job where jobname = 'v1-economy-tick');
  perform cron.schedule('v1-economy-tick', '9 0 * * *', 'select public.v1_economy_tick()');
end $$;
