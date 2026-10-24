-- ═══════════════════════════════════════════════════════════════
-- 21. Правки по итогам проверки 24.10.
--   • Бюджет державы: у каждой постройки 6 слотов, открыто столько, сколько даёт уровень отрасли
--     (Промышленность / Оборонзаказ / Образование) с поправкой на население. Покупки слотов больше нет.
--   • МЗА (межзвёздная артиллерия) заморожена целиком: орудия, арсеналы, Ожерелье Немезиды, Гиперпейсер.
--   • Краткие описания всех технологий.
--   • Служебные сводки (достижения, экспансия и т. п.) больше не попадают на модерацию.
--   • Админ-панель: снос державы, обнуление экономики, ресурсы, технологии, снять игрока, передать державу,
--     переименовать; роль «Гость»; блокировка с причиной и сроком.
-- ═══════════════════════════════════════════════════════════════

-- ── Бюджет ──
insert into public.v1_settings(key, value) values ('budget', jsonb_build_object(
  'weights', jsonb_build_array(0, 1, 2, 4, 7),
  'rates', jsonb_build_object('industry', 0.12, 'military', 0.15, 'science', 0.12, 'social', 0.12, 'infra', 0.09),
  'slots', jsonb_build_array(1, 2, 3, 5, 6),
  'pop_per_slot', 3))
on conflict (key) do nothing;

-- Отрасль, от которой зависят слоты постройки
create or replace function public.v1_budget_branch(p_btype text) returns text
language sql immutable as $$
  select case
    when p_btype in ('shipyard','military_factory','training','starbase','airfield') then 'military'
    when p_btype in ('science','intel') then 'science'
    else 'industry' end;
$$;

create or replace function public.v1_budget_row(p_fid text) returns faction_budget
language sql stable security definer set search_path = public as $$
  select coalesce((select b from faction_budget b where b.faction_id = p_fid),
    jsonb_populate_record(null::faction_budget, jsonb_build_object('faction_id', p_fid, 'industry', 2, 'military', 2, 'science', 2, 'social', 2, 'infra', 2)));
$$;

create or replace function public.v1_pop(p_fid text) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(coalesce(c.pop, coalesce(c.cells, 0) * 50)), 0)::numeric from colonies c where c.faction_id = p_fid;
$$;

-- Слоты всех построек по бюджету; не хватает людей (3 жителя на слот) — все слоты урезаются
create or replace function public.v1_budget_slots(p_fid text) returns void
language plpgsql security definer set search_path = public as $$
declare b faction_budget := v1_budget_row(p_fid); cfg jsonb := coalesce((select value from v1_settings where key = 'budget'), '{}'::jsonb);
  pop numeric := v1_pop(p_fid); total numeric; scale numeric; tgt jsonb;
begin
  tgt := coalesce(cfg->'slots', '[1,2,3,5,6]'::jsonb);
  select coalesce(sum((tgt->>((case v1_budget_branch(cb.btype) when 'military' then b.military when 'science' then b.science else b.industry end)::int))::int), 0)
    into total from colony_buildings cb where cb.faction_id = p_fid;
  if total <= 0 then return; end if;
  scale := least(1.0, pop / (total * coalesce((cfg->>'pop_per_slot')::numeric, 3)));
  update colony_buildings cb set slots_open = x.n
    from (select cb2.id, greatest(1, least(6, round((tgt->>((case v1_budget_branch(cb2.btype) when 'military' then b.military when 'science' then b.science else b.industry end)::int))::int * scale)::int)) n
            from colony_buildings cb2 where cb2.faction_id = p_fid) x
   where cb.id = x.id and cb.slots_open is distinct from x.n;
end $$;

create or replace function public.v1_budget_upkeep(p_fid text) returns numeric
language sql stable security definer set search_path = public as $$
  with b as (select * from v1_budget_row(p_fid)), c as (select coalesce(value, '{}'::jsonb) v from v1_settings where key = 'budget')
  select round(v1_pop(p_fid) * (
      ((select v from c)->'weights'->>b.industry::int)::numeric * ((select v from c)->'rates'->>'industry')::numeric
    + ((select v from c)->'weights'->>b.military::int)::numeric * ((select v from c)->'rates'->>'military')::numeric
    + ((select v from c)->'weights'->>b.science::int)::numeric * ((select v from c)->'rates'->>'science')::numeric
    + case when v1_is_robot(p_fid) then 0 else ((select v from c)->'weights'->>b.social::int)::numeric * ((select v from c)->'rates'->>'social')::numeric end
    + ((select v from c)->'weights'->>b.infra::int)::numeric * ((select v from c)->'rates'->>'infra')::numeric)) from b;
$$;

