-- ═══════════════════════════════════════════════════════════════
-- 15. Статистика державы.
--   v1_my_faction()        — держава вошедшего игрока (владелец или участник);
--   v1_faction_stats(fid)  — вся сводка одним вызовом: казна, история начислений,
--                            территория, армия, наука, достижения, дипломатия.
-- Читает только свою державу; команда проекта может открыть любую.
-- Ничего не меняет в данных — можно применять в любой момент.
-- ═══════════════════════════════════════════════════════════════

create or replace function public.v1_my_faction() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select faction_id from faction_economy where owner_id = auth.uid() order by created_at limit 1),
    (select faction_id from faction_members where user_id = auth.uid() and status = 'active' order by created_at limit 1));
$$;

create or replace function public.v1_faction_stats(p_fid text default null, p_days int default 30)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  fid text := coalesce(nullif(p_fid, ''), v1_my_faction());
  days int := greatest(7, least(coalesce(p_days, 30), 90));
  r jsonb;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if fid is null then raise exception 'no_faction'; end if;
  if fid is distinct from v1_my_faction() and not v1_is_staff() then raise exception 'not_yours'; end if;

  select jsonb_build_object(
    'faction', (select jsonb_build_object('id', a.faction_id, 'name', a.name, 'color', a.color, 'herald_url', a.herald_url,
                  'gov', a.gov, 'regime', a.regime, 'race', a.race, 'capital', a.planet_name, 'capital_system', a.system_name,
                  'since', a.created_at)
                from faction_applications a where a.faction_id = fid and a.status = 'approved' order by a.created_at limit 1),

    'treasury', (select jsonb_build_object('gc', e.gc, 'science', e.science, 'last_tick', e.last_tick, 'agents', e.agents)
                 from faction_economy e where e.faction_id = fid limit 1),

    -- история начислений: по одной записи на тик, от старой к новой
    'history', coalesce((select jsonb_agg(jsonb_build_object(
                  'at', h.tick_at, 'gc', h.gc_after, 'net', h.gc_net, 'sci', h.sci,
                  'build', h.gc_build, 'trade', h.gc_trade, 'market', h.gc_market, 'export', h.gc_export,
                  'policy', h.gc_policy, 'faith', coalesce(h.gc_temple,0) + coalesce(h.gc_tithe,0) + coalesce(h.gc_sects,0),
                  'mined_lost', h.mined_lost) order by h.tick_at)
                from (select * from income_history where faction_id = fid and tick_at > now() - make_interval(days => days)
                      order by tick_at desc limit days * 2) h), '[]'::jsonb),

    'territory', jsonb_build_object(
       'systems', (select count(*) from map_systems s where s.faction = fid),
       'colonies', (select count(*) from colonies c where c.faction_id = fid),
       'pop', (select coalesce(round(sum(c.pop)), 0) from colonies c where c.faction_id = fid),
       'cells', (select coalesce(sum(c.cells), 0) from colonies c where c.faction_id = fid),
       'buildings', (select count(*) from colony_buildings b where b.faction_id = fid),
       'occupied_by_enemy', (select count(*) from colony_occupation o where o.owner_fid = fid),
       'occupying', (select count(*) from colony_occupation o where o.occupier_fid = fid),
       'types', coalesce((select jsonb_agg(jsonb_build_object('t', t, 'n', n) order by n desc)
                 from (select coalesce(nullif(split_part(c.planet_type, ' · ', 1), ''), 'Неизвестно') t, count(*) n
                       from colonies c where c.faction_id = fid group by 1 order by 2 desc limit 8) x), '[]'::jsonb)),

    'army', jsonb_build_object(
       'ships', (select coalesce(sum(qty), 0) from unit_production u where u.faction_id = fid and u.category = 'ship' and u.status = 'done'),
       'ground', (select coalesce(sum(qty), 0) from unit_production u where u.faction_id = fid and u.category = 'ground' and u.status = 'done'),
       'aviation', (select coalesce(sum(qty), 0) from unit_production u where u.faction_id = fid and u.category = 'aviation' and u.status = 'done'),
       'queued', (select coalesce(sum(qty), 0) from unit_production u where u.faction_id = fid and u.status = 'queued'),
       'damaged', (select coalesce(sum(qty), 0) from unit_production u where u.faction_id = fid and u.status = 'damaged'),
       'fleets', (select count(*) from fleets f where f.faction_id = fid and not coalesce(f.is_station, false)),
       'stations', (select count(*) from fleets f where f.faction_id = fid and coalesce(f.is_station, false)),
       'moving', (select count(*) from fleets f where f.faction_id = fid and f.arrive_at > now()),
       'in_fleets', (select coalesce(sum((x->>'qty')::int), 0) from fleets f, jsonb_array_elements(case when jsonb_typeof(f.composition) = 'array' then f.composition else '[]'::jsonb end) x where f.faction_id = fid),
       'designs', (select count(*) from faction_units d where d.faction_id = fid)),

    'science', (select jsonb_build_object(
       'done', case when jsonb_typeof(e.research) = 'array' then (select count(*) from jsonb_array_elements_text(e.research) n where n in (select node_id from tech_nodes)) else 0 end,
       'total', (select count(*) from tech_nodes),
       'active', case when jsonb_typeof(e.research_slots) = 'array' then jsonb_array_length(e.research_slots) else 0 end,
       'queue', case when jsonb_typeof(e.research_queue) = 'array' then jsonb_array_length(e.research_queue) else 0 end,
       'next_ready', (select min((s->>'r')::timestamptz) from jsonb_array_elements(case when jsonb_typeof(e.research_slots) = 'array' then e.research_slots else '[]'::jsonb end) s))
       from faction_economy e where e.faction_id = fid limit 1),

    'achievements', jsonb_build_object(
       'count', (select count(*) from faction_achievements fa where fa.faction_id = fid),
       'catalog', (select count(*) from v1_achievements),
       'reward', (select coalesce(sum(reward), 0) from faction_achievements fa where fa.faction_id = fid),
       'last', coalesce((select jsonb_agg(jsonb_build_object('id', x.ach_id, 'name', coalesce(nullif(v.name, ''), v.old_name, x.ach_id), 'reward', x.reward, 'at', x.earned_at) order by x.earned_at desc)
                 from (select * from faction_achievements where faction_id = fid order by earned_at desc limit 8) x
                 left join v1_achievements v on v.id = x.ach_id), '[]'::jsonb)),

    'diplomacy', jsonb_build_object(
       'wars_active', (select count(*) from wars w where w.ended_at is null and (w.attacker_fid = fid or w.defender_fid = fid
                         or exists (select 1 from war_sides ws where ws.war_id = w.id and ws.fid = fid))),
       'wars_total', (select count(*) from wars w where w.attacker_fid = fid or w.defender_fid = fid
                         or exists (select 1 from war_sides ws where ws.war_id = w.id and ws.fid = fid)),
       'wars_won', (select count(*) from wars w where (w.attacker_fid = fid and w.status = 'attacker_won') or (w.defender_fid = fid and w.status = 'defender_won')),
       'unions', coalesce((select jsonb_agg(jsonb_build_object('kind', u.kind, 'name', u.name, 'leader', u.leader_fid = fid))
                 from diplo_unions u where u.status = 'approved' and (u.leader_fid = fid or exists (select 1 from diplo_members m where m.union_id = u.id and m.fid = fid))), '[]'::jsonb),
       'overlord', (select a.name from diplo_vassals v join faction_applications a on a.faction_id = v.overlord_fid and a.status = 'approved'
                    where v.vassal_fid = fid and v.status = 'active' limit 1),
       'vassals', (select count(*) from diplo_vassals v where v.overlord_fid = fid and v.status = 'active'),
       'loans_given', (select coalesce(sum(amount), 0) from loans l where l.lender_fid = fid and l.status = 'active'),
       'loans_taken', (select coalesce(sum(amount), 0) from loans l where l.borrower_fid = fid and l.status = 'active'),
       'friends', (select count(*) from faction_relations fr where fr.from_fid = fid and fr.score >= 50),
       'rivals', (select count(*) from faction_relations fr where fr.from_fid = fid and fr.score <= -50))
  ) into r;
  return r;
end $$;

revoke all on function public.v1_faction_stats(text, int) from public, anon;
grant execute on function public.v1_my_faction(), public.v1_faction_stats(text, int) to authenticated;
