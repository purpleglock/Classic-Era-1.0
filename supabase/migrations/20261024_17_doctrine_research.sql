-- ═══════════════════════════════════════════════════════════════
-- 17. Доктрина державы и исследования на новом коде.
--   v1_doctrine        — модификаторы правления, режима, идеологии, расы, типа цивилизации, столицы
--                        и изученных технологий (данными, меняются в админ-панели);
--   v1_courses         — курсы державы с новыми названиями (ключи прежние: balanced/civil/war/ideo/custom);
--   v1_course_ideo     — «Великий путь» для каждой идеологии;
--   v1_faction_mods()  — итоговые множители державы;
--   v1_tech            — названия, ветки и описания технологий (цены и связи — в tech_nodes);
--   v1_research_*      — изучение, очередь, слоты.
-- Формат research / research_slots / research_queue прежний — старый суточный тик их тоже понимает.
-- ═══════════════════════════════════════════════════════════════

-- ── Доктрина ──
create table if not exists public.v1_doctrine (
  kind  text not null check (kind in ('gov','regime','ideology','race','civ_type','capital_env','tech','combo')),
  value text not null,
  mods  jsonb not null default '{}'::jsonb,   -- gc mine build research colonize claim_cost claim_cd (доли), sci_flat agents_flat (штуки)
  primary key (kind, value)
);
alter table public.v1_doctrine enable row level security;
drop policy if exists v1_doctrine_read on public.v1_doctrine;
create policy v1_doctrine_read on public.v1_doctrine for select using (true);

insert into public.v1_doctrine(kind, value, mods) values
  ('gov','Республика','{"gc":0.05,"sci_flat":1,"agents_flat":-1}'),
  ('gov','Монархия','{"gc":0.15,"research":0.10,"claim_cd":0.10}'),
  ('gov','Империя','{"claim_cost":-0.20,"claim_cd":-0.15,"gc":-0.15,"agents_flat":1}'),
  ('gov','Олигархия','{"gc":0.20,"sci_flat":-1,"agents_flat":-1}'),
  ('gov','Диктатура','{"claim_cd":-0.20,"agents_flat":1,"gc":-0.10,"sci_flat":-1}'),
  ('gov','Теократия','{"gc":0.10,"research":0.10,"agents_flat":1,"sci_flat":-1}'),
  ('gov','Технократия','{"gc":-0.20,"research":-0.15,"build":0.05,"sci_flat":2}'),
  ('gov','Корпоратократия','{"gc":0.10,"mine":0.10,"agents_flat":-1}'),
  ('gov','Коллективный разум','{"mine":0.20,"claim_cost":0.15,"gc":-0.10,"sci_flat":1}'),
  ('gov','Машинный разум (ИИ)','{"gc":-0.15,"build":-0.10,"research":-0.10,"sci_flat":1,"agents_flat":1}'),
  ('regime','Демократический','{"gc":0.15,"agents_flat":-1}'),
  ('regime','Эгалитарный','{"gc":0.10,"claim_cost":0.10,"sci_flat":1}'),
  ('regime','Меритократический','{"gc":-0.10,"research":-0.15,"sci_flat":2}'),
  ('regime','Плутократический','{"gc":0.20,"sci_flat":-1,"agents_flat":-1}'),
  ('regime','Олигархический','{"gc":0.15,"mine":-0.10}'),
  ('regime','Авторитарный','{"mine":0.10,"agents_flat":1,"gc":-0.10}'),
  ('regime','Тоталитарный','{"mine":0.20,"gc":-0.15,"agents_flat":1}'),
  ('regime','Деспотичный','{"claim_cd":-0.20,"agents_flat":1,"sci_flat":-1}'),
  ('regime','Деспотизм','{"mine":0.15,"gc":0.10,"research":0.15,"sci_flat":-1,"agents_flat":1}'),
  ('regime','Анархический','{"colonize":-0.20,"build":0.15,"gc":-0.15,"sci_flat":1}'),
  ('ideology','Технократия (Культ науки)','{"gc":-0.15,"research":-0.20,"sci_flat":2}'),
  ('ideology','Милитаризм (Культ силы)','{"claim_cost":-0.20,"gc":-0.10,"research":0.10,"agents_flat":1}'),
  ('ideology','Пацифизм','{"gc":0.25,"claim_cd":0.15,"agents_flat":-1}'),
  ('ideology','Экспансионизм','{"colonize":-0.25,"claim_cost":-0.20,"gc":-0.10}'),
  ('ideology','Изоляционизм','{"gc":0.15,"claim_cost":0.20,"claim_cd":0.20,"agents_flat":1}'),
  ('ideology','Ксенофилия','{"gc":0.20,"colonize":-0.10,"agents_flat":-1}'),
  ('ideology','Ксенофобия','{"mine":0.15,"gc":-0.10,"agents_flat":1}'),
  ('ideology','Спиритуализм','{"gc":0.10,"research":0.10,"sci_flat":-1,"agents_flat":1}'),
  ('ideology','Трансгуманизм','{"gc":-0.10,"research":-0.20,"sci_flat":2}'),
  ('ideology','Экоцентризм','{"mine":0.25,"gc":-0.15,"build":0.05}'),
  ('ideology','Индустриализм','{"build":-0.15,"mine":0.10,"gc":0.05,"research":0.10}'),
  ('race','Гуманоиды','{"gc":0.05,"sci_flat":1}'),
  ('race','Млекопитающие','{"gc":0.15}'),
  ('race','Рептилоиды','{"gc":-0.10,"agents_flat":1}'),
  ('race','Авианы (Птицеподобные)','{"claim_cd":-0.20,"gc":-0.05,"agents_flat":1}'),
  ('race','Инсектоиды','{"mine":0.15,"gc":0.05,"research":0.10,"sci_flat":-1}'),
  ('race','Акватики (Водные)','{"gc":0.15,"colonize":0.15}'),
  ('race','Плантоиды (Растениевидные)','{"mine":0.15,"gc":0.05,"agents_flat":-1}'),
  ('race','Литоиды (Каменные)','{"mine":0.20,"gc":-0.15}'),
  ('race','Синтетики / Киборги','{"gc":-0.15,"mine":0.10,"research":-0.15,"sci_flat":2}'),
  ('race','Энергетические сущности','{"gc":-0.15,"research":-0.10,"sci_flat":1,"agents_flat":1}'),
  ('combo','Синтетики / Киборги|Машинный разум (ИИ)','{"gc":0.15}'),
  ('civ_type','frontier','{"colonize":-0.20,"claim_cd":-0.20,"gc":-0.15}'),
  ('civ_type','colony','{"gc":0.15,"mine":0.10,"claim_cost":0.15,"build":-0.10}'),
  ('capital_env','terrestrial','{"gc":0.05}'),
  ('capital_env','oceanic','{"colonize":-0.10}'),
  ('capital_env','desert','{"mine":0.10}'),
  ('capital_env','volcanic','{"mine":0.10}'),
  ('capital_env','lava','{"mine":0.12}'),
  ('capital_env','cryo','{"research":-0.08}'),
  ('capital_env','micro','{"claim_cd":-0.12}'),
  ('capital_env','exotic','{"sci_flat":1}'),
  ('tech','pol.new_deal','{"gc":0.10}'),
  ('tech','pol.mercantile','{"gc":0.10,"build":-0.05}'),
  ('tech','pol.five_year','{"build":-0.15}'),
  ('tech','pol.goelro','{"mine":0.15}'),
  ('tech','pol.land_reform','{"colonize":-0.15}'),
  ('tech','pol.total_mob','{"claim_cost":-0.20}')