create or replace function public.v1_budget_set(p_industry int, p_military int, p_science int, p_social int, p_infra int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := v1_my_faction();
begin
  if me is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(me, 'politics') then raise exception 'not_allowed'; end if;
  insert into faction_budget(faction_id, industry, military, science, social, infra, updated_at)
  values (me, greatest(0, least(4, coalesce(p_industry, 2))), greatest(0, least(4, coalesce(p_military, 2))), greatest(0, least(4, coalesce(p_science, 2))),
          greatest(0, least(4, coalesce(p_social, 2))), greatest(0, least(4, coalesce(p_infra, 2))), now())
  on conflict (faction_id) do update set industry = excluded.industry, military = excluded.military, science = excluded.science,
    social = excluded.social, infra = excluded.infra, updated_at = now();
  perform v1_budget_slots(me);
  return jsonb_build_object('ok', true, 'upkeep', v1_budget_upkeep(me));
end $$;

-- Покупки слотов больше нет
create or replace function public.v1_open_slot(p_building uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'slots_by_budget';
end $$;

-- Готовые проекты + пересчёт слотов по бюджету
create or replace function public.v1_projects_step(p_fid text) returns void
language plpgsql security definer set search_path = public as $$
declare pr colony_projects; built boolean := false;
begin
  for pr in select * from colony_projects where faction_id = p_fid and ready_at <= now() order by ready_at for update skip locked loop
    if pr.kind = 'build' then
      if exists (select 1 from colonies c where c.id = pr.colony_id and c.faction_id = p_fid) then
        insert into colony_buildings(colony_id, faction_id, owner_id, btype, slots_open, tnp_mode, faith_id)
        values (pr.colony_id, p_fid, pr.owner_id, pr.btype, 1, false, nullif(pr.payload->>'faith_id', '')::uuid);
        built := true;
      end if;
    elsif pr.kind = 'slot' then
      null;   -- старые проекты слотов: слоты теперь задаёт бюджет
    elsif pr.kind = 'habitat' then
      update colonies set cells = cells + coalesce(pr.cells, 3), terraformed = true where id = pr.colony_id and faction_id = p_fid;
    elsif pr.kind = 'terraform' then
      if not exists (select 1 from colonies c where c.system_id = pr.system_id and c.planet_pid = pr.planet_pid) then
        insert into colonies(faction_id, owner_id, system_id, planet_name, planet_pid, planet_type, cells, terraformed, resources)
        values (p_fid, pr.owner_id, pr.system_id, pr.planet_name, pr.planet_pid, pr.planet_type, coalesce(nullif(pr.cells, 0), 6), true,
                coalesce(pr.payload->'resources', '[]'::jsonb));
      end if;
    else
      continue;
    end if;
    delete from colony_projects where id = pr.id;
  end loop;
  if built then perform v1_budget_slots(p_fid); end if;
end $$;

-- Сводка колоний: без цены слотов, с отраслью бюджета
create or replace function public.v1_colonies_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction(); cfg jsonb; mods jsonb; faith boolean; res jsonb; b faction_budget;
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  perform v1_projects_step(v_fid);
  cfg := coalesce((select value from v1_settings where key = 'colonies'), '{}'::jsonb);
  mods := v1_faction_mods(v_fid);
  faith := exists (select 1 from faith_membership where faction_id = v_fid);
  select coalesce(research, '[]'::jsonb) into res from faction_economy where faction_id = v_fid;
  b := v1_budget_row(v_fid);
  return jsonb_build_object(
    'can_manage', v1_can_manage(v_fid, 'build'),
    'gc', (select gc from faction_economy where faction_id = v_fid),
    'has_faith', faith,
    'build_mult', mods->'build',
    'budget', jsonb_build_object('industry', b.industry, 'military', b.military, 'science', b.science),
    'habitat_cost', round(coalesce((cfg->>'habitat_cost')::numeric, 10000) * (mods->>'colonize')::numeric),
    'habitat_cells', coalesce((cfg->>'habitat_cells')::int, 3),
    'catalog', (select jsonb_agg(jsonb_build_object('btype', x.btype, 'name', x.name, 'cat', x.cat, 'cost', x.cost, 'branch', v1_budget_branch(x.btype),
                 'descr', x.descr, 'only_on', to_jsonb(x.only_on), 'frozen', coalesce(x.frozen,
                   case when x.needs_tech is not null and not res ? x.needs_tech then 'Нужна технология' end,
                   case when x.btype = 'temple' and not faith then 'Сначала примите или основайте веру' end)) order by x.sort)
                from v1_buildings x),
    'colonies', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.planet_name, 'type', c.planet_type, 'capital', c.is_capital, 'cells', c.cells, 'pop', round(coalesce(c.pop, 0)),
        'system_id', c.system_id, 'system', s.name, 'kind', wk.kind,
        'world', to_jsonb(wk) - 'kind' - 'env',
        'buildings', coalesce((select jsonb_agg(jsonb_build_object('id', cb.id, 'btype', cb.btype, 'slots', cb.slots_open, 'branch', v1_budget_branch(cb.btype)) order by cb.created_at)
                      from colony_buildings cb where cb.colony_id = c.id and cb.faction_id = v_fid), '[]'::jsonb),
        'projects', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'btype', p.btype, 'building_id', p.building_id,
                        'label', p.label, 'ready_at', p.ready_at, 'spent', p.payload->'spent_gc') order by p.ready_at)
                      from colony_projects p where p.colony_id = c.id and p.faction_id = v_fid and p.kind <> 'slot'), '[]'::jsonb))
      order by c.is_capital desc, s.name, c.planet_name)
      from colonies c left join map_systems s on s.id = c.system_id
      cross join lateral (select w.* from v1_world_kinds w where w.kind = v1_world_kind(c.id)) wk
      where c.faction_id = v_fid), '[]'::jsonb),
    'terraforms', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.planet_name, 'system_id', p.system_id, 'ready_at', p.ready_at))
                  from colony_projects p where p.faction_id = v_fid and p.kind = 'terraform'), '[]'::jsonb));
