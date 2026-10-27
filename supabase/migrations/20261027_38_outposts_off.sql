-- Классическая эра 1.0 · Заставы (аванпосты) снимаются на переработку.
--
-- Решение команды проекта (27.10.2026): механика стала обыденной. Все заставы и
-- корабли-носители убираются, владельцам возвращаются деньги:
--   • за каждую заставу — цена носителя (2000 ГС) + наём всего её экипажа (20 ГС за человека);
--   • за каждый носитель (строящийся, в пути или на стоянке) — 2000 ГС.
-- Ресурсы, добытые заставами, остаются у держав. Копии застав и выплаты — в журналах
-- v1_removed_units и v1_compensations. Повторный запуск ничего не делает.
-- Старому сайту закрыты действия с заставами (постройка, отправка, развёртывание…);
-- чтение оставлено, чтобы его страницы не падали — они просто покажут пустоту.

set lock_timeout = '15s';

do $$
declare
  why text := 'Заставы сняты на переработку';
  ship numeric := coalesce((select public._defense_const('outpost_ship_cost'))::numeric, 2000);
  crew numeric := coalesce((select public._defense_const('crew_hire_gc'))::numeric, 20);
  r record; total numeric := 0; fids jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from outposts) and not exists (select 1 from outpost_ships) then
    raise notice 'застав нет — нечего делать'; return;
  end if;

  for r in
    select fid, sum(n_out) n_out, sum(n_crew) n_crew, sum(n_ship) n_ship,
           jsonb_agg(d) filter (where d is not null) detail
      from (
        select o.faction_id fid, 1 n_out, coalesce(o.crew, 0) n_crew, 0 n_ship,
               jsonb_build_object('outpost', o.name, 'system', o.system_id, 'crew', o.crew) d
          from outposts o
        union all
        select s.faction_id, 0, 0, 1, jsonb_build_object('ship', s.name, 'status', s.status)
          from outpost_ships s
      ) z
     where fid is not null
     group by fid
  loop
    update faction_economy set gc = gc + (r.n_out + r.n_ship) * ship + r.n_crew * crew where faction_id = r.fid;
    insert into v1_compensations(faction_id, amount, reason, detail)
    values (r.fid, (r.n_out + r.n_ship) * ship + r.n_crew * crew, why,
            jsonb_build_object('outposts', r.n_out, 'crew', r.n_crew, 'ships', r.n_ship, 'items', r.detail));
    total := total + (r.n_out + r.n_ship) * ship + r.n_crew * crew;
    fids := fids || to_jsonb(r.fid);
  end loop;

  insert into v1_removed_units(id, unit, reason)
  select o.id, to_jsonb(o) || jsonb_build_object('kind', 'outpost'), why from outposts o on conflict (id) do nothing;
  insert into v1_removed_units(id, unit, reason)
  select s.id, to_jsonb(s) || jsonb_build_object('kind', 'outpost_ship'), why from outpost_ships s on conflict (id) do nothing;
  delete from outpost_rights;
  delete from outposts;
  delete from outpost_ships;

  perform v1_bulletin('Заставы сняты на переработку',
    format('Команда проекта сняла заставы на переработку: механика вернётся в обновлённом виде. Все заставы и корабли-носители убраны, владельцам возвращена их стоимость и наём экипажа — всего %s ГС. Добытые заставами ресурсы остаются у держав.',
           to_char(total, 'FM999G999G999G990')), fids);
  raise notice 'выплачено: % ГС', total;
end $$;

-- старому сайту — только чтение
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('outpost_build', 'outpost_ship_build', 'outpost_ship_deploy', 'outpost_ship_send', 'outpost_ship_scrap',
                                'outpost_staff', 'outpost_set_mode', 'outpost_rights_request', 'outpost_rights_set', 'outpost_raze', 'outpost_dismantle') loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    insert into v1_revoked_functions(signature, had_anon, had_auth) values (f.sig::text, false, true) on conflict do nothing;
  end loop;
end $$;
