-- Классическая эра 1.0 · Конструктор орудий (новый, с нуля).
--
-- Орудие = принцип + размер + компоновка стволов + профиль огня + материал
-- ствола (стандартный или свой сплав) + режим. Урон, энергия и дальность —
-- в масштабе старых орудий, чтобы корабли не потеряли огневую мощь.
--
-- Общедоступные орудия старого каталога остаются как есть.
-- Старые орудия держав (faction_turrets) — архив, как реакторы и сплавы.

set lock_timeout = '15s';

-- ════════ 1. Узлы ════════
create table if not exists public.v1_weapon_parts (
  kind    text not null check (kind in ('type', 'size', 'mount', 'profile')),
  id      text not null,
  name    text not null,
  descr   text not null,
  tech    text,
  params  jsonb not null default '{}'::jsonb,
  sort    int not null default 0,
  primary key (kind, id)
);
alter table public.v1_weapon_parts enable row level security;
drop policy if exists v1_weapon_parts_read on public.v1_weapon_parts;
create policy v1_weapon_parts_read on public.v1_weapon_parts for select using (true);
grant select on public.v1_weapon_parts to anon, authenticated;

-- type: dmg — множитель урона; en — энергия на единицу урона; rng — дальность;
--   acc — точность; pen — пробитие брони; rel — надёжность; heat — нагрев;
--   rate — выстрелов за ход; mass — множитель массы; cost; kind — тип урона для боя;
--   bill — сырьё на размер M.
-- size: dmg — базовый урон выстрела; mass (т); slots; rng (+дальность); cost (ГС); k — масштаб сырья.
-- mount: barrels, dmg, mass, en, acc.
-- profile: dmg, rate, rng, acc, pen, en.
insert into public.v1_weapon_parts(kind, id, name, descr, tech, params, sort) values
  ('type', 'kinetic', 'Снарядное',   'Пороховое или электрохимическое орудие. Просто, надёжно, почти не ест энергию.', null,
   '{"dmg":1.0,"en":0.2,"rng":4,"acc":75,"pen":0.10,"rel":92,"heat":0.6,"rate":1,"mass":1.0,"cost":1.0,"kind":"kinetic","bill":{"Железо":6,"Медь":2}}', 10),
  ('type', 'rail',    'Рельсовое',   'Ускоритель масс разгоняет болванку магнитным полем. Бьёт далеко и пробивает броню, но жадно тянет энергию.', 'comp.ship.reactor',
   '{"dmg":1.25,"en":0.6,"rng":8,"acc":80,"pen":0.30,"rel":82,"heat":0.9,"rate":1,"mass":1.2,"cost":1.6,"kind":"kinetic","bill":{"Титан":4,"Медь":4,"Редкоземельные руды":2}}', 20),
  ('type', 'laser',   'Лазерное',    'Луч бьёт мгновенно и без боезапаса. Точнее всего, слабее против толстой брони.', 'wpn.ship.ЭНЕРГЕТИЧЕСКОЕ ВООРУЖЕНИЕ',
   '{"dmg":0.9,"en":1.0,"rng":6,"acc":92,"pen":0.05,"rel":85,"heat":1.1,"rate":1,"mass":0.8,"cost":1.5,"kind":"energy","bill":{"Силикаты":3,"Редкоземельные руды":3,"Гелий-3":1}}', 30),
  ('type', 'plasma',  'Плазменное',  'Сгусток плазмы прожигает броню насквозь. Огромный урон вблизи и сильный нагрев.', 'rg.school.mgd',
   '{"dmg":1.6,"en":1.2,"rng":3,"acc":70,"pen":0.35,"rel":72,"heat":1.5,"rate":1,"mass":1.1,"cost":2.0,"kind":"energy","bill":{"Ионит":3,"Медь":3,"Дейтерий":2}}', 40),
  ('type', 'missile', 'Ракетное',    'Пусковая установка: самая большая дальность, урон по площади, почти без энергии. Ракеты можно сбить.', 'wpn.ship.ВЗРЫВНОЕ ВООРУЖЕНИЕ',
   '{"dmg":1.1,"en":0.1,"rng":22,"acc":65,"pen":0.15,"rel":88,"heat":0.4,"rate":1,"mass":1.0,"cost":1.4,"kind":"missile","bill":{"Железо":3,"Изотопы":2,"Метан":2}}', 50),
  ('type', 'repair',  'Ремонтный рой', 'Рой дронов чинит свои корабли вместо стрельбы. Урона нет, есть восстановление прочности.', 'wpn.ship.АВИАГРУППЫ И ДРОНЫ',
   '{"dmg":0.5,"en":0.5,"rng":8,"acc":100,"pen":0,"rel":90,"heat":0.3,"rate":1,"mass":0.7,"cost":1.8,"kind":"repair","bill":{"Редкоземельные руды":3,"Титан":2}}', 60),

  ('size', 'S',  'S — лёгкое',      'Корветы, катера, точечная оборона.', null,
   '{"dmg":600,"mass":3,"slots":1,"rng":0,"cost":3000,"k":0.35}', 10),
  ('size', 'M',  'M — среднее',     'Фрегаты и эсминцы.', null,
   '{"dmg":2500,"mass":10,"slots":2,"rng":1,"cost":9000,"k":1}', 20),
  ('size', 'L',  'L — тяжёлое',     'Крейсеры: средний и главный калибр.', null,
   '{"dmg":9000,"mass":30,"slots":3,"rng":2,"cost":25000,"k":2.5}', 30),
  ('size', 'XL', 'XL — главный калибр', 'Линкоры и дредноуты.', 'cls.ship.battleship',
   '{"dmg":22000,"mass":80,"slots":5,"rng":3,"cost":70000,"k":6}', 40),

  ('mount', 'single', 'Одиночное',     'Один ствол: легко и экономно.', null,
   '{"barrels":1,"dmg":1.0,"mass":1.0,"en":1.0,"acc":0}', 10),
  ('mount', 'twin',   'Спаренное',     'Два ствола в одной башне.', null,
   '{"barrels":2,"dmg":1.85,"mass":1.7,"en":1.9,"acc":-2}', 20),
  ('mount', 'quad',   'Счетверённое',  'Четыре ствола: море огня, но тяжело и прожорливо.', null,
   '{"barrels":4,"dmg":3.4,"mass":3.0,"en":3.6,"acc":-5}', 30),

  ('profile', 'balanced', 'Сбалансированный', 'Без перекосов.', null,
   '{"dmg":1.0,"rate":1.0,"rng":1.0,"acc":0,"pen":0,"en":1.0}', 10),
  ('profile', 'precise',  'Точный',           'Длинный ствол и хорошая оптика: дальше и точнее, но слабее.', null,
   '{"dmg":0.9,"rate":1.0,"rng":1.3,"acc":15,"pen":0,"en":1.0}', 20),
  ('profile', 'burst',    'Шквальный',        'Высокий темп: больше выстрелов, каждый слабее, разброс шире.', null,
   '{"dmg":0.75,"rate":1.5,"rng":1.0,"acc":-10,"pen":0,"en":1.2}', 30),
  ('profile', 'ap',       'Бронебойный',      'Снаряд или луч сфокусирован на пробитие брони. Реже стреляет.', null,
   '{"dmg":0.95,"rate":0.8,"rng":1.0,"acc":0,"pen":0.15,"en":1.1}', 40)