end $$;

-- Снос: возврат половины цены постройки (слоты бесплатны)
create or replace function public.v1_demolish(p_building uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_fid text := v1_my_faction(); b colony_buildings; refund numeric; share numeric;
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(v_fid, 'build') then raise exception 'not_allowed'; end if;
  delete from colony_buildings where id = p_building and faction_id = v_fid returning * into b;
  if b.id is null then raise exception 'building_foreign'; end if;
  share := coalesce((select (value->>'refund_share')::numeric from v1_settings where key = 'colonies'), 0.5);
  refund := floor(share * coalesce(v1_build_price(v_fid, b.colony_id, (select cost from v1_buildings where btype = b.btype)), 0));
  if refund > 0 then update faction_economy set gc = gc + refund where faction_id = v_fid; end if;
  perform v1_budget_slots(v_fid);
  return jsonb_build_object('ok', true, 'refund', refund);
end $$;

-- ── МЗА заморожена ──
insert into public.v1_buildings(btype, name, cat, cost, ladder, free, descr, frozen, sort) values
  ('doomgun','Длань Неотвратимости','mil',700000,array[0,0,0,0,0,0],1,'Межзвёздное орудие.','Межзвёздная артиллерия заморожена',91),
  ('shellforge','Арсенал Судного Дня','mil',300000,array[0,0,0,0,0,0],1,'Склад и производство снарядов МЗА.','Межзвёздная артиллерия заморожена',92),
  ('ballfab','Баллистический военпромзавод','mil',150000,array[0,0,0,0,0,0],1,'Боеголовки Гиперпейсера.','Межзвёздная артиллерия заморожена',93),
  ('nemesis','Ожерелье Немезиды','mil',6000000,array[0,0,0,0,0,0],1,'Кольцо орбитальных перехватчиков.','Межзвёздная артиллерия заморожена',94)
on conflict (btype) do update set frozen = excluded.frozen, name = excluded.name, descr = excluded.descr;
update public.v1_tech set frozen = 'Межзвёздная артиллерия (МЗА) заморожена', branch = 'МЗА'
 where id in ('pol.ballistics','pol.inevitability','pol.nemesis','pol.hyperpacer','pol.throne_codex');

-- ── Краткие описания технологий ──
update public.v1_tech t set descr = d.descr from (values
  ('pol.new_deal','Налоговые льготы и открытые рынки для межзвёздных корпораций: +10 % к доходу державы.'),
  ('pol.mercantile','Государство берёт под контроль торговые маршруты: +10 % к доходу, постройки дешевле на 5 %.'),
  ('pol.econ_council','Постоянный экономический совет: открывает курс «Своя доктрина» (3 очка), курс меняется раз в 7 дней.'),
  ('pol.econ_council2','Аппарат планирования при совете: «Своя доктрина» получает 4 очка.'),
  ('pol.five_year','Единый государственный план для верфей и заводов: постройки дешевле на 15 %.'),
  ('pol.goelro','Единая энергосеть повышает КПД добывающих комплексов: +15 % к добыче.'),
  ('pol.land_reform','Права поселенцев и льготная логистика первых волн освоения: колонии дешевле на 15 %.'),
  ('pol.total_mob','Флот и дипломатия брошены на расширение границ: захват систем дешевле на 20 %.'),
  ('pol.house_heavens','Имперская служба освоения: две системы за один цикл захвата вместо одной.'),
  ('pol.cel_asteroid','Обитаемые модули крепятся прямо к телам пояса: станции на поясах астероидов, 3 ячейки.'),
  ('pol.cel_giants','Подвесные платформы над гигантами: станции у газовых, ледяных и горячих гигантов, 4 ячейки.'),
  ('pol.cel_anomaly','Стабилизация конструкций внутри аномалий: самые большие станции, 5 ячеек.'),
  ('pol.light_knowledge','Всеобщее просвещение и сеть академий: +1 слот исследований.'),
  ('pol.mind_supremacy','Лучшие умы державы работают над несколькими прорывами сразу: +2 слота исследований.'),
  ('pol.consumer_goods','Свой рецепт фабрик потребления: что именно получает население.'),
  ('pol.welfare_hub','Постройка «Центр благополучия».'),
  ('pol.welfare_hub2','Центры благополучия сильнее в полтора раза.'),
  ('pol.welfare_hub3','Центры благополучия работают на пределе мощности.'),
  ('soc.consumer_goods','Ранняя ветка благополучия: народное потребление.'),
  ('soc.welfare_hub','Ранняя ветка благополучия: социальные программы.'),
  ('soc.welfare_hub2','Ранняя ветка благополучия: расширенные социальные программы.'),
  ('soc.welfare_hub3','Ранняя ветка благополучия: полные социальные программы.'),
  ('pol.ballistics','Межзвёздная баллистика: основа артиллерии, бьющей из системы в систему.'),
  ('pol.inevitability','«Длань Неотвратимости» — стационарное межзвёздное орудие.'),
  ('pol.nemesis','«Ожерелье Немезиды» — кольцо орбитальных перехватчиков вокруг системы.'),
  ('pol.hyperpacer','«Гиперпейсер» — мобильное межзвёздное орудие на корабельном корпусе.'),
  ('pol.throne_codex','Тронный кодекс — свод правил для межзвёздной артиллерии.'),
  ('cls.ship.destroyer','Быстрый и дешёвый корабль первой линии. Основа любого флота.'),
  ('cls.ship.supportCarrier','Лёгкий носитель: авиагруппы и дроны прикрытия для эскадры.'),
  ('cls.ship.mediumCruiser','Сбалансированный крейсер: броня, щиты и средний калибр.'),
  ('cls.ship.hyperCruiser','Рейдерский крейсер: дальние броски по тылам и коммуникациям врага.'),
  ('cls.ship.multiroleCarrier','Тяжёлый носитель с ангарами и собственным вооружением.'),
  ('cls.ship.battleship','Линкор: тяжёлая броня и главный калибр для решающих сражений.'),
  ('cls.ship.dreadnought','Дредноут: флагман, вокруг которого строится флот.'),
  ('cls.ship.ss13','Станция: боевая платформа для обороны систем.'),
  ('cls.ship.colossus','Имперский колосс — вершина кораблестроения, один на целый флот.'),
  ('comp.ship.engine','Двигатели нового поколения: корабли быстрее на манёвре и в перелётах.'),
  ('comp.ship.radar','Радары дальнего обнаружения: точнее огонь и дальше обзор.'),
  ('comp.ship.reactor','Мощные реакторы: больше энергии на оружие и щиты.'),
  ('comp.ship.armor','Композитная броня: корпус держит больше урона.'),
  ('comp.ship.shield','Усиленные щиты: поглощают больше урона до пробития.'),
  ('wpn.ship.ЭНЕРГЕТИЧЕСКОЕ ВООРУЖЕНИЕ','Лазеры и излучатели: точный огонь без боезапаса.'),
  ('wpn.ship.ВЗРЫВНОЕ ВООРУЖЕНИЕ','Ракеты и торпеды: тяжёлый удар по крупным целям.'),
  ('wpn.ship.АНГАРЫ И АВИАГРУППЫ','Ангары для истребителей и штурмовиков на борту.'),
  ('wpn.ship.АВИАГРУППЫ И ДРОНЫ','Рои дронов: прикрытие и перехват ракет.'),
  ('mod.ship.Десант','Десантные отсеки: корабль высаживает войска на планету.'),
  ('mod.ship.Модули станции','Модули для станций: склады, доки и жилые блоки.'),
  ('mod.ship.Модули радиотумана','Радиотуман: корабль хуже виден врагу.'),
  ('mod.ship.Конструкционные модули','Каркасные модули: больше места под оборудование.'),
  ('rg.school.ritag','РИТЭГ: простейший и надёжный источник энергии для малых корпусов.'),
  ('rg.school.yaeu','Ядерная установка деления: заметно мощнее РИТЭГа.'),
  ('rg.school.mgd','Магнитогидродинамический генератор: высокий КПД при малой массе.'),
  ('rg.school.tyar','Термоядерный синтез: большой потолок мощности для тяжёлых кораблей.'),
  ('rg.school.amu','Аннигиляция: огромная мощность при вдвое меньшей массе реакторной зоны.'),
  ('rg.school.kvg','Квантово-вакуумный генератор: предельная мощность, доступная технике.'),
  ('cls.ground.btr','Бронетранспортёры для переброски пехоты.'),
  ('cls.ground.tanki','Основные боевые танки.'),
  ('cls.ground.arta','Артиллерия для огня с закрытых позиций.'),
  ('comp.ground.engine','Двигатели наземной техники.'),
  ('comp.ground.radar','Радары и прицелы наземной техники.'),
  ('comp.ground.reactor','Силовые установки наземной техники.'),
  ('comp.ground.armor','Броня наземной техники.'),
  ('comp.ground.shield','Щиты наземной техники.'),
  ('wpn.ground.ШТУРМОВОЕ ОРУЖИЕ','Оружие штурмовой пехоты.'),
  ('wpn.ground.ГРАНАТЫ И МИНЫ','Гранаты и минирование.'),
  ('wpn.ground.ПУЛЕМЕТЫ','Пулемёты пехоты и техники.'),
  ('wpn.ground.ТЯЖЕЛОЕ ВООРУЖЕНИЕ','Тяжёлое вооружение пехоты.'),
  ('wpn.ground.ПУЛЕМЕТЫ И ТУРЕЛИ','Пулемёты и турели на технике.'),
  ('wpn.ground.КИНЕТИКА','Кинетические орудия техники.'),
  ('wpn.ground.ЭНЕРГЕТИКА','Энергетическое оружие техники.'),
  ('wpn.ground.РАКЕТНОЕ (БУМ)','Ракетное оружие техники.'),
  ('wpn.ground.ОСНОВНОЙ КАЛИБР','Главный калибр танков.'),
  ('wpn.ground.СТВОЛЬНАЯ АРТИЛЛЕРИЯ','Ствольная артиллерия.'),
  ('wpn.ground.РЕАКТИВНЫЕ СИСТЕМЫ','Реактивные системы залпового огня.'),
  ('mod.ground.Десант','Десантные модули наземной техники.'),
  ('cls.aviation.aviacia','Атмосферная авиация.'),
  ('cls.aviation.vertihui','Вертолёты огневой поддержки.'),
  ('cls.aviation.dronkos','Беспилотники.'),
  ('cls.aviation.mla','Малые звездолёты для боя в космосе и атмосфере.'),
  ('comp.aviation.engine','Двигатели авиации.'),
  ('comp.aviation.radar','Радары авиации.'),
  ('comp.aviation.reactor','Силовые установки авиации.'),
  ('comp.aviation.armor','Броня авиации.'),
  ('comp.aviation.shield','Щиты авиации.'),
  ('wpn.aviation.АВИАПУШКИ','Авиапушки.'),
  ('wpn.aviation.РАКЕТНОЕ ВООРУЖЕНИЕ','Ракеты авиации.'),
  ('wpn.aviation.ПУШКИ И ТУРЕЛИ','Пушки и турели авиации.'),
  ('wpn.aviation.КОСМИЧЕСКОЕ ВООРУЖЕНИЕ','Оружие для боя в космосе.'),
  ('mod.aviation.Десант','Десантные модули авиации.'),
  ('perk.patience','Экипаж копит энергию, пока модули перезаряжаются.'),
  ('perk.timeman','Неистраченное время хода переходит в следующий.'),
  ('perk.list','Удары в борт дают экипажу запас времени.'),
  ('perk.altaan','Щит, погасивший урон, ускоряет перезарядку.'),
  ('perk.shine','Корабль поддерживает союзников рядом.'),
  ('perk.slow','Медленный, но устойчивый к урону стиль боя.'),
  ('perk.kchau','Особая тактика экипажа.'),
  ('perk.conformist','Капитан держит строй и действует как флот.'),
  ('perk.beamrider','Мастер лучевого оружия.'),
  ('perk.recycler','Экипаж восстанавливает ресурсы из обломков.'),
  ('perk.despair','Экипаж сильнее, когда корабль на грани гибели.'),
  ('perk.necro','Корабль усиливается за счёт уничтоженных врагов.'),
  ('perk.bloodlust','Каждая победа подстёгивает экипаж.'),
  ('perk.calm','Экипаж сохраняет хладнокровие в любом бою.'),
  ('perk.martyr','Корабль жертвует собой ради союзников.'),
  ('perk.hijack','Перехват вражеских систем управления.'),
  ('perk.choir','Корабли действуют слаженно, как один хор.')
) as d(id, descr) where t.id = d.id;

-- ── Служебные сводки не идут на модерацию ──
create or replace function public.v1_news_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- серверные функции игры (не прямая запись игрока), служебные сводки и команда проекта — без ограничений
  if current_setting('v1.sys_news', true) = 'on' or current_user <> 'authenticated' then return new; end if;
  if auth.uid() is null or public.v1_is_staff() or current_user_role() = any (array['superadmin','editor','moderator']) then return new; end if;
  if tg_op = 'INSERT' then
    new.kind := 'news';   -- игрок пишет только новости
    new.status := case when new.status = 'draft' then 'draft' else 'pending' end;
    new.published_at := null; new.reviewed_by := null; new.staff_verdict := null; new.staff_grants := null;
  elsif new.status is distinct from old.status or new.published_at is distinct from old.published_at
     or new.staff_grants is distinct from old.staff_grants or new.staff_verdict is distinct from old.staff_verdict or new.kind is distinct from old.kind then
    if new.status not in ('draft', 'pending') then raise exception 'news_status_locked'; end if;
    new.published_at := old.published_at; new.staff_grants := old.staff_grants; new.staff_verdict := old.staff_verdict; new.kind := old.kind;
  end if;
  if tg_op = 'UPDATE' and old.status = 'approved' and (new.body is distinct from old.body or new.title is distinct from old.title) then
    new.status := 'pending';
  end if;
  return new;
end $$;

-- застрявшие на модерации сводки — опубликовать
update public.faction_news set status = 'approved', published_at = coalesce(published_at, created_at)
 where status = 'pending' and kind <> 'news';

-- ── Блокировка с причиной и сроком ──
create table if not exists public.v1_bans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reason text not null,
  until timestamptz,                 -- null — навсегда
  banned_by uuid,
  banned_at timestamptz not null default now()
);
alter table public.v1_bans enable row level security;
drop policy if exists v1_bans_read on public.v1_bans;
create policy v1_bans_read on public.v1_bans for select using (user_id = auth.uid() or v1_is_staff());

