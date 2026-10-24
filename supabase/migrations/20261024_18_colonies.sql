-- ═══════════════════════════════════════════════════════════════
-- 18. Управление колониями на новом коде.
--   v1_buildings     — каталог построек (цены, лестница слотов, где можно строить) — данными;
--   v1_world_kinds   — природа мира: множители населения, работы, науки и цены стройки;
--   v1_build / v1_open_slot / v1_demolish / v1_habitat / v1_terraform / v1_abandon / v1_cancel_project;
--   v1_projects_step — завершает готовые проекты (то же делает старый суточный тик).
-- Проекты пишутся в colony_projects в прежнем формате.
-- Новое: «Отделение службы безопасности» (police) — держит порядок в колонии (миграция 20).
-- ═══════════════════════════════════════════════════════════════

insert into public.v1_settings(key, value) values ('colonies', jsonb_build_object(
  'habitat_cost', 10000, 'habitat_cells', 3,
  -- терраформ по сложности: цена, очки науки, дни
  'terraform', jsonb_build_array(
    jsonb_build_object('gc', 62500,  'sci', 0,  'days', 1),
    jsonb_build_object('gc', 112500, 'sci', 60, 'days', 2),
    jsonb_build_object('gc', 300000, 'sci', 30, 'days', 4)),
  'refund_share', 0.5))
on conflict (key) do nothing;

create table if not exists public.v1_buildings (
  btype   text primary key,
  name    text not null,
  cat     text not null,            -- civ | sci | mil | faith | order
  cost    numeric not null,
  ladder  int[] not null default array[0,500,500,1500,1500,3000],
  free    int not null default 1,   -- слотов открыто сразу
  descr   text not null default '',
  needs_tech text,                  -- нужна технология
  only_on text[],                   -- только на мирах этих групп
  per_system int,                   -- не больше N в системе
  frozen  text,                     -- причина, если строить нельзя
  sort    int not null default 0
);
alter table public.v1_buildings enable row level security;
drop policy if exists v1_buildings_read on public.v1_buildings;
create policy v1_buildings_read on public.v1_buildings for select using (true);

insert into public.v1_buildings(btype, name, cat, cost, ladder, free, descr, needs_tech, only_on, per_system, frozen, sort) values
  ('factory','Гражданская фабрика','civ',500,array[0,0,500,1500,1500,3000],2,'+200 ГС в сутки за слот.',null,null,null,null,10),
  ('trade','Торговый хаб','civ',1000,array[0,500,500,1500,1500,3000],1,'+100 ГС в сутки за слот, держит торговые пути.',null,null,null,null,11),
  ('mining','Добывающий завод','civ',500,array[0,0,500,1500,1500,3000],2,'Добывает обычные залежи планеты.',null,null,null,null,12),
  ('mining_deep','Глубинный горный комплекс','civ',2500,array[0,500,500,1500,1500,3000],1,'Добывает необычные и редкие залежи.',null,null,null,null,13),
  ('mining_exotic','Экзотический экстрактор','civ',8000,array[0,500,500,1500,1500,3000],1,'Добывает эпические и легендарные залежи.',null,null,null,null,14),
  ('goodsfab','Фабрика товаров','civ',1200,array[0,500,500,1500,1500,3000],1,'Делает товары для населения из воды и сырья.',null,null,null,null,15),
  ('warehouse','Склад','civ',800,array[0,500,500,1500,1500,3000],1,'+500 к лимиту хранения ресурсов за слот.',null,null,null,null,16),
  ('science','Научный институт','sci',1000,array[0,500,500,1500,1500,3000],1,'+1 ОН в сутки за слот.',null,null,null,null,20),
  ('sci_giant','Гигантская обсерватория','sci',4000,array[0,500,500,1500,1500,3000],1,'+3 ОН в сутки за слот. Только на станции над гигантом.',null,array['gasgiant','icegiant','hotgiant'],null,null,21),
  ('sci_anomaly','Институт аномалий','sci',7000,array[0,500,500,1500,1500,3000],1,'+5 ОН в сутки за слот. Только на станции в аномалии.',null,array['anomaly'],null,null,22),
  ('police','Отделение службы безопасности','order',1500,array[0,500,500,1500,1500,3000],1,'Полиция и контрразведка. +4 к порядку колонии и +2 соседним колониям системы за слот; первой гасит волнения.',null,null,null,null,30),
  ('intel','Центр спецслужб','mil',3000,array[0,500,500,1500,1500,3000],1,'+1 к потолку агентов за слот.',null,null,null,null,31),
  ('shipyard','Корабельная верфь','mil',2000,array[0,500,500,1500,1500,3000],1,'Строит корабли: 1 корабль за слот.',null,null,null,null,40),
  ('starbase','Звёздная база','mil',5000,array[0,5000,5000,8000,8000,12000],1,'+50 к вместимости флота за слот.',null,null,null,null,41),
  ('military_factory','Военный завод','mil',1000,array[0,500,500,1500,1500,3000],1,'Строит технику: 100 единиц за слот.',null,null,null,null,42),
  ('training','Центр подготовки','mil',500,array[0,500,500,1500,1500,3000],1,'Готовит пехоту: 1000 бойцов за слот.',null,null,null,null,43),
  ('flak','Батарея ПВО','mil',1500,array[0,500,500,1500,1500,3000],1,'Прикрывает планету от авиации.',null,null,null,null,44),
  ('abm','Комплекс ПРО','mil',3000,array[0,500,500,1500,1500,3000],1,'Прикрывает всю систему от ударов.',null,null,null,null,45),
  ('airfield','Аэрокосмический завод','mil',1200,array[0,500,500,1500,1500,3000],1,'Строит авиацию.',null,null,null,'Авиация заморожена',46),
  ('temple','Храм веры','faith',1200,array[0,500,500,1500,1500,3000],1,'+150 ГС в сутки за слот. Нужна вера державы.',null,null,null,null,50),
  ('wellhub','Центр благополучия','civ',3000,array[0,500,500,1500,1500,3000],1,'Поднимал благополучие.',null,null,null,'Благополучие заменяется порядком колоний',90)
