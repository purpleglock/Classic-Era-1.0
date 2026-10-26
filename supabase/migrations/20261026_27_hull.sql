-- Классическая эра 1.0 · Конструктор корпусов (сплавы брони), с нуля.
--
-- Держава сплавляет броню из игровых ресурсов и выбирает способ обработки.
-- На выходе — стойкость к кинетике, энергии и ракетам, прочность корпуса,
-- масса и особые свойства. Лучшая оценка — у «золотой середины» между
-- защитой и весом: тяжёлая броня держит удар, но тормозит корабль.
--
-- Выходные поля resist / hpPercentBoost / capacityBoost — в том же масштабе,
-- что у сплавов старого образца, чтобы корабли не потеряли защиту.
-- Старые сплавы (faction_armor_alloys) — архив; запрет на их создание —
-- в 20261026_26_reactor_archive.sql (день перехода).

set lock_timeout = '15s';

-- ════════ 1. Компоненты сплава ════════
-- k / en / mi — стойкость к кинетике, энергии, ракетам на 100 % сплава;
-- hp — прибавка прочности корпуса; dens — плотность (г/см³, масса брони);
-- heat — температура разрушения (°C); grp — семейство для подписи.
create table if not exists public.v1_hull_components (
  res   text primary key,
  grp   text not null check (grp in ('metal', 'ceramic', 'composite', 'heavy', 'organic', 'exotic')),
  role  text not null,
  k     numeric not null,
  en    numeric not null,
  mi    numeric not null,
  hp    numeric not null,
  dens  numeric not null,
  heat  numeric not null,
  note  text not null,
  sort  int not null default 0
);
alter table public.v1_hull_components enable row level security;
drop policy if exists v1_hull_components_read on public.v1_hull_components;
create policy v1_hull_components_read on public.v1_hull_components for select using (true);
grant select on public.v1_hull_components to anon, authenticated;

insert into public.v1_hull_components(res, grp, role, k, en, mi, hp, dens, heat, note, sort) values
  ('Железо',              'metal',     'основа',              0.45, 0.10, 0.15, 0.15,  7.8, 1500, 'Дешёвая и прочная основа. Хорошо держит кинетику, но тяжёлая и плохо переносит лучи.', 10),
  ('Титан',               'metal',     'лёгкая основа',       0.50, 0.20, 0.20, 0.20,  4.5, 1650, 'Прочнее железа и почти вдвое легче. Лучшая основа для большинства корпусов.', 20),
  ('Медь',                'metal',     'теплоотвод',          0.15, 0.30, 0.05, 0.05,  8.9, 1080, 'Быстро растаскивает тепло от луча по корпусу. Сама по себе мягкая.', 30),
  ('Углерод',             'composite', 'волокно',             0.35, 0.25, 0.25, 0.10,  2.0, 3000, 'Углеволокно: лёгкое, жаростойкое, хорошо гасит осколки.', 40),
  ('Силикаты',            'ceramic',   'керамика',            0.25, 0.35, 0.10, 0.05,  2.6, 1700, 'Керамические плитки: держат жар, но трескаются от взрывов.', 50),
  ('Редкоземельные руды', 'composite', 'реактивный слой',     0.25, 0.25, 0.35, 0.10,  6.5, 1400, 'Реактивные вставки срабатывают навстречу ракете и сбивают её кумулятивную струю.', 60),
  ('Платина',             'heavy',     'отражатель',          0.30, 0.45, 0.10, 0.10, 21.4, 1770, 'Зеркальный слой рассеивает лучи. Очень тяжёлый и дорогой.', 70),
  ('Реликтовое дерево',   'organic',   'живая подложка',      0.20, 0.10, 0.30, 0.25,  0.9,  400, 'Плотная древесина-реликт гасит удары и понемногу затягивает трещины.', 80),
  ('Старвис',             'exotic',    'каркас',              0.70, 0.40, 0.40, 0.45,  5.0, 2600, 'Звёздный сплав для каркаса тяжёлых кораблей: поднимает и стойкость, и прочность.', 90),
  ('Стелларит',           'exotic',    'жаровой щит',         0.30, 0.70, 0.20, 0.15,  3.2, 4200, 'Выдерживает температуру звёздной короны. Лучшее, что есть против лучей.', 100),
  ('Рагенод',             'exotic',    'регенерация',         0.40, 0.40, 0.40, 0.35,  4.0, 2000, 'Восстанавливает повреждённую броню прямо в бою.', 110),
  ('Программируемая материя', 'exotic', 'адаптивный слой',    0.35, 0.35, 0.35, 0.30,  3.0, 2200, 'Перестраивается под тип попадания и подтягивает самую слабую стойкость.', 120)
