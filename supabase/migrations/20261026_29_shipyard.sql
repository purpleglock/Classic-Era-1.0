-- Классическая эра 1.0 · Конструктор кораблей: основа (новый, с нуля).
--
-- Корабль собирается на палубной сетке класса: игрок расставляет по клеткам
-- свои реакторы и орудия (из новых конструкторов), топливные баки и модули
-- (двигатели, щиты, мостик, жилые отсеки и т. д.). Броня — сплав державы на
-- весь корпус, топливо в баках — марка или сырьё.
--
-- Правила сетки: предмет целиком на корпусе, без наложений; орудие касается
-- борта; двигатель касается кормы (левый край силуэта). Нос — справа.
-- Размер предмета не больше размера класса (S < M < L < XL).
--
-- Названия модулей и классов — черновые, команда их переименует. Старые
-- проекты кораблей (faction_units) не трогаем.

set lock_timeout = '15s';

-- ════════ 1. Классы корпусов ════════
create table if not exists public.v1_ship_classes (
  id      text primary key,
  name    text not null,
  descr   text not null,
  size    text not null check (size in ('S', 'M', 'L', 'XL')),
  tech    text,
  w       int not null,
  h       int not null,
  mask    text[] not null,       -- строки силуэта: '#' — палуба, '.' — пусто
  params  jsonb not null,        -- hp, mass, crew, cost, speed (множитель), engines (нужны ли)
  sort    int not null default 0,
  frozen  boolean not null default false
);
alter table public.v1_ship_classes enable row level security;
drop policy if exists v1_ship_classes_read on public.v1_ship_classes;
create policy v1_ship_classes_read on public.v1_ship_classes for select using (true);
grant select on public.v1_ship_classes to anon, authenticated;

insert into public.v1_ship_classes(id, name, descr, size, tech, w, h, mask, params, sort) values
  ('corvette', 'Корвет', 'Лёгкий корабль патруля и разведки. Быстрый, но хрупкий.', 'S', null, 14, 6, array['..########....','#############.','##############','##############','#############.','..########....'],
   '{"hp": 1600, "mass": 120, "crew": 30, "cost": 20000, "speed": 1.0, "engines": true}', 10),
  ('destroyer', 'Эсминец', 'Корабль первой линии: основа любого флота.', 'M', 'cls.ship.destroyer', 20, 8, array['....#########.......','.################...','###################.','####################','####################','###################.','.################...','....#########.......'],
   '{"hp": 2800, "mass": 320, "crew": 60, "cost": 60000, "speed": 1.0, "engines": true}', 20),
  ('supportCarrier', 'Носитель поддержки', 'Лёгкий носитель: ангар, дроны прикрытия, ремонт эскадры.', 'M', 'cls.ship.supportCarrier', 22, 9, array['..##############......','###################...','######################','######################','######################','######################','######################','###################...','..##############......'],
   '{"hp": 3000, "mass": 420, "crew": 50, "cost": 80000, "speed": 0.9, "engines": true}', 30),
  ('mediumCruiser', 'Средний крейсер', 'Броня, щиты и средний калибр.', 'L', 'cls.ship.mediumCruiser', 26, 10, array['........########..........','..#################.......','#######################...','#########################.','##########################','##########################','#########################.','#######################...','..#################.......','........########..........'],
   '{"hp": 7200, "mass": 900, "crew": 100, "cost": 160000, "speed": 0.9, "engines": true}', 40),
  ('hyperCruiser', 'Рейдерский крейсер', 'Дальние броски по тылам врага: длинный и узкий корпус под двигатели и баки.', 'L', 'cls.ship.hyperCruiser', 28, 8, array['..####......................','###################.........','##########################..','############################','############################','##########################..','###################.........','..####......................'],
   '{"hp": 7000, "mass": 780, "crew": 90, "cost": 180000, "speed": 1.4, "engines": true}', 50),
  ('multiroleCarrier', 'Многоцелевой носитель', 'Тяжёлый носитель с ангарами и собственным вооружением.', 'L', 'cls.ship.multiroleCarrier', 28, 11, array['....###################.....','.########################...','##########################..','############################','############################','############################','############################','############################','##########################..','.########################...','....###################.....'],
   '{"hp": 12000, "mass": 1500, "crew": 250, "cost": 320000, "speed": 0.8, "engines": true}', 60),
  ('battleship', 'Линкор', 'Тяжёлая броня и главный калибр для решающих сражений.', 'XL', 'cls.ship.battleship', 32, 12, array['................#########.......','.......####################.....','..###########################...','###############################.','################################','################################','################################','################################','###############################.','..###########################...','.......####################.....','................#########.......'],
   '{"hp": 25000, "mass": 2600, "crew": 500, "cost": 700000, "speed": 0.8, "engines": true}', 70),
  ('dreadnought', 'Дредноут', 'Флагман, вокруг которого строится флот.', 'XL', 'cls.ship.dreadnought', 36, 14, array['........####################........','.......#######################......','..##############################....','.#################################..','###################################.','####################################','####################################','####################################','####################################','###################################.','.#################################..','..##############################....','.......#######################......','........####################........'],
   '{"hp": 50000, "mass": 4200, "crew": 700, "cost": 1200000, "speed": 0.75, "engines": true}', 80),
  ('ss13', 'Станция', 'Боевая платформа для обороны систем. Двигателей нет — станция стоит на месте.', 'XL', 'cls.ship.ss13', 18, 18, array['......######......','.....########.....','....##########....','...############...','..##############..','.################.','##################','##################','##################','##################','##################','##################','.################.','..##############..','...############...','....##########....','.....########.....','......######......'],
   '{"hp": 40000, "mass": 5000, "crew": 900, "cost": 1500000, "speed": 0, "engines": false}', 90),
  ('colossus', 'Имперский колосс', 'Вершина кораблестроения, один на целый флот.', 'XL', 'cls.ship.colossus', 44, 16, array['................###############.............','.......##########################...........','.......#############################........','..#####################################.....','#########################################...','###########################################.','############################################','############################################','############################################','############################################','###########################################.','#########################################...','..#####################################.....','.......#############################........','.......##########################...........','................###############.............'],
   '{"hp": 120000, "mass": 9000, "crew": 1500, "cost": 4000000, "speed": 0.6, "engines": true}', 100)
