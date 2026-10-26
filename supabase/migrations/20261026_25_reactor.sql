-- Классическая эра 1.0 · Конструктор реактора (новый, с нуля).
--
-- Реактор собирается из четырёх узлов: принцип, топливо, охлаждение,
-- преобразователь — плюс размер и режим работы. Топливо — марка из
-- конструктора топлива или чистый ресурс. Старшие узлы открываются
-- технологиями ветки «Энергетика».
--
-- Старые реакторы (faction_reactors) не трогаем: это архив. Новые
-- записываются в v1_reactors. Запрет на создание старых — отдельной
-- миграцией в день перехода (20261026_26_reactor_archive.sql).
--
-- Расчёт — одна функция v1_reactor_calc: её же вызывает предпросмотр.

set lock_timeout = '15s';

-- ════════ 1. Технологии ветки «Энергетика» под новые узлы ════════
-- id не меняем: изученное державами остаётся изученным.
update public.v1_tech set name = 'Радиоизотопные установки',
  descr = 'Открывает радиоизотопный реактор: слабый, но почти вечный и очень надёжный.' where id = 'rg.school.ritag';
update public.v1_tech set name = 'Реакторы деления',
  descr = 'Открывает реактор деления на ядерном топливе — основу флота средней руки.' where id = 'rg.school.yaeu';
update public.v1_tech set name = 'Плазменное преобразование',
  descr = 'Открывает плазменный преобразователь: +40 % мощности ценой сильного нагрева.' where id = 'rg.school.mgd';
update public.v1_tech set name = 'Термоядерный синтез',
  descr = 'Открывает термоядерный реактор: большой потолок мощности для тяжёлых кораблей.' where id = 'rg.school.tyar';
update public.v1_tech set name = 'Каталитический синтез',
  descr = 'Открывает каталитический реактор на экзотике и полевое охлаждение.' where id = 'rg.school.amu';
update public.v1_tech set name = 'Гравитационное ядро',
  descr = 'Открывает гравитационный реактор: сжигает любое реакторное топливо с предельной отдачей.' where id = 'rg.school.kvg';
update public.v1_tech set
  descr = 'Открывает реакторы размера XL для линкоров и дредноутов.' where id = 'comp.ship.reactor';

-- ════════ 2. Узлы ════════
create table if not exists public.v1_reactor_parts (
  kind    text not null check (kind in ('type', 'size', 'cool', 'conv')),
  id      text not null,
  name    text not null,
  descr   text not null,
  tech    text,                              -- нужна технология (v1_tech.id) или null
  params  jsonb not null default '{}'::jsonb,
  sort    int not null default 0,
  primary key (kind, id)
);
alter table public.v1_reactor_parts enable row level security;
drop policy if exists v1_reactor_parts_read on public.v1_reactor_parts;
create policy v1_reactor_parts_read on public.v1_reactor_parts for select using (true);
grant select on public.v1_reactor_parts to anon, authenticated;

