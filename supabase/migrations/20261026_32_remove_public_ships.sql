-- Классическая эра 1.0 · Снятие общедоступных кораблей «пан-колониальной» серии.
--
-- Решение команды проекта (26.10.2026): восемь общедоступных проектов кораблей
-- удаляются. Державам возвращаются только деньги (ГС) по цене проекта:
--   • за корабли во флотах — цена × количество, корабли убираются из флотов;
--   • за заказы в очереди верфей (queued/damaged) — цена × количество, заказ снимается.
-- Ресурсы не возвращаются. Флоты, оставшиеся пустыми, не удаляются: у них есть
-- история сражений; держава может распустить их сама.
-- Копии проектов и все выплаты записываются в журналы. Повторный запуск ничего не делает.

set lock_timeout = '15s';

create table if not exists public.v1_removed_units (
  id         uuid primary key,
  unit       jsonb not null,
  reason     text not null,
  removed_at timestamptz not null default now()
);
create table if not exists public.v1_compensations (
  id         bigserial primary key,
  faction_id text not null,
  amount     numeric not null,
  reason     text not null,
  detail     jsonb not null default '[]'::jsonb,
  paid_at    timestamptz not null default now()
);
alter table public.v1_removed_units enable row level security;
alter table public.v1_compensations enable row level security;
revoke all on public.v1_removed_units, public.v1_compensations from anon, authenticated;

do $$
declare
  ids uuid[];
  why text := 'Снятие общедоступных кораблей пан-колониальной серии';
  f record; e jsonb; keep jsonb; cost numeric; q int;
  pay jsonb := '{}'::jsonb;      -- faction_id → сумма
  det jsonb := '{}'::jsonb;      -- faction_id → строки
  p record; k text; v jsonb; total numeric := 0;
begin
  select array_agg(id) into ids from faction_units where faction_id is null and category = 'ship';
  if ids is null then raise notice 'общедоступных кораблей нет — нечего делать'; return; end if;

  -- 1. флоты
  for f in select id, faction_id, name, composition from fleets
            where exists (select 1 from jsonb_array_elements(composition) x where (x->>'unit_id')::uuid = any(ids)) loop
    keep := '[]'::jsonb;
    for e in select * from jsonb_array_elements(f.composition) loop
      if (e->>'unit_id')::uuid = any(ids) then
        select coalesce((summary->>'cost')::numeric, 0) into cost from faction_units where id = (e->>'unit_id')::uuid;
        q := coalesce((e->>'qty')::int, 0);
        pay := jsonb_set(pay, array[f.faction_id], to_jsonb(coalesce((pay->>f.faction_id)::numeric, 0) + cost * q));
        det := jsonb_set(det, array[f.faction_id], coalesce(det->f.faction_id, '[]'::jsonb)
                 || jsonb_build_object('fleet', f.name, 'unit', e->>'unit_name', 'qty', q, 'cost', cost));
      else
        keep := keep || jsonb_build_array(e);
      end if;
    end loop;
    update fleets set composition = keep where id = f.id;
  end loop;

  -- 2. незавершённые заказы верфей
  for p in select u.id, u.faction_id, u.unit_name, u.qty, coalesce((fu.summary->>'cost')::numeric, 0) cost
             from unit_production u join faction_units fu on fu.id = u.unit_id
            where u.unit_id = any(ids) and u.status not in ('done', 'delivered', 'cancelled') loop
    pay := jsonb_set(pay, array[p.faction_id], to_jsonb(coalesce((pay->>p.faction_id)::numeric, 0) + p.cost * p.qty));
    det := jsonb_set(det, array[p.faction_id], coalesce(det->p.faction_id, '[]'::jsonb)
             || jsonb_build_object('order', p.id, 'unit', p.unit_name, 'qty', p.qty, 'cost', p.cost));
    delete from unit_production where id = p.id;
  end loop;

  -- 3. выплаты
  for k, v in select * from jsonb_each(pay) loop
    update faction_economy set gc = gc + (v #>> '{}')::numeric where faction_id = k;
    insert into v1_compensations(faction_id, amount, reason, detail) values (k, (v #>> '{}')::numeric, why, det->k);
    total := total + (v #>> '{}')::numeric;
  end loop;

  -- 4. архив и удаление проектов
  insert into v1_removed_units(id, unit, reason)
  select id, to_jsonb(u), why from faction_units u where id = any(ids) on conflict (id) do nothing;
  delete from faction_units where id = any(ids);

  perform v1_bulletin('Пан-колониальная серия снята с вооружения',
    format('Общедоступные проекты кораблей пан-колониальной серии сняты с вооружения. Корабли этой серии выведены из флотов, заказы на верфях отменены. Державам выплачена компенсация по цене кораблей — всего %s ГС.', to_char(total, 'FM999G999G999G990')),
    (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_object_keys(pay) x));
  raise notice 'удалено проектов: %, выплачено: % ГС', array_length(ids, 1), total;
end $$;
