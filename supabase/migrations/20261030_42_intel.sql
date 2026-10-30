-- Классическая эра 1.0 · Разведка на новом движке и сводка «Война».
--
-- Решение команды проекта (30.10.2026):
--   • специализации агентов (Диверсант, Призрак, Аналитик, Инфильтратор, Куратор), уровни и
--     тренировки в новой разведке не используются — агент просто агент;
--   • артефакты сняты: копии в v1_removed_units, выпадение старых видов выключено
--     (команда проекта сделает новые виды);
--   • операции: разведка, глубокая разведка, досье на флоты, наблюдатель в системе,
--     кража казны, кража ресурсов, саботаж постройки, диверсия на верфи, слив топлива,
--     подстрекательство, ликвидация агента;
--   • пленные — упрощённо: держать в тюрьме, отпустить или предложить выкуп;
--   • при раскрытии жертва узнаёт, чья это операция («след ведёт к …»).
-- Агенты лежат в старой таблице spy_agents (это сохранения игроков). Агент на задании
-- получает ready_at = конец задания, поэтому старый сайт его тоже не возьмёт.

set lock_timeout = '15s';

-- ════════ 1. Артефакты сняты ════════
insert into public.v1_removed_units(id, unit, reason)
select a.id, to_jsonb(a) || jsonb_build_object('kind', 'spy_artifact'), 'Артефакты разведки сняты на переработку'
  from public.spy_artifacts a on conflict (id) do nothing;
delete from public.spy_artifacts;
update public.spy_artifact_kinds set enabled = false;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.proname in ('spy_artifact_equip', 'spy_artifact_unequip') loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    insert into v1_revoked_functions(signature, had_anon, had_auth) values (f.sig::text, false, true) on conflict do nothing;
  end loop;
end $$;

-- ════════ 2. Таблицы ════════
create table if not exists public.v1_spy_ops (
  id          uuid primary key default gen_random_uuid(),
  actor_fid   text not null,
  owner_id    uuid,
  target_fid  text not null,
  op          text not null,
  agents      uuid[] not null,
  colony_id   uuid,
  system_id   text,
  status      text not null default 'active' check (status in ('active', 'watching', 'done', 'aborted')),
  success_pct int not null,
  detect_pct  int not null,
  cost_gc     numeric not null default 0,
  started_at  timestamptz not null default now(),
  ready_at    timestamptz not null,
  until       timestamptz,
  outcome     text,
  detected    boolean,
  result      jsonb not null default '{}'::jsonb,
  params      jsonb not null default '{}'::jsonb
);
create index if not exists v1_spy_ops_act on public.v1_spy_ops(status, ready_at);
create index if not exists v1_spy_ops_fid on public.v1_spy_ops(actor_fid, started_at desc);

create table if not exists public.v1_spy_recruits (
  id uuid primary key default gen_random_uuid(),
  faction_id text not null,
  first_name text not null, last_name text not null,
  cost numeric not null,
  created_at timestamptz not null default now()
);
create index if not exists v1_spy_recruits_fid on public.v1_spy_recruits(faction_id);

create table if not exists public.v1_intel_log (
  id bigserial primary key,
  faction_id text not null,
  kind text not null,            -- report | incident | watch | captive | ransom
  title text not null,
  body text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists v1_intel_log_fid on public.v1_intel_log(faction_id, created_at desc);

create table if not exists public.v1_spy_ransoms (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.spy_agents(id) on delete cascade,
  captor_fid text not null, owner_fid text not null,
  price numeric not null check (price >= 0),
  status text not null default 'open' check (status in ('open', 'paid', 'declined', 'void')),
  created_at timestamptz not null default now()
);

alter table public.v1_spy_ops enable row level security;
alter table public.v1_spy_recruits enable row level security;
alter table public.v1_intel_log enable row level security;
alter table public.v1_spy_ransoms enable row level security;
revoke all on public.v1_spy_ops, public.v1_spy_recruits, public.v1_intel_log, public.v1_spy_ransoms from anon, authenticated;

insert into public.v1_settings(key, value) values ('intel', '{
  "hire_gc": 1500, "max_agents": 20, "recruits": 3, "max_per_op": 3,
  "extra_agent_succ": 8, "extra_agent_det": 4, "guard_succ": 3, "guard_succ_cap": 20, "guard_det": 4, "guard_det_cap": 25,
  "sys_guard_succ": 10, "sys_guard_det": 15, "release_cooldown_h": 24,
  "ops": {
    "recon_basic":   {"label": "Разведка", "target": "faction", "hours": 6, "gc": 600, "succ": 80, "det": 15,
                      "desc": "Казна, колонии, системы, флоты, армии, агенты и войны цели."},
    "recon_deep":    {"label": "Глубокая разведка", "target": "faction", "hours": 12, "gc": 1500, "succ": 60, "det": 25,
                      "desc": "Склад, постройки по видам и очередь верфей цели."},
    "fleet_dossier": {"label": "Досье на флоты", "target": "faction", "hours": 8, "gc": 1200, "succ": 65, "det": 25,
                      "desc": "Все флоты цели: где стоят, куда летят, стойка, запас хода и состав."},
    "watch":         {"label": "Наблюдатель", "target": "system", "hours": 2, "gc": 1500, "succ": 70, "det": 20, "days": 3,
                      "desc": "Агент 3 дня сидит в системе цели и докладывает о прилётах и уходах флотов. Если там начнётся бой — ваша сторона видит дальше (+2 к обзору)."},
    "steal_gc":      {"label": "Кража казны", "target": "faction", "hours": 10, "gc": 1000, "succ": 40, "det": 40, "pct": 0.02, "cap": 150000,
                      "desc": "Уводит 2 % казны цели, не больше 150 000 ГС."},
    "steal_res":     {"label": "Кража ресурсов", "target": "faction", "hours": 10, "gc": 800, "succ": 45, "det": 35, "pct": 0.08, "cap": 300, "kinds": 3,
                      "desc": "Уводит по 8 % трёх самых больших запасов склада цели (не больше 300 каждого)."},
    "sabotage":      {"label": "Саботаж постройки", "target": "colony", "hours": 12, "gc": 2000, "succ": 35, "det": 45,
                      "desc": "Разрушает одну случайную постройку на выбранной колонии цели."},
    "yard_sabotage": {"label": "Диверсия на верфи", "target": "faction", "hours": 10, "gc": 1500, "succ": 40, "det": 40, "delay_h": 6,
                      "desc": "Все заказы в очереди верфей цели сдвигаются на 6 часов."},
    "drain_fuel":    {"label": "Слив топлива", "target": "faction", "hours": 8, "gc": 1200, "succ": 45, "det": 35, "fuel": 3, "fleets": 2,
                      "desc": "У двух флотов цели на стоянке запас хода падает на 3 прыжка."},
    "incite":        {"label": "Подстрекательство", "target": "colony", "hours": 12, "gc": 1500, "succ": 50, "det": 30, "order": -20, "days": 3,
                      "desc": "Порядок на выбранной колонии цели −20 на 3 дня: растёт риск волнений."},
    "kill_agent":    {"label": "Ликвидация агента", "target": "faction", "hours": 12, "gc": 2500, "succ": 35, "det": 45,
                      "desc": "Устраняет одного свободного агента цели."}
  }
}') on conflict (key) do nothing;

create or replace function public._v1_iv(p_key text, p_def numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select (value->>p_key)::numeric from v1_settings where key = 'intel'), p_def)
$$;
create or replace function public._v1_iop(p_op text) returns jsonb
language sql stable security definer set search_path = public as $$
  select value->'ops'->p_op from v1_settings where key = 'intel'