create or replace function public.v1_my_ban() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when coalesce((select bool_or(is_banned) from user_roles where user_id = auth.uid()), false)
    then coalesce((select jsonb_build_object('reason', reason, 'until', until, 'at', banned_at) from v1_bans where user_id = auth.uid()),
                  jsonb_build_object('reason', null, 'until', null, 'at', null)) end;
$$;
grant execute on function public.v1_my_ban() to authenticated;

-- истёкшие блокировки снимаются часовым тиком
create or replace function public.v1_ban_tick() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update user_roles set is_banned = false where user_id in (select user_id from v1_bans where until is not null and until <= now()) and is_banned;
  get diagnostics n = row_count;
  delete from v1_bans where until is not null and until <= now();
  return n;
end $$;
do $$ begin
  perform cron.unschedule('v1-ban-tick') where exists (select 1 from cron.job where jobname = 'v1-ban-tick');
  perform cron.schedule('v1-ban-tick', '*/15 * * * *', 'select public.v1_ban_tick()');
exception when others then raise notice 'cron: %', sqlerrm; end $$;

-- ── Действия команды проекта: пользователи ──
create or replace function public.v1_x_user(p_action text, p_target text, p_payload jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare uid uuid := p_target::uuid; days int; n int := 0;
begin
  if exists (select 1 from v1_staff where user_id = uid and level = 'superadmin') and p_action in ('user.block','user.guest') then raise exception 'superadmin_protected'; end if;
  case p_action
  when 'user.block' then
    days := nullif((p_payload->>'days')::int, 0);
    if coalesce(btrim(p_payload->>'reason'), '') = '' then raise exception 'ban_reason'; end if;
    update user_roles set is_banned = true where user_id = uid;
    get diagnostics n = row_count;
    if n = 0 then insert into user_roles(user_id, role, is_banned) values (uid, 'viewer', true); end if;
    insert into v1_bans(user_id, reason, until, banned_by, banned_at)
    values (uid, left(btrim(p_payload->>'reason'), 500), case when days is not null then now() + make_interval(days => days) end, auth.uid(), now())
    on conflict (user_id) do update set reason = excluded.reason, until = excluded.until, banned_by = excluded.banned_by, banned_at = now();
    return 1;
  when 'user.unblock' then
    update user_roles set is_banned = false where user_id = uid;
    delete from v1_bans where user_id = uid;
    return 1;
  when 'user.guest' then
    -- «Гость»: убрать из команды, снять с державы (держава остаётся без правителя)
    delete from v1_staff where user_id = uid and level <> 'superadmin';
    update faction_economy set owner_id = null where owner_id = uid;
    update faction_members set status = 'left', updated_at = now() where user_id = uid and status in ('active','pending');
    return 1;
  else raise exception 'unknown_action: %', p_action;
  end case;
end $$;

-- ── Действия команды проекта: державы ──
create or replace function public.v1_x_faction(p_action text, p_target text, p_payload jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare v_fid text := p_target; t text; res text; amt numeric; uid uuid; nm text;
begin
  if not exists (select 1 from faction_economy where faction_id = v_fid) and p_action <> 'faction.nuke' then raise exception 'faction_unknown'; end if;
  case p_action
  when 'faction.reset_economy' then
    -- обнулить экономику: казна, наука, склады, очереди и стройка; технологии — по флагу
    update faction_economy set gc = 0, science = 0, resources = '{}'::jsonb, research_slots = '[]'::jsonb, research_queue = '[]'::jsonb,
           research = case when coalesce((p_payload->>'research')::boolean, false) then '[]'::jsonb else research end
     where faction_id = v_fid;
    delete from colony_projects where faction_id = v_fid;
    delete from unit_production where faction_id = v_fid and status = 'queued';
    return 1;
  when 'faction.resource' then
    res := btrim(p_payload->>'name'); amt := (p_payload->>'amount')::numeric;
    if res is null or res = '' or amt is null then raise exception 'bad_payload'; end if;
    update faction_economy set resources = jsonb_set(coalesce(resources, '{}'::jsonb), array[res],
           to_jsonb(greatest(0, coalesce((resources->>res)::numeric, 0) + amt))) where faction_id = v_fid;
    return 1;
  when 'faction.research' then
    t := p_payload->>'node';
    if not exists (select 1 from tech_nodes where node_id = t) then raise exception 'tech_unknown'; end if;
    if coalesce((p_payload->>'grant')::boolean, true) then
      update faction_economy set research = case when coalesce(research, '[]'::jsonb) ? t then research else coalesce(research, '[]'::jsonb) || to_jsonb(t) end where faction_id = v_fid;
    else
      update faction_economy set research = coalesce(research, '[]'::jsonb) - t where faction_id = v_fid;
    end if;
    return 1;
  when 'faction.rename' then
    nm := btrim(p_payload->>'name');
    if length(nm) < 2 or length(nm) > 80 then raise exception 'bad_payload'; end if;
    update faction_applications set name = nm, updated_at = now() where faction_id = v_fid and status = 'approved';
    update faction_units set faction_name = nm where faction_id = v_fid;
    return 1;
  when 'faction.kick_owner' then
    update faction_economy set owner_id = null where faction_id = v_fid;
    update faction_members set status = 'kicked', updated_at = now() where faction_id = v_fid and status = 'active';
    return 1;
  when 'faction.transfer' then
    select id into uid from auth.users where lower(email) = lower(btrim(p_payload->>'email'));
    if uid is null then raise exception 'user_unknown'; end if;
    update faction_economy set owner_id = uid where faction_id = v_fid;
    update faction_applications set owner_id = uid, updated_at = now() where faction_id = v_fid and status = 'approved';
    update colonies set owner_id = uid where faction_id = v_fid;
    update fleets set owner_id = uid where faction_id = v_fid;
    return 1;
  when 'faction.colony_delete' then
    delete from colonies where id = (p_payload->>'colony')::uuid and faction_id = v_fid and not coalesce(is_capital, false);
    return 1;
  when 'faction.system_release' then
    update map_systems set faction = null where id = p_payload->>'system' and faction = v_fid;
    return 1;
  when 'faction.nuke' then
    -- ядерный вариант: держава исчезает целиком, системы становятся ничьими
    update map_systems set faction = null where faction = v_fid;
    delete from system_occupation where owner_fid = v_fid or occupier_fid = v_fid;
    delete from colony_occupation where owner_fid = v_fid or occupier_fid = v_fid;
    delete from colony_projects where faction_id = v_fid;
    delete from colonies where faction_id = v_fid;
    delete from fleets where faction_id = v_fid;
    delete from armies where faction_id = v_fid;
    delete from unit_production where faction_id = v_fid;
    update wars set status = 'status_quo', ended_at = now(), outcome_note = 'держава снесена командой проекта'
     where status = 'active' and (attacker_fid = v_fid or defender_fid = v_fid);
    delete from war_sides s using wars w where s.war_id = w.id and w.status = 'active' and s.fid = v_fid;
    update war_offers set status = 'expired', resolved_at = now() where status = 'pending' and (from_fid = v_fid or to_fid = v_fid);
    delete from diplo_members where fid = p_target;
    update diplo_vassals set status = 'broken' where status in ('pending','active') and (vassal_fid = v_fid or overlord_fid = v_fid);
    update state_unions set status = 'dissolved' where status in ('pending','active') and (lead_fid = v_fid or partner_fid = v_fid);
    update v1_loans set status = 'cancelled' where status in ('offered','active','defaulted') and (lender_fid = v_fid or borrower_fid = v_fid);
    delete from faith_membership where faction_id = v_fid;
    delete from v1_council_reps where faction_id = v_fid;
    update faction_members set status = 'left', updated_at = now() where faction_id = v_fid and status in ('active','pending');
    update faction_applications set status = 'deleted', updated_at = now() where faction_id = v_fid;
    delete from faction_economy where faction_id = v_fid;
    delete from faction_budget where faction_id = v_fid;
    return 1;
  else raise exception 'unknown_action: %', p_action;
  end case;
end $$;

-- Подробности державы для админ-панели
create or replace function public.v1_admin_faction(p_fid text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not v1_is_staff() then raise exception 'not_staff'; end if;
  return (select jsonb_build_object(
    'id', e.faction_id, 'gc', e.gc, 'science', e.science, 'resources', coalesce(e.resources, '{}'::jsonb), 'research', coalesce(e.research, '[]'::jsonb),
    'owner', (select jsonb_build_object('id', u.id, 'email', case when v1_is_superadmin() then u.email end,
               'name', coalesce((select max(display_name) from user_roles where user_id = u.id), 'Игрок')) from auth.users u where u.id = e.owner_id),
    'app', (select jsonb_build_object('name', a.name, 'gov', a.gov, 'race', a.race, 'ideology', a.ideology, 'status', a.status, 'created_at', a.created_at)
            from faction_applications a where a.faction_id = e.faction_id order by (a.status = 'approved') desc, a.created_at limit 1),
    'systems', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.name), '[]'::jsonb) from map_systems s where s.faction = e.faction_id),
    'colonies', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.planet_name, 'capital', c.is_capital, 'system', c.system_id) order by c.planet_name), '[]'::jsonb) from colonies c where c.faction_id = e.faction_id),
    'fleets', (select count(*) from fleets f where f.faction_id = e.faction_id),
    'ships', (select coalesce(sum(qty), 0) from unit_production u where u.faction_id = e.faction_id and u.category = 'ship' and u.status = 'done'),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('user', m.user_id, 'role', m.role, 'status', m.status)), '[]'::jsonb) from faction_members m where m.faction_id = e.faction_id and m.status = 'active'))
    from faction_economy e where e.faction_id = p_fid);
