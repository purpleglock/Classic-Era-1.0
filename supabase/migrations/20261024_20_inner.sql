-- ═══════════════════════════════════════════════════════════════
-- 20. Внутренняя политика на новом коде.
--   Курс державы (новые названия — миграция 17) и его смена.
--   Вера державы: основать, принять, выйти, светское государство (+5 % к науке).
--   Порядок колоний: считается из понятных слагаемых, разбивка видна игроку.
--   Волнения: сначала их гасит служба безопасности (отделения СБ в колонии и системе);
--   не справилась — приходит событие с решениями; без решения — восстание; не подавлено — отделение.
--   Режим просмотра: пока v1_settings.politics.live = false, колонии не отделяются
--   (вместо этого в журнале пишется «отделилась бы»), а доход не режется.
-- ═══════════════════════════════════════════════════════════════

insert into public.v1_settings(key, value) values ('politics', jsonb_build_object(
  'live', false,
  'base', 20, 'capital', 20, 'per_jump', -2, 'distance_cap', -30,
  'faith_match', 10, 'faith_foreign', -10,
  'garrison_fleet', 3, 'garrison_army', 5, 'garrison_cap', 20,
  'police_colony', 4, 'police_system', 2,
  'war', -5, 'weariness_after_days', 14, 'weariness_cap', -20,
  'unrest_at', -50, 'calm_at', -20, 'unrest_days', 2, 'secede_days', 5,
  'police_power_colony', 10, 'police_power_system', 5,
  'concessions_cost', 25000, 'concessions_order', 30, 'concessions_days', 5,
  'army_order', 25, 'army_days', 5, 'army_neighbors', -5,
  'preach_cost', 10000, 'preach_order', 20, 'preach_days', 7,
  'martial_order', 40, 'martial_days', 3,
  'cruelty_order', -10, 'cruelty_days', 3,
  'income_low', -0.25, 'income_high', 0.10))
on conflict (key) do nothing;

-- ── Состояние колоний ──
create table if not exists public.v1_colony_order (
  colony_id uuid primary key references public.colonies(id) on delete cascade,
  faction_id text not null,
  value int not null default 0,
  breakdown jsonb not null default '[]'::jsonb,
  stage text not null default 'calm' check (stage in ('calm','unrest','rebellion')),
  stage_since timestamptz,
  deadline timestamptz,
  faith_id uuid,                    -- вера колонии; null — вера державы
  updated_at timestamptz not null default now()
);
create index if not exists v1_colony_order_fid on public.v1_colony_order(faction_id);
alter table public.v1_colony_order enable row level security;
drop policy if exists v1_colony_order_read on public.v1_colony_order;
create policy v1_colony_order_read on public.v1_colony_order for select using (v1_is_staff() or faction_id = v1_my_faction());