$$;

create or replace function public._v1_intel_log(p_fid text, p_kind text, p_title text, p_body text, p_data jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = public as $$
  insert into v1_intel_log(faction_id, kind, title, body, data) values (p_fid, p_kind, left(p_title, 200), p_body, coalesce(p_data, '{}'::jsonb))
$$;

create or replace function public._v1_agent_name(p_agent uuid) returns text
language sql stable security definer set search_path = public as $$
  select btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) from spy_agents where id = p_agent
$$;

/** Агент свободен: не в плену, не на страже, не на задании (новом или старом). */
create or replace function public._v1_agent_free(p_agent uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from spy_agents a where a.id = p_agent and not coalesce(a.captive, false) and coalesce(a.ready_at, now()) <= now())
     and not exists (select 1 from faction_intel_guard g where g.agent_id = p_agent)
     and not exists (select 1 from v1_spy_ops o where o.status in ('active', 'watching') and p_agent = any(o.agents))
     and not exists (select 1 from spy_missions m where m.status = 'active' and m.agent_ids ? p_agent::text)
$$;

create or replace function public._v1_intel_me(p_need_manage boolean default true) returns text
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction();
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  if p_need_manage and not (v1_can_manage(v_fid, 'spy') or v1_can_manage(v_fid, 'army')) then raise exception 'forbidden'; end if;
  return v_fid;
end $$;

-- ════════ 3. Наём ════════
create or replace function public._v1_recruits(p_fid text) returns void
language plpgsql security definer set search_path = public as $$
declare
  fn text[] := array['Аделина','Борис','Вера','Гордей','Дана','Ефим','Жанна','Илан','Кира','Лев','Мира','Нестор','Оливия','Пётр','Рада',
                     'Савва','Тая','Ульян','Фрея','Харитон','Элла','Юлиан','Яра','Марк','Ника','Остап','Зоя','Тимур','Лада','Арсений'];
  ln text[] := array['Вейс','Карин','Орлова','Северин','Тальберг','Мирош','Дорн','Ланская','Кейн','Ветров','Розен','Сайрус','Белова','Морган',
                     'Штерн','Гарт','Ривас','Ясенева','Холт','Квинт','Лорен','Бжезинская','Кастро','Фальк','Ардан','Ольховая','Мэй','Рейнер','Строгова','Эйр'];
  n int;
begin
  delete from v1_spy_recruits where faction_id = p_fid and created_at < now() - interval '24 hours';
  select count(*) into n from v1_spy_recruits where faction_id = p_fid;
  while n < public._v1_iv('recruits', 3) loop
    insert into v1_spy_recruits(faction_id, first_name, last_name, cost)
    values (p_fid, fn[1 + floor(random() * array_length(fn, 1))::int], ln[1 + floor(random() * array_length(ln, 1))::int],
            round(public._v1_iv('hire_gc', 1500) * (0.8 + random() * 0.4) / 10) * 10);
    n := n + 1;
  end loop;
end $$;

create or replace function public.v1_intel_hire(p_recruit uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_fid text := public._v1_intel_me(); r v1_spy_recruits; aid uuid; cnt int;
begin
  select * into r from v1_spy_recruits where id = p_recruit and faction_id = v_fid for update;
  if r.id is null then raise exception 'recruit_gone'; end if;
  select count(*) into cnt from spy_agents where faction_id = v_fid and not coalesce(captive, false);
  if cnt >= public._v1_iv('max_agents', 20) then raise exception 'agents_cap: %', public._v1_iv('max_agents', 20)::int; end if;
  update faction_economy set gc = gc - r.cost where faction_id = v_fid and gc >= r.cost;
  if not found then raise exception 'prod_no_money: %', r.cost::bigint; end if;
  insert into spy_agents(faction_id, owner_id, first_name, last_name, hired_at, created_at, ready_at, xp, level)
  values (v_fid, auth.uid(), r.first_name, r.last_name, now(), now(), now(), 0, 1) returning id into aid;
  delete from v1_spy_recruits where id = r.id;
  return aid;
end $$;

create or replace function public.v1_intel_fire(p_agent uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_fid text := public._v1_intel_me();
begin
  if not exists (select 1 from spy_agents where id = p_agent and faction_id = v_fid and not coalesce(captive, false)) then raise exception 'agent_not_found'; end if;
  delete from faction_intel_guard where agent_id = p_agent;
  if not public._v1_agent_free(p_agent) then raise exception 'agent_busy'; end if;
  delete from spy_agents where id = p_agent;
  return true;
end $$;

/** Охрана: агент стережёт систему державы (или снимается с охраны при p_system = null). */
create or replace function public.v1_intel_guard(p_agent uuid, p_system text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_fid text := public._v1_intel_me();
begin
  if not exists (select 1 from spy_agents where id = p_agent and faction_id = v_fid and not coalesce(captive, false)) then raise exception 'agent_not_found'; end if;
  delete from faction_intel_guard where agent_id = p_agent;
  if p_system is null then return true; end if;
  if not public._v1_agent_free(p_agent) then raise exception 'agent_busy'; end if;
  if not exists (select 1 from map_systems where id = p_system and faction = v_fid)
     and not exists (select 1 from colonies where system_id = p_system and faction_id = v_fid) then raise exception 'guard_own_system'; end if;
  insert into faction_intel_guard(faction_id, agent_id, system_id, set_at) values (v_fid, p_agent, p_system, now());
  return true;
end $$;

-- ════════ 4. Операции ════════
/** Цели операции: колонии и системы державы. */
create or replace function public.v1_intel_targets(p_fid text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_fid text := public._v1_intel_me(false);
begin
  return jsonb_build_object(
    'colonies', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.planet_name, 'system', s.name, 'system_id', c.system_id, 'capital', c.is_capital)
                   order by c.is_capital desc, s.name, c.planet_name), '[]'::jsonb)
                 from colonies c left join map_systems s on s.id = c.system_id where c.faction_id = p_fid),
    'systems', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.name), '[]'::jsonb)
                from map_systems s where s.faction = p_fid or s.id in (select system_id from colonies where faction_id = p_fid)));