on conflict (kind, value) do nothing;

-- ── Курсы ──
create table if not exists public.v1_courses (
  key   text primary key,
  name  text not null,
  descr text not null,
  mods  jsonb not null default '{}'::jsonb,   -- плюс order (порядок, пункты) и fleet (множитель вместимости флота)
  sort  int not null default 0
);
alter table public.v1_courses enable row level security;
drop policy if exists v1_courses_read on public.v1_courses;
create policy v1_courses_read on public.v1_courses for select using (true);
insert into public.v1_courses(key, name, descr, mods, sort) values
  ('balanced', 'Равновесие', 'Государство не вмешивается сверх меры: ни бонусов, ни штрафов.', '{}', 1),
  ('civil', 'Процветание', 'Ставка на уровень жизни и деловую активность. Люди спокойнее и охотнее платят, рудники недополучают денег.', '{"gc":0.15,"order":5,"build":0.05,"mine":-0.15}', 2),
  ('war', 'Мобилизация', 'Сырьё и флот прежде всего. Добыча растёт, флот держится сверх вместимости баз, а казна и порядок проседают.', '{"mine":0.15,"fleet":0.25,"gc":-0.12,"order":-6}', 3),
  ('ideo', 'Великий путь', 'Свой путь у каждой идеологии.', '{}', 4),
  ('custom', 'Своя доктрина', 'Очки распределяются по осям вручную. Открывается технологией «Экономический совет».', '{}', 5)
on conflict (key) do nothing;

create table if not exists public.v1_course_ideo (
  ideology text primary key,     -- 'robot' — для машинных держав
  name     text not null,
  mods     jsonb not null
);
alter table public.v1_course_ideo enable row level security;
drop policy if exists v1_course_ideo_read on public.v1_course_ideo;
create policy v1_course_ideo_read on public.v1_course_ideo for select using (true);
insert into public.v1_course_ideo(ideology, name, mods) values
  ('Технократия (Культ науки)', 'Эпоха разума', '{"research":-0.15,"sci_flat":1,"gc":-0.10}'),
  ('Милитаризм (Культ силы)', 'Железная поступь', '{"fleet":0.35,"claim_cost":-0.15,"order":-10}'),
  ('Пацифизм', 'Тихая гавань', '{"order":10,"gc":0.10,"fleet":-0.20}'),
  ('Экспансионизм', 'Зов рубежей', '{"colonize":-0.20,"claim_cd":-0.15,"order":-5}'),
  ('Изоляционизм', 'Закрытые врата', '{"gc":0.15,"mine":0.10,"colonize":0.20}'),
  ('Ксенофилия', 'Звёздный перекрёсток', '{"gc":0.20,"order":4,"mine":-0.15}'),
  ('Ксенофобия', 'Чистота крови', '{"mine":0.20,"fleet":0.15,"gc":-0.15}'),
  ('Спиритуализм', 'Свет алтарей', '{"order":8,"gc":0.10,"research":0.10}'),
  ('Трансгуманизм', 'За гранью плоти', '{"research":-0.20,"order":4,"gc":-0.15}'),
  ('Экоцентризм', 'Живая галактика', '{"order":8,"mine":0.10,"build":0.10}'),
  ('Индустриализм', 'Дым заводов', '{"build":-0.20,"mine":0.15,"order":-6}'),
  ('robot', 'Единый контур', '{"build":-0.15,"research":-0.10,"mine":0.10,"order":-5}')
on conflict (ideology) do nothing;

insert into public.v1_settings(key, value) values ('course', jsonb_build_object(
  'cd_days', 10, 'cd_days_council', 7,
  'axes', jsonb_build_object('gc', 0.06, 'mine', 0.06, 'build', -0.06, 'research', -0.05, 'order', 3, 'fleet', 0.10),
  'points', jsonb_build_object('pol.econ_council', 3, 'pol.econ_council2', 4)))
on conflict (key) do nothing;

-- ── Анкета державы ──
create or replace function public.v1_app(p_fid text) returns faction_applications
language sql stable security definer set search_path = public as $$
  select * from faction_applications where faction_id = p_fid and status = 'approved' order by created_at limit 1;
$$;