on conflict (res) do update set grp = excluded.grp, role = excluded.role, k = excluded.k, en = excluded.en, mi = excluded.mi,
  hp = excluded.hp, dens = excluded.dens, heat = excluded.heat, note = excluded.note, sort = excluded.sort;

-- ════════ 2. Способ обработки ════════
-- k / en / mi / hp — множители; cost — множитель цены; tech — нужна технология.
create table if not exists public.v1_hull_process (
  id     text primary key,
  name   text not null,
  descr  text not null,
  tech   text,
  params jsonb not null,
  sort   int not null default 0
);
alter table public.v1_hull_process enable row level security;
drop policy if exists v1_hull_process_read on public.v1_hull_process;
create policy v1_hull_process_read on public.v1_hull_process for select using (true);
grant select on public.v1_hull_process to anon, authenticated;

insert into public.v1_hull_process(id, name, descr, tech, params, sort) values
  ('cast',    'Литьё',              'Сплав разливают по формам. Дёшево и быстро, без сюрпризов.', null,
   '{"k":1.0,"en":1.0,"mi":1.0,"hp":1.0,"cost":1.0}', 10),
  ('forge',   'Ковка',              'Плиты проковывают под прессом: металл плотнее и лучше держит снаряды.', null,
   '{"k":1.12,"en":0.97,"mi":1.0,"hp":1.06,"cost":1.25}', 20),
  ('sinter',  'Спекание',           'Порошок спекают в печи: лучше для керамики и жаровых слоёв, хуже для взрывов.', null,
   '{"k":0.97,"en":1.14,"mi":0.94,"hp":1.0,"cost":1.3}', 30),
  ('layered', 'Слоистое напыление', 'Броню собирают из тонких чередующихся слоёв: понемногу лучше во всём.', 'comp.ship.armor',
   '{"k":1.06,"en":1.06,"mi":1.06,"hp":1.04,"cost":1.6}', 40),
  ('nano',    'Наноупорядочение',   'Кристаллическая решётка выстраивается на уровне атомов. Предел возможного, и по цене тоже.', 'comp.ship.armor',
   '{"k":1.14,"en":1.14,"mi":1.14,"hp":1.1,"cost":2.4}', 50)
on conflict (id) do update set name = excluded.name, descr = excluded.descr, tech = excluded.tech,
  params = excluded.params, sort = excluded.sort;

update public.v1_tech set descr = 'Открывает слоистое напыление и наноупорядочение в конструкторе корпусов.'
 where id = 'comp.ship.armor';