create table if not exists public.v1_order_effects (
  id uuid primary key default gen_random_uuid(),
  colony_id uuid not null references public.colonies(id) on delete cascade,
  amount int not null,
  source text not null,
  until timestamptz not null,
  martial boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists v1_order_effects_col on public.v1_order_effects(colony_id, until);
alter table public.v1_order_effects enable row level security;

create table if not exists public.v1_unrest_log (
  id uuid primary key default gen_random_uuid(),
  faction_id text not null,
  colony_id uuid,
  colony_name text,
  kind text not null,               -- unrest, rebellion, police, decision, calm, seceded, would_secede
  text text not null,
  created_at timestamptz not null default now()
);
create index if not exists v1_unrest_log_fid on public.v1_unrest_log(faction_id, created_at desc);
alter table public.v1_unrest_log enable row level security;
drop policy if exists v1_unrest_log_read on public.v1_unrest_log;
create policy v1_unrest_log_read on public.v1_unrest_log for select using (v1_is_staff() or faction_id = v1_my_faction());

-- Главная вера державы: основанная, иначе самая ранняя принятая
create or replace function public.v1_state_faith_id(p_fid text) returns uuid
language sql stable security definer set search_path = public as $$
  select faith_id from faith_membership where faction_id = p_fid order by (role = 'founder') desc, joined_at limit 1;
$$;

-- Порядок всех колоний державы с разбивкой
create or replace function public.v1_colony_orders(p_fid text)
returns table(colony_id uuid, value int, breakdown jsonb)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare cfg jsonb := coalesce((select value from v1_settings where key = 'politics'), '{}'::jsonb);
  cap_sys text; m jsonb; course_order int; sfaith uuid; at_war boolean; war_days int; state_mods int; weary int;
begin
  select c.system_id into cap_sys from colonies c where c.faction_id = p_fid and c.is_capital limit 1;
  if cap_sys is null then select c.system_id into cap_sys from colonies c where c.faction_id = p_fid order by c.created_at limit 1; end if;
  m := v1_faction_mods(p_fid);
  course_order := round(coalesce((m->>'order')::numeric, 0));
  sfaith := v1_state_faith_id(p_fid);
  select coalesce(max(extract(day from now() - w.started_at))::int, -1) into war_days
    from wars w join war_sides s on s.war_id = w.id and s.fid = p_fid where w.status = 'active';
  at_war := war_days >= 0;
  weary := case when war_days > coalesce((cfg->>'weariness_after_days')::int, 14)
                then greatest(coalesce((cfg->>'weariness_cap')::int, -20), -(war_days - coalesce((cfg->>'weariness_after_days')::int, 14))) else 0 end;
  select coalesce(sum(amount), 0) into state_mods from v1_order_mods where faction_id = p_fid and until > now();

  return query
  with recursive hops(sid, d) as (
    select cap_sys, 0
    union
    select case when h.a_id = hops.sid then h.b_id else h.a_id end, hops.d + 1
      from hops join map_hyperlanes h on (h.a_id = hops.sid or h.b_id = hops.sid)
     where hops.d < 15
  ), dist as (select sid, min(d) d from hops group by sid),
  pol as (select c2.system_id, c2.id, coalesce(sum(b.slots_open), 0) slots
            from colonies c2 left join colony_buildings b on b.colony_id = c2.id and b.btype = 'police'
           where c2.faction_id = p_fid group by c2.system_id, c2.id),
  base as (
    select c.id, c.is_capital, c.system_id,
      coalesce((select d from dist where sid = c.system_id), 15) d,
      (select slots from pol where pol.id = c.id) own_police,
      (select coalesce(sum(slots), 0) from pol where pol.system_id = c.system_id and pol.id <> c.id) sys_police,
      (select count(*) from fleets f where f.faction_id = p_fid and f.system_id = c.system_id and not coalesce(f.is_station, false) and coalesce(f.arrive_at, now()) <= now()) fl,
      (select count(*) from armies a where a.faction_id = p_fid and a.colony_id = c.id) ar,
      (select o.faith_id from v1_colony_order o where o.colony_id = c.id) cfaith,
      (select coalesce(sum(e.amount), 0) from v1_order_effects e where e.colony_id = c.id and e.until > now()) eff
    from colonies c where c.faction_id = p_fid
  ), parts as (
    select b.id, jsonb_strip_nulls(jsonb_build_array(
      jsonb_build_object('k', 'Основа', 'v', coalesce((cfg->>'base')::int, 20)),
      case when b.is_capital then jsonb_build_object('k', 'Столица', 'v', coalesce((cfg->>'capital')::int, 20)) end,
      case when not b.is_capital and b.d > 0 then jsonb_build_object('k', format('Удалённость: %s прыжк.', b.d), 'v', greatest(coalesce((cfg->>'distance_cap')::int, -30), b.d * coalesce((cfg->>'per_jump')::int, -2))) end,
      case when course_order <> 0 then jsonb_build_object('k', 'Курс державы', 'v', course_order) end,
      case when sfaith is not null and coalesce(b.cfaith, sfaith) = sfaith then jsonb_build_object('k', 'Государственная вера', 'v', coalesce((cfg->>'faith_match')::int, 10))
           when b.cfaith is not null and b.cfaith is distinct from sfaith then jsonb_build_object('k', 'Чужая вера', 'v', coalesce((cfg->>'faith_foreign')::int, -10)) end,
      case when b.fl + b.ar > 0 then jsonb_build_object('k', 'Гарнизон', 'v', least(coalesce((cfg->>'garrison_cap')::int, 20), b.fl * coalesce((cfg->>'garrison_fleet')::int, 3) + b.ar * coalesce((cfg->>'garrison_army')::int, 5))) end,
      case when b.own_police + b.sys_police > 0 then jsonb_build_object('k', 'Служба безопасности', 'v', b.own_police * coalesce((cfg->>'police_colony')::int, 4) + b.sys_police * coalesce((cfg->>'police_system')::int, 2)) end,
      case when at_war then jsonb_build_object('k', 'Война', 'v', coalesce((cfg->>'war')::int, -5)) end,
      case when weary <> 0 then jsonb_build_object('k', 'Усталость от войны', 'v', weary) end,
      case when state_mods <> 0 then jsonb_build_object('k', 'События в галактике', 'v', state_mods) end,
      case when b.eff <> 0 then jsonb_build_object('k', 'Решения власти', 'v', b.eff) end
    )) arr
    from base b
  )
  select p.id, greatest(-100, least(100, (select coalesce(sum((x->>'v')::int), 0) from jsonb_array_elements(p.arr) x)))::int,
         (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(p.arr) x where x <> 'null'::jsonb)
    from parts p;
end $$;

-- Пересчитать порядок державы; с p_advance = true — ещё и продвинуть волнения (суточный тик)
create or replace function public.v1_order_refresh(p_fid text, p_advance boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare cfg jsonb := coalesce((select value from v1_settings where key = 'politics'), '{}'::jsonb);
  r record; st v1_colony_order; nm text; power int; strength int; live boolean := coalesce((cfg->>'live')::boolean, false);
begin
  insert into v1_colony_order(colony_id, faction_id, value, breakdown, updated_at)
  select o.colony_id, p_fid, o.value, o.breakdown, now() from v1_colony_orders(p_fid) o
  on conflict (colony_id) do update set faction_id = excluded.faction_id, value = excluded.value, breakdown = excluded.breakdown, updated_at = now();
  delete from v1_colony_order where faction_id = p_fid and colony_id not in (select id from colonies where faction_id = p_fid);
  if not p_advance then return; end if;

  for r in select o.*, c.planet_name, c.system_id from v1_colony_order o join colonies c on c.id = o.colony_id where o.faction_id = p_fid loop
    nm := r.planet_name;
    if r.stage = 'calm' and r.value < coalesce((cfg->>'unrest_at')::int, -50) then
      -- служба безопасности пытается погасить волнения сама
      select coalesce(sum(case when b.colony_id = r.colony_id then b.slots_open * coalesce((cfg->>'police_power_colony')::int, 10)
                               else b.slots_open * coalesce((cfg->>'police_power_system')::int, 5) end), 0) into power
        from colony_buildings b join colonies c on c.id = b.colony_id
       where b.btype = 'police' and c.faction_id = p_fid and c.system_id = r.system_id;
      strength := coalesce((cfg->>'unrest_at')::int, -50) - r.value + 10;
      if power >= strength then
        insert into v1_order_effects(colony_id, amount, source, until) values (r.colony_id, 15, 'Служба безопасности навела порядок', now() + interval '3 days');
        insert into v1_unrest_log(faction_id, colony_id, colony_name, kind, text)
        values (p_fid, r.colony_id, nm, 'police', format('Служба безопасности погасила волнения на «%s» (сила %s против %s).', nm, power, strength));
      else
        update v1_colony_order set stage = 'unrest', stage_since = now(), deadline = now() + make_interval(days => coalesce((cfg->>'unrest_days')::int, 2)) where colony_id = r.colony_id;
        insert into v1_unrest_log(faction_id, colony_id, colony_name, kind, text)
        values (p_fid, r.colony_id, nm, 'unrest', format('Волнения на «%s»: служба безопасности не справляется (сила %s против %s). Нужно решение власти.', nm, power, strength));
      end if;
    elsif r.stage = 'unrest' and r.value >= coalesce((cfg->>'calm_at')::int, -20) then
      update v1_colony_order set stage = 'calm', stage_since = now(), deadline = null where colony_id = r.colony_id;
      insert into v1_unrest_log(faction_id, colony_id, colony_name, kind, text) values (p_fid, r.colony_id, nm, 'calm', format('На «%s» снова спокойно.', nm));
    elsif r.stage = 'unrest' and r.deadline <= now() then
      update v1_colony_order set stage = 'rebellion', stage_since = now(), deadline = now() + make_interval(days => coalesce((cfg->>'secede_days')::int, 5)) where colony_id = r.colony_id;
      insert into v1_unrest_log(faction_id, colony_id, colony_name, kind, text)
      values (p_fid, r.colony_id, nm, 'rebellion', format('Восстание на «%s»! Колония не подчиняется власти. Подавите его, пока она не отделилась.', nm));
      perform v1_bulletin('Восстание: ' || nm, format('В колонии «%s» державы %s вспыхнуло восстание.', nm, v1_fname(p_fid)), jsonb_build_array(p_fid));
    elsif r.stage = 'rebellion' and r.value >= coalesce((cfg->>'calm_at')::int, -20) then
      update v1_colony_order set stage = 'calm', stage_since = now(), deadline = null where colony_id = r.colony_id;
      insert into v1_unrest_log(faction_id, colony_id, colony_name, kind, text) values (p_fid, r.colony_id, nm, 'calm', format('Восстание на «%s» выдохлось.', nm));
    elsif r.stage = 'rebellion' and r.deadline <= now() then
      if live and not exists (select 1 from colonies where id = r.colony_id and is_capital) then
        insert into v1_unrest_log(faction_id, colony_id, colony_name, kind, text) values (p_fid, null, nm, 'seceded', format('Колония «%s» отделилась от державы.', nm));
        perform v1_bulletin('Отделение: ' || nm, format('Колония «%s» выходит из состава державы %s.', nm, v1_fname(p_fid)), jsonb_build_array(p_fid));
        delete from colony_projects where colony_id = r.colony_id;
        delete from colonies where id = r.colony_id;
      else
        update v1_colony_order set deadline = now() + interval '1 day' where colony_id = r.colony_id;
        insert into v1_unrest_log(faction_id, colony_id, colony_name, kind, text)
        values (p_fid, r.colony_id, nm, 'would_secede', format('Колония «%s» отделилась бы (режим просмотра: отделение выключено).', nm));
      end if;
    end if;
  end loop;
end $$;

create or replace function public.v1_politics_tick() returns jsonb
language plpgsql security definer set search_path = public as $$
declare f record; n int := 0;
begin
  delete from v1_order_effects where until < now() - interval '1 day';
  delete from v1_order_mods where until < now() - interval '1 day';
  for f in select distinct c.faction_id from colonies c join faction_applications a on a.faction_id = c.faction_id and a.status = 'approved' loop
    begin perform v1_order_refresh(f.faction_id, true); n := n + 1;
    exception when others then raise notice 'politics %: %', f.faction_id, sqlerrm; end;
  end loop;
  return jsonb_build_object('factions', n);
end $$;

-- ── Решения власти ──
create or replace function public.v1_unrest_decide(p_colony uuid, p_choice text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := v1_my_faction(); cfg jsonb := coalesce((select value from v1_settings where key = 'politics'), '{}'::jsonb);
  o v1_colony_order; c colonies; cost numeric := 0; garrison int; sf uuid; msg text;
begin
  if me is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(me, 'politics') then raise exception 'not_allowed'; end if;
  select * into c from colonies where id = p_colony;
  if c.id is null or c.faction_id <> me then raise exception 'colony_foreign'; end if;
  select * into o from v1_colony_order where colony_id = p_colony for update;
  if o.colony_id is null or o.stage = 'calm' then raise exception 'unrest_none'; end if;
  select count(*) into garrison from fleets f where f.faction_id = me and f.system_id = c.system_id and not coalesce(f.is_station, false) and coalesce(f.arrive_at, now()) <= now();
  garrison := garrison + (select count(*) from armies a where a.faction_id = me and a.colony_id = p_colony);
  case p_choice
    when 'concessions' then
      cost := coalesce((cfg->>'concessions_cost')::numeric, 25000) * case when o.stage = 'rebellion' then 2 else 1 end;
      insert into v1_order_effects(colony_id, amount, source, until) values (p_colony, coalesce((cfg->>'concessions_order')::int, 30), 'Уступки', now() + make_interval(days => coalesce((cfg->>'concessions_days')::int, 5)));
      msg := 'Власть пошла на уступки';
    when 'army' then
      if garrison = 0 then raise exception 'unrest_no_garrison'; end if;
      insert into v1_order_effects(colony_id, amount, source, until) values (p_colony, coalesce((cfg->>'army_order')::int, 25), 'Введены войска', now() + make_interval(days => coalesce((cfg->>'army_days')::int, 5)));
      insert into v1_order_effects(colony_id, amount, source, until)
      select id, coalesce((cfg->>'army_neighbors')::int, -5), 'Войска в соседней колонии', now() + make_interval(days => coalesce((cfg->>'army_days')::int, 5))
        from colonies where faction_id = me and system_id = c.system_id and id <> p_colony;
      if o.stage = 'rebellion' then
        insert into v1_order_mods(faction_id, amount, source, until) values (me, coalesce((cfg->>'cruelty_order')::int, -10), 'Жёсткое подавление восстания', now() + make_interval(days => coalesce((cfg->>'cruelty_days')::int, 3)));
      end if;
      msg := 'В колонию введены войска';
    when 'preach' then
      sf := v1_state_faith_id(me);
      if sf is null then raise exception 'unrest_no_faith'; end if;
      cost := coalesce((cfg->>'preach_cost')::numeric, 10000);
      insert into v1_order_effects(colony_id, amount, source, until) values (p_colony, coalesce((cfg->>'preach_order')::int, 20), 'Проповедь государственной веры', now() + make_interval(days => coalesce((cfg->>'preach_days')::int, 7)));
      update v1_colony_order set faith_id = null where colony_id = p_colony;
      msg := 'Проповедники вернули колонию к государственной вере';
    when 'martial' then
      if o.stage = 'rebellion' then raise exception 'unrest_martial_late'; end if;
      insert into v1_order_effects(colony_id, amount, source, until, martial) values (p_colony, coalesce((cfg->>'martial_order')::int, 40), 'Военное положение', now() + make_interval(days => coalesce((cfg->>'martial_days')::int, 3)), true);
      msg := 'Объявлено военное положение — колония не приносит дохода';
    else raise exception 'bad_choice';
  end case;
  if cost > 0 then
    update faction_economy set gc = gc - cost where faction_id = me and gc >= cost;
    if not found then raise exception 'not_enough_gc'; end if;
  end if;
  perform v1_order_refresh(me, false);
  select * into o from v1_colony_order where colony_id = p_colony;
  if o.value >= coalesce((cfg->>'unrest_at')::int, -50) or (p_choice = 'army' and o.stage = 'rebellion') then
    update v1_colony_order set stage = 'calm', stage_since = now(), deadline = null where colony_id = p_colony;
  end if;
  insert into v1_unrest_log(faction_id, colony_id, colony_name, kind, text) values (me, p_colony, c.planet_name, 'decision', format('«%s»: %s.', c.planet_name, msg));
  return jsonb_build_object('ok', true, 'cost', cost, 'order', o.value);
end $$;

-- ── Курс ──
create or replace function public.v1_course_set(p_key text, p_custom jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := v1_my_faction(); eco faction_economy; cfg jsonb := coalesce((select value from v1_settings where key = 'course'), '{}'::jsonb);
  cd int; nxt timestamptz; pts int := 0; used int := 0; ax text; st int; cus jsonb := '{}'::jsonb;
begin
  if me is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(me, 'politics') then raise exception 'not_allowed'; end if;
  if not exists (select 1 from v1_courses where key = p_key) then raise exception 'course_unknown'; end if;
  select * into eco from faction_economy where faction_id = me for update;
  cd := case when coalesce(eco.research, '[]'::jsonb) ? 'pol.econ_council' then coalesce((cfg->>'cd_days_council')::int, 7) else coalesce((cfg->>'cd_days')::int, 10) end;
  nxt := coalesce(eco.econ_policy_at, to_timestamp(0)) + make_interval(days => cd);
  if now() < nxt and (coalesce(eco.econ_policy, 'balanced') <> p_key or p_key <> 'custom') then
    raise exception 'course_cooldown: %', to_char(nxt at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  end if;
  if p_key = 'custom' then
    select coalesce(max(value::int), 0) into pts from jsonb_each_text(coalesce(cfg->'points', '{}'::jsonb)) where coalesce(eco.research, '[]'::jsonb) ? key;
    if pts = 0 then raise exception 'course_council'; end if;
    for ax in select jsonb_object_keys(coalesce(p_custom, '{}'::jsonb)) loop
      if ax not in ('gc','mine','build','research','order','fleet') then raise exception 'course_axis'; end if;
      st := coalesce((p_custom->>ax)::int, 0);
      if st < -2 or st > 2 then raise exception 'course_axis'; end if;
      used := used + st;
      -- ось порядка храним под старым именем «wb», чтобы старый суточный тик понимал курс
      if st <> 0 then cus := cus || jsonb_build_object(case ax when 'order' then 'wb' else ax end, st); end if;
    end loop;
    if used > pts then raise exception 'course_budget: %', pts; end if;
  end if;
  update faction_economy set econ_policy = p_key, econ_policy_at = now(),
         econ_policy_custom = case when p_key = 'custom' then cus else coalesce(econ_policy_custom, '{}'::jsonb) end
   where faction_id = me;
  perform v1_order_refresh(me, false);
  return jsonb_build_object('ok', true, 'next', now() + make_interval(days => cd));
end $$;

-- ── Вера ──
create or replace function public.v1_faith_found(p_name text, p_dogma text, p_color text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := v1_my_faction(); nm text := btrim(coalesce(p_name, '')); id uuid;
begin
  if me is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(me, 'politics') then raise exception 'not_allowed'; end if;
  if length(nm) < 3 or length(nm) > 60 then raise exception 'faith_name'; end if;
  if v1_name_problem(nm, auth.uid()) is not null then raise exception 'name_rejected: %', v1_name_problem(nm, auth.uid()); end if;
  if exists (select 1 from faith_membership where faction_id = me) then raise exception 'faith_has'; end if;
  if exists (select 1 from faiths where lower(name) = lower(nm)) then raise exception 'faith_taken'; end if;
  insert into faiths(name, founder_fid, founder_owner, dogma, color, open, status)
  values (nm, me, (select owner_id from faction_economy where faction_id = me), left(btrim(coalesce(p_dogma, '')), 2000),
          case when p_color ~ '^#[0-9a-fA-F]{6}$' then p_color else '#e9b949' end, true, 'approved') returning faiths.id into id;
  insert into faith_membership(faction_id, faith_id, role, owner_id) values (me, id, 'founder', (select owner_id from faction_economy where faction_id = me));
  delete from v1_state_faith where faction_id = me;
  perform v1_bulletin('Новая вера: ' || nm, format('Держава %s провозглашает веру «%s».', v1_fname(me), nm), jsonb_build_array(me));
  perform v1_order_refresh(me, false);
  return jsonb_build_object('ok', true, 'faith_id', id);
end $$;

create or replace function public.v1_faith_join(p_faith uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := v1_my_faction(); f faiths;
begin
  if me is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(me, 'politics') then raise exception 'not_allowed'; end if;
  select * into f from faiths where id = p_faith;
  if f.id is null or f.status <> 'approved' then raise exception 'faith_unknown'; end if;
  if not coalesce(f.open, true) then raise exception 'faith_closed'; end if;
  if exists (select 1 from faith_membership where faction_id = me) then raise exception 'faith_has'; end if;
  insert into faith_membership(faction_id, faith_id, role, owner_id) values (me, p_faith, 'member', (select owner_id from faction_economy where faction_id = me));
  delete from v1_state_faith where faction_id = me;
  perform v1_rel_add(f.founder_fid, me, 10);
  perform v1_bulletin('Принятие веры', format('Держава %s принимает веру «%s».', v1_fname(me), f.name), jsonb_build_array(me, f.founder_fid));
  perform v1_order_refresh(me, false);
  return jsonb_build_object('ok', true);
end $$;

-- Выйти из веры (основатель не может, пока у веры есть другие последователи)
create or replace function public.v1_faith_leave(p_faith uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := v1_my_faction(); m faith_membership;
begin
  if me is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(me, 'politics') then raise exception 'not_allowed'; end if;
  select * into m from faith_membership where faction_id = me and faith_id = p_faith;
  if m.faith_id is null then raise exception 'faith_unknown'; end if;
  if m.role = 'founder' then
    if exists (select 1 from faith_membership where faith_id = p_faith and faction_id <> me) then raise exception 'faith_founder'; end if;
    delete from faith_membership where faith_id = p_faith;
    update colony_buildings set faith_id = null where faith_id = p_faith;
    delete from faiths where id = p_faith;
  else
    delete from faith_membership where faction_id = me and faith_id = p_faith;
  end if;
  perform v1_order_refresh(me, false);
  return jsonb_build_object('ok', true);
end $$;

-- Светское государство: без веры, +5 % к науке
create or replace function public.v1_faith_secular(p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := v1_my_faction();
begin
  if me is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(me, 'politics') then raise exception 'not_allowed'; end if;
  if coalesce(p_on, false) then
    if exists (select 1 from faith_membership where faction_id = me) then raise exception 'faith_has'; end if;
    insert into v1_state_faith(faction_id, mode, changed_at) values (me, 'secular', now())
    on conflict (faction_id) do update set mode = 'secular', faith_id = null, changed_at = now();
  else
    delete from v1_state_faith where faction_id = me;
  end if;
  perform v1_order_refresh(me, false);
  return jsonb_build_object('ok', true);
end $$;

-- Основатель открывает или закрывает веру и исключает последователей
create or replace function public.v1_faith_manage(p_faith uuid, p_open boolean, p_expel text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := v1_my_faction();
begin
  if me is null or not v1_can_manage(me, 'politics') then raise exception 'not_allowed'; end if;
  if not exists (select 1 from faith_membership where faction_id = me and faith_id = p_faith and role = 'founder') then raise exception 'faith_not_founder'; end if;
  if p_open is not null then update faiths set open = p_open where id = p_faith; end if;
  if p_expel is not null and p_expel <> me then delete from faith_membership where faith_id = p_faith and faction_id = p_expel; end if;
  return jsonb_build_object('ok', true);
end $$;

-- ── Сводка для страницы «Внутренняя политика» ──
create or replace function public.v1_inner_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := v1_my_faction(); eco faction_economy; a faction_applications; cfg jsonb; ccfg jsonb; pts int := 0; cd int; mods jsonb; sf uuid;
begin
  if me is null then raise exception 'no_faction'; end if;
  perform v1_order_refresh(me, false);
  select * into eco from faction_economy where faction_id = me;
  a := v1_app(me);
  cfg := coalesce((select value from v1_settings where key = 'politics'), '{}'::jsonb);
  ccfg := coalesce((select value from v1_settings where key = 'course'), '{}'::jsonb);
  select coalesce(max(value::int), 0) into pts from jsonb_each_text(coalesce(ccfg->'points', '{}'::jsonb)) where coalesce(eco.research, '[]'::jsonb) ? key;
  cd := case when coalesce(eco.research, '[]'::jsonb) ? 'pol.econ_council' then coalesce((ccfg->>'cd_days_council')::int, 7) else coalesce((ccfg->>'cd_days')::int, 10) end;
  mods := v1_faction_mods(me);
  sf := v1_state_faith_id(me);
  return jsonb_build_object(
    'can_manage', v1_can_manage(me, 'politics'),
    'gc', eco.gc,
    'live', coalesce((cfg->>'live')::boolean, false),
    'cfg', cfg,
    'mods', mods,
    'course', jsonb_build_object(
      'key', coalesce(eco.econ_policy, 'balanced'),
      'custom', coalesce(eco.econ_policy_custom, '{}'::jsonb),
      'next', case when eco.econ_policy_at is not null and eco.econ_policy_at + make_interval(days => cd) > now() then eco.econ_policy_at + make_interval(days => cd) end,
      'cd_days', cd, 'points', pts, 'axes', ccfg->'axes',
      'list', (select jsonb_agg(to_jsonb(c) order by c.sort) from v1_courses c),
      'ideo', (select to_jsonb(i) from v1_course_ideo i where i.ideology = case when v1_is_robot(me) then 'robot' else a.ideology end),
      'ideology', a.ideology),
    'faith', jsonb_build_object(
      'secular', exists (select 1 from v1_state_faith where faction_id = me and mode = 'secular'),
      'main', sf,
      'mine', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'dogma', f.dogma, 'color', f.color, 'open', f.open, 'role', m.role,
                 'members', (select jsonb_agg(jsonb_build_object('fid', x.faction_id, 'name', v1_fname(x.faction_id), 'role', x.role)) from faith_membership x where x.faith_id = f.id)))
               from faith_membership m join faiths f on f.id = m.faith_id where m.faction_id = me), '[]'::jsonb),
      'all', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'dogma', left(coalesce(f.dogma, ''), 400), 'color', f.color, 'open', f.open,
                 'founder', v1_fname(f.founder_fid), 'members', (select count(*) from faith_membership x where x.faith_id = f.id)) order by f.name)
               from faiths f where f.status = 'approved'), '[]'::jsonb)),
    'order', jsonb_build_object(
      'avg', (select round(avg(value)) from v1_colony_order where faction_id = me),
      'unrest', (select count(*) from v1_colony_order where faction_id = me and stage = 'unrest'),
      'rebellion', (select count(*) from v1_colony_order where faction_id = me and stage = 'rebellion'),
      'low', (select count(*) from v1_colony_order where faction_id = me and value < 0),
      'high', (select count(*) from v1_colony_order where faction_id = me and value > 50),
      'police', (select coalesce(sum(b.slots_open), 0) from colony_buildings b where b.faction_id = me and b.btype = 'police'),
      'state_mods', coalesce((select jsonb_agg(jsonb_build_object('amount', amount, 'source', source, 'until', until)) from v1_order_mods where faction_id = me and until > now()), '[]'::jsonb),
      'colonies', coalesce((select jsonb_agg(jsonb_build_object('id', o.colony_id, 'name', c.planet_name, 'system', s.name, 'capital', c.is_capital,
           'value', o.value, 'stage', o.stage, 'deadline', o.deadline, 'breakdown', o.breakdown,
           'martial', exists (select 1 from v1_order_effects e where e.colony_id = o.colony_id and e.martial and e.until > now()),
           'garrison', (select count(*) from fleets f where f.faction_id = me and f.system_id = c.system_id and not coalesce(f.is_station, false) and coalesce(f.arrive_at, now()) <= now())
                     + (select count(*) from armies x where x.faction_id = me and x.colony_id = c.id))
         order by (o.stage <> 'calm') desc, o.value, c.planet_name)
        from v1_colony_order o join colonies c on c.id = o.colony_id left join map_systems s on s.id = c.system_id where o.faction_id = me), '[]'::jsonb)),
    'log', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'text', text, 'at', created_at) order by created_at desc)
        from (select * from v1_unrest_log where faction_id = me order by created_at desc limit 30) l), '[]'::jsonb));