-- type: power — множитель мощности; mass — массы; rel — базовая надёжность;
--   heat — тепловыделение; sig — заметность; use — расход топлива; cost — цена;
--   fuels — какие семейства топлива принимает; ref — энергия «нормального» топлива;
--   bill — сырьё на постройку (на размер M, масштабируется размером).
-- size: power (в масштабе старых реакторов: термоядерный M ≈ эсминец, L ≈ крейсер, XL ≈ линкор), mass, slots, use (ед. топлива в сутки), cost (ГС), k (масштаб сырья), sig.
-- cool: cap — сколько тепла отводит; mass, sig, rel, cost, self — своё потребление.
-- conv: power, mass, rel, heat, cost.
insert into public.v1_reactor_parts(kind, id, name, descr, tech, params, sort) values
  ('type', 'rtg',      'Радиоизотопный', 'Тепло распада без цепной реакции. Мощности мало, зато работает годами на горсти изотопов и почти не ломается.',
   'rg.school.ritag', '{"power":0.35,"mass":0.8,"rel":92,"heat":0.4,"sig":10,"use":0.1,"cost":0.6,"ref":50,"fuels":["nuclear"],"max_mode":100,"bill":{"Изотопы":2}}', 10),
  ('type', 'fission',  'Деления',        'Управляемая цепная реакция. Честная рабочая лошадка: средняя мощность, понятный риск.',
   'rg.school.yaeu',  '{"power":1.0,"mass":1.0,"rel":80,"heat":0.8,"sig":25,"use":0.6,"cost":1.0,"ref":50,"fuels":["nuclear"],"bill":{"Изотопы":4}}', 20),
  ('type', 'fusion',   'Термоядерный',   'Синтез лёгких ядер в магнитной ловушке. Большой потолок мощности, но тяжёлый и требовательный к охлаждению.',
   'rg.school.tyar',  '{"power":1.8,"mass":1.2,"rel":72,"heat":1.0,"sig":35,"use":0.8,"cost":1.6,"ref":90,"fuels":["fusion"],"bill":{"Гелий-3":4,"Редкоземельные руды":2}}', 30),
  ('type', 'catalytic','Каталитический', 'Синтез, разогнанный звёздным катализатором. Огромная мощность и такой же характер.',
   'rg.school.amu',   '{"power":2.6,"mass":1.1,"rel":55,"heat":1.3,"sig":45,"use":1.2,"cost":2.4,"ref":120,"fuels":["exotic","fusion"],"bill":{"Стелларит":2,"Гелий-3":2}}', 40),
  ('type', 'grav',     'Гравитационный', 'Гравиядро сжимает рабочее тело до предела. Принимает любое реакторное топливо и выжимает из него максимум.',
   'rg.school.kvg',   '{"power":3.2,"mass":1.5,"rel":65,"heat":0.9,"sig":30,"use":0.5,"cost":3.5,"ref":90,"fuels":["nuclear","fusion","exotic"],"bill":{"Гравиядро":1,"Редкоземельные руды":3}}', 50),

  ('size', 'S',  'S — малый',        'Корветы, катера и тяжёлая наземная техника.', null,
   '{"power":4500,"mass":8,"slots":1,"use":1,"cost":2000,"k":0.35,"sig":0.6}', 10),
  ('size', 'M',  'M — средний',      'Фрегаты и эсминцы.', null,
   '{"power":13500,"mass":22,"slots":2,"use":3,"cost":6000,"k":1,"sig":0.8}', 20),
  ('size', 'L',  'L — большой',      'Крейсеры и авианосцы.', null,
   '{"power":36000,"mass":55,"slots":4,"use":7,"cost":15000,"k":2.5,"sig":1.0}', 30),
  ('size', 'XL', 'XL — сверхбольшой', 'Линкоры и дредноуты.', 'comp.ship.reactor',
   '{"power":90000,"mass":130,"slots":7,"use":16,"cost":40000,"k":6,"sig":1.3}', 40),

  ('cool', 'radiator', 'Радиаторы',       'Широкие панели отводят тепло излучением. Просто и надёжно, но корабль светится на сенсорах.', null,
   '{"cap":1.0,"mass":0.10,"sig":12,"rel":0,"cost":1.0,"self":0,"bill":{"Медь":2}}', 10),
  ('cool', 'metal',    'Жидкий металл',   'Расплав металла в замкнутом контуре. Отводит много тепла, но тяжёл и может дать течь.', null,
   '{"cap":1.4,"mass":0.25,"sig":4,"rel":-3,"cost":1.2,"self":0,"bill":{"Медь":3,"Железо":2}}', 20),
  ('cool', 'cryo',     'Криоконтур',      'Холодный контур на сжиженных газах. Корабль почти не виден в тепловом спектре.', null,
   '{"cap":1.2,"mass":0.15,"sig":-12,"rel":2,"cost":1.5,"self":0.03,"bill":{"Аммиачный лёд":3,"Лёд":2}}', 30),
  ('cool', 'field',    'Полевое охлаждение', 'Силовое поле выносит тепло за борт. Лучший отвод, но съедает часть мощности.', 'rg.school.amu',
   '{"cap":1.8,"mass":0.05,"sig":0,"rel":0,"cost":2.2,"self":0.08,"bill":{"Редкоземельные руды":3}}', 40),

  ('conv', 'thermal', 'Тепловой',   'Турбины превращают тепло в ток. Тяжело, зато предсказуемо.', null,
   '{"power":1.0,"mass":0.20,"rel":5,"heat":1.0,"cost":1.0,"bill":{"Титан":2}}', 10),
  ('conv', 'direct',  'Прямой',     'Заряженные частицы снимаются сразу в ток. Легче и меньше греется, но капризнее.', null,
   '{"power":1.15,"mass":-0.10,"rel":-8,"heat":0.8,"cost":1.3,"bill":{"Редкоземельные руды":2}}', 20),
  ('conv', 'plasma',  'Плазменный', 'Плазменный поток в магнитном канале. Самый мощный и самый горячий.', 'rg.school.mgd',
   '{"power":1.4,"mass":0.05,"rel":-5,"heat":1.3,"cost":1.6,"bill":{"Ионит":2,"Медь":1}}', 30)
