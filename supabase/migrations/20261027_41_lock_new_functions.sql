-- Классическая эра 1.0 · Закрыть служебные функции миграций 39–40.
--
-- Миграция 36 закрыла доступ «по умолчанию» только для схемы public, а в Postgres
-- такая настройка не отменяет общую: новая функция всё равно получает право вызова
-- для всех (PUBLIC), а через него — для anon и authenticated. Поэтому служебные
-- функции нового боя и полёта (_v1_…, тик флотов) оказались доступны из браузера.
--   1. Общая настройка: новые функции владельца postgres больше не открываются всем.
--   2. Служебные функции закрыты полностью (их вызывают только другие функции и таймер).
--   3. Игровые функции полёта и армий — только вошедшим игрокам (authenticated), не anon.

set lock_timeout = '15s';

alter default privileges for role postgres revoke execute on functions from public;

do $$
declare f record; n int := 0;
begin
  for f in
    select p.oid::regprocedure sig from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
       and (p.proname like '\_v1\_%' or p.proname in ('v1_fleet_tick', 'v1_sys_open', 'v1_fleet_prof'))
       -- функции, на которые ссылаются правила доступа к строкам, не трогаем
       and not exists (select 1 from pg_policy pol where coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') like '%' || p.proname || '%')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
    n := n + 1;
  end loop;
  raise notice 'закрыто служебных функций: %', n;

  for f in
    select p.oid::regprocedure sig from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('v1_fleet_state', 'v1_fleet_new', 'v1_fleet_meta_save', 'v1_fleet_stance', 'v1_fleet_base', 'v1_fleet_targets',
                         'v1_fleet_send', 'v1_fleet_recall', 'v1_fleet_refuel', 'v1_army_new', 'v1_army_meta_save', 'v1_army_base',
                         'v1_army_targets', 'v1_army_move', 'v1_army_land', 'v1_army_cancel', 'v1_army_disband', 'v1_lane_hours')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;