-- ════════ 3. Зарегистрированные сплавы ════════
create table if not exists public.v1_alloys (
  id          uuid primary key default gen_random_uuid(),
  faction_id  text not null,
  owner_id    uuid references auth.users(id) on delete set null,
  name        text not null,
  recipe      jsonb not null,
  process     text not null,
  stats       jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists v1_alloys_name on public.v1_alloys(faction_id, lower(name));
create index if not exists v1_alloys_fid on public.v1_alloys(faction_id);
alter table public.v1_alloys enable row level security;
revoke all on public.v1_alloys from anon, authenticated;

insert into public.v1_settings(key, value) values
  ('hull', '{"min_units": 10, "max_units": 100, "max_per_faction": 12}')
on conflict (key) do nothing;

-- ════════ 4. Расчёт ════════
create or replace function public.v1_alloy_calc(p_recipe jsonb, p_process text, p_fid text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  cfg jsonb := coalesce((select value from v1_settings where key = 'hull'), '{}'::jsonb);
  mn int := coalesce((cfg->>'min_units')::int, 10);
  mx int := coalesce((cfg->>'max_units')::int, 100);
  pr v1_hull_process; pp jsonb;
  c v1_hull_components;
  key text; val jsonb; n numeric; total numeric := 0; kinds int := 0;
  sh jsonb := '{}'::jsonb;  -- доли
  g jsonb := '{}'::jsonb;   -- вес семейств
  rk numeric := 0; ren numeric := 0; rmi numeric := 0; hpp numeric := 0; dn numeric := 0; ht numeric := 0;
  regen numeric := 0; sig numeric := 0; cost numeric := 0; price numeric;
  traits jsonb := '[]'::jsonb; warns jsonb := '[]'::jsonb;
  fx numeric; lo numeric; avg3 numeric; best numeric := -1; cls text;
  prot numeric; light numeric; grade numeric; done jsonb; locked boolean := false;
  f_fe numeric; f_ti numeric; f_c numeric; f_si numeric; f_cu numeric; f_pt numeric; f_star numeric; f_wood numeric; f_rag numeric; f_pm numeric; f_re numeric; f_stel numeric;
begin
  select * into pr from v1_hull_process where id = coalesce(p_process, 'cast');
  if pr.id is null then return jsonb_build_object('ok', false, 'error', 'alloy_process'); end if;
  pp := pr.params;
  if p_fid is not null and pr.tech is not null then
    select coalesce(research, '[]'::jsonb) into done from faction_economy where faction_id = p_fid;
    locked := not coalesce(done, '[]'::jsonb) ? pr.tech;
  end if;

  if p_recipe is null or jsonb_typeof(p_recipe) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'alloy_empty');
  end if;
  for key, val in select * from jsonb_each(p_recipe) loop
    if not exists (select 1 from v1_hull_components where res = key) then
      return jsonb_build_object('ok', false, 'error', 'alloy_bad_resource', 'res', key);
    end if;
    if jsonb_typeof(val) <> 'number' or (val #>> '{}')::numeric < 0 or (val #>> '{}')::numeric <> trunc((val #>> '{}')::numeric) then
      return jsonb_build_object('ok', false, 'error', 'alloy_bad_amount', 'res', key);
    end if;
    n := (val #>> '{}')::numeric;
    if n > 0 then total := total + n; kinds := kinds + 1; end if;
  end loop;
  if total = 0 then return jsonb_build_object('ok', false, 'error', 'alloy_empty'); end if;
  if total < mn or total > mx then
    return jsonb_build_object('ok', false, 'error', 'alloy_total', 'total', total, 'min', mn, 'max', mx);
  end if;

  for c in select * from v1_hull_components order by sort loop
    n := coalesce((p_recipe->>c.res)::numeric, 0);
    if n <= 0 then continue; end if;
    fx := n / total;
    sh := sh || jsonb_build_object(c.res, fx);
    g := jsonb_set(g, array[c.grp], to_jsonb(coalesce((g->>c.grp)::numeric, 0) + fx));
    rk := rk + fx * c.k; ren := ren + fx * c.en; rmi := rmi + fx * c.mi; hpp := hpp + fx * c.hp;
    dn := dn + fx * c.dens; ht := ht + fx * c.heat;
    price := coalesce((select base_price from market_resources where name = c.res), 10);
    cost := cost + fx * price;
  end loop;

  f_fe := coalesce((sh->>'Железо')::numeric, 0);  f_ti := coalesce((sh->>'Титан')::numeric, 0);
  f_c := coalesce((sh->>'Углерод')::numeric, 0);  f_si := coalesce((sh->>'Силикаты')::numeric, 0);
  f_cu := coalesce((sh->>'Медь')::numeric, 0);    f_pt := coalesce((sh->>'Платина')::numeric, 0);
  f_star := coalesce((sh->>'Старвис')::numeric, 0); f_wood := coalesce((sh->>'Реликтовое дерево')::numeric, 0);
  f_rag := coalesce((sh->>'Рагенод')::numeric, 0); f_pm := coalesce((sh->>'Программируемая материя')::numeric, 0);
  f_re := coalesce((sh->>'Редкоземельные руды')::numeric, 0); f_stel := coalesce((sh->>'Стелларит')::numeric, 0);

  -- удачные сочетания
  if f_fe >= 0.3 and f_c between 0.08 and 0.3 then
    rk := rk + 0.10; hpp := hpp + 0.05; traits := traits || '["Углеродистая сталь"]';
  end if;
  if f_ti >= 0.25 and f_si >= 0.2 then
    ren := ren + 0.10; rk := rk + 0.04; traits := traits || '["Титанокерамика"]';
  end if;
  if f_cu between 0.08 and 0.25 and (f_fe + f_ti) >= 0.3 then
    ren := ren + 0.08; ht := ht + 300; traits := traits || '["Теплоотводящая сетка"]';
  end if;
  if f_pt >= 0.12 then
    ren := ren + 0.12; traits := traits || '["Зеркальный слой"]';
  end if;
  if f_re >= 0.15 and (f_fe + f_ti + f_star) >= 0.3 then
    rmi := rmi + 0.10; traits := traits || '["Реактивная защита"]';
  end if;
  if f_star >= 0.1 then
    hpp := hpp + 0.12; traits := traits || '["Звёздный каркас"]';
  end if;
  if f_stel >= 0.1 then
    ht := ht + 800; traits := traits || '["Жаровой щит"]';
  end if;
  if f_wood >= 0.2 then
    regen := regen + 1.5 * least(f_wood, 0.5) / 0.5; sig := sig - 5; traits := traits || '["Живая подложка"]';
  end if;
  if f_rag >= 0.05 then
    regen := regen + 2 + 6 * least(f_rag, 0.3) / 0.3; traits := traits || '["Регенерация"]';
  end if;
  -- штрафы
  if f_si + f_c >= 0.6 then
    rmi := rmi - 0.15; warns := warns || '["Хрупкость: керамика и волокно трескаются от взрывов — стойкость к ракетам снижена"]';
  end if;
  if f_wood >= 0.4 then
    ren := ren - 0.15; warns := warns || '["Древесина горит: при доле больше 40 % лучи прожигают её насквозь"]';
  end if;
  if kinds > 6 then
    rk := rk - 0.03 * (kinds - 6); ren := ren - 0.03 * (kinds - 6); rmi := rmi - 0.03 * (kinds - 6);
    warns := warns || jsonb_build_array(format('Слишком много компонентов (%s): сплав неоднородный, стойкость ниже', kinds));
  end if;

  -- обработка
  rk := rk * (pp->>'k')::numeric; ren := ren * (pp->>'en')::numeric; rmi := rmi * (pp->>'mi')::numeric;
  hpp := hpp * (pp->>'hp')::numeric; cost := cost * (pp->>'cost')::numeric;

  -- адаптивный слой подтягивает самую слабую стойкость
  if f_pm >= 0.05 then
    avg3 := (rk + ren + rmi) / 3;
    lo := least(rk, ren, rmi);
    fx := least(1, f_pm / 0.2);
    if rk = lo then rk := rk + (avg3 - rk) * fx * 0.8; elsif ren = lo then ren := ren + (avg3 - ren) * fx * 0.8; else rmi := rmi + (avg3 - rmi) * fx * 0.8; end if;
    traits := traits || '["Адаптивная решётка"]';
  end if;

  rk := round(greatest(-0.3, least(0.9, rk)), 3);
  ren := round(greatest(-0.3, least(0.9, ren)), 3);
  rmi := round(greatest(-0.3, least(0.9, rmi)), 3);
  hpp := round(greatest(0, least(0.65, hpp)), 3);
  dn := round(dn, 2);

  for key, val in select * from jsonb_each(g) loop
    if (val #>> '{}')::numeric > best then best := (val #>> '{}')::numeric; cls := key; end if;
  end loop;

  -- оценка: защита × лёгкость — тяжёлая броня держит удар, но тормозит корабль
  prot := least(1, ((rk + ren + rmi) / 3 + hpp * 0.5) / 0.6);
  light := least(1, 4 / greatest(dn, 0.5));
  grade := least(100, round(100 * sqrt(greatest(prot, 0) * light) * (1 + least(regen, 8) / 80)));

  if locked then warns := warns || jsonb_build_array(format('Способ «%s» откроется после технологии «%s»', pr.name,
       coalesce((select name from v1_tech where id = pr.tech), pr.tech))); end if;

  return jsonb_build_object(
    'ok', true, 'total', total, 'kinds', kinds, 'class', cls, 'process', pr.id, 'process_name', pr.name,
    'resist', jsonb_build_object('kinetic', rk, 'energy', ren, 'missile', rmi),
    'hpPercentBoost', hpp,
    'density', dn,
    'mass_factor', round(dn / 7.8, 2),                       -- масса брони относительно стальной
    'speed', round(-(dn - 4.5) * 2.5)::int,                  -- % к скорости корабля (титан — ноль)
    'capacityBoost', round((7.8 - dn) * 8)::int,             -- места в корпусе: лёгкая броня освобождает
    'heat', round(ht)::int, 'regen', round(regen, 1), 'signature', sig::int,
    'cost', round(cost, 2), 'grade', grade,
    'tier', case when grade >= 80 then 'Шедевр' when grade >= 65 then 'Элитный' when grade >= 45 then 'Боевой'
                 when grade >= 25 then 'Рабочий' else 'Сырой' end,
    'traits', traits, 'warnings', warns, 'locked', locked,
    'registrable', not locked);
end $$;
revoke execute on function public.v1_alloy_calc(jsonb, text, text) from public, anon;
grant execute on function public.v1_alloy_calc(jsonb, text, text) to authenticated;

create or replace function public.v1_alloy_preview(p_recipe jsonb, p_process text) returns jsonb
language sql stable security definer set search_path = public as $$
  select v1_alloy_calc(p_recipe, p_process, v1_my_faction());
$$;
grant execute on function public.v1_alloy_preview(jsonb, text) to authenticated;

-- ════════ 5. Состояние конструктора ════════
create or replace function public.v1_alloy_state() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_fid text := v1_my_faction(); v_stock jsonb; v_done jsonb;
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  select coalesce(resources, '{}'::jsonb), coalesce(research, '[]'::jsonb) into v_stock, v_done from faction_economy where faction_id = v_fid;
  v_stock := coalesce(v_stock, '{}'::jsonb); v_done := coalesce(v_done, '[]'::jsonb);
  return jsonb_build_object(
    'can_edit', v1_can_manage(v_fid, 'produce'),
    'settings', coalesce((select value from v1_settings where key = 'hull'), '{}'::jsonb),
    'components', (select coalesce(jsonb_agg(jsonb_build_object(
        'res', c.res, 'grp', c.grp, 'role', c.role, 'k', c.k, 'en', c.en, 'mi', c.mi, 'hp', c.hp, 'dens', c.dens, 'note', c.note,
        'rarity', r.rarity, 'stock', coalesce((v_stock->>c.res)::numeric, 0)) order by c.sort), '[]'::jsonb)
      from v1_hull_components c left join resource_rarity r on r.name = c.res),
    'processes', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'descr', p.descr, 'params', p.params,
        'tech', p.tech, 'tech_name', t.name, 'open', p.tech is null or v_done ? p.tech) order by p.sort), '[]'::jsonb)
      from v1_hull_process p left join v1_tech t on t.id = p.tech),
    'alloys', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'recipe', recipe, 'process', process,
        'stats', stats, 'created_at', created_at) order by created_at), '[]'::jsonb)
      from v1_alloys where faction_id = v_fid),
    'archive', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'grade', a.stats->'grade',
        'resist', a.stats->'resist', 'hp', a.stats->'hpPercentBoost', 'created_at', a.created_at) order by a.created_at), '[]'::jsonb)
      from faction_armor_alloys a where a.faction_id = v_fid));