on conflict (kind, id) do update set name = excluded.name, descr = excluded.descr, tech = excluded.tech,
  params = excluded.params, sort = excluded.sort;

-- ════════ 3. Зарегистрированные реакторы ════════
create table if not exists public.v1_reactors (
  id          uuid primary key default gen_random_uuid(),
  faction_id  text not null,
  owner_id    uuid references auth.users(id) on delete set null,
  name        text not null,
  cfg         jsonb not null,     -- {type, size, cool, conv, mode, fuel:{kind:'fuel'|'res', id|res}}
  stats       jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists v1_reactors_name on public.v1_reactors(faction_id, lower(name));
create index if not exists v1_reactors_fid on public.v1_reactors(faction_id);
create index if not exists v1_reactors_fuel on public.v1_reactors((cfg->'fuel'->>'id'));
alter table public.v1_reactors enable row level security;
revoke all on public.v1_reactors from anon, authenticated;

insert into public.v1_settings(key, value) values
  ('reactor', '{"max_per_faction": 12, "mode_min": 60, "mode_max": 140, "min_reliability": 10}')
on conflict (key) do nothing;

-- ════════ 4. Расчёт ════════
-- Чистый ресурс как реакторное топливо: свойства компонента без правил смеси
-- (перегрев без рабочего тела — это про двигатели, у реактора свой контур).
create or replace function public.v1_fuel_raw(p_res text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('energy', c.e, 'stability', greatest(0, least(100, 50 + c.s)),
         'efficiency', c.eff, 'class', c.grp,
         'registrable', 50 + c.s >= coalesce((select (value->>'min_stability')::numeric from v1_settings where key = 'fuel'), 5))
    from v1_fuel_components c where c.res = p_res;
$$;
grant execute on function public.v1_fuel_raw(text) to authenticated;

-- p_fid нужен, чтобы найти марку топлива державы и проверить технологии;
-- null — без проверки технологий (служебный пересчёт).
create or replace function public.v1_reactor_calc(p_cfg jsonb, p_fid text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  cfg  jsonb := coalesce((select value from v1_settings where key = 'reactor'), '{}'::jsonb);
  ty v1_reactor_parts; sz v1_reactor_parts; co v1_reactor_parts; cv v1_reactor_parts;
  pt jsonb; ps jsonb; pc jsonb; pv jsonb;
  done jsonb := '[]'::jsonb;
  mode numeric := coalesce((p_cfg->>'mode')::numeric, 100);
  m numeric;
  fu jsonb; fstats jsonb; fname text; fcls text;
  fuel_k numeric; pwr numeric; mass numeric; heat numeric; margin numeric; rel numeric;
  sig numeric; use numeric; cost numeric; risk numeric; dens numeric; grade numeric;
  bill jsonb := '{}'::jsonb; k text; v jsonb; scale numeric;
  locked jsonb := '[]'::jsonb; warns jsonb := '[]'::jsonb;
begin
  select * into ty from v1_reactor_parts where kind = 'type' and id = p_cfg->>'type';
  select * into sz from v1_reactor_parts where kind = 'size' and id = p_cfg->>'size';
  select * into co from v1_reactor_parts where kind = 'cool' and id = p_cfg->>'cool';
  select * into cv from v1_reactor_parts where kind = 'conv' and id = p_cfg->>'conv';
  if ty.id is null or sz.id is null or co.id is null or cv.id is null then
    return jsonb_build_object('ok', false, 'error', 'reactor_incomplete');
  end if;
  pt := ty.params; ps := sz.params; pc := co.params; pv := cv.params;

  if mode < coalesce((cfg->>'mode_min')::numeric, 60) or mode > coalesce((cfg->>'mode_max')::numeric, 140)
     or mode > coalesce((pt->>'max_mode')::numeric, 999) then
    return jsonb_build_object('ok', false, 'error', 'reactor_mode', 'max', least(coalesce((cfg->>'mode_max')::numeric, 140), coalesce((pt->>'max_mode')::numeric, 999)));
  end if;
  m := mode / 100;

  -- технологии
  if p_fid is not null then
    select coalesce(research, '[]'::jsonb) into done from faction_economy where faction_id = p_fid;
    done := coalesce(done, '[]'::jsonb);
    if ty.tech is not null and not done ? ty.tech then locked := locked || to_jsonb(ty.name); end if;
    if sz.tech is not null and not done ? sz.tech then locked := locked || to_jsonb(sz.name); end if;
    if co.tech is not null and not done ? co.tech then locked := locked || to_jsonb(co.name); end if;
    if cv.tech is not null and not done ? cv.tech then locked := locked || to_jsonb(cv.name); end if;
  end if;

  -- топливо: марка державы или чистый ресурс
  fu := p_cfg->'fuel';
  if fu->>'kind' = 'fuel' then
    select f.stats, f.name into fstats, fname from v1_fuels f
     where f.id::text = fu->>'id' and (p_fid is null or f.faction_id = p_fid);
    if fstats is null then return jsonb_build_object('ok', false, 'error', 'reactor_fuel_missing'); end if;
  elsif fu->>'kind' = 'res' then
    fstats := v1_fuel_raw(fu->>'res');
    if fstats is null then return jsonb_build_object('ok', false, 'error', 'reactor_fuel_missing'); end if;
    fname := fu->>'res';
  else
    return jsonb_build_object('ok', false, 'error', 'reactor_incomplete');
  end if;
  if not coalesce((fstats->>'registrable')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', 'reactor_fuel_unstable', 'fuel', fname);
  end if;
  fcls := fstats->>'class';
  if not (pt->'fuels') ? fcls then
    return jsonb_build_object('ok', false, 'error', 'reactor_fuel_class', 'fuel', fname, 'class', fcls, 'need', pt->'fuels');
  end if;

  -- мощность: размер × принцип × преобразователь × качество топлива × режим − своё потребление охлаждения
  fuel_k := greatest(0.5, least(1.6, (fstats->>'energy')::numeric / (pt->>'ref')::numeric));
  pwr := (ps->>'power')::numeric * (pt->>'power')::numeric * (pv->>'power')::numeric * fuel_k * m;
  pwr := pwr * (1 - (pc->>'self')::numeric);

  mass := (ps->>'mass')::numeric * (pt->>'mass')::numeric * (1 + (pc->>'mass')::numeric + (pv->>'mass')::numeric);

  -- нагрев: что выделяется против того, что отводится
  heat := (pt->>'heat')::numeric * (pv->>'heat')::numeric * m * m;
  margin := (pc->>'cap')::numeric - heat;

  rel := (pt->>'rel')::numeric + ((fstats->>'stability')::numeric - 50) * 0.3
         + (pc->>'rel')::numeric + (pv->>'rel')::numeric
         - greatest(0, mode - 100) * 0.6 + greatest(0, 100 - mode) * 0.1;
  if margin < 0 then
    rel := rel + margin * 40;
    warns := warns || jsonb_build_array(format('Перегрев: охлаждение не справляется (запас %s). Смените контур, снизьте режим или возьмите другой преобразователь.', round(margin, 2)));
  end if;
  rel := round(greatest(0, least(100, rel)), 1);

  sig := round(greatest(0, least(100, ((pt->>'sig')::numeric + (pc->>'sig')::numeric) * (ps->>'sig')::numeric + greatest(0, mode - 100) * 0.3)), 1);
  use := round((ps->>'use')::numeric * (pt->>'use')::numeric * m / greatest(0.5, (fstats->>'efficiency')::numeric), 2);
  cost := round((ps->>'cost')::numeric * (pt->>'cost')::numeric * ((pc->>'cost')::numeric + (pv->>'cost')::numeric) / 2);
  risk := round(50 * power((100 - rel) / 100, 2), 1);
  dens := pwr / mass;

  -- сырьё на постройку: узлы × масштаб размера
  scale := (ps->>'k')::numeric;
  for k, v in select * from jsonb_each((pt->'bill') ) union all select * from jsonb_each(pc->'bill') union all select * from jsonb_each(pv->'bill') loop
    bill := jsonb_set(bill, array[k], to_jsonb(coalesce((bill->>k)::numeric, 0) + ceil((v #>> '{}')::numeric * scale)));
  end loop;
  bill := jsonb_set(bill, '{Титан}', to_jsonb(coalesce((bill->>'Титан')::numeric, 0) + ceil(4 * scale)));

  -- оценка: удельная мощность × надёжность, с бонусом за запас по теплу
  grade := least(100, round(100 * sqrt(least(1, dens / 1800) * rel / 100) * (0.9 + 0.1 * least(1, greatest(0, margin) / 0.5))));

  if rel < coalesce((cfg->>'min_reliability')::numeric, 10) then
    warns := warns || '["Установка разрушится на первых же испытаниях: зарегистрировать нельзя"]';
  end if;
  if jsonb_array_length(locked) > 0 then
    warns := warns || jsonb_build_array('Не изучены технологии для узлов: ' || (select string_agg(x, ', ') from jsonb_array_elements_text(locked) x));
  end if;

  return jsonb_build_object(
    'ok', true,
    'power', round(pwr), 'mass', round(mass, 1), 'slots', (ps->>'slots')::int,
    'density', round(dens, 1), 'heat', round(heat, 2), 'cooling', (pc->>'cap')::numeric, 'margin', round(margin, 2),
    'reliability', rel, 'risk', risk, 'signature', sig, 'fuel_use', use, 'cost', cost, 'bill', bill,
    'fuel_name', fname, 'fuel_class', fcls, 'fuel_k', round(fuel_k, 2),
    'grade', grade,
    'tier', case when grade >= 80 then 'Шедевр' when grade >= 65 then 'Элитный' when grade >= 45 then 'Боевой'
                 when grade >= 25 then 'Рабочий' else 'Сырой' end,
    'rel_tier', case when rel >= 80 then 'Надёжный' when rel >= 60 then 'Устойчивый'
                     when rel >= 35 then 'Капризный' else 'Аварийный' end,
    'locked', locked, 'warnings', warns,
    'registrable', rel >= coalesce((cfg->>'min_reliability')::numeric, 10) and jsonb_array_length(locked) = 0);
end $$;
revoke execute on function public.v1_reactor_calc(jsonb, text) from public, anon;
grant execute on function public.v1_reactor_calc(jsonb, text) to authenticated;

-- Предпросмотр на сайте: всегда от имени своей державы.
create or replace function public.v1_reactor_preview(p_cfg jsonb) returns jsonb
language sql stable security definer set search_path = public as $$
  select v1_reactor_calc(p_cfg, v1_my_faction());
$$;
grant execute on function public.v1_reactor_preview(jsonb) to authenticated;

-- ════════ 5. Состояние конструктора ════════
create or replace function public.v1_reactor_state() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_fid text := v1_my_faction(); done jsonb;
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  select coalesce(research, '[]'::jsonb) into done from faction_economy where faction_id = v_fid;
  done := coalesce(done, '[]'::jsonb);
  return jsonb_build_object(
    'can_edit', v1_can_manage(v_fid, 'produce'),
    'settings', coalesce((select value from v1_settings where key = 'reactor'), '{}'::jsonb),
    'parts', (select coalesce(jsonb_agg(jsonb_build_object('kind', p.kind, 'id', p.id, 'name', p.name, 'descr', p.descr,
        'params', p.params, 'tech', p.tech, 'tech_name', t.name,
        'open', p.tech is null or done ? p.tech) order by p.kind, p.sort), '[]'::jsonb)
      from v1_reactor_parts p left join v1_tech t on t.id = p.tech),
    'fuels', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'class', stats->>'class',
        'energy', stats->'energy', 'stability', stats->'stability', 'grade', stats->'grade') order by created_at), '[]'::jsonb)
      from v1_fuels where faction_id = v_fid),
    'raw', (select coalesce(jsonb_agg(jsonb_build_object('res', c.res, 'class', x->>'class', 'energy', x->'energy',
        'stability', x->'stability', 'ok', x->'registrable') order by c.sort), '[]'::jsonb)
      from v1_fuel_components c cross join lateral (select v1_fuel_raw(c.res) x) q
      where (x->>'class') in ('nuclear', 'fusion', 'exotic')),
    'reactors', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'cfg', cfg, 'stats', stats,
        'created_at', created_at) order by created_at), '[]'::jsonb)
      from v1_reactors where faction_id = v_fid),
    'archive', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name,
        'carrier', r.stats->>'klassRu', 'power', r.stats->'power', 'mass', r.stats->'mass',
        'fuel', r.stats->>'fuelRu', 'reliability', r.stats->'stab', 'created_at', r.created_at) order by r.created_at), '[]'::jsonb)
      from faction_reactors r where r.faction_id = v_fid));
