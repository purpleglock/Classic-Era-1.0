-- Классическая эра 1.0 · Конструктор топлива и модуль «Топливный бак».
--
-- Держава смешивает топливо из игровых ресурсов и регистрирует его как свою
-- марку. Чем больше энергии в смеси, тем она нестабильнее: лучшая оценка —
-- у «золотой середины», а не у самой мощной или самой безопасной смеси.
-- Регистрация ничего не списывает со склада: ресурсы будут тратиться при
-- заправке кораблей (переработанный конструктор кораблей).
--
-- Расчёт — одна функция v1_fuel_calc: её же вызывает предпросмотр на сайте,
-- поэтому формулы на сайте и в базе не расходятся.

set lock_timeout = '15s';

-- ════════ 1. Компоненты топлива ════════
-- e — энергия на 100 % смеси, t — тяга (1 = обычная), s — вклад в стабильность
-- на 100 % смеси (база 50), eff — экономичность расхода, grp — семейство.
create table if not exists public.v1_fuel_components (
  res   text primary key,           -- имя ресурса как на складе (faction_economy.resources)
  role  text not null,              -- роль в смеси, для подсказки
  grp   text not null check (grp in ('chem', 'mass', 'ion', 'nuclear', 'fusion', 'exotic')),
  e     numeric not null,
  t     numeric not null,
  s     numeric not null,
  eff   numeric not null,
  note  text not null,
  sort  int not null default 0
);
alter table public.v1_fuel_components enable row level security;
drop policy if exists v1_fuel_components_read on public.v1_fuel_components;
create policy v1_fuel_components_read on public.v1_fuel_components for select using (true);
grant select on public.v1_fuel_components to anon, authenticated;

insert into public.v1_fuel_components(res, role, grp, e, t, s, eff, note, sort) values
  ('Метан',          'горючее',            'chem',    30, 1.20,  20, 0.80, 'Дешёвое химическое горючее: сильная тяга, мало энергии. С окислителем горит лучше.', 10),
  ('Аммиачный лёд',  'однокомпонентное',   'chem',    22, 1.00,  10, 0.85, 'Горит без окислителя. Средняя тяга, спокойный характер.', 20),
  ('Лёд',            'окислитель',         'mass',     5, 0.80,  30, 0.70, 'Кислород и рабочее тело. Сам почти не даёт энергии, но гасит нестабильность.', 30),
  ('Жидкая вода',    'рабочее тело',       'mass',     0, 0.70,  45, 0.60, 'Охладитель и рабочее тело для ядерного контура. Лучший стабилизатор из обычных ресурсов.', 40),
  ('Ионит',          'ионное рабочее тело', 'ion',    40, 0.30,  15, 1.60, 'Очень экономичен в расходе, но тяга слабая: далеко, зато медленно.', 50),
  ('Изотопы',        'делящееся',          'nuclear', 70, 1.10, -35, 1.00, 'Ядерное тепловое топливо. Без рабочего тела перегревается.', 60),
  ('Дейтерий',       'термоядерное',       'fusion',  80, 1.00, -25, 1.10, 'Основное термоядерное горючее. Мощное, но капризное.', 70),
  ('Гелий-3',        'термоядерное',       'fusion',  75, 0.90,   5, 1.20, 'Чистый синтез почти без нейтронов. В паре с дейтерием даёт лучший цикл.', 80),
  ('Стелларит',      'катализатор',        'exotic', 110, 1.30, -60, 1.00, 'Звёздный катализатор: резко поднимает энергию смеси и её опасность.', 90),
  ('Хтонит',         'экзотическое горючее', 'exotic', 150, 1.50, -90, 0.90, 'Самое энергоёмкое вещество в игре. В чистом виде взрывается от искры.', 100),
  ('Гравиядро',      'стабилизатор поля',  'exotic',  20, 0.80, 120, 1.00, 'Удерживает смесь гравитационным полем. Делает возможными самые злые составы.', 110)
on conflict (res) do update set role = excluded.role, grp = excluded.grp, e = excluded.e, t = excluded.t,
  s = excluded.s, eff = excluded.eff, note = excluded.note, sort = excluded.sort;