end $$;
grant execute on function public.v1_alloy_state() to authenticated;

-- ════════ 6. Регистрация, правка, удаление ════════
create or replace function public.v1_alloy_save(p_id uuid, p_name text, p_recipe jsonb, p_process text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_fid text := v1_my_faction();
  cfg jsonb := coalesce((select value from v1_settings where key = 'hull'), '{}'::jsonb);
  nm text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  clean jsonb := '{}'::jsonb; key text; val jsonb; st jsonb; row_id uuid;
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(v_fid, 'produce') then raise exception 'forbidden'; end if;
  if char_length(nm) < 3 or char_length(nm) > 48 then raise exception 'alloy_name'; end if;
  for key, val in select * from jsonb_each(coalesce(p_recipe, '{}'::jsonb)) loop
    if jsonb_typeof(val) = 'number' and (val #>> '{}')::numeric > 0 then clean := clean || jsonb_build_object(key, val); end if;
  end loop;
  st := v1_alloy_calc(clean, p_process, v_fid);
  if not (st->>'ok')::boolean then raise exception '%', st->>'error'; end if;
  if (st->>'locked')::boolean then raise exception 'alloy_locked'; end if;
  if exists (select 1 from v1_alloys where faction_id = v_fid and lower(name) = lower(nm) and id is distinct from p_id) then
    raise exception 'alloy_name_taken';
  end if;
  if p_id is null then
    if (select count(*) from v1_alloys where faction_id = v_fid) >= coalesce((cfg->>'max_per_faction')::int, 12) then
      raise exception 'alloy_limit';
    end if;
    insert into v1_alloys(faction_id, owner_id, name, recipe, process, stats)
    values (v_fid, auth.uid(), nm, clean, st->>'process', st) returning id into row_id;
  else
    update v1_alloys set name = nm, recipe = clean, process = st->>'process', stats = st, updated_at = now()
     where id = p_id and faction_id = v_fid returning id into row_id;
    if row_id is null then raise exception 'alloy_not_found'; end if;
  end if;
  return jsonb_build_object('id', row_id, 'stats', st);
end $$;
revoke execute on function public.v1_alloy_save(uuid, text, jsonb, text) from public, anon;
grant execute on function public.v1_alloy_save(uuid, text, jsonb, text) to authenticated;

create or replace function public.v1_alloy_delete(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction();
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(v_fid, 'produce') then raise exception 'forbidden'; end if;
  delete from v1_alloys where id = p_id and faction_id = v_fid;
  if not found then raise exception 'alloy_not_found'; end if;
  return true;
end $$;
revoke execute on function public.v1_alloy_delete(uuid) from public, anon;
grant execute on function public.v1_alloy_delete(uuid) to authenticated;