end $$;

-- Действия команды проекта: пересчёт порядка для проверки
create or replace function public.v1_x_politics(p_action text, p_target text, p_payload jsonb) returns integer
language plpgsql security definer set search_path = public as $$
begin
  if p_action = 'politics.tick' then perform v1_politics_tick(); return 1; end if;
  raise exception 'unknown_action: %', p_action;
end $$;
insert into public.v1_action_policy(action, label, mode) values ('politics.tick', 'Прогнать суточный тик внутренней политики', 'free')
on conflict (action) do nothing;

revoke all on function public.v1_colony_orders(text), public.v1_order_refresh(text, boolean), public.v1_politics_tick(), public.v1_x_politics(text, text, jsonb),
  public.v1_state_faith_id(text) from public, anon, authenticated;
grant execute on function public.v1_inner_state(), public.v1_unrest_decide(uuid, text), public.v1_course_set(text, jsonb),
  public.v1_faith_found(text, text, text), public.v1_faith_join(uuid), public.v1_faith_leave(uuid), public.v1_faith_secular(boolean),
  public.v1_faith_manage(uuid, boolean, text) to authenticated;

do $$ begin
  perform cron.unschedule('v1-politics-tick') where exists (select 1 from cron.job where jobname = 'v1-politics-tick');
  perform cron.schedule('v1-politics-tick', '20 0 * * *', 'select public.v1_politics_tick()');
exception when others then raise notice 'cron: %', sqlerrm; end $$;
