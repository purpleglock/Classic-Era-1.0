-- Классическая эра 1.0 · старые реакторы — в архив.
-- ЗАПУСКАТЬ В ДЕНЬ ПЕРЕХОДА (вместе с 07–09): пока работает старый сайт,
-- его конструктор реакторов должен оставаться рабочим.
--
-- Старые реакторы (faction_reactors) остаются в базе: корабли на них работают
-- до переработки конструктора кораблей, а держава видит их в разделе «Архив»
-- нового конструктора реактора. Создавать, менять и удалять их больше нельзя.

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('reactor_upsert', 'reactor_upsert__raw', 'reactor_delete', 'reactor_delete__raw')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

-- прямую запись в таблицу тоже закрываем
revoke insert, update, delete on public.faction_reactors from anon, authenticated;
