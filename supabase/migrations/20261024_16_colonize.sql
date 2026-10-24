-- ═══════════════════════════════════════════════════════════════
-- 16. Колонизация на новом коде.
--   Захват системы — 100 000 ГС, колонизация планеты (или станция) — 25 000 ГС.
--   Цены и перерыв — в v1_settings.colonize (меняются без программиста).
--   Какие миры родные для расы — таблица v1_race_envs; тип планеты → группа — v1_planet_groups.
--   Пишет в те же таблицы, что и старый сайт (map_systems.faction, colonies, faction_economy),
--   поэтому обе версии видят одно и то же.
-- ═══════════════════════════════════════════════════════════════

-- ── Настройки ──
insert into public.v1_settings(key, value) values ('colonize', jsonb_build_object(
  'system_cost', 100000,
  'planet_cost', 25000,
  'station_cost', 25000,
  'claim_cd_days', 4,
  'default_cells', 6,
  'station_cells', jsonb_build_object('belt', 3, 'giant', 4, 'anomaly', 5),
  -- держава с «Машинным разумом», но биологической расой: все миры НЕ родные (давнее исключение)
  'native_all_except', jsonb_build_array('fac_d9662abfe6')))
on conflict (key) do nothing;

-- ── Тип планеты → климатическая группа ──
create table if not exists public.v1_planet_groups (
  label text primary key,           -- тип или имя планеты, как на карте
  grp   text not null check (grp in ('lava','volcanic','terrestrial','oceanic','desert','cryo','micro','exotic','gasgiant','icegiant','hotgiant','anomaly'))
);
alter table public.v1_planet_groups enable row level security;
drop policy if exists v1_planet_groups_read on public.v1_planet_groups;
create policy v1_planet_groups_read on public.v1_planet_groups for select using (true);

insert into public.v1_planet_groups(label, grp) values
  ('Лавовые миры','lava'), ('Вулканические','volcanic'), ('Землеподобные','terrestrial'), ('Океанические','oceanic'),
  ('Пустынные','desert'), ('Криомиры','cryo'), ('Газовые гиганты','gasgiant'), ('Ледяные гиганты','icegiant'),
  ('Горячие гиганты','hotgiant'), ('Экзотические','exotic'), ('Малые тела','micro'), ('Аномалии','anomaly'),
  ('Идеальный мир','terrestrial'),
  ('Катархей','lava'), ('Мёртвая планета','lava'), ('Супервулканическая планета','volcanic'), ('Хтонический мир','lava'),
  ('Горячий Юпитер','hotgiant'), ('Горячий Нептун','hotgiant'), ('Железный мир','lava'), ('Дастория','volcanic'),
  ('Литара','desert'), ('Океаническая суперземля','exotic'), ('Рыхлый гигант','gasgiant'), ('Железный карлик','terrestrial'),
  ('Духлесс','volcanic'), ('Терра','terrestrial'), ('Суперземля','terrestrial'), ('Гикеан','oceanic'),
  ('Панталассическая планета','oceanic'), ('Теракрон','terrestrial'), ('Мини-Нептун','gasgiant'), ('Водный Юпитер','gasgiant'),
  ('Тундровая планета','terrestrial'), ('Псамора','oceanic'), ('Мир дюн','desert'), ('Гельвард','cryo'),
  ('Турмион','gasgiant'), ('Ледяной гигант','icegiant'), ('Аммиачный мир','cryo'), ('Газовый карлик','gasgiant'),
  ('Метановый мир','cryo'), ('Суперюпитер','gasgiant'), ('Коричневый карлик','gasgiant'), ('Планета-сирота','exotic'),
  ('Углеродная планета','cryo'), ('Тёмный замёрзший мир','cryo'), ('Карликовая планета','micro'), ('Мегаастероид','micro'),
  ('Пустошь','anomaly'), ('Кротовая нора','anomaly'), ('Токсичный карлик','anomaly')
on conflict (label) do nothing;

