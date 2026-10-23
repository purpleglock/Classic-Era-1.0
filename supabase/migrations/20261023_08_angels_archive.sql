-- Классическая эра 1.0 · Ангелы: вырезаем из игры, код сохраняем на будущее.
--
-- Что делает:
--   1. Создаёт закрытую схему archive (из браузера недоступна).
--   2. Сохраняет ТЕКСТ всех функций ангелов в archive.code — ровно в том виде,
--      в каком они сейчас работают в базе, — и копии всех таблиц angel_* с данными.
--   3. Снимает задачи ангелов с расписания и удаляет функции ангелов.
--
-- Что оставляет: ~20 мелких функций-проверок (_angel_is, _angel_fid и т. п.) и
-- пустые таблицы angel_state / angel_guard. Их вызывает СТАРЫЙ боевой код
-- (_bt_hit, _war_engage, battle_state…). Пока ангелов нет, они просто отвечают
-- «не ангел». Уйдут вместе со старым боевым движком (см. 20261023_11_battles.sql).
--
-- Вернуть любую функцию:  select definition from archive.code where name = '…';
-- и выполнить полученный текст. Таблицы — из archive.angel_*.
-- На момент вырезания ангелов в игре нет: angel_state и angel_relic пусты,
-- ни одна держава не «вознесена», откатывать игрокам нечего.

-- Удаление триггеров на fleets и battle_units ждёт, пока закончатся текущие
-- запросы к этим таблицам. Чтобы не повесить сайт, ждём не дольше 15 секунд:
-- если не успели — запустите файл ещё раз (он повторяемый), лучше ночью.
set lock_timeout = '15s';

create schema if not exists archive;
revoke all on schema archive from public, anon, authenticated;

create table if not exists archive.code (
  name        text not null,
  args        text not null default '',
  kind        text not null,                -- function | cron | table
  definition  text not null,
  note        text,
  archived_at timestamptz not null default now(),
  primary key (name, args, kind)
);

-- ── 1. Текст функций ──
insert into archive.code(name, args, kind, definition, note)
select p.proname, pg_get_function_identity_arguments(p.oid), 'function', pg_get_functiondef(p.oid), 'ангелы'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname ~ '(^_?angel|^admin_angel|_fire_angel$)'
on conflict (name, args, kind) do update set definition = excluded.definition, archived_at = now();

-- функции, которые трогали ангелов изнутри общего кода, — для справки, как было связано
insert into archive.code(name, args, kind, definition, note)
select p.proname, pg_get_function_identity_arguments(p.oid), 'function', pg_get_functiondef(p.oid), 'общий код со вставками ангелов'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('world_melted_to_ideal', '_doom_resolve', 'doom_fire_angel', 'mza_fire_angel')
on conflict (name, args, kind) do update set definition = excluded.definition, archived_at = now();

-- триггеры ангелов на общих таблицах (fleets, battle_units, colony_buildings, colony_projects)
insert into archive.code(name, kind, definition, note)
select t.tgname, 'trigger', pg_get_triggerdef(t.oid), 'ангелы'
  from pg_trigger t join pg_proc p on p.oid = t.tgfoid
 where p.proname ~ '(^_?angel|^admin_angel|_fire_angel$)' and not t.tgisinternal
on conflict (name, args, kind) do update set definition = excluded.definition;

-- ── 2. Расписание ──
insert into archive.code(name, kind, definition, note)
select jobname, 'cron', schedule || ' :: ' || command, 'ангелы' from cron.job where jobname like 'angel-%'
on conflict (name, args, kind) do update set definition = excluded.definition;
select cron.unschedule(jobname) from cron.job where jobname like 'angel-%';

-- ── 3. Таблицы: копии с данными ──
do $$
declare t text;
begin
  for t in select table_name from information_schema.tables where table_schema = 'public' and table_name like 'angel\_%' loop
    execute format('create table if not exists archive.%I (like public.%I including all)', t, t);
    execute format('insert into archive.%I select * from public.%I on conflict do nothing', t, t);
    insert into archive.code(name, kind, definition, note)
    values (t, 'table', (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = t) || ' колонок, копия в archive.' || t, 'ангелы')
    on conflict (name, args, kind) do update set archived_at = now();
  end loop;
end $$;

-- ── 4. Удаление функций ангелов ──
-- Оставляем только те, что вызывает старый боевой код.
do $$
declare r record;
  keep text[] := array['_angel_const','_angel_fid','_angel_bt_const','_angel_is','_angel_ark_bt','_angel_slip','_angel_bt_take',
    '_angel_glitch','_angel_guard_left','_angel_scream','_angel_free_hex','_angel_guard_hurt','_angel_take_salvo','_angel_guard_const',
    '_angel_host_const','_angel_engage_meant','_angel_guard_deploy','_angel_phase','_angel_news','_angel_noise'];
begin
  for r in select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) a
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname ~ '(^_?angel|^admin_angel|_fire_angel$)' and not (p.proname = any(keep))
  loop
    execute format('drop function if exists public.%I(%s) cascade', r.proname, r.a);
  end loop;
  -- оставшиеся помощники — не для браузера
  for r in select p.proname, pg_get_function_identity_arguments(p.oid) a
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = any(keep)
  loop
    execute format('revoke execute on function public.%I(%s) from public, anon, authenticated', r.proname, r.a);
  end loop;
end $$;

-- таблицы ангелов браузеру больше не нужны
do $$
declare t text;
begin
  for t in select table_name from information_schema.tables where table_schema = 'public' and table_name like 'angel\_%' loop
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

select kind, count(*) from archive.code group by kind;