on conflict (kind, id) do update set name = excluded.name, descr = excluded.descr, tech = excluded.tech,
  params = excluded.params, sort = excluded.sort;

-- ════════ 2. Зарегистрированные орудия ════════
create table if not exists public.v1_weapons (
  id          uuid primary key default gen_random_uuid(),
  faction_id  text not null,
  owner_id    uuid references auth.users(id) on delete set null,
  name        text not null,
  cfg         jsonb not null,    -- {type, size, mount, profile, mode, alloy: uuid|null}
  stats       jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists v1_weapons_name on public.v1_weapons(faction_id, lower(name));
create index if not exists v1_weapons_fid on public.v1_weapons(faction_id);
alter table public.v1_weapons enable row level security;
revoke all on public.v1_weapons from anon, authenticated;

insert into public.v1_settings(key, value) values
  ('weapon', '{"max_per_faction": 16, "mode_min": 60, "mode_max": 140, "min_reliability": 10}')
on conflict (key) do nothing;

-- ════════ 3. Расчёт ════════
create or replace function public.v1_weapon_calc(p_cfg jsonb, p_fid text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  cfg jsonb := coalesce((select value from v1_settings where key = 'weapon'), '{}'::jsonb);
  ty v1_weapon_parts; sz v1_weapon_parts; mo v1_weapon_parts; pf v1_weapon_parts;
  pt jsonb; ps jsonb; pm jsonb; pp jsonb;
  v_done jsonb := '[]'::jsonb; locked jsonb := '[]'::jsonb; warns jsonb := '[]'::jsonb;
  md numeric := coalesce((p_cfg->>'mode')::numeric, 100); m numeric;
  al jsonb; al_name text := 'Стандартная сталь';
  al_heat numeric := 1500; al_mass numeric := 1; al_kin numeric := 0.45;
  shot numeric; rate numeric; dmg numeric; en numeric; rng numeric; acc numeric; pen numeric; rel numeric;
  mass numeric; cost numeric; useful numeric; burden numeric; grade numeric;
  bill jsonb := '{}'::jsonb; k text; v jsonb; scale numeric;
begin
  select * into ty from v1_weapon_parts where kind = 'type' and id = p_cfg->>'type';
  select * into sz from v1_weapon_parts where kind = 'size' and id = p_cfg->>'size';
  select * into mo from v1_weapon_parts where kind = 'mount' and id = coalesce(p_cfg->>'mount', 'single');
  select * into pf from v1_weapon_parts where kind = 'profile' and id = coalesce(p_cfg->>'profile', 'balanced');
  if ty.id is null or sz.id is null or mo.id is null or pf.id is null then
    return jsonb_build_object('ok', false, 'error', 'weapon_incomplete');
  end if;
  pt := ty.params; ps := sz.params; pm := mo.params; pp := pf.params;
  if md < coalesce((cfg->>'mode_min')::numeric, 60) or md > coalesce((cfg->>'mode_max')::numeric, 140) then
    return jsonb_build_object('ok', false, 'error', 'weapon_mode');
  end if;
  m := md / 100;

  if p_fid is not null then
    select coalesce(research, '[]'::jsonb) into v_done from faction_economy where faction_id = p_fid;
    v_done := coalesce(v_done, '[]'::jsonb);
    if ty.tech is not null and not v_done ? ty.tech then locked := locked || to_jsonb(ty.name); end if;
    if sz.tech is not null and not v_done ? sz.tech then locked := locked || to_jsonb(sz.name); end if;
  end if;

  -- материал ствола: свой сплав державы или стандартная сталь
  if nullif(p_cfg->>'alloy', '') is not null then
    select a.stats, a.name into al, al_name from v1_alloys a
     where a.id::text = p_cfg->>'alloy' and (p_fid is null or a.faction_id = p_fid);
    if al is null then return jsonb_build_object('ok', false, 'error', 'weapon_alloy_missing'); end if;
    al_heat := coalesce((al->>'heat')::numeric, 1500);
    al_mass := coalesce((al->>'mass_factor')::numeric, 1);
    al_kin := coalesce((al->'resist'->>'kinetic')::numeric, 0.45);
  end if;

  shot := (ps->>'dmg')::numeric * (pt->>'dmg')::numeric * (pp->>'dmg')::numeric * m;
  rate := (pt->>'rate')::numeric * (pp->>'rate')::numeric;
  dmg := shot * (pm->>'dmg')::numeric * rate;                          -- урон за ход
  en := shot * (pt->>'en')::numeric * (pm->>'en')::numeric * (pp->>'en')::numeric * m * rate;
  rng := ((pt->>'rng')::numeric + (ps->>'rng')::numeric) * (pp->>'rng')::numeric;
  acc := greatest(5, least(99, (pt->>'acc')::numeric + (pm->>'acc')::numeric + (pp->>'acc')::numeric - greatest(0, md - 100) * 0.15));
  pen := least(0.8, (pt->>'pen')::numeric + (pp->>'pen')::numeric
              + case when pt->>'kind' = 'kinetic' then (al_kin - 0.45) * 0.3 else 0 end);
  rel := (pt->>'rel')::numeric + least(8, greatest(-8, (al_heat - 1500) / 200)) * (pt->>'heat')::numeric
         - greatest(0, md - 100) * 0.5 * (pt->>'heat')::numeric + greatest(0, 100 - md) * 0.1
         - case when mo.id = 'quad' then 4 when mo.id = 'twin' then 1.5 else 0 end;
  rel := round(greatest(0, least(100, rel)), 1);
  mass := (ps->>'mass')::numeric * (pt->>'mass')::numeric * (pm->>'mass')::numeric * (0.6 + 0.4 * al_mass);
  cost := (ps->>'cost')::numeric * (pt->>'cost')::numeric * (pm->>'mass')::numeric * case when al is null then 1 else 1.15 end;

  -- сырьё
  scale := (ps->>'k')::numeric * (pm->>'mass')::numeric;
  for k, v in select * from jsonb_each(pt->'bill') loop
    bill := jsonb_set(bill, array[k], to_jsonb(ceil((v #>> '{}')::numeric * scale)));
  end loop;

  -- оценка: польза (урон с учётом точности, пробития, дальности) против цены (масса и энергия)
  useful := dmg * acc / 100 * (1 + pen) * (1 + least(rng, 30) / 40);
  burden := (ps->>'dmg')::numeric * 1.8 * (1 + en / ((ps->>'dmg')::numeric * 1.5)) * (mass / (ps->>'mass')::numeric) ^ 0.8;
  grade := least(100, round(100 * sqrt(least(1, useful / burden) * rel / 100)));

  if rel < coalesce((cfg->>'min_reliability')::numeric, 10) then
    warns := warns || '["Ствол не выдержит первых стрельб: зарегистрировать нельзя"]';
  end if;
  if md > 120 then warns := warns || '["Форсированный режим: орудие перегревается и чаще отказывает"]'; end if;
  if jsonb_array_length(locked) > 0 then
    warns := warns || jsonb_build_array('Не изучены технологии для узлов: ' || (select string_agg(x, ', ') from jsonb_array_elements_text(locked) x));
  end if;

  return jsonb_build_object(
    'ok', true, 'kind', pt->>'kind',
    'damage', case when pt->>'kind' = 'repair' then 0 else round(dmg) end,
    'heal', case when pt->>'kind' = 'repair' then round(dmg) else 0 end,
    'shot', round(shot), 'rate', round(rate, 2), 'barrels', (pm->>'barrels')::int,
    'energy', round(en), 'dalnost', round(rng, 1), 'accuracy', round(acc), 'penetration', round(pen, 3),
    'reliability', rel, 'mass', round(mass, 1), 'slots', (ps->>'slots')::int, 'gs', round(cost), 'cost', round(cost),
    'bill', bill, 'alloy_name', al_name, 'grade', grade,
    'tier', case when grade >= 80 then 'Шедевр' when grade >= 65 then 'Элитное' when grade >= 45 then 'Боевое'
                 when grade >= 25 then 'Рабочее' else 'Сырое' end,
    'locked', locked, 'warnings', warns,
    'registrable', rel >= coalesce((cfg->>'min_reliability')::numeric, 10) and jsonb_array_length(locked) = 0);
end $$;
revoke execute on function public.v1_weapon_calc(jsonb, text) from public, anon;
grant execute on function public.v1_weapon_calc(jsonb, text) to authenticated;

create or replace function public.v1_weapon_preview(p_cfg jsonb) returns jsonb
language sql stable security definer set search_path = public as $$
  select v1_weapon_calc(p_cfg, v1_my_faction());
$$;
grant execute on function public.v1_weapon_preview(jsonb) to authenticated;

-- ════════ 4. Состояние ════════
create or replace function public.v1_weapon_state() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_fid text := v1_my_faction(); v_done jsonb;
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  select coalesce(research, '[]'::jsonb) into v_done from faction_economy where faction_id = v_fid;
  v_done := coalesce(v_done, '[]'::jsonb);
  return jsonb_build_object(
    'can_edit', v1_can_manage(v_fid, 'produce'),
    'settings', coalesce((select value from v1_settings where key = 'weapon'), '{}'::jsonb),
    'parts', (select coalesce(jsonb_agg(jsonb_build_object('kind', p.kind, 'id', p.id, 'name', p.name, 'descr', p.descr,
        'params', p.params, 'tech', p.tech, 'tech_name', t.name, 'open', p.tech is null or v_done ? p.tech) order by p.kind, p.sort), '[]'::jsonb)
      from v1_weapon_parts p left join v1_tech t on t.id = p.tech),
    'alloys', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'grade', stats->'grade',
        'heat', stats->'heat', 'mass_factor', stats->'mass_factor') order by created_at), '[]'::jsonb)
      from v1_alloys where faction_id = v_fid),
    'weapons', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'cfg', cfg, 'stats', stats,
        'created_at', created_at) order by created_at), '[]'::jsonb)
      from v1_weapons where faction_id = v_fid),
    'archive', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'klass', t.stats->>'klassRu',
        'kind', t.stats->>'kind', 'damage', t.stats->'damage', 'energy', t.stats->'energy', 'dalnost', t.stats->'dalnost') order by t.created_at), '[]'::jsonb)
      from faction_turrets t where t.faction_id = v_fid));