-- ── Раса → родные группы миров ──
create table if not exists public.v1_race_envs (
  race text primary key,
  envs text[] not null
);
alter table public.v1_race_envs enable row level security;
drop policy if exists v1_race_envs_read on public.v1_race_envs;
create policy v1_race_envs_read on public.v1_race_envs for select using (true);

insert into public.v1_race_envs(race, envs) values
  ('Гуманоиды', array['terrestrial']),
  ('Млекопитающие', array['terrestrial','oceanic']),
  ('Рептилоиды', array['desert','volcanic','terrestrial']),
  ('Авианы (Птицеподобные)', array['terrestrial','desert']),
  ('Инсектоиды', array['terrestrial','desert','volcanic']),
  ('Акватики (Водные)', array['oceanic']),
  ('Плантоиды (Растениевидные)', array['terrestrial','oceanic']),
  ('Литоиды (Каменные)', array['micro','lava','desert']),
  ('Синтетики / Киборги', array['terrestrial','oceanic','desert','volcanic','lava','cryo','micro','exotic']),
  ('Энергетические сущности', array['exotic','cryo','lava'])
on conflict (race) do nothing;

-- ── Группа небесного тела ──
create or replace function public.v1_body_group(p jsonb) returns text
language sql stable set search_path = public as $$
  select case
    when p->>'kind' = 'belt' then 'belt'
    when p->>'kind' = 'anomaly' then 'anomaly'
    else coalesce(
      (select grp from v1_planet_groups where label = btrim(coalesce(p->>'type', ''))),
      (select grp from v1_planet_groups where label = btrim(coalesce(p->>'name', ''))),
      'unknown') end;
$$;