on conflict (id) do update set name = excluded.name, descr = excluded.descr, size = excluded.size, tech = excluded.tech,
  w = excluded.w, h = excluded.h, mask = excluded.mask, params = excluded.params, sort = excluded.sort;

-- ════════ 2. Модули ════════
alter table public.v1_modules add column if not exists tech text;

-- размеры баков на сетке
update public.v1_modules set params = params || '{"w":1,"h":1}' where id = 'tank_s';
update public.v1_modules set params = params || '{"w":2,"h":1}' where id in ('tank_m', 'tank_arm');
update public.v1_modules set params = params || '{"w":2,"h":2}' where id = 'tank_l';

-- w, h — клетки; energy — потребление ЭЕ; mass — т; cost — ГС; остальное — по виду модуля.
insert into public.v1_modules(id, kind, name, size, params, descr, sort, tech) values
  ('bridge',    'bridge',   'Командный мостик',       'S', '{"w":2,"h":1,"crew":12,"energy":200,"mass":8,"cost":4000}',
   'Обязателен: ровно один на корабль.', 100, null),
  ('eng_s',     'engine',   'Маршевый двигатель S',   'S', '{"w":1,"h":1,"thrust":400,"energy":300,"mass":6,"cost":2500}',
   'Ставится у кормы.', 110, null),
  ('eng_m',     'engine',   'Маршевый двигатель M',   'M', '{"w":2,"h":1,"thrust":1300,"energy":900,"mass":16,"cost":7000}',
   'Ставится у кормы.', 120, null),
  ('eng_l',     'engine',   'Маршевый двигатель L',   'L', '{"w":2,"h":2,"thrust":3600,"energy":2500,"mass":40,"cost":18000}',
   'Ставится у кормы.', 130, 'comp.ship.engine'),
  ('shield_s',  'shield',   'Генератор щита S',       'S', '{"w":1,"h":1,"shield":400,"energy":800,"mass":4,"cost":3000}',
   'Поглощает урон до брони.', 140, null),
  ('shield_m',  'shield',   'Генератор щита M',       'M', '{"w":2,"h":1,"shield":1500,"energy":2600,"mass":10,"cost":9000}',
   'Поглощает урон до брони.', 150, null),
  ('shield_l',  'shield',   'Генератор щита L',       'L', '{"w":2,"h":2,"shield":5000,"energy":7500,"mass":24,"cost":26000}',
   'Поглощает урон до брони.', 160, 'comp.ship.shield'),
  ('sensor',    'sensor',   'Радарный комплекс',      'S', '{"w":1,"h":1,"radar":4,"energy":500,"mass":3,"cost":3500}',
   'Дальше видит — раньше стреляет.', 170, null),
  ('sensor_l',  'sensor',   'Дальний радар',          'M', '{"w":2,"h":1,"radar":10,"energy":1400,"mass":8,"cost":9000}',
   'Обзор на соседние системы.', 180, 'comp.ship.radar'),
  ('crew_s',    'quarters', 'Жилой отсек',            'S', '{"w":1,"h":1,"crew":20,"energy":50,"mass":3,"cost":800}',
   'Места для экипажа.', 190, null),
  ('crew_m',    'quarters', 'Жилая палуба',           'M', '{"w":2,"h":1,"crew":60,"energy":120,"mass":7,"cost":2000}',
   'Места для экипажа.', 200, null),
  ('cargo_m',   'cargo',    'Грузовой трюм',          'M', '{"w":2,"h":1,"cargo":200,"energy":0,"mass":5,"cost":1500}',
   'Груз и десант.', 210, null),
  ('cargo_l',   'cargo',    'Большой трюм',           'L', '{"w":2,"h":2,"cargo":600,"energy":0,"mass":12,"cost":3500}',
   'Груз и десант.', 220, null),
  ('hangar',    'hangar',   'Ангар',                  'L', '{"w":3,"h":2,"craft":4,"energy":1200,"mass":30,"cost":20000}',
   'Авиагруппа на 4 звена.', 230, 'wpn.ship.АНГАРЫ И АВИАГРУППЫ')