end $$;
grant execute on function public.v1_admin_faction(text) to authenticated;

insert into public.v1_action_policy(action, label, mode) values
  ('user.block', 'Заблокировать пользователя (с причиной и сроком)', 'approval'),
  ('user.unblock', 'Снять блокировку', 'free'),
  ('user.guest', 'Сделать гостем: убрать из команды и снять с державы', 'approval'),
  ('faction.reset_economy', 'Обнулить экономику державы', 'approval'),
  ('faction.resource', 'Выдать или забрать ресурс', 'approval'),
  ('faction.research', 'Выдать или забрать технологию', 'free'),
  ('faction.rename', 'Переименовать державу', 'free'),
  ('faction.kick_owner', 'Снять игрока с державы', 'approval'),
  ('faction.transfer', 'Передать державу другому игроку', 'superadmin'),
  ('faction.colony_delete', 'Удалить колонию', 'approval'),
  ('faction.system_release', 'Освободить систему', 'approval'),
  ('faction.nuke', 'Снести державу целиком', 'superadmin')
on conflict (action) do nothing;

revoke all on function public.v1_x_user(text, text, jsonb), public.v1_x_faction(text, text, jsonb), public.v1_ban_tick(),
  public.v1_budget_slots(text) from public, anon, authenticated;
grant execute on function public.v1_budget_set(int, int, int, int, int), public.v1_budget_upkeep(text) to authenticated;