on conflict (btype) do nothing;

-- ── Природа мира ──
create table if not exists public.v1_world_kinds (
  kind  text primary key,          -- ideal, группа мира или std
  pop numeric not null, work numeric not null, sci numeric not null, build numeric not null,
  env int                          -- «климатическая» координата для сложности терраформа
);
alter table public.v1_world_kinds enable row level security;
drop policy if exists v1_world_kinds_read on public.v1_world_kinds;
create policy v1_world_kinds_read on public.v1_world_kinds for select using (true);
insert into public.v1_world_kinds(kind, pop, work, sci, build, env) values
  ('ideal',1.50,1.45,1.45,0.75,null), ('terrestrial',1.15,1.00,1.05,0.95,2), ('oceanic',1.10,0.95,1.15,1.00,2),
  ('desert',0.90,1.10,1.00,0.95,3), ('cryo',0.80,1.05,1.15,1.15,0), ('volcanic',0.75,1.25,0.95,1.15,5),
  ('lava',0.60,1.30,0.90,1.25,6), ('micro',0.70,1.15,1.00,0.90,3), ('exotic',0.85,1.00,1.25,1.20,4),
  ('gasgiant',0.70,1.20,1.10,1.15,null), ('icegiant',0.70,1.10,1.15,1.15,null), ('hotgiant',0.65,1.25,1.05,1.20,null),
  ('belt',0.60,1.30,0.95,0.90,null), ('anomaly',0.65,0.90,1.30,1.25,null), ('std',1,1,1,1,null)
on conflict (kind) do nothing;