end $$;

create or replace function public.v1_intel_launch(p_op text, p_target text, p_agents uuid[], p_colony uuid default null, p_system text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_fid text := public._v1_intel_me(); cfg jsonb := public._v1_iop(p_op); n int; a uuid; g int; sysg boolean := false;
  s int; d int; cost numeric; v_sys text := p_system; t timestamptz; oid uuid;
begin
  if cfg is null then raise exception 'unknown_op'; end if;
  if p_target is null or p_target = v_fid or not exists (select 1 from faction_economy where faction_id = p_target) then raise exception 'bad_target'; end if;
  n := coalesce(array_length(p_agents, 1), 0);
  if n < 1 or n > public._v1_iv('max_per_op', 3) or n <> (select count(distinct x) from unnest(p_agents) x) then raise exception 'op_agents: %', public._v1_iv('max_per_op', 3)::int; end if;
  foreach a in array p_agents loop
    if not exists (select 1 from spy_agents where id = a and faction_id = v_fid) or not public._v1_agent_free(a) then raise exception 'agent_busy'; end if;
  end loop;
  if cfg->>'target' = 'colony' then
    select system_id into v_sys from colonies where id = p_colony and faction_id = p_target;
    if v_sys is null then raise exception 'op_need_colony'; end if;
  elsif cfg->>'target' = 'system' then
    if p_system is null or not (exists (select 1 from map_systems where id = p_system and faction = p_target)
                                or exists (select 1 from colonies where system_id = p_system and faction_id = p_target)) then raise exception 'op_need_system'; end if;
  else v_sys := null;
  end if;
  select count(*) into g from faction_intel_guard gi join spy_agents ag on ag.id = gi.agent_id and not coalesce(ag.captive, false) where gi.faction_id = p_target;
  if v_sys is not null then sysg := exists (select 1 from faction_intel_guard gi where gi.faction_id = p_target and gi.system_id = v_sys); end if;
  s := (cfg->>'succ')::int + public._v1_iv('extra_agent_succ', 8)::int * (n - 1)
       - least(public._v1_iv('guard_succ_cap', 20), public._v1_iv('guard_succ', 3) * g)::int - case when sysg then public._v1_iv('sys_guard_succ', 10)::int else 0 end;
  d := (cfg->>'det')::int + public._v1_iv('extra_agent_det', 4)::int * (n - 1)
       + least(public._v1_iv('guard_det_cap', 25), public._v1_iv('guard_det', 4) * g)::int + case when sysg then public._v1_iv('sys_guard_det', 15)::int else 0 end;
  s := greatest(5, least(95, s)); d := greatest(5, least(95, d));
  cost := (cfg->>'gc')::numeric * n;
  update faction_economy set gc = gc - cost where faction_id = v_fid and gc >= cost;
  if not found then raise exception 'prod_no_money: %', cost::bigint; end if;
  t := now() + make_interval(secs => (cfg->>'hours')::numeric * 3600);
  insert into v1_spy_ops(actor_fid, owner_id, target_fid, op, agents, colony_id, system_id, success_pct, detect_pct, cost_gc, ready_at)
  values (v_fid, auth.uid(), p_target, p_op, p_agents, p_colony, v_sys, s, d, cost, t) returning id into oid;
  update spy_agents set ready_at = t where id = any(p_agents);
  return jsonb_build_object('id', oid, 'ready_at', t, 'cost', cost);
end $$;

/** Снять наблюдателя досрочно: агенты возвращаются сразу. */
create or replace function public.v1_intel_recall(p_op uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_fid text := public._v1_intel_me(); o v1_spy_ops;
begin
  select * into o from v1_spy_ops where id = p_op and actor_fid = v_fid and status = 'watching' for update;
  if o.id is null then raise exception 'op_not_found'; end if;
  update v1_spy_ops set status = 'done', until = now() where id = o.id;
  update spy_agents set ready_at = now() where id = any(o.agents) and faction_id = v_fid;
  perform public._v1_intel_log(v_fid, 'watch', 'Наблюдатель отозван', format('Агенты покинули систему %s.', (select name from map_systems where id = o.system_id)));
  return true;
end $$;

-- ════════ 5. Плен ════════
create or replace function public._v1_capture(p_agent uuid, p_captor text) returns void
language plpgsql security definer set search_path = public as $$
declare own text;
begin
  select faction_id into own from spy_agents where id = p_agent;
  delete from faction_intel_guard where agent_id = p_agent;
  update spy_agents set orig_fid = own, faction_id = p_captor, captive = true, captured_at = now(), ready_at = now() where id = p_agent;
end $$;

create or replace function public._v1_free_captive(p_agent uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update spy_agents set faction_id = orig_fid, captive = false, orig_fid = null, captured_at = null,
         ready_at = now() + make_interval(hours => public._v1_iv('release_cooldown_h', 24)::int)
   where id = p_agent and captive;
  update v1_spy_ransoms set status = 'void' where agent_id = p_agent and status = 'open';
end $$;

create or replace function public.v1_intel_release(p_agent uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_fid text := public._v1_intel_me(); a spy_agents;
begin
  select * into a from spy_agents where id = p_agent and faction_id = v_fid and captive for update;
  if a.id is null then raise exception 'captive_not_found'; end if;
  perform public._v1_free_captive(a.id);
  perform public._v1_intel_log(a.orig_fid, 'captive', 'Агент вернулся из плена',
    format('Держава «%s» отпустила агента %s без выкупа.', v1_fname(v_fid), btrim(a.first_name || ' ' || a.last_name)));
  return true;
end $$;

create or replace function public.v1_intel_ransom(p_agent uuid, p_price numeric) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_fid text := public._v1_intel_me(); a spy_agents;
begin
  select * into a from spy_agents where id = p_agent and faction_id = v_fid and captive for update;
  if a.id is null then raise exception 'captive_not_found'; end if;
  if coalesce(p_price, -1) < 0 or p_price > 10000000 then raise exception 'bad_price'; end if;
  update v1_spy_ransoms set status = 'void' where agent_id = a.id and status = 'open';
  insert into v1_spy_ransoms(agent_id, captor_fid, owner_fid, price) values (a.id, v_fid, a.orig_fid, round(p_price));
  perform public._v1_intel_log(a.orig_fid, 'ransom', 'Предложен выкуп агента',
    format('Держава «%s» готова вернуть агента %s за %s ГС.', v1_fname(v_fid), btrim(a.first_name || ' ' || a.last_name), to_char(round(p_price), 'FM999G999G999')));
  return true;
end $$;

create or replace function public.v1_intel_ransom_answer(p_ransom uuid, p_accept boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_fid text := public._v1_intel_me(); r v1_spy_ransoms; nm text;
begin
  select * into r from v1_spy_ransoms where id = p_ransom and owner_fid = v_fid and status = 'open' for update;
  if r.id is null then raise exception 'ransom_gone'; end if;
  nm := public._v1_agent_name(r.agent_id);
  if not p_accept then
    update v1_spy_ransoms set status = 'declined' where id = r.id;
    perform public._v1_intel_log(r.captor_fid, 'ransom', 'Выкуп отклонён', format('Держава «%s» отказалась выкупать агента %s.', v1_fname(v_fid), nm));
    return true;
  end if;
  if not exists (select 1 from spy_agents where id = r.agent_id and captive and faction_id = r.captor_fid) then
    update v1_spy_ransoms set status = 'void' where id = r.id; raise exception 'ransom_gone';
  end if;
  update faction_economy set gc = gc - r.price where faction_id = v_fid and gc >= r.price;
  if not found then raise exception 'prod_no_money: %', r.price::bigint; end if;
  update faction_economy set gc = gc + r.price where faction_id = r.captor_fid;
  perform public._v1_free_captive(r.agent_id);
  update v1_spy_ransoms set status = 'paid' where id = r.id;
  perform public._v1_intel_log(r.captor_fid, 'ransom', 'Выкуп получен', format('Держава «%s» заплатила %s ГС за агента %s.', v1_fname(v_fid), to_char(r.price, 'FM999G999G999'), nm));
  return true;
end $$;

-- ════════ 6. Исход операции ════════
create or replace function public._v1_intel_resolve(p_op uuid) returns void
language plpgsql security definer set search_path = public as $$
declare o v1_spy_ops; cfg jsonb; ok boolean; det boolean; res jsonb := '{}'; v_label text; v_actor text; v_target text;
  amt numeric; k text; v numeric; stock jsonb; got jsonb := '{}'; bid uuid; bname text; cname text; ag uuid; nm text; f uuid; n int;
  vis text;      -- что жертва видит без раскрытия
begin
  select * into o from v1_spy_ops where id = p_op and status = 'active' for update;
  if o.id is null then return; end if;
  cfg := public._v1_iop(o.op); v_label := coalesce(cfg->>'label', o.op);
  v_actor := v1_fname(o.actor_fid); v_target := v1_fname(o.target_fid);
  ok := random() * 100 < o.success_pct;
  det := random() * 100 < o.detect_pct;

  if ok then
    if o.op = 'recon_basic' then
      res := jsonb_build_object(
        'gc', (select gc from faction_economy where faction_id = o.target_fid),
        'colonies', (select count(*) from colonies where faction_id = o.target_fid),
        'systems', (select count(*) from map_systems where faction = o.target_fid),
        'agents', (select count(*) from spy_agents where faction_id = o.target_fid and not coalesce(captive, false)),
        'guards', (select count(*) from faction_intel_guard where faction_id = o.target_fid),
        'fleets', (select count(*) from fleets where faction_id = o.target_fid),
        'armies', (select count(*) from armies where faction_id = o.target_fid),
        'wars', (select coalesce(jsonb_agg(distinct v1_fname(b.fid)), '[]'::jsonb) from wars w join war_sides a on a.war_id = w.id and a.fid = o.target_fid
                  join war_sides b on b.war_id = w.id and b.side <> a.side where w.status = 'active'));
    elsif o.op = 'recon_deep' then
      res := jsonb_build_object(
        'stock', (select coalesce(jsonb_object_agg(key, val), '{}'::jsonb) from (select e.key, round((e.value #>> '{}')::numeric) val
                    from faction_economy fe, jsonb_each(coalesce(fe.resources, '{}'::jsonb)) e where fe.faction_id = o.target_fid
                    and jsonb_typeof(e.value) = 'number' order by (e.value #>> '{}')::numeric desc limit 12) z),
        'buildings', (select coalesce(jsonb_object_agg(btype, cnt), '{}'::jsonb) from (select btype, count(*) cnt from colony_buildings where faction_id = o.target_fid group by btype) z),
        'queue', (select coalesce(jsonb_agg(jsonb_build_object('name', p.name, 'qty', p.qty, 'ready_at', p.ready_at, 'system', (select name from map_systems where id = p.system_id)) order by p.ready_at), '[]'::jsonb)
                  from v1_production p where p.faction_id = o.target_fid and p.status = 'queued'));
    elsif o.op = 'fleet_dossier' then
      res := jsonb_build_object('fleets', (select coalesce(jsonb_agg(jsonb_build_object(
          'name', fl.name, 'status', fl.status, 'system', (select name from map_systems where id = fl.system_id),
          'dest', (select name from map_systems where id = fl.dest_sys), 'arrive_at', fl.arrive_at,
          'stance', m.stance, 'fuel', m.fuel, 'fuel_cap', m.fuel_cap,
          'ships', (select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(e->>'unit_name', 'корабль'), 'qty', (e->>'qty')::int)), '[]'::jsonb)
                      from jsonb_array_elements(coalesce(fl.composition, '[]'::jsonb)) e where coalesce((e->>'qty')::int, 0) > 0)
                   || (select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'qty', x.qty)), '[]'::jsonb) from v1_fleet_ships x where x.fleet_id = fl.id))
          order by fl.created_at), '[]'::jsonb)
        from fleets fl left join v1_fleet_meta m on m.fleet_id = fl.id where fl.faction_id = o.target_fid));
    elsif o.op = 'watch' then
      res := jsonb_build_object('system', (select name from map_systems where id = o.system_id), 'days', coalesce((cfg->>'days')::int, 3));
    elsif o.op = 'steal_gc' then
      select least(floor(greatest(0, gc) * coalesce((cfg->>'pct')::numeric, 0.02)), coalesce((cfg->>'cap')::numeric, 150000)) into amt
        from faction_economy where faction_id = o.target_fid for update;
      amt := coalesce(amt, 0);
      update faction_economy set gc = gc - amt where faction_id = o.target_fid;
      update faction_economy set gc = gc + amt where faction_id = o.actor_fid;
      res := jsonb_build_object('gc', amt);
      vis := format('Из казны пропало %s ГС.', to_char(amt, 'FM999G999G999'));
    elsif o.op = 'steal_res' then
      select resources into stock from faction_economy where faction_id = o.target_fid for update;
      for k, v in select e.key, (e.value #>> '{}')::numeric from jsonb_each(coalesce(stock, '{}'::jsonb)) e
                   where jsonb_typeof(e.value) = 'number' and (e.value #>> '{}')::numeric >= 1
                   order by (e.value #>> '{}')::numeric desc limit coalesce((cfg->>'kinds')::int, 3) loop
        amt := least(floor(v * coalesce((cfg->>'pct')::numeric, 0.08)), coalesce((cfg->>'cap')::numeric, 300));
        if amt <= 0 then continue; end if;
        stock := jsonb_set(stock, array[k], to_jsonb(v - amt));
        got := got || jsonb_build_object(k, amt);
      end loop;
      update faction_economy set resources = stock where faction_id = o.target_fid;
      update faction_economy fe set resources = (select coalesce(fe.resources, '{}'::jsonb) || coalesce(jsonb_object_agg(g.key,
               coalesce((fe.resources->>g.key)::numeric, 0) + (g.value #>> '{}')::numeric), '{}'::jsonb) from jsonb_each(got) g)
       where fe.faction_id = o.actor_fid;
      res := jsonb_build_object('resources', got);
      vis := 'Со склада пропало: ' || coalesce((select string_agg(key || ' ' || (value #>> '{}'), ', ') from jsonb_each(got)), 'ничего') || '.';
    elsif o.op = 'sabotage' then
      select b.id, b.btype into bid, bname from colony_buildings b where b.colony_id = o.colony_id order by random() limit 1;
      select planet_name into cname from colonies where id = o.colony_id;
      if bid is not null then delete from colony_buildings where id = bid; end if;
      res := jsonb_build_object('colony', cname, 'building', bname);
      vis := case when bid is null then null else format('На колонии «%s» взорвана постройка (%s).', cname, bname) end;
    elsif o.op = 'yard_sabotage' then
      update v1_production set started_at = started_at + make_interval(hours => coalesce((cfg->>'delay_h')::int, 6)),
             ready_at = ready_at + make_interval(hours => coalesce((cfg->>'delay_h')::int, 6))
       where faction_id = o.target_fid and status = 'queued';
      get diagnostics n = row_count;
      res := jsonb_build_object('orders', n, 'hours', coalesce((cfg->>'delay_h')::int, 6));
      vis := case when n > 0 then format('На верфях авария: %s заказов задержаны на %s ч.', n, coalesce((cfg->>'delay_h')::int, 6)) end;
    elsif o.op = 'drain_fuel' then
      n := 0;
      for f in select fl.id from fleets fl where fl.faction_id = o.target_fid and fl.status = 'idle' and not coalesce(fl.is_station, false)
                 order by random() limit coalesce((cfg->>'fleets')::int, 2) loop
        perform public._v1_fleet_meta(f);
        update v1_fleet_meta set fuel = greatest(0, fuel - coalesce((cfg->>'fuel')::numeric, 3)), updated_at = now() where fleet_id = f;
        got := got || jsonb_build_object((select name from fleets where id = f), coalesce((cfg->>'fuel')::numeric, 3));
        n := n + 1;
      end loop;
      res := jsonb_build_object('fleets', got);
      vis := case when n > 0 then 'Утечка топлива: у флотов ' || (select string_agg('«' || key || '»', ', ') from jsonb_each(got)) || ' упал запас хода.' end;
    elsif o.op = 'incite' then
      select planet_name into cname from colonies where id = o.colony_id;
      insert into v1_order_effects(colony_id, amount, source, until)
      values (o.colony_id, coalesce((cfg->>'order')::int, -20), 'Подстрекатели', now() + make_interval(days => coalesce((cfg->>'days')::int, 3)));
      res := jsonb_build_object('colony', cname, 'order', coalesce((cfg->>'order')::int, -20), 'days', coalesce((cfg->>'days')::int, 3));
      vis := format('На колонии «%s» работают подстрекатели: порядок падает.', cname);
    elsif o.op = 'kill_agent' then
      select a.id into ag from spy_agents a where a.faction_id = o.target_fid and not coalesce(a.captive, false)
        and not exists (select 1 from v1_spy_ops x where x.status in ('active', 'watching') and a.id = any(x.agents)) order by random() limit 1;
      if ag is not null then
        nm := public._v1_agent_name(ag);
        delete from spy_agents where id = ag;
      end if;
      res := jsonb_build_object('agent', nm);
      vis := case when ag is null then null else format('Агент %s найден мёртвым.', nm) end;
    end if;
  end if;

  -- исход для исполнителя
  if o.op = 'watch' and ok then
    update v1_spy_ops set status = 'watching', outcome = 'success', detected = det, result = res,
           until = now() + make_interval(days => coalesce((cfg->>'days')::int, 3)),
           params = jsonb_build_object('seen', (select coalesce(jsonb_agg(id), '[]'::jsonb) from fleets where system_id = o.system_id and status = 'idle' and faction_id <> o.actor_fid))
     where id = o.id;
    update spy_agents set ready_at = now() + make_interval(days => coalesce((cfg->>'days')::int, 3)) where id = any(o.agents);
  else
    update v1_spy_ops set status = 'done', outcome = case when ok then 'success' else 'fail' end, detected = det, result = res where id = o.id;
    update spy_agents set ready_at = now() where id = any(o.agents) and faction_id = o.actor_fid;
  end if;

  if ok then
    perform public._v1_intel_log(o.actor_fid, 'report', v_label || ' · ' || v_target || ': успех',
      case when det then 'Операция удалась, но цель узнала, чья это работа.' else 'Операция удалась незаметно.' end,
      jsonb_build_object('op', o.op, 'target', o.target_fid, 'target_name', v_target, 'result', res, 'detected', det));
    if det then
      perform public._v1_intel_log(o.target_fid, 'incident', 'Раскрыта операция: ' || v_label,
        coalesce(vis || ' ', '') || format('След ведёт к державе «%s».', v_actor), jsonb_build_object('op', o.op, 'actor', o.actor_fid, 'actor_name', v_actor));
    elsif vis is not null then
      perform public._v1_intel_log(o.target_fid, 'incident', 'Тайная операция против державы', vis || ' Виновных найти не удалось.', jsonb_build_object('op', o.op));
    end if;
  else
    if det then
      -- провал и раскрытие: один из агентов попадает в плен
      ag := o.agents[1 + floor(random() * array_length(o.agents, 1))::int];
      nm := public._v1_agent_name(ag);
      perform public._v1_capture(ag, o.target_fid);
      perform public._v1_intel_log(o.actor_fid, 'report', v_label || ' · ' || v_target || ': провал',
        format('Операция сорвалась, агент %s схвачен и сидит в тюрьме державы «%s».', nm, v_target),
        jsonb_build_object('op', o.op, 'target', o.target_fid, 'target_name', v_target, 'captured', nm));
      perform public._v1_intel_log(o.target_fid, 'incident', 'Пойман агент: ' || v_label,
        format('Служба безопасности сорвала операцию «%s» и задержала агента %s. След ведёт к державе «%s». Пленного можно держать, отпустить или предложить выкуп.', v_label, nm, v_actor),
        jsonb_build_object('op', o.op, 'actor', o.actor_fid, 'actor_name', v_actor, 'agent', ag));
    else
      perform public._v1_intel_log(o.actor_fid, 'report', v_label || ' · ' || v_target || ': провал',
        'Операция не удалась, агенты ушли незамеченными.', jsonb_build_object('op', o.op, 'target', o.target_fid, 'target_name', v_target));
    end if;
  end if;
end $$;

/** Наблюдатель: кто прилетел и кто ушёл из системы с прошлого тика. */
create or replace function public._v1_watch_scan(p_op uuid) returns void
language plpgsql security definer set search_path = public as $$
declare o v1_spy_ops; cur jsonb; prev jsonb; came text; went text; sname text;
begin
  select * into o from v1_spy_ops where id = p_op and status = 'watching' for update;
  if o.id is null then return; end if;
  sname := (select name from map_systems where id = o.system_id);
  if o.until <= now() then
    update v1_spy_ops set status = 'done' where id = o.id;
    perform public._v1_intel_log(o.actor_fid, 'watch', 'Наблюдатель вернулся', format('Срок наблюдения в системе %s вышел, агенты свободны.', sname));
    return;
  end if;
  select coalesce(jsonb_agg(id), '[]'::jsonb) into cur from fleets where system_id = o.system_id and status = 'idle' and faction_id <> o.actor_fid;
  prev := coalesce(o.params->'seen', '[]'::jsonb);
  select string_agg(format('«%s» (%s, кораблей: %s)', f.name, v1_fname(f.faction_id),
           (select coalesce(sum((e->>'qty')::int), 0) from jsonb_array_elements(coalesce(f.composition, '[]'::jsonb)) e)
           + (select coalesce(sum(qty), 0) from v1_fleet_ships where fleet_id = f.id)), ', ')
    into came from fleets f where f.id in (select (jsonb_array_elements_text(cur))::uuid except select (jsonb_array_elements_text(prev))::uuid);
  select string_agg(format('«%s» (%s)', f.name, v1_fname(f.faction_id)), ', ')
    into went from fleets f where f.id in (select (jsonb_array_elements_text(prev))::uuid except select (jsonb_array_elements_text(cur))::uuid);
  if came is not null then perform public._v1_intel_log(o.actor_fid, 'watch', 'Прибытие в ' || sname, 'В систему вошли: ' || came || '.', jsonb_build_object('system', sname)); end if;
  if went is not null then perform public._v1_intel_log(o.actor_fid, 'watch', 'Уход из ' || sname, 'Систему покинули: ' || went || '.', jsonb_build_object('system', sname)); end if;
  update v1_spy_ops set params = jsonb_set(params, '{seen}', cur) where id = o.id;
end $$;

create or replace function public.v1_intel_tick() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; n1 int := 0; n2 int := 0;
begin
  for r in select id from v1_spy_ops where status = 'active' and ready_at <= now() order by ready_at limit 200 loop
    begin perform public._v1_intel_resolve(r.id); n1 := n1 + 1;
    exception when others then raise warning 'операция %: %', r.id, sqlerrm; end;
  end loop;
  for r in select id from v1_spy_ops where status = 'watching' loop
    begin perform public._v1_watch_scan(r.id); n2 := n2 + 1;
    exception when others then raise warning 'наблюдатель %: %', r.id, sqlerrm; end;
  end loop;
  return jsonb_build_object('resolved', n1, 'watching', n2);
end $$;

do $$ begin
  perform cron.unschedule('v1-intel-tick') where exists (select 1 from cron.job where jobname = 'v1-intel-tick');
  perform cron.schedule('v1-intel-tick', '*/5 * * * *', 'select public.v1_intel_tick()');
end $$;

-- ════════ 7. Бой: наблюдатель в системе даёт стороне +2 к обзору ════════
create or replace function public._v1_side_sees(p_battle uuid, p_side text, p_x int, p_y int, p_ttype text default 'ship') returns boolean
language plpgsql stable security definer set search_path = public as $$
declare b record; m jsonb; u record; r numeric; d int; tc text; oc text; ground boolean; bonus int := 0;
begin
  select * into b from v1_battles where id = p_battle;
  m := b.map; if m is null then return true; end if;
  ground := b.kind = 'ground';
  tc := v1_map_cell(m, p_x, p_y);
  if exists (select 1 from v1_spy_ops o join v1_battle_sides s on s.battle_id = p_battle and s.side = p_side and s.faction_id = o.actor_fid
              where o.op = 'watch' and o.status = 'watching' and o.system_id = b.system_id) then bonus := 2; end if;
  for u in select * from v1_battle_units where battle_id = p_battle and side = p_side and alive and not left_field loop
    d := v1_hex_dist(u.x, u.y, p_x, p_y);
    oc := v1_map_cell(m, u.x, u.y);
    if not ground then
      r := (u.radar + bonus) * coalesce((m->>'radar')::numeric, 1) * case when u.pulse_turn = b.turn_no then 2 else 1 end;
      if oc = 'i' then r := r * 0.5; end if;
      if tc = 'a' then r := r * 0.7; end if;
      if (case when tc = 'n' then d <= 2 else d <= r end) and (d <= 1 or v1_hex_los(m, u.x, u.y, p_x, p_y, 'P')) then return true; end if;
    else
      r := (u.radar + bonus + case when u.utype = 'air' then 1 when oc = 'M' then 2 when oc = 'h' then 1 else 0 end)
           * case when u.pulse_turn = b.turn_no then 2 else 1 end;
      if tc in ('F', 'S') and p_ttype <> 'air' then r := least(r, 2); end if;
      if d <= r and (d <= 1 or u.utype = 'air' or p_ttype = 'air' or oc = 'M' or v1_hex_los(m, u.x, u.y, p_x, p_y, 'M')) then return true; end if;
    end if;
  end loop;
  return false;
end $$;

-- ════════ 8. Состояние раздела «Разведка» ════════
create or replace function public.v1_intel_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_fid text := public._v1_intel_me(false); can boolean;
begin
  can := v1_can_manage(v_fid, 'spy') or v1_can_manage(v_fid, 'army');
  if can then perform public._v1_recruits(v_fid); end if;
  return jsonb_build_object(
    'fid', v_fid, 'can', can,
    'gc', (select gc from faction_economy where faction_id = v_fid),
    'settings', (select value from v1_settings where key = 'intel'),
    'agents', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', btrim(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, '')),
                  'hired_at', coalesce(a.hired_at, a.created_at), 'ready_at', a.ready_at,
                  'guard', (select jsonb_build_object('id', g.system_id, 'name', s.name) from faction_intel_guard g left join map_systems s on s.id = g.system_id where g.agent_id = a.id limit 1),
                  'op', (select jsonb_build_object('id', o.id, 'op', o.op, 'status', o.status, 'ready_at', o.ready_at, 'until', o.until, 'target', v1_fname(o.target_fid))
                           from v1_spy_ops o where o.status in ('active', 'watching') and a.id = any(o.agents) limit 1),
                  'old_busy', exists (select 1 from spy_missions m where m.status = 'active' and m.agent_ids ? a.id::text),
                  'free', public._v1_agent_free(a.id)) order by coalesce(a.hired_at, a.created_at)), '[]'::jsonb)
               from spy_agents a where a.faction_id = v_fid and not coalesce(a.captive, false)),
    'recruits', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', first_name || ' ' || last_name, 'cost', cost, 'expires', created_at + interval '24 hours') order by created_at), '[]'::jsonb)
                 from v1_spy_recruits where faction_id = v_fid),
    'ops', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'op', o.op, 'status', o.status, 'target', v1_fname(o.target_fid),
              'colony', (select planet_name from colonies where id = o.colony_id), 'system', (select name from map_systems where id = o.system_id),
              'success', o.success_pct, 'detect', o.detect_pct, 'ready_at', o.ready_at, 'until', o.until, 'agents', cardinality(o.agents)) order by o.ready_at), '[]'::jsonb)
            from v1_spy_ops o where o.actor_fid = v_fid and o.status in ('active', 'watching')),
    'log', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'kind', l.kind, 'title', l.title, 'body', l.body, 'data', l.data, 'at', l.created_at) order by l.id desc), '[]'::jsonb)
            from (select * from v1_intel_log where faction_id = v_fid order by id desc limit 60) l),
    'captives', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', btrim(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, '')),
                   'owner', v1_fname(a.orig_fid), 'since', a.captured_at,
                   'ransom', (select jsonb_build_object('price', r.price, 'status', r.status) from v1_spy_ransoms r where r.agent_id = a.id order by r.created_at desc limit 1))), '[]'::jsonb)
                 from spy_agents a where a.faction_id = v_fid and a.captive),
    'jailed', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', btrim(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, '')),
                 'captor', v1_fname(a.faction_id), 'since', a.captured_at,
                 'ransom', (select jsonb_build_object('id', r.id, 'price', r.price) from v1_spy_ransoms r where r.agent_id = a.id and r.status = 'open' limit 1))), '[]'::jsonb)
               from spy_agents a where a.orig_fid = v_fid and a.captive),
    'factions', (select coalesce(jsonb_agg(jsonb_build_object('id', fe.faction_id, 'name', v1_fname(fe.faction_id), 'war', v1_at_war(v_fid, fe.faction_id)) order by v1_fname(fe.faction_id)), '[]'::jsonb)
                 from faction_economy fe where fe.faction_id <> v_fid and exists (select 1 from colonies c where c.faction_id = fe.faction_id)),
    'systems', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.name), '[]'::jsonb)
                from map_systems s where s.faction = v_fid or s.id in (select system_id from colonies where faction_id = v_fid)));