end $$;
grant execute on function public.v1_weapon_state() to authenticated;

-- ════════ 5. Регистрация, правка, удаление ════════
create or replace function public.v1_weapon_save(p_id uuid, p_name text, p_cfg jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_fid text := v1_my_faction();
  cfg jsonb := coalesce((select value from v1_settings where key = 'weapon'), '{}'::jsonb);
  nm text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  clean jsonb; st jsonb; row_id uuid;
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(v_fid, 'produce') then raise exception 'forbidden'; end if;
  if char_length(nm) < 3 or char_length(nm) > 48 then raise exception 'weapon_name'; end if;
  clean := jsonb_build_object('type', p_cfg->>'type', 'size', p_cfg->>'size',
    'mount', coalesce(p_cfg->>'mount', 'single'), 'profile', coalesce(p_cfg->>'profile', 'balanced'),
    'mode', round(coalesce((p_cfg->>'mode')::numeric, 100)), 'alloy', nullif(p_cfg->>'alloy', ''));
  st := v1_weapon_calc(clean, v_fid);
  if not (st->>'ok')::boolean then raise exception '%', st->>'error'; end if;
  if jsonb_array_length(st->'locked') > 0 then raise exception 'weapon_locked'; end if;
  if not (st->>'registrable')::boolean then raise exception 'weapon_unreliable'; end if;
  if exists (select 1 from v1_weapons where faction_id = v_fid and lower(name) = lower(nm) and id is distinct from p_id) then
    raise exception 'weapon_name_taken';
  end if;
  if p_id is null then
    if (select count(*) from v1_weapons where faction_id = v_fid) >= coalesce((cfg->>'max_per_faction')::int, 16) then
      raise exception 'weapon_limit';
    end if;
    insert into v1_weapons(faction_id, owner_id, name, cfg, stats) values (v_fid, auth.uid(), nm, clean, st) returning id into row_id;
  else
    update v1_weapons set name = nm, cfg = clean, stats = st, updated_at = now()
     where id = p_id and faction_id = v_fid returning id into row_id;
    if row_id is null then raise exception 'weapon_not_found'; end if;
  end if;
  return jsonb_build_object('id', row_id, 'stats', st);
end $$;
revoke execute on function public.v1_weapon_save(uuid, text, jsonb) from public, anon;
grant execute on function public.v1_weapon_save(uuid, text, jsonb) to authenticated;

create or replace function public.v1_weapon_delete(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction();
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(v_fid, 'produce') then raise exception 'forbidden'; end if;
  delete from v1_weapons where id = p_id and faction_id = v_fid;
  if not found then raise exception 'weapon_not_found'; end if;
  return true;
end $$;
revoke execute on function public.v1_weapon_delete(uuid) from public, anon;
grant execute on function public.v1_weapon_delete(uuid) to authenticated;

-- ════════ 6. Связь со сплавом ════════
-- Правка сплава пересчитывает орудия со стволом из него; удалить сплав,
-- из которого сделаны орудия, нельзя.
create or replace function public.v1_alloy_after_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; st jsonb;
begin
  for r in select id, cfg from v1_weapons where faction_id = new.faction_id and cfg->>'alloy' = new.id::text loop
    st := v1_weapon_calc(r.cfg, null);
    if (st->>'ok')::boolean then update v1_weapons set stats = st, updated_at = now() where id = r.id; end if;
  end loop;
  return new;
end $$;
drop trigger if exists v1_alloy_after_change on public.v1_alloys;
create trigger v1_alloy_after_change after update of recipe, process, stats on public.v1_alloys
  for each row execute function public.v1_alloy_after_change();

create or replace function public.v1_alloy_delete(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction(); n int;
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(v_fid, 'produce') then raise exception 'forbidden'; end if;
  select count(*) into n from v1_weapons where faction_id = v_fid and cfg->>'alloy' = p_id::text;
  if n > 0 then raise exception 'alloy_in_use: %', n; end if;
  delete from v1_alloys where id = p_id and faction_id = v_fid;
  if not found then raise exception 'alloy_not_found'; end if;
  return true;
end $$;
