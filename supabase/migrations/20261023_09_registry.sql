-- Классическая эра 1.0 · Реестр кораблей и армий.
--   1. Чужие ТТХ скрыты: игрок видит только свои проекты и общедоступные.
--   2. Классы переименованы: «Факельщик» → «Рейдерский крейсер», «СС-13» → «Станция».
-- Модули не трогаем — их пересоберут отдельно.

set lock_timeout = '15s';

-- ════════ 1. Скрыть чужие ТТХ ════════
-- Таблица faction_units уже отдаёт игроку только свои и общедоступные проекты.
-- Дыра была в служебных функциях: _bt_stats(id), _bt_resist(id), _bt_acts_of(id),
-- _bt_batteries(id), _bt_perks_of(id), _repair_cost(id…), _ship_power_avg(fid) и т. п.
-- выполняются с правами владельца базы и вызывались из браузера кем угодно —
-- даже без входа. Подставь id чужого корабля — получи все его характеристики.
--
-- Служебные функции (имя начинается с «_») браузеру не нужны вообще: их вызывают
-- другие функции базы. Закрываем им вызов от anon и authenticated. Исключение —
-- функции, на которых держатся правила доступа к таблицам (_ec_my_fid и т. п.):
-- правила проверяются от имени игрока, без права вызова они бы сломались.
do $$
declare r record; in_policies text; n int := 0;
begin
  select string_agg(coalesce(qual, '') || ' ' || coalesce(with_check, ''), ' ') into in_policies from pg_policies;
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) a
      from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.proname like '\_%'
       and p.prokind = 'f'
       and position(p.proname || '(' in in_policies) = 0
       and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
  loop
    execute format('revoke execute on function public.%I(%s) from public, anon, authenticated', r.proname, r.a);
    n := n + 1;
  end loop;
  raise notice 'закрыто служебных функций: %', n;
end $$;

-- Тестовый бой админа был открыт всем, даже без входа.
do $$ begin
  if to_regprocedure('public.admin_bot_battle(uuid, uuid, integer, text)') is not null then
    revoke execute on function public.admin_bot_battle(uuid, uuid, integer, text) from public, anon;
  end if;
end $$;

-- ════════ 2. Переименование классов ════════
create or replace function pg_temp.v1_rename(t text) returns text language sql immutable as $$
  select regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(t,
    'СС-13 \(станция\)', 'Станция', 'g'),
    '([Сс]танция) (\(класс СС-13\)|класса СС-13)', '\1', 'g'),
    '([Сс]танция) СС-13', '\1', 'g'),
    'СС-13', 'Станция', 'g'),
    'ФАКЕЛЬЩИК', 'РЕЙДЕРСКИЙ КРЕЙСЕР', 'g'),
    'Факельщик', 'Рейдерский крейсер', 'g'),
    'факельщик', 'рейдерский крейсер', 'g')
$$;

-- проекты игроков: класс в сводке и в карточке; названия, которые игроки дали сами, не трогаем
update public.faction_units set
  summary   = pg_temp.v1_rename(summary::text)::jsonb,
  card_text = pg_temp.v1_rename(card_text)
 where summary::text ~* 'факельщик|СС-13' or card_text ~* 'факельщик|СС-13';
update public.faction_reactors set stats = pg_temp.v1_rename(stats::text)::jsonb where stats::text ~* 'факельщик|СС-13';
update public.fleets set composition = pg_temp.v1_rename(composition::text)::jsonb where composition::text ~* 'факельщик|СС-13';
update public.tech_offers set tech_label = pg_temp.v1_rename(tech_label) where tech_label ~* 'факельщик|СС-13';
delete from public.mt_cache where body::text ~* 'факельщик|СС-13';   -- кэш перевода пересоберётся сам

-- справочники в функциях базы (_tg_dict, _rg_dict, _cn_catalog, station_deploy__raw):
-- меняем только подписи, ключи вроде "hyperCruiser" и "ss13" остаются — на них держатся данные
do $$
declare r record; src text;
begin
  for r in select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where s.nspname = 'public' and p.prosrc ~* 'факельщик|СС-13' loop
    src := pg_temp.v1_rename(pg_get_functiondef(r.oid));
    execute src;
  end loop;
end $$;

select
  (select count(*) from public.faction_units where summary::text ~* 'факельщик|СС-13' or card_text ~* 'факельщик|СС-13') units_left,
  (select count(*) from pg_proc where prosrc ~* 'факельщик|СС-13') functions_left;