end $$;

-- ════════ 9. Сводка «Война» ════════
create or replace function public.v1_war_front() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction();
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  return jsonb_build_object(
    'fid', v_fid,
    'wars', (select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'started_at', w.started_at, 'cause', w.cause,
               'mine', (select jsonb_agg(v1_fname(s.fid)) from war_sides s where s.war_id = w.id and s.side = me.side),
               'foes', (select jsonb_agg(v1_fname(s.fid)) from war_sides s where s.war_id = w.id and s.side <> me.side),
               'foe_ids', (select jsonb_agg(s.fid) from war_sides s where s.war_id = w.id and s.side <> me.side),
               'role', me.side) order by w.started_at), '[]'::jsonb)
             from wars w join war_sides me on me.war_id = w.id and me.fid = v_fid where w.status = 'active'),
    'held', (select coalesce(jsonb_agg(jsonb_build_object('system', s.name, 'owner', v1_fname(o.owner_fid), 'since', o.since,
               'fleet', (select name from fleets where id = o.fleet_id)) order by o.since), '[]'::jsonb)
             from system_occupation o join map_systems s on s.id = o.system_id where o.occupier_fid = v_fid),
    'lost', (select coalesce(jsonb_agg(jsonb_build_object('system', s.name, 'occupier', v1_fname(o.occupier_fid), 'since', o.since) order by o.since), '[]'::jsonb)
             from system_occupation o join map_systems s on s.id = o.system_id where o.owner_fid = v_fid),
    'colonies_held', (select coalesce(jsonb_agg(jsonb_build_object('colony', c.planet_name, 'system', s.name, 'owner', v1_fname(o.owner_fid), 'capital', c.is_capital,
               'transfer_at', o.transfer_at, 'held', exists (select 1 from armies a where a.colony_id = c.id and a.faction_id = v_fid and a.status = 'idle')) order by o.transfer_at), '[]'::jsonb)
             from colony_occupation o join colonies c on c.id = o.colony_id left join map_systems s on s.id = c.system_id where o.occupier_fid = v_fid),
    'colonies_lost', (select coalesce(jsonb_agg(jsonb_build_object('colony', c.planet_name, 'system', s.name, 'occupier', v1_fname(o.occupier_fid), 'capital', c.is_capital,
               'transfer_at', o.transfer_at) order by o.transfer_at), '[]'::jsonb)
             from colony_occupation o join colonies c on c.id = o.colony_id left join map_systems s on s.id = c.system_id where o.owner_fid = v_fid),
    'clearing', (select coalesce(jsonb_agg(jsonb_build_object('army', a.name, 'colony', c.planet_name, 'ready', m.clear_ready) order by m.clear_ready), '[]'::jsonb)
             from armies a join v1_army_meta m on m.army_id = a.id join colonies c on c.id = m.clear_colony where a.faction_id = v_fid and a.status = 'v1_clearing'),
    'battles', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'kind', b.kind, 'system', (select name from map_systems where id = b.system_id),
               'colony', (select planet_name from colonies where id = b.colony_id), 'turn', b.turn_no, 'my_turn', b.side_to_move = s.side,
               'foes', (select jsonb_agg(distinct v1_fname(x.faction_id)) from v1_battle_sides x where x.battle_id = b.id and x.side <> s.side)) order by b.created_at desc), '[]'::jsonb)
             from v1_battles b join v1_battle_sides s on s.battle_id = b.id and s.faction_id = v_fid where b.status = 'active'),
    'recent', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'kind', b.kind, 'system', (select name from map_systems where id = b.system_id),
               'won', b.winner_side = s.side, 'ended_at', b.ended_at) order by b.ended_at desc), '[]'::jsonb)
             from (select b.* from v1_battles b join v1_battle_sides s2 on s2.battle_id = b.id and s2.faction_id = v_fid
                    where b.status = 'done' and b.kind <> 'test' order by b.ended_at desc nulls last limit 8) b
             join v1_battle_sides s on s.battle_id = b.id and s.faction_id = v_fid),
    'moving', (select coalesce(jsonb_agg(jsonb_build_object('fleet', f.name, 'to', (select name from map_systems where id = f.dest_sys), 'arrive_at', f.arrive_at) order by f.arrive_at), '[]'::jsonb)
             from fleets f join map_systems d on d.id = f.dest_sys
            where f.faction_id = v_fid and f.status = 'v1_transit' and d.faction is not null and v1_at_war(v_fid, d.faction)));
end $$;

-- ════════ 10. Права ════════
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('_v1_iv', '_v1_iop', '_v1_intel_log', '_v1_agent_name', '_v1_agent_free', '_v1_intel_me', '_v1_recruits', '_v1_capture',
                                '_v1_free_captive', '_v1_intel_resolve', '_v1_watch_scan', 'v1_intel_tick', '_v1_side_sees') loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
  for f in select p.oid::regprocedure sig from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('v1_intel_state', 'v1_intel_hire', 'v1_intel_fire', 'v1_intel_guard', 'v1_intel_targets', 'v1_intel_launch',
                                'v1_intel_recall', 'v1_intel_release', 'v1_intel_ransom', 'v1_intel_ransom_answer', 'v1_war_front') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;