-- Бюджет для страницы «Внутренняя политика»
create or replace function public.v1_budget_state() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me text := v1_my_faction(); b faction_budget; cfg jsonb := coalesce((select value from v1_settings where key = 'budget'), '{}'::jsonb);
  pop numeric; total numeric;
begin
  if me is null then raise exception 'no_faction'; end if;
  b := v1_budget_row(me);
  pop := v1_pop(me);
  select coalesce(sum((cfg->'slots'->>((case v1_budget_branch(cb.btype) when 'military' then b.military when 'science' then b.science else b.industry end)::int))::int), 0)
    into total from colony_buildings cb where cb.faction_id = me;
  return jsonb_build_object('levels', jsonb_build_object('industry', b.industry, 'military', b.military, 'science', b.science, 'social', b.social, 'infra', b.infra),
    'upkeep', v1_budget_upkeep(me), 'pop', round(pop), 'cfg', cfg, 'robot', v1_is_robot(me),
    'slots_need', total * coalesce((cfg->>'pop_per_slot')::numeric, 3),
    'buildings', (select jsonb_object_agg(br, n) from (select v1_budget_branch(btype) br, count(*) n from colony_buildings where faction_id = me group by 1) x));
end $$;
grant execute on function public.v1_budget_state() to authenticated;