-- ── Кто управляет державой: владелец или соправитель / участник с правом колонизации ──
create or replace function public.v1_can_manage(p_fid text, p_perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and not exists (select 1 from user_roles where user_id = auth.uid() and coalesce(is_banned, false))
     and (exists (select 1 from faction_economy where faction_id = p_fid and owner_id = auth.uid())
          or exists (select 1 from faction_members m where m.faction_id = p_fid and m.user_id = auth.uid() and m.status = 'active'
                     and (m.role = 'coruler' or coalesce(m.perms, '[]'::jsonb) ? p_perm)));
$$;

-- ── Правила заселения для державы ──
create or replace function public.v1_colony_rules(p_fid text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  cfg jsonb := coalesce((select value from v1_settings where key = 'colonize'), '{}'::jsonb);
  app faction_applications;
  res jsonb;
  robot boolean;
  envs text[];
  pool int := 1;
begin
  select * into app from faction_applications where faction_id = p_fid and status = 'approved' order by created_at limit 1;
  select coalesce(research, '[]'::jsonb) into res from faction_economy where faction_id = p_fid;
  res := coalesce(res, '[]'::jsonb);
  robot := app.race = 'Синтетики / Киборги' or app.gov = 'Машинный разум (ИИ)';
  envs := coalesce((select e.envs from v1_race_envs e where e.race = app.race), array['terrestrial']);
  if app.ideology = 'Экспансионизм' then pool := pool + 1; end if;
  if res ? 'pol.house_heavens' then pool := pool + 1; end if;
  if robot then pool := pool + 1; end if;
  return jsonb_build_object(
    'race', app.race,
    'native_all', robot and not coalesce(cfg->'native_all_except', '[]'::jsonb) ? p_fid,
    'envs', to_jsonb(envs),
    'belt', case when res ? 'pol.cel_asteroid' then coalesce((cfg->'station_cells'->>'belt')::int, 3) end,
    'giant', case when res ? 'pol.cel_giants' then coalesce((cfg->'station_cells'->>'giant')::int, 4) end,
    'anomaly', case when res ? 'pol.cel_anomaly' then coalesce((cfg->'station_cells'->>'anomaly')::int, 5) end,
    'pool', pool,
    'system_cost', coalesce((cfg->>'system_cost')::numeric, 100000),
    'planet_cost', coalesce((cfg->>'planet_cost')::numeric, 25000),
    'station_cost', coalesce((cfg->>'station_cost')::numeric, 25000),
    'claim_cd_days', coalesce((cfg->>'claim_cd_days')::numeric, 4),
    'default_cells', coalesce((cfg->>'default_cells')::int, 6));
end $$;

-- Что можно сделать с телом: colony | station | need_station | terraform | dead | hidden
create or replace function public.v1_body_access(p_rules jsonb, p_sys map_systems, p jsonb) returns jsonb
language plpgsql stable set search_path = public as $$
declare g text := v1_body_group(p); st int;
begin
  if coalesce((p->>'dead')::boolean, false) or coalesce((p->>'doomed')::boolean, false) then
    return jsonb_build_object('grp', g, 'mode', 'dead');
  end if;
  -- тело у скрытого компаньона кратной звезды на карте не показывается
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
  return jsonb_build_object('grp', g, 'mode', 'terraform');
end $$;

-- ── Сводка для страницы «Колонизация» ──
create or replace function public.v1_colonize_state() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  fid text := v1_my_faction();
  rules jsonb; eco faction_economy; cd_until timestamptz; used int;
begin
  if fid is null then raise exception 'no_faction'; end if;
  rules := v1_colony_rules(fid);
  select * into eco from faction_economy where faction_id = fid;
  if eco.last_system_claim is not null then
    cd_until := eco.last_system_claim + make_interval(days => (rules->>'claim_cd_days')::int);
    if cd_until <= now() then cd_until := null; end if;
  end if;
  used := case when eco.last_system_claim is null then coalesce(eco.claim_used, 0) else 0 end;
  return jsonb_build_object(
    'faction_id', fid,
    'can_manage', v1_can_manage(fid, 'colonize'),
    'gc', eco.gc,
    'rules', rules,
    'claim', jsonb_build_object('pool', rules->'pool', 'used', case when cd_until is not null then (rules->>'pool')::int else used end, 'cooldown_until', cd_until),
    -- ничьи системы по соседству (по гиперпути)
    'frontier', coalesce((select jsonb_agg(x order by x->>'name') from (
        select jsonb_build_object('id', s.id, 'name', s.name, 'star_type', s.star_type, 'x', s.x, 'y', s.y,
                 'bodies', jsonb_array_length(coalesce(s.planets, '[]'::jsonb)),
                 'open', (select count(*) from jsonb_array_elements(coalesce(s.planets, '[]'::jsonb)) p where (v1_body_access(rules, s, p)->>'mode') in ('colony','station')),
                 'from', (select jsonb_agg(distinct o.name) from map_hyperlanes h join map_systems o on o.id = case when h.a_id = s.id then h.b_id else h.a_id end
                          where (h.a_id = s.id or h.b_id = s.id) and o.faction = fid)) as x
        from map_systems s
        where s.faction is null and exists (
          select 1 from map_hyperlanes h join map_systems o on o.id = case when h.a_id = s.id then h.b_id else h.a_id end
          where (h.a_id = s.id or h.b_id = s.id) and o.faction = fid)) q), '[]'::jsonb),
    -- свои системы и их тела
    'systems', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'star_type', s.star_type,
        'bodies', coalesce((select jsonb_agg(jsonb_build_object('pid', (p->>'pid')::int, 'name', p->>'name', 'type', p->>'type', 'kind', coalesce(p->>'kind','planet'),
                     'colony', (select jsonb_build_object('id', c.id, 'mine', c.faction_id = fid, 'capital', c.is_capital, 'cells', c.cells)
                                from colonies c where c.system_id = s.id and c.planet_pid = (p->>'pid')::int limit 1))
                   || v1_body_access(rules, s, p) order by (p->>'pid')::int)
                   from jsonb_array_elements(coalesce(s.planets, '[]'::jsonb)) p where p ? 'pid'), '[]'::jsonb))
        order by s.name) from map_systems s where s.faction = fid), '[]'::jsonb));
end $$;