-- Тело планеты по колонии
create or replace function public.v1_colony_body(p_colony uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select p from colonies c join map_systems m on m.id = c.system_id, jsonb_array_elements(coalesce(m.planets, '[]'::jsonb)) p
   where c.id = p_colony and (p->>'pid')::int = c.planet_pid limit 1;
$$;

create or replace function public.v1_world_kind(p_colony uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare b jsonb := v1_colony_body(p_colony); g text; t text;
begin
  if b is not null and coalesce((b->>'ideal')::boolean, false) then return 'ideal'; end if;
  if b is not null then g := v1_body_group(b); if g <> 'unknown' then return g; end if; end if;
  select planet_type into t from colonies where id = p_colony;
  select grp into g from v1_planet_groups where label = btrim(coalesce(t, ''));
  if g is not null then return g; end if;
  if position('·' in coalesce(t, '')) > 0 then return 'belt'; end if;
  return 'std';
end $$;

-- Цена постройки или слота с учётом доктрины и природы мира
create or replace function public.v1_build_price(p_fid text, p_colony uuid, p_base numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select greatest(1, round(p_base * (v1_faction_mods(p_fid)->>'build')::numeric
                     * coalesce((select build from v1_world_kinds where kind = v1_world_kind(p_colony)), 1)));
$$;

-- Сложность терраформа: 1..3 по «климатическому» расстоянию до родных миров расы
create or replace function public.v1_terraform_tier(p_fid text, p_grp text) returns int
language plpgsql stable security definer set search_path = public as $$
declare pe int; d int; envs text[];
begin
  select env into pe from v1_world_kinds where kind = p_grp;
  if pe is null then return 3; end if;
  select e.envs into envs from v1_race_envs e where e.race = (v1_app(p_fid)).race;
  select min(abs(pe - w.env)) into d from v1_world_kinds w where w.kind = any(coalesce(envs, array['terrestrial'])) and w.env is not null;
  if d is null then return 2; end if;
  return case when d <= 1 then 1 when d <= 3 then 2 else 3 end;
end $$;

-- ── Завершить готовые проекты ──
create or replace function public.v1_projects_step(p_fid text) returns void
language plpgsql security definer set search_path = public as $$
declare pr colony_projects;
begin
  for pr in select * from colony_projects where faction_id = p_fid and ready_at <= now() order by ready_at for update skip locked loop
    if pr.kind = 'build' then
      if exists (select 1 from colonies c where c.id = pr.colony_id and c.faction_id = p_fid) then
        insert into colony_buildings(colony_id, faction_id, owner_id, btype, slots_open, tnp_mode, faith_id)
        values (pr.colony_id, p_fid, pr.owner_id, pr.btype, coalesce((pr.payload->>'free_slots')::int, 1), false, nullif(pr.payload->>'faith_id', '')::uuid);
      end if;
    elsif pr.kind = 'slot' then
      update colony_buildings set slots_open = least(6, slots_open + 1) where id = pr.building_id and faction_id = p_fid;
    elsif pr.kind = 'habitat' then
      update colonies set cells = cells + coalesce(pr.cells, 3), terraformed = true where id = pr.colony_id and faction_id = p_fid;
    elsif pr.kind = 'terraform' then
      if not exists (select 1 from colonies c where c.system_id = pr.system_id and c.planet_pid = pr.planet_pid) then
        insert into colonies(faction_id, owner_id, system_id, planet_name, planet_pid, planet_type, cells, terraformed, resources)
        values (p_fid, pr.owner_id, pr.system_id, pr.planet_name, pr.planet_pid, pr.planet_type, coalesce(nullif(pr.cells, 0), 6), true,
                coalesce(pr.payload->'resources', '[]'::jsonb));
      end if;
    else
      continue;   -- чужие виды проектов (старый сайт) не трогаем
    end if;
    delete from colony_projects where id = pr.id;
  end loop;
end $$;

-- ── Сводка для страницы «Управление колониями» ──
create or replace function public.v1_colonies_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction(); cfg jsonb; mods jsonb; faith boolean; res jsonb; bm numeric;
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  perform v1_projects_step(v_fid);
  cfg := coalesce((select value from v1_settings where key = 'colonies'), '{}'::jsonb);
  mods := v1_faction_mods(v_fid);
  bm := (mods->>'build')::numeric;
  faith := exists (select 1 from faith_membership where faction_id = v_fid);
  select coalesce(research, '[]'::jsonb) into res from faction_economy where faction_id = v_fid;
  return jsonb_build_object(
    'can_manage', v1_can_manage(v_fid, 'build'),
    'gc', (select gc from faction_economy where faction_id = v_fid),
    'has_faith', faith,
    'build_mult', mods->'build',
    'habitat_cost', round(coalesce((cfg->>'habitat_cost')::numeric, 10000) * (mods->>'colonize')::numeric),
    'habitat_cells', coalesce((cfg->>'habitat_cells')::int, 3),
    'catalog', (select jsonb_agg(jsonb_build_object('btype', b.btype, 'name', b.name, 'cat', b.cat, 'cost', b.cost, 'ladder', to_jsonb(b.ladder),
                 'free', b.free, 'descr', b.descr, 'only_on', to_jsonb(b.only_on), 'frozen', coalesce(b.frozen,
                   case when b.needs_tech is not null and not res ? b.needs_tech then 'Нужна технология' end,
                   case when b.btype = 'temple' and not faith then 'Сначала примите или основайте веру' end)) order by b.sort)
                from v1_buildings b),
    'colonies', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.planet_name, 'type', c.planet_type, 'capital', c.is_capital, 'cells', c.cells, 'pop', round(coalesce(c.pop, 0)),
        'system_id', c.system_id, 'system', s.name, 'kind', wk.kind,
        'world', to_jsonb(wk) - 'kind' - 'env',
        'buildings', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'btype', b.btype, 'slots', b.slots_open,
                        'next_slot', case when b.slots_open < 6 then greatest(1, round(coalesce((select (bb.ladder)[b.slots_open + 1] from v1_buildings bb where bb.btype = b.btype), 0) * bm * wk.build)) end,
                        'slot_busy', exists (select 1 from colony_projects p where p.kind = 'slot' and p.building_id = b.id)) order by b.created_at)
                      from colony_buildings b where b.colony_id = c.id and b.faction_id = v_fid), '[]'::jsonb),
        'projects', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'btype', p.btype, 'building_id', p.building_id,
                        'label', p.label, 'ready_at', p.ready_at, 'spent', p.payload->'spent_gc') order by p.ready_at)
                      from colony_projects p where p.colony_id = c.id and p.faction_id = v_fid), '[]'::jsonb))
      order by c.is_capital desc, s.name, c.planet_name)
      from colonies c left join map_systems s on s.id = c.system_id
      cross join lateral (select w.* from v1_world_kinds w where w.kind = v1_world_kind(c.id)) wk
      where c.faction_id = v_fid), '[]'::jsonb),
    'terraforms', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.planet_name, 'system_id', p.system_id, 'ready_at', p.ready_at))
                  from colony_projects p where p.faction_id = v_fid and p.kind = 'terraform'), '[]'::jsonb));