create or replace function public.v1_is_robot(p_fid text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select a.race = 'Синтетики / Киборги' or a.gov = 'Машинный разум (ИИ)' from faction_applications a
                   where a.faction_id = p_fid and a.status = 'approved' order by a.created_at limit 1), false);
$$;

-- Модификаторы выбранного курса
create or replace function public.v1_course_mods(p_fid text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  eco faction_economy; a faction_applications; cfg jsonb; k text; m jsonb := '{}'::jsonb;
  pts int := 0; used int := 0; ax text; st int; r jsonb;
begin
  select * into eco from faction_economy where faction_id = p_fid;
  k := coalesce(eco.econ_policy, 'balanced');
  if k = 'ideo' then
    a := v1_app(p_fid);
    select mods into m from v1_course_ideo where ideology = case when v1_is_robot(p_fid) then 'robot' else a.ideology end;
  elsif k = 'custom' then
    cfg := coalesce((select value from v1_settings where key = 'course'), '{}'::jsonb);
    r := coalesce(eco.research, '[]'::jsonb);
    select coalesce(max(value::int), 0) into pts from jsonb_each_text(coalesce(cfg->'points', '{}'::jsonb)) where r ? key;
    for ax in select jsonb_object_keys(coalesce(eco.econ_policy_custom, '{}'::jsonb)) loop
      st := greatest(-2, least(2, coalesce((eco.econ_policy_custom->>ax)::int, 0)));
      used := used + st;
      -- старое имя оси «wb» (благополучие) теперь «order» (порядок)
      m := m || jsonb_build_object(case ax when 'wb' then 'order' else ax end,
             coalesce((m->>(case ax when 'wb' then 'order' else ax end))::numeric, 0)
             + coalesce((cfg->'axes'->>(case ax when 'wb' then 'order' else ax end))::numeric, 0) * st);
    end loop;
    if pts = 0 or used > pts then m := '{}'::jsonb; end if;
  else
    select mods into m from v1_courses where key = k;
  end if;
  return coalesce(m, '{}'::jsonb) || jsonb_build_object('key', k);
end $$;

-- Итоговые множители державы
create or replace function public.v1_faction_mods(p_fid text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  a faction_applications; res jsonb; acc jsonb := '{}'::jsonb; m jsonb; k text; course jsonb;
  secular boolean;
begin
  a := v1_app(p_fid);
  select coalesce(research, '[]'::jsonb) into res from faction_economy where faction_id = p_fid;
  for m in
    select d.mods from v1_doctrine d where
         (d.kind = 'gov' and d.value = a.gov) or (d.kind = 'regime' and d.value = a.regime)
      or (d.kind = 'ideology' and d.value = a.ideology) or (d.kind = 'race' and d.value = a.race)
      or (d.kind = 'civ_type' and d.value = a.civ_type) or (d.kind = 'capital_env' and d.value = a.capital_env)
      or (d.kind = 'combo' and d.value = a.race || '|' || a.gov)
      or (d.kind = 'tech' and coalesce(res, '[]'::jsonb) ? d.value)
  loop
    for k in select jsonb_object_keys(m) loop
      acc := acc || jsonb_build_object(k, coalesce((acc->>k)::numeric, 0) + (m->>k)::numeric);
    end loop;
  end loop;
  course := v1_course_mods(p_fid);
  for k in select jsonb_object_keys(course - 'key') loop
    acc := acc || jsonb_build_object(k, coalesce((acc->>k)::numeric, 0) + (course->>k)::numeric);
  end loop;
  -- светское государство: +5 % к науке
  secular := exists (select 1 from v1_state_faith where faction_id = p_fid and mode = 'secular');
  return jsonb_build_object(
    'gc',         greatest(0.3,  1 + coalesce((acc->>'gc')::numeric, 0)),
    'mine',       greatest(0.3,  1 + coalesce((acc->>'mine')::numeric, 0)),
    'build',      greatest(0.3,  1 + coalesce((acc->>'build')::numeric, 0)),
    'research',   greatest(0.3,  1 + coalesce((acc->>'research')::numeric, 0)),
    'colonize',   greatest(0.3,  1 + coalesce((acc->>'colonize')::numeric, 0)),
    'claim_cost', greatest(0.3,  1 + coalesce((acc->>'claim_cost')::numeric, 0)),
    'claim_cd',   greatest(0.25, 1 + coalesce((acc->>'claim_cd')::numeric, 0)),
    'science',    1 + case when secular then 0.05 else 0 end,
    'sci_flat',   coalesce((acc->>'sci_flat')::numeric, 0),
    'agents_flat', coalesce((acc->>'agents_flat')::numeric, 0),
    'order',      coalesce((acc->>'order')::numeric, 0),
    'fleet',      1 + coalesce((acc->>'fleet')::numeric, 0),
    'course',     course->>'key');
end $$;

-- Вера державы: светская / основатель / последователь (подробно — в миграции 20)
create table if not exists public.v1_state_faith (
  faction_id text primary key,
  mode       text not null check (mode in ('secular','founder','member','none')),
  faith_id   uuid,
  changed_at timestamptz not null default now()
);
alter table public.v1_state_faith enable row level security;
drop policy if exists v1_state_faith_read on public.v1_state_faith;
create policy v1_state_faith_read on public.v1_state_faith for select using (true);

-- ── Каталог технологий ──
create table if not exists public.v1_tech (
  id     text primary key,      -- = tech_nodes.node_id
  branch text not null,
  name   text not null,
  descr  text not null default '',
  sort   int not null default 0,
  frozen text                   -- причина, если изучать сейчас нельзя
);
alter table public.v1_tech enable row level security;
drop policy if exists v1_tech_read on public.v1_tech;
create policy v1_tech_read on public.v1_tech for select using (true);

insert into public.v1_tech(id, branch, name, descr, sort, frozen) values
  ('pol.new_deal','Экономика','Торговые концессии','+10 % к доходу.',10,null),
  ('pol.mercantile','Экономика','Торговая монополия','+10 % к доходу, постройки дешевле на 5 %.',11,null),
  ('pol.econ_council','Экономика','Экономический совет','Открывает курс «Своя доктрина» с 3 очками. Курс можно менять раз в 7 дней вместо 10.',12,null),
  ('pol.econ_council2','Экономика','Плановое управление','«Своя доктрина» получает 4 очка.',13,null),
  ('pol.five_year','Производство','Директивная экономика','Постройки дешевле на 15 %.',20,null),
  ('pol.goelro','Производство','Энергетическая сеть','+15 % к добыче.',21,null),
  ('pol.land_reform','Экспансия','Колонизационный кодекс','Колонии дешевле на 15 %.',30,null),
  ('pol.total_mob','Экспансия','Экспансионный мандат','Захват систем дешевле на 20 %.',31,null),
  ('pol.house_heavens','Экспансия','Дом в небесах','+1 захват системы до перерыва.',32,null),
  ('pol.cel_asteroid','Освоение','Астероидные станции','Станции на поясах астероидов: 3 ячейки.',40,null),
  ('pol.cel_giants','Освоение','Орбитальные станции','Станции над газовыми, ледяными и горячими гигантами: 4 ячейки.',41,null),
  ('pol.cel_anomaly','Освоение','Аномальные станции','Станции в аномалиях: 5 ячеек.',42,null),
  ('pol.light_knowledge','Разум','Свет знаний','+1 слот исследований.',50,null),
  ('pol.mind_supremacy','Разум','Превосходство разума','+2 слота исследований.',51,null),
  ('pol.consumer_goods','Благополучие','Товары народного потребления','Рецепт фабрик потребления.',60,'Благополучие заменяется порядком колоний'),
  ('pol.welfare_hub','Благополучие','Центры благополучия','Постройка «Центр благополучия».',61,'Благополучие заменяется порядком колоний'),
  ('pol.welfare_hub2','Благополучие','Гражданские институты','Центры благополучия сильнее в 1,5 раза.',62,'Благополучие заменяется порядком колоний'),
  ('pol.welfare_hub3','Благополучие','Общественный договор','Центры благополучия на пределе мощности.',63,'Благополучие заменяется порядком колоний'),
  ('soc.consumer_goods','Благополучие','Народное потребление','Ранняя версия ветки благополучия.',64,'Благополучие заменяется порядком колоний'),
  ('soc.welfare_hub','Благополучие','Соцпрограммы I','Ранняя версия ветки благополучия.',65,'Благополучие заменяется порядком колоний'),
  ('soc.welfare_hub2','Благополучие','Соцпрограммы II','Ранняя версия ветки благополучия.',66,'Благополучие заменяется порядком колоний'),
  ('soc.welfare_hub3','Благополучие','Соцпрограммы III','Ранняя версия ветки благополучия.',67,'Благополучие заменяется порядком колоний'),
  ('pol.ballistics','Дальний огонь','Межзвёздная баллистика','Межзвёздная артиллерия.',70,'Межзвёздная артиллерия на пересмотре'),
  ('pol.inevitability','Дальний огонь','Сама неотвратимость','Межзвёздная артиллерия.',71,'Межзвёздная артиллерия на пересмотре'),
  ('pol.nemesis','Дальний огонь','Ожерелье Немезиды','Межзвёздная артиллерия.',72,'Межзвёздная артиллерия на пересмотре'),
  ('pol.hyperpacer','Дальний огонь','Гиперпейсер','Межзвёздная артиллерия.',73,'Межзвёздная артиллерия на пересмотре'),
  ('pol.throne_codex','Дальний огонь','Тронный кодекс','Межзвёздная артиллерия.',74,'Межзвёздная артиллерия на пересмотре'),
  ('cls.ship.destroyer','Классы кораблей','Эсминец','Открывает класс в конструкторе.',100,null),
  ('cls.ship.supportCarrier','Классы кораблей','Носитель поддержки','Открывает класс в конструкторе.',101,null),
  ('cls.ship.mediumCruiser','Классы кораблей','Средний крейсер','Открывает класс в конструкторе.',102,null),
  ('cls.ship.hyperCruiser','Классы кораблей','Рейдерский крейсер','Открывает класс в конструкторе.',103,null),
  ('cls.ship.multiroleCarrier','Классы кораблей','Многоцелевой носитель','Открывает класс в конструкторе.',104,null),
  ('cls.ship.battleship','Классы кораблей','Линкор','Открывает класс в конструкторе.',105,null),
  ('cls.ship.dreadnought','Классы кораблей','Дредноут','Открывает класс в конструкторе.',106,null),
  ('cls.ship.ss13','Классы кораблей','Станция','Открывает класс в конструкторе.',107,null),
  ('cls.ship.colossus','Классы кораблей','Имперский колосс','Открывает класс в конструкторе.',108,null),
  ('comp.ship.engine','Компоненты кораблей','Продвинутые двигатели','Новые двигатели в конструкторе.',110,null),
  ('comp.ship.radar','Компоненты кораблей','Продвинутые радары','Новые радары в конструкторе.',111,null),
  ('comp.ship.reactor','Компоненты кораблей','Продвинутые реакторы','Новые реакторы в конструкторе.',112,null),
  ('comp.ship.armor','Компоненты кораблей','Продвинутая броня','Новая броня в конструкторе.',113,null),
  ('comp.ship.shield','Компоненты кораблей','Продвинутые щиты','Новые щиты в конструкторе.',114,null),
  ('wpn.ship.ЭНЕРГЕТИЧЕСКОЕ ВООРУЖЕНИЕ','Вооружение кораблей','Энергетическое вооружение','Группа орудий в конструкторе.',120,null),
  ('wpn.ship.ВЗРЫВНОЕ ВООРУЖЕНИЕ','Вооружение кораблей','Взрывное вооружение','Группа орудий в конструкторе.',121,null),
  ('wpn.ship.АНГАРЫ И АВИАГРУППЫ','Вооружение кораблей','Ангары и авиагруппы','Группа вооружения в конструкторе.',122,null),
  ('wpn.ship.АВИАГРУППЫ И ДРОНЫ','Вооружение кораблей','Авиагруппы и дроны','Группа вооружения в конструкторе.',123,null),
  ('mod.ship.Десант','Модули кораблей','Десантные модули','Модули в конструкторе.',130,null),
  ('mod.ship.Модули станции','Модули кораблей','Модули станции','Модули в конструкторе.',131,null),
  ('mod.ship.Модули радиотумана','Модули кораблей','Модули радиотумана','Модули в конструкторе.',132,null),
  ('mod.ship.Конструкционные модули','Модули кораблей','Конструкционные модули','Модули в конструкторе.',133,null),
  ('rg.school.ritag','Энергетика','РИТЭГ','Школа реакторов для конструктора.',140,null),
  ('rg.school.yaeu','Энергетика','ЯЭУ — деление','Школа реакторов для конструктора.',141,null),
  ('rg.school.mgd','Энергетика','МГД-генератор','Школа реакторов для конструктора.',142,null),
  ('rg.school.tyar','Энергетика','ТЯР — синтез','Школа реакторов для конструктора.',143,null),
  ('rg.school.amu','Энергетика','Аннигиляция','Школа реакторов для конструктора.',144,null),
  ('rg.school.kvg','Энергетика','Квантово-вакуумный генератор','Школа реакторов для конструктора.',145,null),
  ('cls.ground.btr','Наземные войска','БТР','Класс наземной техники.',200,'Наземная война заморожена до нового движка'),
  ('cls.ground.tanki','Наземные войска','Танки','Класс наземной техники.',201,'Наземная война заморожена до нового движка'),
  ('cls.ground.arta','Наземные войска','Артиллерия','Класс наземной техники.',202,'Наземная война заморожена до нового движка'),
  ('comp.ground.engine','Наземные войска','Двигатели техники','Компонент.',210,'Наземная война заморожена до нового движка'),
  ('comp.ground.radar','Наземные войска','Радары техники','Компонент.',211,'Наземная война заморожена до нового движка'),
  ('comp.ground.reactor','Наземные войска','Реакторы техники','Компонент.',212,'Наземная война заморожена до нового движка'),
  ('comp.ground.armor','Наземные войска','Броня техники','Компонент.',213,'Наземная война заморожена до нового движка'),
  ('comp.ground.shield','Наземные войска','Щиты техники','Компонент.',214,'Наземная война заморожена до нового движка'),
  ('wpn.ground.ШТУРМОВОЕ ОРУЖИЕ','Наземные войска','Штурмовое оружие','Вооружение.',220,'Наземная война заморожена до нового движка'),
  ('wpn.ground.ГРАНАТЫ И МИНЫ','Наземные войска','Гранаты и мины','Вооружение.',221,'Наземная война заморожена до нового движка'),
  ('wpn.ground.ПУЛЕМЕТЫ','Наземные войска','Пулемёты','Вооружение.',222,'Наземная война заморожена до нового движка'),
  ('wpn.ground.ТЯЖЕЛОЕ ВООРУЖЕНИЕ','Наземные войска','Тяжёлое вооружение','Вооружение.',223,'Наземная война заморожена до нового движка'),
  ('wpn.ground.ПУЛЕМЕТЫ И ТУРЕЛИ','Наземные войска','Пулемёты и турели','Вооружение.',224,'Наземная война заморожена до нового движка'),
  ('wpn.ground.КИНЕТИКА','Наземные войска','Кинетика','Вооружение.',225,'Наземная война заморожена до нового движка'),
  ('wpn.ground.ЭНЕРГЕТИКА','Наземные войска','Энергетика','Вооружение.',226,'Наземная война заморожена до нового движка'),
  ('wpn.ground.РАКЕТНОЕ (БУМ)','Наземные войска','Ракетное оружие','Вооружение.',227,'Наземная война заморожена до нового движка'),
  ('wpn.ground.ОСНОВНОЙ КАЛИБР','Наземные войска','Основной калибр','Вооружение.',228,'Наземная война заморожена до нового движка'),
  ('wpn.ground.СТВОЛЬНАЯ АРТИЛЛЕРИЯ','Наземные войска','Ствольная артиллерия','Вооружение.',229,'Наземная война заморожена до нового движка'),
  ('wpn.ground.РЕАКТИВНЫЕ СИСТЕМЫ','Наземные войска','Реактивные системы','Вооружение.',230,'Наземная война заморожена до нового движка'),
  ('mod.ground.Десант','Наземные войска','Десантные модули техники','Модули.',231,'Наземная война заморожена до нового движка'),
  ('cls.aviation.aviacia','Авиация','Авиация','Класс авиации.',300,'Авиация заморожена'),
  ('cls.aviation.vertihui','Авиация','Вертолёты','Класс авиации.',301,'Авиация заморожена'),
  ('cls.aviation.dronkos','Авиация','БПЛА','Класс авиации.',302,'Авиация заморожена'),
  ('cls.aviation.mla','Авиация','Звездолёты','Класс авиации.',303,'Авиация заморожена'),
  ('comp.aviation.engine','Авиация','Двигатели авиации','Компонент.',310,'Авиация заморожена'),
  ('comp.aviation.radar','Авиация','Радары авиации','Компонент.',311,'Авиация заморожена'),
  ('comp.aviation.reactor','Авиация','Реакторы авиации','Компонент.',312,'Авиация заморожена'),
  ('comp.aviation.armor','Авиация','Броня авиации','Компонент.',313,'Авиация заморожена'),
  ('comp.aviation.shield','Авиация','Щиты авиации','Компонент.',314,'Авиация заморожена'),
  ('wpn.aviation.АВИАПУШКИ','Авиация','Авиапушки','Вооружение.',320,'Авиация заморожена'),
  ('wpn.aviation.РАКЕТНОЕ ВООРУЖЕНИЕ','Авиация','Ракетное вооружение','Вооружение.',321,'Авиация заморожена'),
  ('wpn.aviation.ПУШКИ И ТУРЕЛИ','Авиация','Пушки и турели','Вооружение.',322,'Авиация заморожена'),
  ('wpn.aviation.КОСМИЧЕСКОЕ ВООРУЖЕНИЕ','Авиация','Космическое вооружение','Вооружение.',323,'Авиация заморожена'),
  ('mod.aviation.Десант','Авиация','Десантные модули авиации','Модули.',324,'Авиация заморожена'),
  ('perk.patience','Доктрина боя','Терпение','Боевой перк экипажа.',400,'Боевые перки вернутся с новым боевым движком'),
  ('perk.timeman','Доктрина боя','Тайменеджмент','Боевой перк экипажа.',401,'Боевые перки вернутся с новым боевым движком'),
  ('perk.list','Доктрина боя','Наклонности','Боевой перк экипажа.',402,'Боевые перки вернутся с новым боевым движком'),
  ('perk.altaan','Доктрина боя','Альтаанская стойкость','Боевой перк экипажа.',403,'Боевые перки вернутся с новым боевым движком'),
  ('perk.shine','Доктрина боя','Сияй другим','Боевой перк экипажа.',404,'Боевые перки вернутся с новым боевым движком'),
  ('perk.slow','Доктрина боя','Медленно и верно','Боевой перк экипажа.',405,'Боевые перки вернутся с новым боевым движком'),
  ('perk.kchau','Доктрина боя','Кчау','Боевой перк экипажа.',406,'Боевые перки вернутся с новым боевым движком'),
  ('perk.conformist','Доктрина боя','Капитан-конформист','Боевой перк экипажа.',407,'Боевые перки вернутся с новым боевым движком'),
  ('perk.beamrider','Доктрина боя','Бимрайдер','Боевой перк экипажа.',408,'Боевые перки вернутся с новым боевым движком'),
  ('perk.recycler','Доктрина боя','Серийный ресайклер','Боевой перк экипажа.',409,'Боевые перки вернутся с новым боевым движком'),
  ('perk.despair','Доктрина боя','Отчаяние','Боевой перк экипажа.',410,'Боевые перки вернутся с новым боевым движком'),
  ('perk.necro','Доктрина боя','Пожиратель душ','Боевой перк экипажа.',411,'Боевые перки вернутся с новым боевым движком'),
  ('perk.bloodlust','Доктрина боя','Жажда крови','Боевой перк экипажа.',412,'Боевые перки вернутся с новым боевым движком'),
  ('perk.calm','Доктрина боя','Трансцендентность','Боевой перк экипажа.',413,'Боевые перки вернутся с новым боевым движком'),
  ('perk.martyr','Доктрина боя','Путь мученика','Боевой перк экипажа.',414,'Боевые перки вернутся с новым боевым движком'),
  ('perk.hijack','Доктрина боя','Перехват контура','Боевой перк экипажа.',415,'Боевые перки вернутся с новым боевым движком'),
  ('perk.choir','Доктрина боя','Звёздный хор','Боевой перк экипажа.',416,'Боевые перки вернутся с новым боевым движком')
on conflict (id) do nothing;

-- ── Исследования ──
-- Готовность — ближайший суточный тик (00:05 UTC); если до него меньше двух часов — следующий.
create or replace function public.v1_next_tick() returns timestamptz
language sql stable as $$
  select case when t < now() + interval '2 hours' then t + interval '1 day' else t end
  from (select date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' + interval '1 day 5 minutes' as t) q;
$$;

create or replace function public.v1_research_slots(p_fid text) returns int
language plpgsql stable security definer set search_path = public as $$
declare n int := 1; a faction_applications; r jsonb;
begin
  a := v1_app(p_fid);
  if v1_is_robot(p_fid) then n := n + 1; end if;
  if a.gov = 'Технократия' then n := n + 1; end if;
  if a.ideology = 'Технократия (Культ науки)' then n := n + 1; end if;
  select coalesce(research, '[]'::jsonb) into r from faction_economy where faction_id = p_fid;
  if r ? 'pol.light_knowledge' then n := n + 1; end if;
  if r ? 'pol.mind_supremacy' then n := n + 2; end if;
  return n;
end $$;

create or replace function public.v1_tech_cost(p_fid text, p_node text) returns numeric
language sql stable security definer set search_path = public as $$
  select greatest(1, round(t.base_cost * (v1_faction_mods(p_fid)->>'research')::numeric)) from tech_nodes t where t.node_id = p_node;
$$;

-- Завершить готовые и добрать очередь в свободные слоты
create or replace function public.v1_research_step(p_fid text) returns void
language plpgsql security definer set search_path = public as $$
declare
  eco faction_economy; slot jsonb; kept jsonb := '[]'::jsonb; done jsonb := '[]'::jsonb;
  smax int; nid text; cost numeric; q jsonb := '[]'::jsonb; ok boolean; mres numeric;
begin
  select * into eco from faction_economy where faction_id = p_fid for update;
  if not found then return; end if;
  eco.research := coalesce(eco.research, '[]'::jsonb);
  for slot in select value from jsonb_array_elements(coalesce(eco.research_slots, '[]'::jsonb)) loop
    if (slot->>'r')::timestamptz <= now() + interval '10 minutes' then done := done || to_jsonb(slot->>'n');
    else kept := kept || slot; end if;
  end loop;
  eco.research := eco.research || done;
  eco.research_slots := kept;
  smax := v1_research_slots(p_fid);
  mres := (v1_faction_mods(p_fid)->>'research')::numeric;
  for nid in select value from jsonb_array_elements_text(coalesce(eco.research_queue, '[]'::jsonb)) loop
    if eco.research ? nid or exists (select 1 from jsonb_array_elements(eco.research_slots) s where s->>'n' = nid)
       or exists (select 1 from v1_tech t where t.id = nid and t.frozen is not null) then
      continue;   -- уже изучено, идёт или заморожено — из очереди убираем
    end if;
    ok := jsonb_array_length(eco.research_slots) < smax
      and not exists (select 1 from tech_nodes t, jsonb_array_elements_text(coalesce(t.prereq, '[]'::jsonb)) p
                      where t.node_id = nid and not eco.research ? p.value);
    select greatest(1, round(base_cost * mres)) into cost from tech_nodes where node_id = nid;
    if ok and cost is not null and coalesce(eco.science, 0) >= cost then
      eco.research_slots := eco.research_slots || jsonb_build_object('n', nid, 'r', v1_next_tick());
      eco.science := eco.science - cost;
    else
      q := q || to_jsonb(nid);
    end if;
  end loop;
  update faction_economy set research = eco.research, research_slots = eco.research_slots,
         research_queue = q, science = eco.science where faction_id = p_fid;
end $$;

-- Сводка для страницы «Исследования»
create or replace function public.v1_research_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction(); eco faction_economy; mods jsonb;
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  perform v1_research_step(v_fid);
  select * into eco from faction_economy where faction_id = v_fid;
  mods := v1_faction_mods(v_fid);
  return jsonb_build_object(
    'can_manage', v1_can_manage(v_fid, 'research'),
    'science', eco.science,
    'slots', v1_research_slots(v_fid),
    'active', coalesce(eco.research_slots, '[]'::jsonb),
    'queue', coalesce(eco.research_queue, '[]'::jsonb),
    'done', coalesce(eco.research, '[]'::jsonb),
    'mult', mods->'research',
    'next_tick', v1_next_tick(),
    'income', (select sci from income_history where faction_id = v_fid order by tick_at desc limit 1),
    'tree', coalesce((select jsonb_agg(jsonb_build_object('id', n.node_id, 'cost', greatest(1, round(n.base_cost * (mods->>'research')::numeric)),
              'prereq', coalesce(n.prereq, '[]'::jsonb), 'branch', coalesce(t.branch, 'Прочее'), 'name', coalesce(t.name, n.node_id),
              'descr', coalesce(t.descr, ''), 'frozen', t.frozen, 'sort', coalesce(t.sort, 999)) order by coalesce(t.sort, 999), n.node_id)
             from tech_nodes n left join v1_tech t on t.id = n.node_id), '[]'::jsonb));
end $$;

create or replace function public.v1_research_start(p_node text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction(); eco faction_economy; cost numeric; miss text;
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(v_fid, 'research') then raise exception 'not_allowed'; end if;
  perform v1_research_step(v_fid);
  select * into eco from faction_economy where faction_id = v_fid for update;
  if not exists (select 1 from tech_nodes where node_id = p_node) then raise exception 'tech_unknown'; end if;
  if exists (select 1 from v1_tech where id = p_node and frozen is not null) then raise exception 'tech_frozen'; end if;
  if coalesce(eco.research, '[]'::jsonb) ? p_node then raise exception 'tech_done'; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(eco.research_slots, '[]'::jsonb)) s where s->>'n' = p_node) then raise exception 'tech_running'; end if;
  if jsonb_array_length(coalesce(eco.research_slots, '[]'::jsonb)) >= v1_research_slots(v_fid) then raise exception 'slots_full'; end if;
  select string_agg(coalesce(t.name, p.value), ', ') into miss
    from tech_nodes n, jsonb_array_elements_text(coalesce(n.prereq, '[]'::jsonb)) p left join v1_tech t on t.id = p.value
   where n.node_id = p_node and not coalesce(eco.research, '[]'::jsonb) ? p.value;
  if miss is not null then raise exception 'tech_prereq: %', miss; end if;
  cost := v1_tech_cost(v_fid, p_node);
  update faction_economy set science = science - cost,
         research_slots = coalesce(research_slots, '[]'::jsonb) || jsonb_build_object('n', p_node, 'r', v1_next_tick())
   where faction_id = v_fid and science >= cost;
  if not found then raise exception 'not_enough_science'; end if;
  return jsonb_build_object('ok', true, 'cost', cost, 'ready', v1_next_tick());
end $$;

create or replace function public.v1_research_queue(p_node text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction(); eco faction_economy; miss text;
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(v_fid, 'research') then raise exception 'not_allowed'; end if;
  select * into eco from faction_economy where faction_id = v_fid for update;
  if not exists (select 1 from tech_nodes where node_id = p_node) then raise exception 'tech_unknown'; end if;
  if exists (select 1 from v1_tech where id = p_node and frozen is not null) then raise exception 'tech_frozen'; end if;
  if coalesce(eco.research, '[]'::jsonb) ? p_node then raise exception 'tech_done'; end if;
  if coalesce(eco.research_queue, '[]'::jsonb) ? p_node then raise exception 'tech_queued'; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(eco.research_slots, '[]'::jsonb)) s where s->>'n' = p_node) then raise exception 'tech_running'; end if;
  if jsonb_array_length(coalesce(eco.research_queue, '[]'::jsonb)) >= 12 then raise exception 'queue_full'; end if;
  -- предшественники: изучены, идут или стоят в очереди раньше
  select string_agg(coalesce(t.name, p.value), ', ') into miss
    from tech_nodes n, jsonb_array_elements_text(coalesce(n.prereq, '[]'::jsonb)) p left join v1_tech t on t.id = p.value
   where n.node_id = p_node and not coalesce(eco.research, '[]'::jsonb) ? p.value
     and not coalesce(eco.research_queue, '[]'::jsonb) ? p.value
     and not exists (select 1 from jsonb_array_elements(coalesce(eco.research_slots, '[]'::jsonb)) s where s->>'n' = p.value);
  if miss is not null then raise exception 'tech_prereq: %', miss; end if;
  update faction_economy set research_queue = coalesce(research_queue, '[]'::jsonb) || to_jsonb(p_node) where faction_id = v_fid;
  perform v1_research_step(v_fid);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.v1_research_dequeue(p_node text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction();
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(v_fid, 'research') then raise exception 'not_allowed'; end if;
  update faction_economy set research_queue = coalesce(research_queue, '[]'::jsonb) - p_node where faction_id = v_fid;
  return jsonb_build_object('ok', true);
end $$;

-- ── Колонизация теперь учитывает доктрину (скидки технологий, идеологии и курса) ──
create or replace function public.v1_colony_rules(p_fid text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  cfg jsonb := coalesce((select value from v1_settings where key = 'colonize'), '{}'::jsonb);
  app faction_applications; res jsonb; robot boolean; envs text[]; pool int := 1; m jsonb;
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
    'default_cells', coalesce((cfg->>'default_cells')::int, 6));
end $$;

-- перерыв захвата может быть дробным (доктрина) — считаем в часах
create or replace function public.v1_claim_system(p_system_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_fid text := v1_my_faction();
  rules jsonb; eco faction_economy; cost numeric; pool int; used int; cd interval;
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(v_fid, 'colonize') then raise exception 'not_allowed'; end if;
  rules := v1_colony_rules(v_fid);
  cost := (rules->>'system_cost')::numeric;
  pool := (rules->>'pool')::int;
  cd := make_interval(hours => round((rules->>'claim_cd_days')::numeric * 24)::int);
  select * into eco from faction_economy where faction_id = v_fid for update;
  if eco.last_system_claim is not null and eco.last_system_claim > now() - cd then
    raise exception 'claim_cooldown: %', to_char((eco.last_system_claim + cd) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  end if;
  if not exists (select 1 from map_systems where id = p_system_id) then raise exception 'system_not_found'; end if;
  if not exists (select 1 from map_hyperlanes h join map_systems o on o.id = case when h.a_id = p_system_id then h.b_id else h.a_id end
                 where (h.a_id = p_system_id or h.b_id = p_system_id) and o.faction = v_fid) then
    raise exception 'not_adjacent';
  end if;
  if coalesce(eco.gc, 0) < cost then raise exception 'not_enough_gc'; end if;
  update map_systems set faction = v_fid where id = p_system_id and faction is null;
  if not found then raise exception 'system_taken'; end if;
  used := case when eco.last_system_claim is null then coalesce(eco.claim_used, 0) else 0 end + 1;
  update faction_economy set gc = gc - cost, claim_used = used,
         last_system_claim = case when used >= pool then now() else null end
   where faction_id = v_fid and gc >= cost;
  if not found then raise exception 'not_enough_gc'; end if;
  return jsonb_build_object('ok', true, 'system_id', p_system_id, 'cost', cost, 'left', greatest(pool - used, 0));
end $$;

create or replace function public.v1_colonize_state() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_fid text := v1_my_faction();
  rules jsonb; eco faction_economy; cd_until timestamptz; used int;
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  rules := v1_colony_rules(v_fid);
  select * into eco from faction_economy where faction_id = v_fid;
  if eco.last_system_claim is not null then
    cd_until := eco.last_system_claim + make_interval(hours => round((rules->>'claim_cd_days')::numeric * 24)::int);
    if cd_until <= now() then cd_until := null; end if;
  end if;
  used := case when eco.last_system_claim is null then coalesce(eco.claim_used, 0) else 0 end;
  return jsonb_build_object(
    'faction_id', v_fid,
    'can_manage', v1_can_manage(v_fid, 'colonize'),
    'gc', eco.gc,
    'rules', rules,
    'claim', jsonb_build_object('pool', rules->'pool', 'used', case when cd_until is not null then (rules->>'pool')::int else used end, 'cooldown_until', cd_until),
    'frontier', coalesce((select jsonb_agg(x order by x->>'name') from (
        select jsonb_build_object('id', s.id, 'name', s.name, 'star_type', s.star_type, 'x', s.x, 'y', s.y,
                 'bodies', jsonb_array_length(coalesce(s.planets, '[]'::jsonb)),
                 'open', (select count(*) from jsonb_array_elements(coalesce(s.planets, '[]'::jsonb)) p where (v1_body_access(rules, s, p)->>'mode') in ('colony','station')),
                 'from', (select jsonb_agg(distinct o.name) from map_hyperlanes h join map_systems o on o.id = case when h.a_id = s.id then h.b_id else h.a_id end
                          where (h.a_id = s.id or h.b_id = s.id) and o.faction = v_fid)) as x
        from map_systems s
        where s.faction is null and exists (
          select 1 from map_hyperlanes h join map_systems o on o.id = case when h.a_id = s.id then h.b_id else h.a_id end
          where (h.a_id = s.id or h.b_id = s.id) and o.faction = v_fid)) q), '[]'::jsonb),
    'systems', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'star_type', s.star_type,
        'bodies', coalesce((select jsonb_agg(jsonb_build_object('pid', (p->>'pid')::int, 'name', p->>'name', 'type', p->>'type', 'kind', coalesce(p->>'kind','planet'),
                     'colony', (select jsonb_build_object('id', c.id, 'mine', c.faction_id = v_fid, 'capital', c.is_capital, 'cells', c.cells)
                                from colonies c where c.system_id = s.id and c.planet_pid = (p->>'pid')::int limit 1))
                   || v1_body_access(rules, s, p) order by (p->>'pid')::int)
                   from jsonb_array_elements(coalesce(s.planets, '[]'::jsonb)) p where p ? 'pid'), '[]'::jsonb))
        order by s.name) from map_systems s where s.faction = v_fid), '[]'::jsonb));
end $$;

revoke all on function public.v1_research_step(text), public.v1_faction_mods(text), public.v1_course_mods(text), public.v1_app(text),
  public.v1_tech_cost(text, text) from public, anon;
grant execute on function public.v1_research_state(), public.v1_research_start(text), public.v1_research_queue(text),
  public.v1_research_dequeue(text), public.v1_faction_mods(text), public.v1_next_tick() to authenticated;