on conflict (id) do update set kind = excluded.kind, name = excluded.name, size = excluded.size, params = excluded.params,
  descr = excluded.descr, sort = excluded.sort, tech = excluded.tech;

-- ════════ 3. Проекты кораблей ════════
create table if not exists public.v1_ships (
  id          uuid primary key default gen_random_uuid(),
  faction_id  text not null,
  owner_id    uuid references auth.users(id) on delete set null,
  name        text not null,
  class       text not null references public.v1_ship_classes(id),
  cfg         jsonb not null,   -- {layout:[{t,id,x,y,r}], alloy: uuid|null, fuel: {kind,id|res}|null}
  stats       jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists v1_ships_name on public.v1_ships(faction_id, lower(name));
create index if not exists v1_ships_fid on public.v1_ships(faction_id);
alter table public.v1_ships enable row level security;
revoke all on public.v1_ships from anon, authenticated;

insert into public.v1_settings(key, value) values
  ('shipyard', '{"max_per_faction": 40, "max_items": 240, "speed_k": 2.2, "armor_mass_per_cell": 0.6, "armor_cost_per_cell": 100}')
on conflict (key) do nothing;

create or replace function public.v1_size_rank(p text) returns int language sql immutable as $$
  select case p when 'S' then 1 when 'M' then 2 when 'L' then 3 when 'XL' then 4 else 9 end;
$$;

create or replace function public.v1_bill_add(a jsonb, b jsonb, k numeric default 1) returns jsonb
language plpgsql immutable as $$
declare r jsonb := coalesce(a, '{}'::jsonb); key text; val jsonb;
begin
  for key, val in select * from jsonb_each(coalesce(b, '{}'::jsonb)) loop
    if jsonb_typeof(val) = 'number' then
      r := jsonb_set(r, array[key], to_jsonb(coalesce((r->>key)::numeric, 0) + ceil((val #>> '{}')::numeric * k)));
    end if;
  end loop;
  return r;
end $$;

-- ════════ 4. Расчёт корабля ════════
create or replace function public.v1_ship_calc(p_class text, p_cfg jsonb, p_fid text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  set_ jsonb := coalesce((select value from v1_settings where key = 'shipyard'), '{}'::jsonb);
  cl v1_ship_classes; cp jsonb; v_done jsonb := '[]'::jsonb;
  items jsonb := coalesce(p_cfg->'layout', '[]'::jsonb);
  it jsonb; i int; n int; t text; iid text; x int; y int; rot int;
  w int; h int; sz text; nm text; st jsonb; mp jsonb; mkind text;
  occ jsonb := '{}'::jsonb; cx int; cy int; dx int; dy int; ok_edge boolean; ok_stern boolean; bad boolean;
  errs jsonb := '[]'::jsonb; warns jsonb := '[]'::jsonb; locked jsonb := '[]'::jsonb;
  cells int := 0; used int := 0;
  pw numeric := 0; pu numeric := 0; mass numeric; cost numeric; thrust numeric := 0; shield numeric := 0;
  dmg numeric := 0; heal numeric := 0; rng numeric := 0; radar numeric := 1; crew_cap numeric; crew_need numeric;
  cargo numeric := 0; craft numeric := 0; tank_cap numeric := 0; tank_risk numeric := 0; fuel_use numeric := 0;
  bridges int := 0; engines int := 0; reactors int := 0; guns int := 0; mods int := 0;
  bill jsonb := '{}'::jsonb;
  al jsonb; al_name text := 'Стандартная сталь'; al_recipe jsonb;
  resist jsonb := '{"kinetic":0.3,"energy":0.1,"missile":0.1}'::jsonb; hp_pct numeric := 0; mf numeric := 1; al_speed numeric := 0;
  fu jsonb; fst jsonb; fname text; jumps int := 0; autonomy numeric;
  hp numeric; speed numeric; counts jsonb := '{}'::jsonb;
begin
  select * into cl from v1_ship_classes where id = p_class and not frozen;
  if cl.id is null then return jsonb_build_object('ok', false, 'error', 'ship_class'); end if;
  cp := cl.params;
  if p_fid is not null then
    select coalesce(research, '[]'::jsonb) into v_done from faction_economy where faction_id = p_fid;
    v_done := coalesce(v_done, '[]'::jsonb);
    if cl.tech is not null and not v_done ? cl.tech then locked := locked || to_jsonb(cl.name); end if;
  end if;
  if jsonb_typeof(items) <> 'array' then return jsonb_build_object('ok', false, 'error', 'ship_layout'); end if;
  n := jsonb_array_length(items);
  if n > coalesce((set_->>'max_items')::int, 240) then return jsonb_build_object('ok', false, 'error', 'ship_too_many'); end if;

  for cy in 0 .. cl.h - 1 loop
    cells := cells + length(cl.mask[cy + 1]) - length(replace(cl.mask[cy + 1], '#', ''));
  end loop;
  mass := (cp->>'mass')::numeric; cost := (cp->>'cost')::numeric;
  crew_cap := (cp->>'crew')::numeric; crew_need := (cp->>'crew')::numeric;

  for i in 0 .. n - 1 loop
    it := items->i;
    t := it->>'t'; iid := it->>'id';
    x := coalesce((it->>'x')::int, -1); y := coalesce((it->>'y')::int, -1); rot := coalesce((it->>'r')::int, 0);
    st := null; mp := null; mkind := null; sz := null; nm := null;
    if t = 'reactor' then
      select r.stats, r.cfg->>'size', r.name into st, sz, nm from v1_reactors r where r.id::text = iid and (p_fid is null or r.faction_id = p_fid);
    elsif t = 'weapon' then
      select wp.stats, wp.cfg->>'size', wp.name into st, sz, nm from v1_weapons wp where wp.id::text = iid and (p_fid is null or wp.faction_id = p_fid);
    elsif t = 'module' then
      select md.params, md.size, md.name, md.kind into mp, sz, nm, mkind from v1_modules md where md.id = iid and not md.frozen;
      if mp is not null and p_fid is not null and (select tech from v1_modules where id = iid) is not null
         and not v_done ? (select tech from v1_modules where id = iid) then
        locked := locked || to_jsonb(nm);
      end if;
    end if;
    if st is null and mp is null then
      errs := errs || jsonb_build_object('i', i, 'msg', 'Предмет не найден — возможно, проект удалён');
      continue;
    end if;
    if v1_size_rank(sz) > v1_size_rank(cl.size) then
      errs := errs || jsonb_build_object('i', i, 'msg', format('«%s» размера %s не встанет на класс %s', nm, sz, cl.size));
    end if;
    if mp is not null then w := coalesce((mp->>'w')::int, 1); h := coalesce((mp->>'h')::int, 1);
    else w := case sz when 'S' then 1 when 'M' then 2 when 'L' then 2 else 3 end;
         h := case sz when 'S' then 1 when 'M' then 1 when 'L' then 2 else 2 end; end if;
    if rot = 1 then dx := w; w := h; h := dx; end if;

    -- клетки
    ok_edge := false; ok_stern := false; bad := false;
    for dy in 0 .. h - 1 loop
      for dx in 0 .. w - 1 loop
        cx := x + dx; cy := y + dy;
        if cx < 0 or cy < 0 or cx >= cl.w or cy >= cl.h or substr(cl.mask[cy + 1], cx + 1, 1) <> '#' then
          bad := true;
        else
          if occ ? (cx || ':' || cy) then
            errs := errs || jsonb_build_object('i', i, 'msg', format('«%s» наезжает на другой предмет', nm));
          end if;
          occ := occ || jsonb_build_object(cx || ':' || cy, i);
          used := used + 1;
          if cx = 0 or substr(cl.mask[cy + 1], cx, 1) <> '#' then ok_stern := true; ok_edge := true; end if;
          if cx = cl.w - 1 or substr(cl.mask[cy + 1], cx + 2, 1) <> '#' or cy = 0 or cy = cl.h - 1
             or substr(cl.mask[cy], cx + 1, 1) <> '#' or substr(cl.mask[cy + 2], cx + 1, 1) <> '#' then
            ok_edge := true;
          end if;
        end if;
      end loop;
    end loop;
    if bad then errs := errs || jsonb_build_object('i', i, 'msg', format('«%s» выходит за корпус', nm)); end if;

    if t = 'reactor' then
      reactors := reactors + 1;
      pw := pw + coalesce((st->>'power')::numeric, 0);
      mass := mass + coalesce((st->>'mass')::numeric, 0);
      cost := cost + coalesce((st->>'cost')::numeric, 0);
      fuel_use := fuel_use + coalesce((st->>'fuel_use')::numeric, 0);
      bill := v1_bill_add(bill, st->'bill');
      crew_need := crew_need + 3;
      if st ? 'broken' then errs := errs || jsonb_build_object('i', i, 'msg', format('Реактор «%s» сломан: пересоберите его', nm)); end if;
    elsif t = 'weapon' then
      guns := guns + 1;
      pu := pu + coalesce((st->>'energy')::numeric, 0);
      dmg := dmg + coalesce((st->>'damage')::numeric, 0);
      heal := heal + coalesce((st->>'heal')::numeric, 0);
      rng := greatest(rng, coalesce((st->>'dalnost')::numeric, 0));
      mass := mass + coalesce((st->>'mass')::numeric, 0);
      cost := cost + coalesce((st->>'cost')::numeric, 0);
      bill := v1_bill_add(bill, st->'bill');
      crew_need := crew_need + 2 * v1_size_rank(sz);
      if not ok_edge then errs := errs || jsonb_build_object('i', i, 'msg', format('Орудие «%s» должно касаться борта', nm)); end if;
    else
      mods := mods + 1;
      counts := jsonb_set(counts, array[mkind], to_jsonb(coalesce((counts->>mkind)::int, 0) + 1));
      pu := pu + coalesce((mp->>'energy')::numeric, 0);
      mass := mass + coalesce((mp->>'mass')::numeric, 0);
      cost := cost + coalesce((mp->>'cost')::numeric, 0);
      if mkind = 'engine' then
        engines := engines + 1; thrust := thrust + (mp->>'thrust')::numeric; crew_need := crew_need + 2;
        if not ok_stern then errs := errs || jsonb_build_object('i', i, 'msg', format('Двигатель «%s» должен стоять у кормы', nm)); end if;
      elsif mkind = 'bridge' then bridges := bridges + 1; crew_cap := crew_cap + (mp->>'crew')::numeric;
      elsif mkind = 'shield' then shield := shield + (mp->>'shield')::numeric; crew_need := crew_need + 1;
      elsif mkind = 'sensor' then radar := radar + (mp->>'radar')::numeric;
      elsif mkind = 'quarters' then crew_cap := crew_cap + (mp->>'crew')::numeric;
      elsif mkind = 'cargo' then cargo := cargo + (mp->>'cargo')::numeric;
      elsif mkind = 'hangar' then craft := craft + (mp->>'craft')::numeric; crew_need := crew_need + 20;
      elsif mkind = 'fuel_tank' then tank_cap := tank_cap + (mp->>'capacity')::numeric;
        tank_risk := greatest(tank_risk, coalesce((mp->>'risk')::numeric, 1));
      end if;
    end if;
  end loop;

  -- броня
  if nullif(p_cfg->>'alloy', '') is not null then
    select a.stats, a.name, a.recipe into al, al_name, al_recipe from v1_alloys a
     where a.id::text = p_cfg->>'alloy' and (p_fid is null or a.faction_id = p_fid);
    if al is null then errs := errs || jsonb_build_object('i', -1, 'msg', 'Сплав брони не найден');
    else
      resist := al->'resist'; hp_pct := coalesce((al->>'hpPercentBoost')::numeric, 0);
      mf := coalesce((al->>'mass_factor')::numeric, 1); al_speed := coalesce((al->>'speed')::numeric, 0);
      bill := v1_bill_add(bill, al_recipe, cells / 100.0);
    end if;
  end if;
  mass := mass + cells * coalesce((set_->>'armor_mass_per_cell')::numeric, 0.6) * mf;
  cost := cost + cells * coalesce((set_->>'armor_cost_per_cell')::numeric, 100) * case when al is null then 1 else 1.5 end;
  hp := round((cp->>'hp')::numeric * (1 + hp_pct));

  -- топливо в баках
  fu := p_cfg->'fuel';
  if tank_cap > 0 then
    if fu->>'kind' = 'fuel' then
      select f.stats, f.name into fst, fname from v1_fuels f where f.id::text = fu->>'id' and (p_fid is null or f.faction_id = p_fid);
    elsif fu->>'kind' = 'res' then
      fst := v1_fuel_raw(fu->>'res'); fname := fu->>'res';
    end if;
    if fst is null then warns := warns || '["Выберите топливо для баков"]';
    else jumps := floor(tank_cap * (fst->>'energy')::numeric * (fst->>'efficiency')::numeric / 300)::int; end if;
  elsif coalesce((cp->>'engines')::boolean, true) then
    warns := warns || '["Без топливных баков корабль не сможет ходить между системами"]';
  end if;
  autonomy := case when fuel_use > 0 and tank_cap > 0 then round(tank_cap / fuel_use, 1) else null end;

  speed := case when coalesce((cp->>'engines')::boolean, true)
                then round(coalesce((set_->>'speed_k')::numeric, 2.2) * (cp->>'speed')::numeric * thrust / greatest(mass, 1) * (1 + al_speed / 100.0), 1)
                else 0 end;

  -- обязательные узлы
  if bridges = 0 then errs := errs || '{"i":-1,"msg":"Нужен командный мостик"}'::jsonb; end if;
  if bridges > 1 then errs := errs || '{"i":-1,"msg":"Мостик может быть только один"}'::jsonb; end if;
  if reactors = 0 then errs := errs || '{"i":-1,"msg":"Нужен хотя бы один реактор"}'::jsonb; end if;
  if engines = 0 and coalesce((cp->>'engines')::boolean, true) then errs := errs || '{"i":-1,"msg":"Нужен хотя бы один двигатель"}'::jsonb; end if;
  if engines > 0 and not coalesce((cp->>'engines')::boolean, true) then errs := errs || '{"i":-1,"msg":"Станции двигатели не ставятся"}'::jsonb; end if;
  if pu > pw then errs := errs || jsonb_build_object('i', -1, 'msg', format('Не хватает энергии: нужно %s ЭЕ, реакторы дают %s', round(pu), round(pw))); end if;
  if crew_need > crew_cap then
    warns := warns || jsonb_build_array(format('Экипажа не хватает: нужно %s, мест %s. Добавьте жилые отсеки', round(crew_need), round(crew_cap)));
  end if;
  if jsonb_array_length(locked) > 0 then
    errs := errs || jsonb_build_object('i', -1, 'msg', 'Не изучены технологии: ' || (select string_agg(z, ', ') from jsonb_array_elements_text(locked) z));
  end if;

  return jsonb_build_object(
    'ok', true, 'class', cl.id, 'class_name', cl.name, 'size', cl.size,
    'cells', cells, 'used', used,
    'hp', hp, 'resist', resist, 'shield', shield, 'alloy_name', al_name,
    'damage', round(dmg), 'heal', round(heal), 'dalnost', rng,
    'power', round(pw), 'energy_use', round(pu), 'energy_free', round(pw - pu),
    'mass', round(mass), 'thrust', thrust, 'speed', speed,
    'crew', round(crew_need), 'crew_cap', round(crew_cap), 'radar', radar, 'cargo', cargo, 'craft', craft,
    'tank', tank_cap, 'tank_risk', tank_risk, 'fuel_name', fname, 'jumps', jumps, 'fuel_use', round(fuel_use, 2), 'autonomy', autonomy,
    'cost', round(cost), 'bill', bill,
    'counts', jsonb_build_object('reactors', reactors, 'weapons', guns, 'engines', engines, 'modules', mods) || counts,
    'errors', errs, 'warnings', warns,
    'registrable', jsonb_array_length(errs) = 0);
end $$;
revoke execute on function public.v1_ship_calc(text, jsonb, text) from public, anon;
grant execute on function public.v1_ship_calc(text, jsonb, text) to authenticated;

create or replace function public.v1_ship_preview(p_class text, p_cfg jsonb) returns jsonb
language sql stable security definer set search_path = public as $$
  select v1_ship_calc(p_class, p_cfg, v1_my_faction());
$$;
grant execute on function public.v1_ship_preview(text, jsonb) to authenticated;

-- ════════ 5. Состояние верфи ════════
create or replace function public.v1_shipyard_state() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_fid text := v1_my_faction(); v_done jsonb;
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  select coalesce(research, '[]'::jsonb) into v_done from faction_economy where faction_id = v_fid;
  v_done := coalesce(v_done, '[]'::jsonb);
  return jsonb_build_object(
    'can_edit', v1_can_manage(v_fid, 'produce'),
    'settings', coalesce((select value from v1_settings where key = 'shipyard'), '{}'::jsonb),
    'classes', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'descr', c.descr, 'size', c.size,
        'w', c.w, 'h', c.h, 'mask', to_jsonb(c.mask), 'params', c.params, 'tech_name', t.name,
        'open', c.tech is null or v_done ? c.tech) order by c.sort), '[]'::jsonb)
      from v1_ship_classes c left join v1_tech t on t.id = c.tech where not c.frozen),
    'modules', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'name', m.name, 'size', m.size,
        'params', m.params, 'descr', m.descr, 'tech_name', t.name, 'open', m.tech is null or v_done ? m.tech) order by m.sort), '[]'::jsonb)
      from v1_modules m left join v1_tech t on t.id = m.tech where not m.frozen),
    'reactors', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'size', cfg->>'size',
        'power', stats->'power', 'mass', stats->'mass', 'fuel_use', stats->'fuel_use', 'broken', stats ? 'broken') order by created_at), '[]'::jsonb)
      from v1_reactors where faction_id = v_fid),
    'weapons', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'size', cfg->>'size', 'kind', stats->>'kind',
        'damage', stats->'damage', 'heal', stats->'heal', 'energy', stats->'energy', 'mass', stats->'mass', 'dalnost', stats->'dalnost') order by created_at), '[]'::jsonb)
      from v1_weapons where faction_id = v_fid),
    'alloys', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'grade', stats->'grade') order by created_at), '[]'::jsonb)
      from v1_alloys where faction_id = v_fid),
    'fuels', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'grade', stats->'grade') order by created_at), '[]'::jsonb)
      from v1_fuels where faction_id = v_fid),
    'raw', (select coalesce(jsonb_agg(res order by sort), '[]'::jsonb) from v1_fuel_components),
    'ships', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'class', class, 'cfg', cfg, 'stats', stats,
        'created_at', created_at) order by created_at), '[]'::jsonb)
      from v1_ships where faction_id = v_fid));