-- ════════ 2. Зарегистрированные марки топлива ════════
create table if not exists public.v1_fuels (
  id          uuid primary key default gen_random_uuid(),
  faction_id  text not null,
  owner_id    uuid references auth.users(id) on delete set null,
  name        text not null,
  recipe      jsonb not null,
  stats       jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists v1_fuels_name on public.v1_fuels(faction_id, lower(name));
create index if not exists v1_fuels_fid on public.v1_fuels(faction_id);
alter table public.v1_fuels enable row level security;
revoke all on public.v1_fuels from anon, authenticated;   -- только через функции: чужие формулы скрыты

insert into public.v1_settings(key, value) values
  ('fuel', '{"min_units": 10, "max_units": 100, "max_per_faction": 10, "min_stability": 5, "tank_ref": 25, "jump_energy": 300}')
on conflict (key) do nothing;

-- ════════ 3. Модули кораблей: топливные баки ════════
-- Общий каталог модулей для переработанного конструктора кораблей.
create table if not exists public.v1_modules (
  id      text primary key,
  kind    text not null,
  name    text not null,
  size    text not null check (size in ('S', 'M', 'L')),
  params  jsonb not null default '{}'::jsonb,
  descr   text not null default '',
  sort    int not null default 0,
  frozen  boolean not null default false
);
alter table public.v1_modules enable row level security;
drop policy if exists v1_modules_read on public.v1_modules;
create policy v1_modules_read on public.v1_modules for select using (true);
grant select on public.v1_modules to anon, authenticated;

-- capacity — единиц топлива; mass — тонн; slots — мест в корпусе; hp — прочность модуля;
-- risk — множитель риска детонации при пробитии; cost — ГС за модуль.
insert into public.v1_modules(id, kind, name, size, params, descr, sort) values
  ('tank_s',   'fuel_tank', 'Малый топливный бак',       'S', '{"capacity": 10, "mass": 4,  "slots": 1, "hp": 40,  "risk": 1.00, "cost": 300}',
   'Для корветов и катеров. Хватает на короткие переходы.', 10),
  ('tank_m',   'fuel_tank', 'Стандартный топливный бак', 'M', '{"capacity": 25, "mass": 9,  "slots": 2, "hp": 90,  "risk": 1.00, "cost": 650}',
   'Эталонный бак: по нему считается дальность марки топлива.', 20),
  ('tank_l',   'fuel_tank', 'Большой топливный бак',     'L', '{"capacity": 60, "mass": 20, "slots": 4, "hp": 180, "risk": 1.15, "cost": 1400}',
   'Дальние рейды и тяжёлые корабли. Крупная цель: риск детонации выше.', 30),
  ('tank_arm', 'fuel_tank', 'Бронированный бак',         'M', '{"capacity": 18, "mass": 14, "slots": 2, "hp": 220, "risk": 0.45, "cost": 1100}',
   'Меньше топлива, зато пробить и подорвать его вдвое труднее. Для нестабильных марок.', 40)
on conflict (id) do update set kind = excluded.kind, name = excluded.name, size = excluded.size,
  params = excluded.params, descr = excluded.descr, sort = excluded.sort;

-- ════════ 4. Расчёт смеси ════════
create or replace function public.v1_fuel_calc(p_recipe jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  cfg jsonb := coalesce((select value from v1_settings where key = 'fuel'), '{}'::jsonb);
  mn int := coalesce((cfg->>'min_units')::int, 10);
  mx int := coalesce((cfg->>'max_units')::int, 100);
  tank numeric := coalesce((cfg->>'tank_ref')::numeric, 25);
  jump_e numeric := coalesce((cfg->>'jump_energy')::numeric, 300);
  k text; v jsonb; n numeric; total numeric := 0; kinds int := 0;
  c v1_fuel_components;
  e numeric := 0; t numeric := 0; s numeric := 50; eff numeric := 0; cost numeric := 0;
  f jsonb := '{}'::jsonb;              -- доли по ресурсам
  g jsonb := '{}'::jsonb;              -- вес семейств
  traits jsonb := '[]'::jsonb; warns jsonb := '[]'::jsonb;
  em numeric := 1; tm numeric := 1; effm numeric := 1; ds numeric := 0;
  fx numeric; cls text; best numeric := -1; grade numeric; risk numeric; jumps int; speed int; blast int;
  price numeric;
begin
  if p_recipe is null or jsonb_typeof(p_recipe) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'fuel_empty');
  end if;
  for k, v in select * from jsonb_each(p_recipe) loop
    if not exists (select 1 from v1_fuel_components where res = k) then
      return jsonb_build_object('ok', false, 'error', 'fuel_bad_resource', 'res', k);
    end if;
    if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric < 0 or (v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric) then
      return jsonb_build_object('ok', false, 'error', 'fuel_bad_amount', 'res', k);
    end if;
    n := (v #>> '{}')::numeric;
    if n > 0 then total := total + n; kinds := kinds + 1; end if;
  end loop;
  if total = 0 then return jsonb_build_object('ok', false, 'error', 'fuel_empty'); end if;
  if total < mn or total > mx then
    return jsonb_build_object('ok', false, 'error', 'fuel_total', 'total', total, 'min', mn, 'max', mx);
  end if;

  -- базовые свойства: взвешенные по долям
  for c in select * from v1_fuel_components order by sort loop
    n := coalesce((p_recipe->>c.res)::numeric, 0);
    if n <= 0 then continue; end if;
    fx := n / total;
    f := f || jsonb_build_object(c.res, fx);
    g := jsonb_set(g, array[c.grp], to_jsonb(coalesce((g->>c.grp)::numeric, 0) + fx * (c.e + 10)));
    e := e + fx * c.e;
    t := t + fx * c.t;
    s := s + fx * c.s;
    eff := eff + fx * c.eff;
    price := coalesce((select base_price from market_resources where name = c.res), 10);
    cost := cost + fx * price;
  end loop;

  -- сочетания
  if coalesce((f->>'Метан')::numeric, 0) >= 0.2 and coalesce((f->>'Лёд')::numeric, 0) >= 0.2 then
    em := em * 1.15; ds := ds + 5;
    traits := traits || '["Метанокислородная смесь"]';
  end if;
  if coalesce((f->>'Дейтерий')::numeric, 0) >= 0.15 and coalesce((f->>'Гелий-3')::numeric, 0) >= 0.15 then
    em := em * 1.2; ds := ds + 10;
    traits := traits || '["Дейтерий-гелиевый цикл"]';
  end if;
  if coalesce((f->>'Изотопы')::numeric, 0) >= 0.15 then
    if coalesce((f->>'Жидкая вода')::numeric, 0) + coalesce((f->>'Лёд')::numeric, 0) >= 0.25 then
      em := em * 1.15; tm := tm * 1.1; ds := ds + 8;
      traits := traits || '["Ядерный тепловой контур"]';
    else
      ds := ds - 15;
      warns := warns || '["Перегрев: изотопам нужно рабочее тело — вода или лёд, не меньше 25 % смеси"]';
    end if;
  end if;
  if coalesce((f->>'Ионит')::numeric, 0) >= 0.4 then
    effm := effm * 1.3; tm := tm * 0.6;
    traits := traits || '["Ионная плазма"]';
  end if;
  if coalesce((f->>'Стелларит')::numeric, 0) >= 0.05 then
    em := em * (1 + 2 * least((f->>'Стелларит')::numeric, 0.3)); ds := ds - 15;
    traits := traits || '["Звёздный катализ"]';
  end if;
  if coalesce((f->>'Хтонит')::numeric, 0) >= 0.1 then
    traits := traits || '["Хтоническое ядро"]';
    warns := warns || '["Хтонит: смесь детонирует при любом серьёзном попадании, если её не стабилизировать"]';
  end if;
  if coalesce((f->>'Гравиядро')::numeric, 0) >= 0.05 then
    ds := ds + 20;
    traits := traits || '["Гравитационная стабилизация"]';
  end if;
  if kinds > 6 then
    ds := ds - 5 * (kinds - 6);
    warns := warns || jsonb_build_array(format('Слишком много компонентов (%s): смесь расслаивается, стабильность −%s', kinds, 5 * (kinds - 6)));
  end if;

  e := round(e * em, 1);
  t := round(t * tm, 2);
  eff := round(eff * effm, 2);
  s := round(greatest(0, least(100, s + ds)), 1);

  -- семейство — по наибольшему энергетическому вкладу
  for k, v in select * from jsonb_each(g) loop
    if (v #>> '{}')::numeric > best then best := (v #>> '{}')::numeric; cls := k; end if;
  end loop;

  jumps := greatest(1, floor(tank * e * eff / jump_e))::int;
  speed := round((t - 1) * 40)::int;
  risk := round(60 * power((100 - s) / 100, 2), 1);
  blast := least(60, round(e / 3))::int;
  -- (0.9 … 1.0): экономичность даёт до +10 % к оценке
  grade := least(100, round(100 * sqrt(least(e, 150) / 150 * s / 100) * (0.9 + 0.1 * least(eff, 1.6) / 1.6)));

  if s < coalesce((cfg->>'min_stability')::numeric, 5) then
    warns := warns || '["Смесь не держит форму: такую марку зарегистрировать нельзя"]';
  end if;

  return jsonb_build_object(
    'ok', true, 'total', total, 'kinds', kinds, 'class', cls,
    'energy', e, 'thrust', t, 'stability', s, 'efficiency', eff,
    'jumps', jumps, 'speed', speed, 'risk', risk, 'blast', blast,
    'cost', round(cost, 2), 'grade', grade,
    'tier', case when grade >= 80 then 'Шедевр' when grade >= 65 then 'Элитное' when grade >= 45 then 'Боевое'
                 when grade >= 25 then 'Рабочее' else 'Сырое' end,
    'stab_tier', case when s >= 75 then 'Стабильное' when s >= 50 then 'Умеренное'
                      when s >= 25 then 'Нестабильное' else 'Взрывоопасное' end,
    'traits', traits, 'warnings', warns,
    'registrable', s >= coalesce((cfg->>'min_stability')::numeric, 5));
end $$;
grant execute on function public.v1_fuel_calc(jsonb) to anon, authenticated;

-- ════════ 5. Состояние конструктора ════════
create or replace function public.v1_fuel_state() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_fid text := v1_my_faction(); v_stock jsonb;
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  select coalesce(resources, '{}'::jsonb) into v_stock from faction_economy where faction_id = v_fid;
  return jsonb_build_object(
    'can_edit', v1_can_manage(v_fid, 'produce'),
    'settings', coalesce((select value from v1_settings where key = 'fuel'), '{}'::jsonb),
    'components', (select coalesce(jsonb_agg(jsonb_build_object(
        'res', c.res, 'role', c.role, 'grp', c.grp, 'e', c.e, 't', c.t, 's', c.s, 'eff', c.eff, 'note', c.note,
        'rarity', r.rarity, 'price', m.base_price, 'stock', coalesce((v_stock->>c.res)::numeric, 0)) order by c.sort), '[]'::jsonb)
      from v1_fuel_components c left join resource_rarity r on r.name = c.res left join market_resources m on m.name = c.res),
    'fuels', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'recipe', recipe, 'stats', stats,
        'created_at', created_at, 'updated_at', updated_at) order by created_at), '[]'::jsonb)
      from v1_fuels where faction_id = v_fid),
    'tanks', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'size', size, 'params', params, 'descr', descr) order by sort), '[]'::jsonb)
      from v1_modules where kind = 'fuel_tank' and not frozen));