end $$;

-- ── Действия ──
create or replace function public.v1_build(p_colony uuid, p_btype text, p_faith uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction(); c colonies; b v1_buildings; cost numeric; used int; k text;
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(v_fid, 'build') then raise exception 'not_allowed'; end if;
  select * into c from colonies where id = p_colony;
  if c.id is null or c.faction_id is distinct from v_fid then raise exception 'colony_foreign'; end if;
  select * into b from v1_buildings where btype = p_btype;
  if b.btype is null then raise exception 'building_unknown'; end if;
  if b.frozen is not null then raise exception 'building_frozen: %', b.frozen; end if;
  if b.needs_tech is not null and not exists (select 1 from faction_economy where faction_id = v_fid and coalesce(research, '[]'::jsonb) ? b.needs_tech) then
    raise exception 'building_tech';
  end if;
  k := v1_world_kind(p_colony);
  if b.only_on is not null and not k = any(b.only_on) then raise exception 'building_world'; end if;
  if p_btype = 'temple' then
    if p_faith is null then
      select faith_id into p_faith from faith_membership where faction_id = v_fid order by (role = 'founder') desc, joined_at limit 1;
    end if;
    if p_faith is null or not exists (select 1 from faith_membership where faction_id = v_fid and faith_id = p_faith) then
      raise exception 'temple_no_faith';
    end if;
  else
    p_faith := null;
  end if;
  select (select count(*) from colony_buildings where colony_id = p_colony and faction_id = v_fid)
       + (select count(*) from colony_projects where colony_id = p_colony and faction_id = v_fid and kind = 'build') into used;
  if used >= coalesce(c.cells, 6) then raise exception 'no_cells'; end if;
  cost := v1_build_price(v_fid, p_colony, b.cost);
  update faction_economy set gc = gc - cost where faction_id = v_fid and gc >= cost;
  if not found then raise exception 'not_enough_gc'; end if;
  insert into colony_projects(faction_id, owner_id, kind, btype, colony_id, payload, label, ready_at)
  values (v_fid, (select owner_id from faction_economy where faction_id = v_fid), 'build', p_btype, p_colony,
          jsonb_build_object('spent_gc', cost, 'spent_science', 0, 'btype', p_btype, 'free_slots', b.free, 'faith_id', p_faith),
          'Постройка', now() + interval '1 day');
  return jsonb_build_object('ok', true, 'cost', cost);
end $$;

create or replace function public.v1_open_slot(p_building uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction(); b colony_buildings; cost numeric; base numeric;
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(v_fid, 'build') then raise exception 'not_allowed'; end if;
  select * into b from colony_buildings where id = p_building;
  if b.id is null or b.faction_id is distinct from v_fid then raise exception 'building_foreign'; end if;
  if coalesce(b.slots_open, 0) >= 6 then raise exception 'slots_max'; end if;
  if exists (select 1 from colony_projects where kind = 'slot' and building_id = p_building) then raise exception 'slot_busy'; end if;
  select (ladder)[coalesce(b.slots_open, 0) + 1] into base from v1_buildings where btype = b.btype;
  if base is null then raise exception 'building_unknown'; end if;
  cost := v1_build_price(v_fid, b.colony_id, base);
  update faction_economy set gc = gc - cost where faction_id = v_fid and gc >= cost;
  if not found then raise exception 'not_enough_gc'; end if;
  insert into colony_projects(faction_id, owner_id, kind, colony_id, building_id, payload, label, ready_at)
  values (v_fid, (select owner_id from faction_economy where faction_id = v_fid), 'slot', b.colony_id, p_building,
          jsonb_build_object('spent_gc', cost, 'spent_science', 0), 'Слот', now() + interval '1 day');
  return jsonb_build_object('ok', true, 'cost', cost);
end $$;

create or replace function public.v1_demolish(p_building uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction(); b colony_buildings; refund numeric; share numeric;
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(v_fid, 'build') then raise exception 'not_allowed'; end if;
  delete from colony_buildings where id = p_building and faction_id = v_fid returning * into b;
  if b.id is null then raise exception 'building_foreign'; end if;
  share := coalesce((select (value->>'refund_share')::numeric from v1_settings where key = 'colonies'), 0.5);
  refund := floor(share * (coalesce(v1_build_price(v_fid, b.colony_id, (select cost from v1_buildings where btype = b.btype)), 0)
            + coalesce((select sum((payload->>'spent_gc')::numeric) from colony_projects where kind = 'slot' and building_id = p_building), 0)));
  delete from colony_projects where kind = 'slot' and building_id = p_building;
  if refund > 0 then update faction_economy set gc = gc + refund where faction_id = v_fid; end if;
  return jsonb_build_object('ok', true, 'refund', refund);
end $$;

create or replace function public.v1_cancel_project(p_project uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction(); p colony_projects; refund numeric; sci numeric;
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(v_fid, 'build') then raise exception 'not_allowed'; end if;
  delete from colony_projects where id = p_project and faction_id = v_fid and kind in ('build','slot','habitat','terraform') returning * into p;
  if p.id is null then raise exception 'project_foreign'; end if;
  refund := coalesce((p.payload->>'spent_gc')::numeric, 0);
  sci := coalesce((p.payload->>'spent_science')::numeric, 0);
  update faction_economy set gc = gc + refund, science = science + sci where faction_id = v_fid;
  return jsonb_build_object('ok', true, 'refund', refund, 'science', sci);
end $$;

create or replace function public.v1_habitat(p_colony uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction(); c colonies; cfg jsonb; cost numeric;
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(v_fid, 'build') then raise exception 'not_allowed'; end if;
  select * into c from colonies where id = p_colony;
  if c.id is null or c.faction_id is distinct from v_fid then raise exception 'colony_foreign'; end if;
  if exists (select 1 from colony_projects where kind = 'habitat' and colony_id = p_colony) then raise exception 'habitat_busy'; end if;
  cfg := coalesce((select value from v1_settings where key = 'colonies'), '{}'::jsonb);
  cost := round(coalesce((cfg->>'habitat_cost')::numeric, 10000) * (v1_faction_mods(v_fid)->>'colonize')::numeric);
  update faction_economy set gc = gc - cost where faction_id = v_fid and gc >= cost;
  if not found then raise exception 'not_enough_gc'; end if;
  insert into colony_projects(faction_id, owner_id, kind, colony_id, cells, payload, label, ready_at)
  values (v_fid, (select owner_id from faction_economy where faction_id = v_fid), 'habitat', p_colony, coalesce((cfg->>'habitat_cells')::int, 3),
          jsonb_build_object('spent_gc', cost, 'spent_science', 0), 'Обустройство среды', now() + interval '1 day');
  return jsonb_build_object('ok', true, 'cost', cost);
end $$;

create or replace function public.v1_terraform(p_system_id text, p_pid int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction(); sys map_systems; body jsonb; acc jsonb; tier int; t jsonb; cost numeric; sci numeric;
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(v_fid, 'colonize') then raise exception 'not_allowed'; end if;
  select * into sys from map_systems where id = p_system_id;
  if sys.id is null then raise exception 'system_not_found'; end if;
  if sys.faction is not null and sys.faction <> v_fid then raise exception 'system_foreign'; end if;
  select p into body from jsonb_array_elements(coalesce(sys.planets, '[]'::jsonb)) p where (p->>'pid')::int = p_pid limit 1;
  if body is null then raise exception 'body_not_found'; end if;
  acc := v1_body_access(v1_colony_rules(v_fid), sys, body);
  if acc->>'mode' <> 'terraform' then raise exception 'terraform_not_needed'; end if;
  if exists (select 1 from colonies where system_id = p_system_id and planet_pid = p_pid) then raise exception 'body_taken'; end if;
  if exists (select 1 from colony_projects where kind = 'terraform' and system_id = p_system_id and planet_pid = p_pid) then raise exception 'terraform_busy'; end if;
  tier := v1_terraform_tier(v_fid, acc->>'grp');
  t := coalesce((select value->'terraform'->(tier - 1) from v1_settings where key = 'colonies'), '{"gc":62500,"sci":0,"days":1}'::jsonb);
  cost := round((t->>'gc')::numeric * (v1_faction_mods(v_fid)->>'colonize')::numeric);
  sci := (t->>'sci')::numeric;
  update faction_economy set gc = gc - cost, science = science - sci where faction_id = v_fid and gc >= cost and science >= sci;
  if not found then raise exception 'not_enough_gc'; end if;
  insert into colony_projects(faction_id, owner_id, kind, system_id, planet_name, planet_pid, planet_type, cells, payload, label, ready_at)
  values (v_fid, (select owner_id from faction_economy where faction_id = v_fid), 'terraform', p_system_id, body->>'name', p_pid, coalesce(body->>'type', ''),
          coalesce((body->>'slotsP')::int, 6), jsonb_build_object('resources', coalesce(body->'resources', '[]'::jsonb), 'spent_gc', cost, 'spent_science', sci),
          'Терраформ', now() + make_interval(days => (t->>'days')::int));
  return jsonb_build_object('ok', true, 'cost', cost, 'science', sci, 'days', (t->>'days')::int, 'tier', tier);
end $$;

create or replace function public.v1_abandon(p_colony uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction(); c colonies;
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(v_fid, 'build') then raise exception 'not_allowed'; end if;
  select * into c from colonies where id = p_colony;
  if c.id is null or c.faction_id is distinct from v_fid then raise exception 'colony_foreign'; end if;
  if coalesce(c.is_capital, false) then raise exception 'capital_abandon'; end if;
  delete from colony_projects where colony_id = p_colony and faction_id = v_fid;
  delete from colonies where id = p_colony;
  return jsonb_build_object('ok', true);
end $$;

-- Терраформ виден в «Колонизации»: цена и сложность прямо в карточке мира
create or replace function public.v1_body_access(p_rules jsonb, p_sys map_systems, p jsonb) returns jsonb
language plpgsql stable set search_path = public as $$
declare g text := v1_body_group(p); st int;
begin
  if coalesce((p->>'dead')::boolean, false) or coalesce((p->>'doomed')::boolean, false) then
    return jsonb_build_object('grp', g, 'mode', 'dead');
  end if;
  if coalesce(p->>'star', 'A') <> 'A' and (p_sys.multi is false or not exists (
       select 1 from jsonb_array_elements(case when jsonb_typeof(p_sys.stars) = 'array' then p_sys.stars else '[]'::jsonb end) s
       where s->>'letter' = p->>'star')) then
    return jsonb_build_object('grp', g, 'mode', 'hidden');
  end if;
  if g in ('gasgiant','icegiant','hotgiant','belt','anomaly') then
    st := case g when 'belt' then (p_rules->>'belt')::int when 'anomaly' then (p_rules->>'anomaly')::int else (p_rules->>'giant')::int end;
    if st is null then
      return jsonb_build_object('grp', g, 'mode', 'need_station',
        'tech', case g when 'belt' then 'Астероидные станции' when 'anomaly' then 'Аномальные станции' else 'Орбитальные станции' end);
    end if;
    return jsonb_build_object('grp', g, 'mode', 'station', 'cells', st, 'cost', p_rules->'station_cost');
  end if;
  if coalesce((p_rules->>'native_all')::boolean, false) or p_rules->'envs' ? g then
    return jsonb_build_object('grp', g, 'mode', 'colony', 'cells', coalesce((p->>'slotsP')::int, (p_rules->>'default_cells')::int, 6), 'cost', p_rules->'planet_cost');
  end if;
  return jsonb_build_object('grp', g, 'mode', 'terraform', 'cells', coalesce((p->>'slotsP')::int, (p_rules->>'default_cells')::int, 6),
    'tf', p_rules->'terraform'->(greatest(1, least(3, case
        when (select env from v1_world_kinds where kind = g) is null then 3
        else (select case when min(abs(w2.env - w.env)) <= 1 then 1 when min(abs(w2.env - w.env)) <= 3 then 2 else 3 end
              from v1_world_kinds w, v1_world_kinds w2
              where w.kind = g and w2.kind in (select jsonb_array_elements_text(p_rules->'envs')) and w2.env is not null) end)) - 1));
end $$;

-- правила колонизации отдают и цены терраформа
create or replace function public.v1_colony_rules(p_fid text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  cfg jsonb := coalesce((select value from v1_settings where key = 'colonize'), '{}'::jsonb);
  tcfg jsonb := coalesce((select value->'terraform' from v1_settings where key = 'colonies'), '[]'::jsonb);
  app faction_applications; res jsonb; robot boolean; envs text[]; pool int := 1; m jsonb; tf jsonb := '[]'::jsonb; x jsonb;
begin
  app := v1_app(p_fid);
  select coalesce(research, '[]'::jsonb) into res from faction_economy where faction_id = p_fid;
  res := coalesce(res, '[]'::jsonb);
  robot := v1_is_robot(p_fid);
  m := v1_faction_mods(p_fid);
  envs := coalesce((select e.envs from v1_race_envs e where e.race = app.race), array['terrestrial']);
  if app.ideology = 'Экспансионизм' then pool := pool + 1; end if;
  if res ? 'pol.house_heavens' then pool := pool + 1; end if;
  if robot then pool := pool + 1; end if;
  for x in select value from jsonb_array_elements(tcfg) loop
    tf := tf || jsonb_build_object('gc', round((x->>'gc')::numeric * (m->>'colonize')::numeric), 'sci', x->'sci', 'days', x->'days');
  end loop;
  return jsonb_build_object(
    'race', app.race,
    'native_all', robot and not coalesce(cfg->'native_all_except', '[]'::jsonb) ? p_fid,
    'envs', to_jsonb(envs),
    'belt', case when res ? 'pol.cel_asteroid' then coalesce((cfg->'station_cells'->>'belt')::int, 3) end,
    'giant', case when res ? 'pol.cel_giants' then coalesce((cfg->'station_cells'->>'giant')::int, 4) end,
    'anomaly', case when res ? 'pol.cel_anomaly' then coalesce((cfg->'station_cells'->>'anomaly')::int, 5) end,
    'pool', pool,
    'base_system_cost', coalesce((cfg->>'system_cost')::numeric, 100000),
    'base_planet_cost', coalesce((cfg->>'planet_cost')::numeric, 25000),
    'system_cost', round(coalesce((cfg->>'system_cost')::numeric, 100000) * (m->>'claim_cost')::numeric),
    'planet_cost', round(coalesce((cfg->>'planet_cost')::numeric, 25000) * (m->>'colonize')::numeric),
    'station_cost', round(coalesce((cfg->>'station_cost')::numeric, 25000) * (m->>'colonize')::numeric),
    'claim_cd_days', round(coalesce((cfg->>'claim_cd_days')::numeric, 4) * (m->>'claim_cd')::numeric, 1),
    'default_cells', coalesce((cfg->>'default_cells')::int, 6),
    'terraform', tf);
end $$;

revoke all on function public.v1_projects_step(text), public.v1_build_price(text, uuid, numeric), public.v1_colony_body(uuid) from public, anon;
grant execute on function public.v1_colonies_state(), public.v1_build(uuid, text, uuid), public.v1_open_slot(uuid), public.v1_demolish(uuid),
  public.v1_cancel_project(uuid), public.v1_habitat(uuid), public.v1_terraform(text, int), public.v1_abandon(uuid) to authenticated;