end $$;
grant execute on function public.v1_shipyard_state() to authenticated;

-- ════════ 6. Регистрация, правка, удаление ════════
create or replace function public.v1_ship_save(p_id uuid, p_name text, p_class text, p_cfg jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_fid text := v1_my_faction();
  set_ jsonb := coalesce((select value from v1_settings where key = 'shipyard'), '{}'::jsonb);
  nm text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  clean jsonb; st jsonb; row_id uuid;
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(v_fid, 'produce') then raise exception 'forbidden'; end if;
  if char_length(nm) < 3 or char_length(nm) > 48 then raise exception 'ship_name'; end if;
  clean := jsonb_build_object(
    'layout', coalesce((select jsonb_agg(jsonb_build_object('t', e->>'t', 'id', e->>'id', 'x', (e->>'x')::int, 'y', (e->>'y')::int,
        'r', coalesce((e->>'r')::int, 0))) from jsonb_array_elements(coalesce(p_cfg->'layout', '[]'::jsonb)) e), '[]'::jsonb),
    'alloy', nullif(p_cfg->>'alloy', ''),
    'fuel', case when p_cfg->'fuel'->>'kind' = 'fuel' then jsonb_build_object('kind', 'fuel', 'id', p_cfg->'fuel'->>'id')
                 when p_cfg->'fuel'->>'kind' = 'res' then jsonb_build_object('kind', 'res', 'res', p_cfg->'fuel'->>'res')
                 else null end);
  st := v1_ship_calc(p_class, clean, v_fid);
  if not (st->>'ok')::boolean then raise exception '%', st->>'error'; end if;
  if not (st->>'registrable')::boolean then raise exception 'ship_invalid: %', st->'errors'->0->>'msg'; end if;
  if exists (select 1 from v1_ships where faction_id = v_fid and lower(name) = lower(nm) and id is distinct from p_id) then
    raise exception 'ship_name_taken';
  end if;
  if p_id is null then
    if (select count(*) from v1_ships where faction_id = v_fid) >= coalesce((set_->>'max_per_faction')::int, 40) then
      raise exception 'ship_limit';
    end if;
    insert into v1_ships(faction_id, owner_id, name, class, cfg, stats) values (v_fid, auth.uid(), nm, p_class, clean, st) returning id into row_id;
  else
    update v1_ships set name = nm, class = p_class, cfg = clean, stats = st, updated_at = now()
     where id = p_id and faction_id = v_fid returning id into row_id;
    if row_id is null then raise exception 'ship_not_found'; end if;
  end if;
  return jsonb_build_object('id', row_id, 'stats', st);
end $$;
revoke execute on function public.v1_ship_save(uuid, text, text, jsonb) from public, anon;
grant execute on function public.v1_ship_save(uuid, text, text, jsonb) to authenticated;

create or replace function public.v1_ship_delete(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction();
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(v_fid, 'produce') then raise exception 'forbidden'; end if;
  delete from v1_ships where id = p_id and faction_id = v_fid;
  if not found then raise exception 'ship_not_found'; end if;
  return true;
end $$;
revoke execute on function public.v1_ship_delete(uuid) from public, anon;
grant execute on function public.v1_ship_delete(uuid) to authenticated;

-- ════════ 7. Связи: пересчёт и защита от удаления ════════
create or replace function public.v1_ships_using(p_kind text, p_id text) returns setof uuid
language sql stable security definer set search_path = public as $$
  select s.id from v1_ships s
   where (p_kind in ('reactor', 'weapon') and exists (select 1 from jsonb_array_elements(s.cfg->'layout') e where e->>'t' = p_kind and e->>'id' = p_id))
      or (p_kind = 'alloy' and s.cfg->>'alloy' = p_id)
      or (p_kind = 'fuel' and s.cfg->'fuel'->>'id' = p_id);
$$;

create or replace function public.v1_ships_recalc(p_kind text, p_id text) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select s.id, s.class, s.cfg from v1_ships s where s.id in (select v1_ships_using(p_kind, p_id)) loop
    update v1_ships set stats = v1_ship_calc(r.class, r.cfg, null), updated_at = now() where id = r.id;
  end loop;
end $$;

create or replace function public.v1_part_after_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform v1_ships_recalc(tg_argv[0], new.id::text);
  return new;
end $$;
drop trigger if exists v1_reactor_ships on public.v1_reactors;
create trigger v1_reactor_ships after update of stats on public.v1_reactors for each row execute function public.v1_part_after_change('reactor');
drop trigger if exists v1_weapon_ships on public.v1_weapons;
create trigger v1_weapon_ships after update of stats on public.v1_weapons for each row execute function public.v1_part_after_change('weapon');
drop trigger if exists v1_alloy_ships on public.v1_alloys;
create trigger v1_alloy_ships after update of stats on public.v1_alloys for each row execute function public.v1_part_after_change('alloy');
drop trigger if exists v1_fuel_ships on public.v1_fuels;
create trigger v1_fuel_ships after update of stats on public.v1_fuels for each row execute function public.v1_part_after_change('fuel');

-- удаление: нельзя убрать то, что стоит на кораблях
create or replace function public.v1_part_in_ships(p_kind text, p_id uuid) returns void
language plpgsql stable security definer set search_path = public as $$
declare n int;
begin
  select count(*) into n from v1_ships_using(p_kind, p_id::text);
  if n > 0 then raise exception 'part_in_ships: %', n; end if;
end $$;

create or replace function public.v1_reactor_delete(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction();
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(v_fid, 'produce') then raise exception 'forbidden'; end if;
  perform v1_part_in_ships('reactor', p_id);
  delete from v1_reactors where id = p_id and faction_id = v_fid;
  if not found then raise exception 'reactor_not_found'; end if;
  return true;
end $$;

create or replace function public.v1_weapon_delete(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction();
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(v_fid, 'produce') then raise exception 'forbidden'; end if;
  perform v1_part_in_ships('weapon', p_id);
  delete from v1_weapons where id = p_id and faction_id = v_fid;
  if not found then raise exception 'weapon_not_found'; end if;
  return true;
end $$;

create or replace function public.v1_alloy_delete(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction(); n int;
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(v_fid, 'produce') then raise exception 'forbidden'; end if;
  select count(*) into n from v1_weapons where faction_id = v_fid and cfg->>'alloy' = p_id::text;
  if n > 0 then raise exception 'alloy_in_use: %', n; end if;
  perform v1_part_in_ships('alloy', p_id);
  delete from v1_alloys where id = p_id and faction_id = v_fid;
  if not found then raise exception 'alloy_not_found'; end if;
  return true;
end $$;

create or replace function public.v1_fuel_delete(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction(); n int;
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(v_fid, 'produce') then raise exception 'forbidden'; end if;
  select count(*) into n from v1_reactors where faction_id = v_fid and cfg->'fuel'->>'id' = p_id::text;
  if n > 0 then raise exception 'fuel_in_use: %', n; end if;
  perform v1_part_in_ships('fuel', p_id);
  delete from v1_fuels where id = p_id and faction_id = v_fid;
  if not found then raise exception 'fuel_not_found'; end if;
  return true;
end $$;

revoke execute on function public.v1_ships_using(text, text), public.v1_ships_recalc(text, text), public.v1_part_in_ships(text, uuid) from public, anon, authenticated;