end $$;
grant execute on function public.v1_fuel_state() to authenticated;

-- ════════ 6. Регистрация, правка, удаление ════════
create or replace function public.v1_fuel_save(p_id uuid, p_name text, p_recipe jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_fid text := v1_my_faction();
  cfg jsonb := coalesce((select value from v1_settings where key = 'fuel'), '{}'::jsonb);
  nm text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  st jsonb; clean jsonb := '{}'::jsonb; k text; v jsonb; row_id uuid;
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(v_fid, 'produce') then raise exception 'forbidden'; end if;
  if char_length(nm) < 3 or char_length(nm) > 48 then raise exception 'fuel_name'; end if;
  -- нули из рецепта убираем
  for k, v in select * from jsonb_each(coalesce(p_recipe, '{}'::jsonb)) loop
    if jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric > 0 then clean := clean || jsonb_build_object(k, v); end if;
  end loop;
  st := v1_fuel_calc(clean);
  if not (st->>'ok')::boolean then raise exception '%', st->>'error'; end if;
  if not (st->>'registrable')::boolean then raise exception 'fuel_unstable'; end if;
  if exists (select 1 from v1_fuels where faction_id = v_fid and lower(name) = lower(nm) and id is distinct from p_id) then
    raise exception 'fuel_name_taken';
  end if;

  if p_id is null then
    if (select count(*) from v1_fuels where faction_id = v_fid) >= coalesce((cfg->>'max_per_faction')::int, 10) then
      raise exception 'fuel_limit';
    end if;
    insert into v1_fuels(faction_id, owner_id, name, recipe, stats)
    values (v_fid, auth.uid(), nm, clean, st) returning id into row_id;
  else
    update v1_fuels set name = nm, recipe = clean, stats = st, updated_at = now()
     where id = p_id and faction_id = v_fid returning id into row_id;
    if row_id is null then raise exception 'fuel_not_found'; end if;
  end if;
  return jsonb_build_object('id', row_id, 'stats', st);
end $$;
revoke execute on function public.v1_fuel_save(uuid, text, jsonb) from public, anon;
grant execute on function public.v1_fuel_save(uuid, text, jsonb) to authenticated;

create or replace function public.v1_fuel_delete(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction();
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(v_fid, 'produce') then raise exception 'forbidden'; end if;
  delete from v1_fuels where id = p_id and faction_id = v_fid;
  if not found then raise exception 'fuel_not_found'; end if;
  return true;
end $$;
revoke execute on function public.v1_fuel_delete(uuid) from public, anon;
grant execute on function public.v1_fuel_delete(uuid) to authenticated;