end $$;
grant execute on function public.v1_reactor_state() to authenticated;

-- ════════ 6. Регистрация, правка, удаление ════════
create or replace function public.v1_reactor_save(p_id uuid, p_name text, p_cfg jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_fid text := v1_my_faction();
  cfg jsonb := coalesce((select value from v1_settings where key = 'reactor'), '{}'::jsonb);
  nm text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  clean jsonb; st jsonb; row_id uuid;
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(v_fid, 'produce') then raise exception 'forbidden'; end if;
  if char_length(nm) < 3 or char_length(nm) > 48 then raise exception 'reactor_name'; end if;
  clean := jsonb_build_object('type', p_cfg->>'type', 'size', p_cfg->>'size', 'cool', p_cfg->>'cool',
    'conv', p_cfg->>'conv', 'mode', round(coalesce((p_cfg->>'mode')::numeric, 100)),
    'fuel', case when p_cfg->'fuel'->>'kind' = 'fuel' then jsonb_build_object('kind', 'fuel', 'id', p_cfg->'fuel'->>'id')
                 else jsonb_build_object('kind', 'res', 'res', p_cfg->'fuel'->>'res') end);
  st := v1_reactor_calc(clean, v_fid);
  if not (st->>'ok')::boolean then raise exception '%', st->>'error'; end if;
  if jsonb_array_length(st->'locked') > 0 then raise exception 'reactor_locked'; end if;
  if not (st->>'registrable')::boolean then raise exception 'reactor_unreliable'; end if;
  if exists (select 1 from v1_reactors where faction_id = v_fid and lower(name) = lower(nm) and id is distinct from p_id) then
    raise exception 'reactor_name_taken';
  end if;
  if p_id is null then
    if (select count(*) from v1_reactors where faction_id = v_fid) >= coalesce((cfg->>'max_per_faction')::int, 12) then
      raise exception 'reactor_limit';
    end if;
    insert into v1_reactors(faction_id, owner_id, name, cfg, stats) values (v_fid, auth.uid(), nm, clean, st) returning id into row_id;
  else
    update v1_reactors set name = nm, cfg = clean, stats = st, updated_at = now()
     where id = p_id and faction_id = v_fid returning id into row_id;
    if row_id is null then raise exception 'reactor_not_found'; end if;
  end if;
  return jsonb_build_object('id', row_id, 'stats', st);
end $$;
revoke execute on function public.v1_reactor_save(uuid, text, jsonb) from public, anon;
grant execute on function public.v1_reactor_save(uuid, text, jsonb) to authenticated;

create or replace function public.v1_reactor_delete(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction();
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(v_fid, 'produce') then raise exception 'forbidden'; end if;
  delete from v1_reactors where id = p_id and faction_id = v_fid;
  if not found then raise exception 'reactor_not_found'; end if;
  return true;
end $$;
revoke execute on function public.v1_reactor_delete(uuid) from public, anon;
grant execute on function public.v1_reactor_delete(uuid) to authenticated;

-- ════════ 7. Связь с маркой топлива ════════
-- Правка марки пересчитывает реакторы на ней; удалить марку, на которой
-- стоят реакторы, нельзя.
create or replace function public.v1_fuel_after_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; st jsonb;
begin
  for r in select id, cfg from v1_reactors where faction_id = new.faction_id and cfg->'fuel'->>'id' = new.id::text loop
    st := v1_reactor_calc(r.cfg, null);
    if (st->>'ok')::boolean then update v1_reactors set stats = st, updated_at = now() where id = r.id;
    else update v1_reactors set stats = stats || jsonb_build_object('broken', st->>'error') where id = r.id; end if;
  end loop;
  return new;
end $$;
drop trigger if exists v1_fuel_after_change on public.v1_fuels;
create trigger v1_fuel_after_change after update of recipe, stats on public.v1_fuels
  for each row execute function public.v1_fuel_after_change();

create or replace function public.v1_fuel_delete(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction(); n int;
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(v_fid, 'produce') then raise exception 'forbidden'; end if;
  select count(*) into n from v1_reactors where faction_id = v_fid and cfg->'fuel'->>'id' = p_id::text;
  if n > 0 then raise exception 'fuel_in_use: %', n; end if;
  delete from v1_fuels where id = p_id and faction_id = v_fid;
  if not found then raise exception 'fuel_not_found'; end if;
  return true;
end $$;