-- ── Захват системы ──
create or replace function public.v1_claim_system(p_system_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  fid text := v1_my_faction();
  rules jsonb; eco faction_economy; cost numeric; pool int; used int;
begin
  if fid is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(fid, 'colonize') then raise exception 'not_allowed'; end if;
  rules := v1_colony_rules(fid);
  cost := (rules->>'system_cost')::numeric;
  pool := (rules->>'pool')::int;
  select * into eco from faction_economy where faction_id = fid for update;
  if eco.last_system_claim is not null and eco.last_system_claim > now() - make_interval(days => (rules->>'claim_cd_days')::int) then
    raise exception 'claim_cooldown: %', to_char(eco.last_system_claim + make_interval(days => (rules->>'claim_cd_days')::int), 'DD.MM HH24:MI');
  end if;
  if not exists (select 1 from map_systems where id = p_system_id) then raise exception 'system_not_found'; end if;
  if not exists (select 1 from map_hyperlanes h join map_systems o on o.id = case when h.a_id = p_system_id then h.b_id else h.a_id end
                 where (h.a_id = p_system_id or h.b_id = p_system_id) and o.faction = fid) then
    raise exception 'not_adjacent';
  end if;
  if coalesce(eco.gc, 0) < cost then raise exception 'not_enough_gc'; end if;
  update map_systems set faction = fid where id = p_system_id and faction is null;
  if not found then raise exception 'system_taken'; end if;
  used := case when eco.last_system_claim is null then coalesce(eco.claim_used, 0) else 0 end + 1;
  update faction_economy set gc = gc - cost, claim_used = used,
         last_system_claim = case when used >= pool then now() else null end
   where faction_id = fid and gc >= cost;
  if not found then raise exception 'not_enough_gc'; end if;
  return jsonb_build_object('ok', true, 'system_id', p_system_id, 'cost', cost, 'left', greatest(pool - used, 0));
end $$;

-- ── Колония или станция на теле ──
create or replace function public.v1_colonize(p_system_id text, p_pid int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  fid text := v1_my_faction();
  rules jsonb; sys map_systems; body jsonb; acc jsonb; cost numeric; cells int;
begin
  if fid is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(fid, 'colonize') then raise exception 'not_allowed'; end if;
  select * into sys from map_systems where id = p_system_id;
  if not found then raise exception 'system_not_found'; end if;
  if sys.faction is not null and sys.faction <> fid then raise exception 'system_foreign'; end if;
  select p into body from jsonb_array_elements(coalesce(sys.planets, '[]'::jsonb)) p where (p->>'pid')::int = p_pid limit 1;
  if body is null then raise exception 'body_not_found'; end if;
  rules := v1_colony_rules(fid);
  acc := v1_body_access(rules, sys, body);
  case acc->>'mode'
    when 'colony', 'station' then null;
    when 'need_station' then raise exception 'need_station: %', acc->>'tech';
    when 'terraform' then raise exception 'need_terraform';
    else raise exception 'body_closed';
  end case;
  if exists (select 1 from colonies where system_id = p_system_id and planet_pid = p_pid) then raise exception 'body_taken'; end if;
  cost := (acc->>'cost')::numeric;
  cells := (acc->>'cells')::int;
  update faction_economy set gc = gc - cost where faction_id = fid and gc >= cost;
  if not found then raise exception 'not_enough_gc'; end if;
  insert into colonies(faction_id, owner_id, system_id, planet_name, planet_pid, planet_type, cells, terraformed, resources)
  values (fid, (select owner_id from faction_economy where faction_id = fid), p_system_id, body->>'name', p_pid,
          coalesce(body->>'type', ''), cells, acc->>'mode' = 'station', coalesce(body->'resources', '[]'::jsonb));
  return jsonb_build_object('ok', true, 'mode', acc->>'mode', 'cost', cost, 'cells', cells, 'name', body->>'name');
end $$;

revoke all on function public.v1_colonize_state(), public.v1_claim_system(text), public.v1_colonize(text, int),
  public.v1_colony_rules(text), public.v1_can_manage(text, text), public.v1_body_access(jsonb, map_systems, jsonb) from public, anon;
grant execute on function public.v1_colonize_state(), public.v1_claim_system(text), public.v1_colonize(text, int) to authenticated;
grant execute on function public.v1_body_group(jsonb) to anon, authenticated;
