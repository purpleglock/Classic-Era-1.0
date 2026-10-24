-- ═══════════════════════════════════════════════════════════════
-- 19. Внешняя политика на новом коде.
--   Война: объявление, ноты (мир, капитуляция, требование капитуляции — только при ≥ 80 % систем врага),
--          зов союзника и вступление в войну. Таблицы прежние: wars, war_sides, war_offers.
--   Союзы: альянс (новое), конфедерация и федерация — diplo_unions / diplo_members / diplo_invites.
--   Вассалы — diplo_vassals. Младшая уния — state_unions. Объединение держав (старшая уния) —
--          v1_merge_requests, после согласия обеих сторон утверждает команда проекта.
--   Кредиты с процентом и сроком — v1_loans.
--   Межгалактическое сообщество: представители, резолюции, голосование (один голос на державу).
--   v1_diplo_tick — раз в час: итоги голосований, ответы на требования извинений, платежи по кредитам.
-- ═══════════════════════════════════════════════════════════════

-- ── Общие помощники ──
create or replace function public.v1_fname(p_fid text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select name from faction_applications where faction_id = p_fid and status = 'approved' order by created_at limit 1), 'держава');
$$;

create or replace function public.v1_is_active_faction(p_fid text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from faction_applications where faction_id = p_fid and status = 'approved');
$$;

-- Сводка сектора без проверки модератором (служебные новости)
create or replace function public.v1_bulletin(p_title text, p_body text, p_fids jsonb default '[]'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('v1.sys_news', 'on', true);
  insert into faction_news(faction_name, title, body, status, kind, published_at, mentions)
  values ('◈ ХРОНИКА СЕКТОРА', left(p_title, 200), p_body, 'approved', 'bulletin', now(), coalesce(p_fids, '[]'::jsonb));
  perform set_config('v1.sys_news', 'off', true);
exception when others then
  perform set_config('v1.sys_news', 'off', true);
  raise notice 'bulletin: %', sqlerrm;    -- сводка не должна ломать игровое действие
end $$;

-- страж новостей пропускает служебные сводки
create or replace function public.v1_news_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('v1.sys_news', true) = 'on' then return new; end if;
  if auth.uid() is null or public.v1_is_staff() or current_user_role() = any (array['superadmin','editor','moderator']) then return new; end if;
  if tg_op = 'INSERT' then
    new.status := case when new.status = 'draft' then 'draft' else 'pending' end;
    new.published_at := null; new.reviewed_by := null; new.staff_verdict := null; new.staff_grants := null;
  elsif new.status is distinct from old.status or new.published_at is distinct from old.published_at
     or new.staff_grants is distinct from old.staff_grants or new.staff_verdict is distinct from old.staff_verdict then
    if new.status not in ('draft', 'pending') then raise exception 'news_status_locked'; end if;
    new.published_at := old.published_at; new.staff_grants := old.staff_grants; new.staff_verdict := old.staff_verdict;
  end if;
  if tg_op = 'UPDATE' and old.status = 'approved' and (new.body is distinct from old.body or new.title is distinct from old.title) then
    new.status := 'pending';
  end if;
  return new;
end $$;

-- Отношение державы A к державе B: −100…100
create or replace function public.v1_rel_add(p_from text, p_to text, p_delta int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_from is null or p_to is null or p_from = p_to then return; end if;
  update faction_relations set score = greatest(-100, least(100, score + p_delta)), updated_at = now() where from_fid = p_from and to_fid = p_to;
  if not found then
    insert into faction_relations(from_fid, to_fid, score, updated_at) values (p_from, p_to, greatest(-100, least(100, p_delta)), now());
  end if;
end $$;

-- Временные поправки к порядку державы (решения Сообщества, усталость от войны и т. п.)
create table if not exists public.v1_order_mods (
  id uuid primary key default gen_random_uuid(),
  faction_id text not null,
  amount int not null,
  source text not null,
  until timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists v1_order_mods_fid on public.v1_order_mods(faction_id, until);
alter table public.v1_order_mods enable row level security;
drop policy if exists v1_order_mods_read on public.v1_order_mods;
create policy v1_order_mods_read on public.v1_order_mods for select using (true);

-- ── Война ──
create or replace function public.v1_war_side(p_war uuid, p_fid text) returns text
language sql stable security definer set search_path = public as $$
  select side from war_sides where war_id = p_war and fid = p_fid limit 1;
$$;

create or replace function public.v1_at_war(p_a text, p_b text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from wars w join war_sides a on a.war_id = w.id and a.fid = p_a join war_sides b on b.war_id = w.id and b.fid = p_b
                 where w.status = 'active' and a.side <> b.side);
$$;

-- Доля систем врага под вашей оккупацией
create or replace function public.v1_war_share(p_holder text, p_foe text) returns numeric
language sql stable security definer set search_path = public as $$
  select case when tot = 0 then 0 else round(held::numeric / tot, 4) end
  from (select (select count(*) from map_systems where faction = p_foe) tot,
               (select count(*) from system_occupation o join map_systems s on s.id = o.system_id and s.faction = p_foe where o.occupier_fid = p_holder) held) q;
$$;

-- Старший партнёр младшей унии (если держава — младший партнёр)
create or replace function public.v1_union_senior(p_fid text) returns text
language sql stable security definer set search_path = public as $$
  select lead_fid from state_unions where partner_fid = p_fid and status = 'active' limit 1;
$$;

-- Передача всего имущества одной державы другой (капитуляция, объединение)
create or replace function public.v1_merge_faction(p_lead text, p_minor text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare lead_owner uuid; t text; n_sys int; n_col int;
begin
  select owner_id into lead_owner from faction_economy where faction_id = p_lead;
  select count(*) into n_sys from map_systems where faction = p_minor;
  select count(*) into n_col from colonies where faction_id = p_minor;
  update faction_economy le set
    gc = coalesce(le.gc, 0) + coalesce(me.gc, 0),
    science = coalesce(le.science, 0) + coalesce(me.science, 0),
    resources = (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from (
      select key k, sum(value::numeric) v from (select * from jsonb_each_text(coalesce(le.resources, '{}'::jsonb))
        union all select * from jsonb_each_text(coalesce(me.resources, '{}'::jsonb))) x group by key) s),
    research = (select coalesce(jsonb_agg(distinct e), '[]'::jsonb) from (
      select jsonb_array_elements(coalesce(le.research, '[]'::jsonb)) e union all select jsonb_array_elements(coalesce(me.research, '[]'::jsonb))) u)
  from faction_economy me where le.faction_id = p_lead and me.faction_id = p_minor;
  update faction_economy set gc = 0, science = 0, resources = '{}'::jsonb, research_slots = '[]'::jsonb, research_queue = '[]'::jsonb where faction_id = p_minor;
  update map_systems set union_origin = coalesce(union_origin, faction), faction = p_lead where faction = p_minor;
  update system_occupation set owner_fid = p_lead where owner_fid = p_minor;
  delete from system_occupation where owner_fid = p_lead and occupier_fid = p_lead;
  update system_occupation set occupier_fid = p_lead where occupier_fid = p_minor;
  update colony_occupation set owner_fid = p_lead where owner_fid = p_minor;
  delete from colony_occupation where owner_fid = p_lead and occupier_fid = p_lead;
  update colony_occupation set occupier_fid = p_lead where occupier_fid = p_minor;
  update colonies set faction_id = p_lead, owner_id = lead_owner, union_origin = coalesce(union_origin, p_minor) where faction_id = p_minor;
  update colony_buildings set faction_id = p_lead, owner_id = lead_owner where faction_id = p_minor;
  update colony_projects set faction_id = p_lead, owner_id = lead_owner where faction_id = p_minor;
  update fleets set faction_id = p_lead, owner_id = lead_owner where faction_id = p_minor;
  update armies set faction_id = p_lead, owner_id = lead_owner where faction_id = p_minor;
  update unit_production set faction_id = p_lead, owner_id = lead_owner where faction_id = p_minor;
  update faction_units set faction_id = p_lead, owner_id = lead_owner, faction_name = v1_fname(p_lead) where faction_id = p_minor;
  -- второстепенное имущество: если таблицы нет или мешает ограничение — пропускаем
  foreach t in array array['outposts','spy_agents','system_minefields','system_drone_posts','faction_turrets','faction_reactors','faction_armor_alloys'] loop
    begin
      execute format('update public.%I set faction_id = $1 where faction_id = $2', t) using p_lead, p_minor;
    exception when others then raise notice 'merge %: %', t, sqlerrm;
    end;
  end loop;
  return jsonb_build_object('systems', n_sys, 'colonies', n_col);
end $$;

-- Капитуляция: всё имущество проигравшего — лидеру победившей стороны
create or replace function public.v1_capitulate(p_war uuid, p_winner text, p_loser text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare w wars; moved jsonb;
begin
  select * into w from wars where id = p_war for update;
  if w.id is null then raise exception 'war_not_found'; end if;
  update wars set status = case when p_winner = w.attacker_fid then 'attacker_won' else 'defender_won' end,
         ended_at = now(), outcome_note = coalesce(p_note, outcome_note) where id = p_war and status = 'active';
  -- прочие войны проигравшего: где он зачинщик — гаснут, где союзник — выбывает
  update wars set status = 'status_quo', ended_at = now(), outcome_note = 'держава прекратила существование после капитуляции'
   where status = 'active' and id <> p_war and (attacker_fid = p_loser or defender_fid = p_loser);
  delete from war_sides s using wars x where s.war_id = x.id and x.status = 'active' and s.fid = p_loser;
  update war_offers set status = 'expired', resolved_at = now()
   where status = 'pending' and (from_fid = p_loser or to_fid = p_loser or war_id in (select id from wars where status <> 'active'));
  moved := v1_merge_faction(p_winner, p_loser);
  update faction_applications set status = 'capitulated', updated_at = now() where faction_id = p_loser and status = 'approved';
  update faction_members set status = 'left', updated_at = now() where faction_id = p_loser and status in ('active','pending');
  update diplo_vassals set status = 'broken' where status in ('pending','active') and (vassal_fid = p_loser or overlord_fid = p_loser);
  update state_unions set status = 'dissolved' where status in ('pending','active') and (lead_fid = p_loser or partner_fid = p_loser);
  delete from diplo_members where fid = p_loser;
  update v1_loans set status = 'cancelled' where status in ('offered','active') and (lender_fid = p_loser or borrower_fid = p_loser);
  perform v1_bulletin('Капитуляция: ' || v1_fname(p_loser),
    format('Держава %s капитулирует перед %s. Под новый флаг уходят систем: %s, колоний: %s — вместе с флотами, складами и казной.',
           v1_fname(p_loser), v1_fname(p_winner), moved->>'systems', moved->>'colonies'),
    jsonb_build_array(p_winner, p_loser));
  return jsonb_build_object('ok', true, 'winner', p_winner, 'loser', p_loser) || moved;
end $$;

create or replace function public.v1_war_declare(p_target text, p_cause text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := v1_my_faction(); w uuid; cz text := nullif(btrim(coalesce(p_cause, '')), ''); m record; senior text;
begin
  if me is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(me, 'war') then raise exception 'not_allowed'; end if;
  if p_target is null or p_target = me then raise exception 'war_self'; end if;
  if not v1_is_active_faction(p_target) then raise exception 'faction_unknown'; end if;
  if v1_union_senior(me) is not null then raise exception 'union_junior'; end if;
  if exists (select 1 from state_unions where status = 'active' and ((lead_fid = me and partner_fid = p_target) or (lead_fid = p_target and partner_fid = me))) then raise exception 'war_union'; end if;
  if v1_at_war(me, p_target) then raise exception 'war_exists'; end if;
  if exists (select 1 from diplo_members a join diplo_members b on b.union_id = a.union_id where a.fid = me and b.fid = p_target) then raise exception 'war_ally'; end if;
  if exists (select 1 from diplo_vassals where status = 'active' and ((overlord_fid = me and vassal_fid = p_target) or (overlord_fid = p_target and vassal_fid = me))) then raise exception 'war_vassal'; end if;
  insert into wars(attacker_fid, defender_fid, cause) values (me, p_target, cz) returning id into w;
  insert into war_sides(war_id, fid, side) values (w, me, 'attacker'), (w, p_target, 'defender');
  -- младшие партнёры уний воюют вместе со старшими
  insert into war_sides(war_id, fid, side) select w, partner_fid, 'attacker' from state_unions where lead_fid = me and status = 'active' on conflict do nothing;
  insert into war_sides(war_id, fid, side) select w, partner_fid, 'defender' from state_unions where lead_fid = p_target and status = 'active' on conflict do nothing;
  senior := v1_union_senior(p_target);
  if senior is not null and senior <> me then insert into war_sides(war_id, fid, side) values (w, senior, 'defender') on conflict do nothing; end if;
  -- союзники по альянсу и сюзерен получают зов
  for m in
    select distinct x.fid from (
      select b.fid from diplo_members a join diplo_members b on b.union_id = a.union_id join diplo_unions u on u.id = a.union_id
       where a.fid = p_target and b.fid not in (me, p_target) and u.kind = 'alliance' and u.status = 'approved'
      union select overlord_fid from diplo_vassals where vassal_fid = p_target and status = 'active' and overlord_fid <> me) x
    where not exists (select 1 from war_sides s where s.war_id = w and s.fid = x.fid)
  loop
    insert into war_offers(war_id, from_fid, to_fid, kind, message, expires_at)
    values (w, p_target, m.fid, 'call_ally', 'Союзник атакован — договор обязывает прийти на помощь.', now() + interval '3 days');
  end loop;
  perform v1_bulletin('Объявлена война: ' || v1_fname(me) || ' → ' || v1_fname(p_target),
    format('%s объявляет войну державе %s.%s Посольства пустеют, слово переходит к флотам.', v1_fname(me), v1_fname(p_target),
           case when cz is null then '' else ' Повод — «' || cz || '».' end),
    jsonb_build_array(me, p_target));
  return jsonb_build_object('ok', true, 'war_id', w);
end $$;

-- Ноты: status_quo — предложить мир; surrender — капитулировать самим; capitulation — потребовать капитуляции (≥ 80 %)
create or replace function public.v1_war_note(p_war uuid, p_kind text, p_message text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := v1_my_faction(); w wars; foe text; sh numeric; need numeric; msg text := nullif(btrim(coalesce(p_message, '')), ''); oid uuid;
begin
  if me is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(me, 'war') then raise exception 'not_allowed'; end if;
  select * into w from wars where id = p_war;
  if w.id is null then raise exception 'war_not_found'; end if;
  if w.status <> 'active' then raise exception 'war_over'; end if;
  if me not in (w.attacker_fid, w.defender_fid) then raise exception 'war_not_leader'; end if;
  if p_kind not in ('status_quo','surrender','capitulation') then raise exception 'bad_note'; end if;
  foe := case when me = w.attacker_fid then w.defender_fid else w.attacker_fid end;
  need := coalesce((select (value->>'capitulation_share')::numeric from v1_settings where key = 'war'), 0.8);
  if p_kind = 'capitulation' then
    sh := v1_war_share(me, foe);
    if sh < need then raise exception 'capitulation_locked: %', round(sh * 100); end if;
  end if;
  if exists (select 1 from war_offers where war_id = p_war and from_fid = me and kind = p_kind and status = 'pending') then raise exception 'note_pending'; end if;
  if p_kind = 'surrender' then
    -- капитуляция на милость победителя — сразу
    return v1_capitulate(p_war, foe, me, coalesce(msg, 'капитуляция'));
  end if;
  insert into war_offers(war_id, from_fid, to_fid, kind, message, expires_at)
  values (p_war, me, foe, p_kind, msg, now() + interval '3 days') returning id into oid;
  if p_kind = 'capitulation' then
    perform v1_bulletin('Ультиматум: ' || v1_fname(me) || ' → ' || v1_fname(foe),
      format('%s держит %s %% систем державы %s и требует капитуляции. На ответ трое суток; молчание будет считаться согласием.%s',
             v1_fname(me), round(sh * 100), v1_fname(foe), case when msg is null then '' else ' Из ноты: «' || msg || '».' end),
      jsonb_build_array(me, foe));
  end if;
  return jsonb_build_object('ok', true, 'offer_id', oid);
end $$;

create or replace function public.v1_war_respond(p_offer uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := v1_my_faction(); o war_offers; w wars; r record;
begin
  if me is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(me, 'war') then raise exception 'not_allowed'; end if;
  select * into o from war_offers where id = p_offer for update;
  if o.id is null or o.to_fid is distinct from me then raise exception 'note_foreign'; end if;
  if o.status <> 'pending' then raise exception 'note_done'; end if;
  if o.kind = 'call_ally' then return v1_war_join(p_offer, p_accept); end if;
  select * into w from wars where id = o.war_id for update;
  if w.status <> 'active' then raise exception 'war_over'; end if;
  if not coalesce(p_accept, false) then
    update war_offers set status = 'declined', resolved_at = now() where id = p_offer;
    -- отказ от перемирия, к которому призвало Сообщество, бьёт по отношениям
    for r in select v.fid from v1_council_res c join v1_council_votes v on v.res_id = c.id and v.vote = 'yes' where c.offer_id = p_offer loop
      perform v1_rel_add(r.fid, me, -10);
    end loop;
    return jsonb_build_object('ok', true, 'accepted', false);
  end if;
  update war_offers set status = 'accepted', resolved_at = now() where id = p_offer;
  if o.kind = 'status_quo' then
    update wars set status = 'status_quo', ended_at = now(), outcome_note = coalesce(o.message, outcome_note) where id = w.id;
    update war_offers set status = 'expired', resolved_at = now() where war_id = w.id and status = 'pending';
    perform v1_bulletin('Мир: ' || v1_fname(w.attacker_fid) || ' ↔ ' || v1_fname(w.defender_fid),
      format('%s и %s подписывают мир на условиях статус-кво. Границы остаются прежними.', v1_fname(w.attacker_fid), v1_fname(w.defender_fid)),
      jsonb_build_array(w.attacker_fid, w.defender_fid));
    return jsonb_build_object('ok', true, 'accepted', true, 'status', 'status_quo');
  end if;
  -- требование капитуляции принято: сдаётся получатель
  return v1_capitulate(w.id, o.from_fid, me, o.message);
end $$;

create or replace function public.v1_war_call(p_war uuid, p_ally text, p_message text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := v1_my_faction(); w wars; sd text;
begin
  if me is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(me, 'war') then raise exception 'not_allowed'; end if;
  select * into w from wars where id = p_war;
  if w.id is null or w.status <> 'active' then raise exception 'war_over'; end if;
  sd := v1_war_side(p_war, me);
  if sd is null then raise exception 'war_not_member'; end if;
  if p_ally = me or not v1_is_active_faction(p_ally) then raise exception 'faction_unknown'; end if;
  if v1_war_side(p_war, p_ally) is not null then raise exception 'ally_in_war'; end if;
  if exists (select 1 from war_offers where war_id = p_war and to_fid = p_ally and kind = 'call_ally' and status = 'pending') then raise exception 'note_pending'; end if;
  insert into war_offers(war_id, from_fid, to_fid, kind, message, expires_at)
  values (p_war, me, p_ally, 'call_ally', nullif(btrim(coalesce(p_message, '')), ''), now() + interval '3 days');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.v1_war_join(p_offer uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := v1_my_faction(); o war_offers; w wars; sd text;
begin
  if me is null then raise exception 'no_faction'; end if;
  select * into o from war_offers where id = p_offer for update;
  if o.id is null or o.to_fid is distinct from me or o.kind <> 'call_ally' then raise exception 'note_foreign'; end if;
  if o.status <> 'pending' then raise exception 'note_done'; end if;
  select * into w from wars where id = o.war_id;
  if w.status <> 'active' then update war_offers set status = 'expired', resolved_at = now() where id = p_offer; raise exception 'war_over'; end if;
  if not coalesce(p_accept, false) then
    update war_offers set status = 'declined', resolved_at = now() where id = p_offer;
    perform v1_rel_add(o.from_fid, me, -10);
    return jsonb_build_object('ok', true, 'joined', false);
  end if;
  sd := v1_war_side(o.war_id, o.from_fid);
  if v1_war_side(o.war_id, me) is null then insert into war_sides(war_id, fid, side) values (o.war_id, me, sd); end if;
  update war_offers set status = 'accepted', resolved_at = now() where id = p_offer;
  perform v1_rel_add(o.from_fid, me, 10);
  perform v1_bulletin('Вступление в войну: ' || v1_fname(me),
    format('%s вступает в войну на стороне %s.', v1_fname(me), v1_fname(o.from_fid)), jsonb_build_array(me, o.from_fid));
  return jsonb_build_object('ok', true, 'joined', true, 'side', sd);
end $$;

-- Ноты с истёкшим сроком: требование капитуляции без ответа = капитуляция, прочие = отказ.
-- Включить вместо старой задачи war-offers-expire в день переезда.
create or replace function public.v1_war_expire() returns jsonb
language plpgsql security definer set search_path = public as $$
declare o war_offers; n int := 0;
begin
  for o in select * from war_offers where status = 'pending' and expires_at < now() order by created_at for update skip locked loop
    if o.kind = 'capitulation' and exists (select 1 from wars where id = o.war_id and status = 'active') then
      update war_offers set status = 'accepted', resolved_at = now() where id = o.id;
      begin perform v1_capitulate(o.war_id, o.from_fid, o.to_fid, coalesce(o.message, 'ультиматум остался без ответа'));
      exception when others then raise notice 'expire %: %', o.id, sqlerrm; end;
    else
      update war_offers set status = case when o.kind = 'call_ally' then 'expired' else 'declined' end, resolved_at = now() where id = o.id;
    end if;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'closed', n);
end $$;

insert into public.v1_settings(key, value) values ('war', jsonb_build_object('capitulation_share', 0.8, 'reply_days', 3))
on conflict (key) do nothing;

-- ── Союзы ──
alter table public.diplo_unions drop constraint if exists diplo_unions_kind_check;
alter table public.diplo_unions add constraint diplo_unions_kind_check check (kind in ('federation','confederation','alliance'));

create or replace function public.v1_union_create(p_kind text, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := v1_my_faction(); u uuid; nm text := btrim(coalesce(p_name, ''));
begin
  if me is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(me, 'diplomacy') then raise exception 'not_allowed'; end if;
  if p_kind not in ('alliance','confederation','federation') then raise exception 'bad_union'; end if;
  if length(nm) < 3 or length(nm) > 60 then raise exception 'union_name'; end if;
  if exists (select 1 from diplo_members where fid = me) then raise exception 'union_member'; end if;
  insert into diplo_unions(kind, name, leader_fid, status) values (p_kind, nm, me, 'approved') returning id into u;
  insert into diplo_members(union_id, fid, owner_id) values (u, me, (select owner_id from faction_economy where faction_id = me));
  perform v1_bulletin('Новый союз: «' || nm || '»', format('%s основывает %s «%s».', v1_fname(me),
    case p_kind when 'alliance' then 'альянс' when 'confederation' then 'конфедерацию' else 'федерацию' end, nm), jsonb_build_array(me));
  return jsonb_build_object('ok', true, 'union_id', u);
end $$;

create or replace function public.v1_union_invite(p_target text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := v1_my_faction(); u diplo_unions;
begin
  if me is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(me, 'diplomacy') then raise exception 'not_allowed'; end if;
  select * into u from diplo_unions where leader_fid = me and status = 'approved' limit 1;
  if u.id is null then raise exception 'union_not_leader'; end if;
  if not v1_is_active_faction(p_target) or p_target = me then raise exception 'faction_unknown'; end if;
  if exists (select 1 from diplo_members where fid = p_target) then raise exception 'union_target_member'; end if;
  if v1_at_war(me, p_target) then raise exception 'war_exists'; end if;
  if exists (select 1 from diplo_invites where union_id = u.id and fid = p_target and status = 'pending') then raise exception 'note_pending'; end if;
  insert into diplo_invites(union_id, fid, owner_id, status) values (u.id, p_target, (select owner_id from faction_economy where faction_id = p_target), 'pending');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.v1_union_respond(p_invite uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := v1_my_faction(); i diplo_invites; u diplo_unions;
begin
  if me is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(me, 'diplomacy') then raise exception 'not_allowed'; end if;
  select * into i from diplo_invites where id = p_invite for update;
  if i.id is null or i.fid <> me then raise exception 'note_foreign'; end if;
  if i.status <> 'pending' then raise exception 'note_done'; end if;
  select * into u from diplo_unions where id = i.union_id;
  if not coalesce(p_accept, false) or u.id is null then
    update diplo_invites set status = 'declined' where id = p_invite;
    return jsonb_build_object('ok', true, 'joined', false);
  end if;
  if exists (select 1 from diplo_members where fid = me) then raise exception 'union_member'; end if;
  update diplo_invites set status = 'accepted' where id = p_invite;
  insert into diplo_members(union_id, fid, owner_id) values (u.id, me, (select owner_id from faction_economy where faction_id = me));
  perform v1_bulletin('Союз «' || u.name || '» растёт', format('%s вступает в «%s».', v1_fname(me), u.name), jsonb_build_array(me, u.leader_fid));
  return jsonb_build_object('ok', true, 'joined', true);
end $$;

create or replace function public.v1_union_leave() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := v1_my_faction(); u diplo_unions; nxt text;
begin
  if me is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(me, 'diplomacy') then raise exception 'not_allowed'; end if;
  select un.* into u from diplo_unions un join diplo_members m on m.union_id = un.id where m.fid = me limit 1;
  if u.id is null then raise exception 'union_none'; end if;
  delete from diplo_members where union_id = u.id and fid = me;
  if u.leader_fid = me then
    select fid into nxt from diplo_members where union_id = u.id order by joined_at limit 1;
    if nxt is null then delete from diplo_invites where union_id = u.id; delete from diplo_unions where id = u.id;
    else update diplo_unions set leader_fid = nxt where id = u.id; end if;
  end if;
  perform v1_bulletin('Выход из союза', format('%s покидает «%s».', v1_fname(me), u.name), jsonb_build_array(me));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.v1_union_kick(p_target text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := v1_my_faction(); u diplo_unions;
begin
  if me is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(me, 'diplomacy') then raise exception 'not_allowed'; end if;
  select * into u from diplo_unions where leader_fid = me limit 1;
  if u.id is null then raise exception 'union_not_leader'; end if;
  if p_target = me then raise exception 'bad_target'; end if;
  delete from diplo_members where union_id = u.id and fid = p_target;
  if not found then raise exception 'union_none'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- ── Вассалы ──
create or replace function public.v1_vassal_propose(p_target text, p_tribute numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := v1_my_faction();
begin
  if me is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(me, 'diplomacy') then raise exception 'not_allowed'; end if;
  if p_target = me or not v1_is_active_faction(p_target) then raise exception 'faction_unknown'; end if;
  if p_tribute is null or p_tribute < 0 or p_tribute > 0.3 then raise exception 'bad_tribute'; end if;
  if exists (select 1 from diplo_vassals where vassal_fid = p_target and status in ('pending','active')) then raise exception 'vassal_taken'; end if;
  if exists (select 1 from diplo_vassals where vassal_fid = me and status = 'active') then raise exception 'vassal_self'; end if;
  insert into diplo_vassals(overlord_fid, vassal_fid, overlord_owner, vassal_owner, tribute_pct, status)
  values (me, p_target, (select owner_id from faction_economy where faction_id = me), (select owner_id from faction_economy where faction_id = p_target), round(p_tribute, 2), 'pending');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.v1_vassal_respond(p_id uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := v1_my_faction(); v diplo_vassals;
begin
  if me is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(me, 'diplomacy') then raise exception 'not_allowed'; end if;
  select * into v from diplo_vassals where id = p_id for update;
  if v.id is null or v.vassal_fid <> me then raise exception 'note_foreign'; end if;
  if v.status <> 'pending' then raise exception 'note_done'; end if;
  update diplo_vassals set status = case when coalesce(p_accept, false) then 'active' else 'declined' end where id = p_id;
  if coalesce(p_accept, false) then
    perform v1_bulletin('Вассальная присяга', format('%s признаёт сюзеренитет державы %s (дань %s %%).', v1_fname(me), v1_fname(v.overlord_fid), round(v.tribute_pct * 100)),
      jsonb_build_array(me, v.overlord_fid));
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Сюзерен отпускает вассала; вассал объявляет независимость (с ухудшением отношений)
create or replace function public.v1_vassal_end(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := v1_my_faction(); v diplo_vassals;
begin
  if me is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(me, 'diplomacy') then raise exception 'not_allowed'; end if;
  select * into v from diplo_vassals where id = p_id for update;
  if v.id is null or me not in (v.overlord_fid, v.vassal_fid) then raise exception 'note_foreign'; end if;
  if v.status not in ('active','pending') then raise exception 'note_done'; end if;
  update diplo_vassals set status = 'broken' where id = p_id;
  if v.status = 'active' and me = v.vassal_fid then
    perform v1_rel_add(v.overlord_fid, me, -30);
    perform v1_bulletin('Независимость: ' || v1_fname(me), format('%s разрывает вассальную присягу державе %s.', v1_fname(me), v1_fname(v.overlord_fid)),
      jsonb_build_array(me, v.overlord_fid));
  elsif v.status = 'active' then
    perform v1_bulletin('Вассал отпущен', format('%s освобождает державу %s от вассальной присяги.', v1_fname(me), v1_fname(v.vassal_fid)),
      jsonb_build_array(me, v.vassal_fid));
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ── Младшая уния ──
create or replace function public.v1_junior_propose(p_target text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := v1_my_faction();
begin
  if me is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(me, 'diplomacy') then raise exception 'not_allowed'; end if;
  if p_target = me or not v1_is_active_faction(p_target) then raise exception 'faction_unknown'; end if;
  if v1_union_senior(me) is not null then raise exception 'union_junior'; end if;
  if exists (select 1 from state_unions where status in ('pending','active') and (partner_fid = p_target or lead_fid = p_target)) then raise exception 'union_taken'; end if;
  insert into state_unions(lead_fid, partner_fid, status, initiator_fid) values (me, p_target, 'pending', me);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.v1_junior_respond(p_id uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := v1_my_faction(); s state_unions;
begin
  if me is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(me, 'diplomacy') then raise exception 'not_allowed'; end if;
  select * into s from state_unions where id = p_id for update;
  if s.id is null or s.partner_fid <> me then raise exception 'note_foreign'; end if;
  if s.status <> 'pending' then raise exception 'note_done'; end if;
  update state_unions set status = case when coalesce(p_accept, false) then 'active' else 'declined' end,
         sealed_at = case when coalesce(p_accept, false) then now() end where id = p_id;
  if coalesce(p_accept, false) then
    perform v1_bulletin('Младшая уния', format('%s и %s заключают унию: внешнюю политику обеих держав ведёт %s.', v1_fname(s.lead_fid), v1_fname(me), v1_fname(s.lead_fid)),
      jsonb_build_array(me, s.lead_fid));
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.v1_junior_end(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := v1_my_faction(); s state_unions;
begin
  if me is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(me, 'diplomacy') then raise exception 'not_allowed'; end if;
  select * into s from state_unions where id = p_id for update;
  if s.id is null or me not in (s.lead_fid, s.partner_fid) then raise exception 'note_foreign'; end if;
  if s.status not in ('pending','active') then raise exception 'note_done'; end if;
  update state_unions set status = 'dissolved' where id = p_id;
  if s.status = 'active' then
    perform v1_bulletin('Уния распущена', format('Уния %s и %s распущена.', v1_fname(s.lead_fid), v1_fname(s.partner_fid)), jsonb_build_array(s.lead_fid, s.partner_fid));
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ── Объединение держав (старшая уния) ──
create table if not exists public.v1_merge_requests (
  id uuid primary key default gen_random_uuid(),
  lead_fid text not null,
  minor_fid text not null,
  status text not null default 'proposed' check (status in ('proposed','agreed','approved','declined','cancelled')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid
);
alter table public.v1_merge_requests enable row level security;
drop policy if exists v1_merge_read on public.v1_merge_requests;
create policy v1_merge_read on public.v1_merge_requests for select using (true);

create or replace function public.v1_merge_propose(p_target text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := v1_my_faction();
begin
  if me is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(me, 'diplomacy') then raise exception 'not_allowed'; end if;
  if p_target = me or not v1_is_active_faction(p_target) then raise exception 'faction_unknown'; end if;
  if exists (select 1 from v1_merge_requests where status in ('proposed','agreed') and (minor_fid in (me, p_target) or lead_fid in (me, p_target))) then raise exception 'merge_pending'; end if;
  insert into v1_merge_requests(lead_fid, minor_fid) values (me, p_target);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.v1_merge_respond(p_id uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := v1_my_faction(); m v1_merge_requests;
begin
  if me is null then raise exception 'no_faction'; end if;
  select * into m from v1_merge_requests where id = p_id for update;
  if m.id is null then raise exception 'note_foreign'; end if;
  -- отменить может любая сторона, пока команда проекта не утвердила
  if not coalesce(p_accept, false) then
    if me not in (m.lead_fid, m.minor_fid) then raise exception 'note_foreign'; end if;
    if m.status not in ('proposed','agreed') then raise exception 'note_done'; end if;
    update v1_merge_requests set status = case when me = m.minor_fid and m.status = 'proposed' then 'declined' else 'cancelled' end, decided_at = now() where id = p_id;
    return jsonb_build_object('ok', true);
  end if;
  if me <> m.minor_fid or not v1_can_manage(me, 'diplomacy') then raise exception 'note_foreign'; end if;
  if m.status <> 'proposed' then raise exception 'note_done'; end if;
  update v1_merge_requests set status = 'agreed', decided_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'status', 'agreed');
end $$;

-- Действия команды проекта: утвердить или отклонить объединение
create or replace function public.v1_x_diplo(p_action text, p_target text, p_payload jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare m v1_merge_requests; moved jsonb; minor_owner uuid;
begin
  if p_action not in ('diplo.merge_approve','diplo.merge_decline') then raise exception 'unknown_action: %', p_action; end if;
  select * into m from v1_merge_requests where id = p_target::uuid for update;
  if m.id is null or m.status <> 'agreed' then raise exception 'merge_not_ready'; end if;
  if p_action = 'diplo.merge_decline' then
    update v1_merge_requests set status = 'declined', decided_at = now(), decided_by = auth.uid() where id = m.id;
    return 1;
  end if;
  select owner_id into minor_owner from faction_economy where faction_id = m.minor_fid;
  moved := v1_merge_faction(m.lead_fid, m.minor_fid);
  update faction_applications set status = 'merged', updated_at = now() where faction_id = m.minor_fid and status = 'approved';
  -- правитель младшей державы становится соправителем старшей
  if minor_owner is not null and not exists (select 1 from faction_members where faction_id = m.lead_fid and user_id = minor_owner and status = 'active') then
    insert into faction_members(faction_id, user_id, status, role, perms, scope_all, scope)
    values (m.lead_fid, minor_owner, 'active', 'coruler', '[]'::jsonb, true, '{"armies":[],"fleets":[],"systems":[]}'::jsonb);
  end if;
  update diplo_vassals set status = 'broken' where status in ('pending','active') and (vassal_fid = m.minor_fid or overlord_fid = m.minor_fid);
  update state_unions set status = 'dissolved' where status in ('pending','active') and (lead_fid = m.minor_fid or partner_fid = m.minor_fid);
  delete from diplo_members where fid = m.minor_fid;
  update v1_merge_requests set status = 'approved', decided_at = now(), decided_by = auth.uid() where id = m.id;
  perform v1_bulletin('Объединение держав', format('%s входит в состав державы %s. Систем: %s, колоний: %s.', v1_fname(m.minor_fid), v1_fname(m.lead_fid), moved->>'systems', moved->>'colonies'),
    jsonb_build_array(m.lead_fid, m.minor_fid));
  return 1;
end $$;
insert into public.v1_action_policy(action, label, mode) values
  ('diplo.merge_approve', 'Утвердить объединение держав', 'superadmin'),
  ('diplo.merge_decline', 'Отклонить объединение держав', 'free')
on conflict (action) do nothing;

-- ── Кредиты ──
create table if not exists public.v1_loans (
  id uuid primary key default gen_random_uuid(),
  lender_fid text not null,
  borrower_fid text not null,
  amount numeric not null check (amount > 0),
  interest_pct numeric not null default 0 check (interest_pct between 0 and 0.3),
  days int not null check (days between 7 and 60),
  note text,
  status text not null default 'offered' check (status in ('offered','active','repaid','defaulted','forgiven','declined','cancelled')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  total_due numeric,
  paid numeric not null default 0,
  next_due_at timestamptz,
  overdue_since timestamptz
);
create index if not exists v1_loans_due on public.v1_loans(status, next_due_at);
alter table public.v1_loans enable row level security;
drop policy if exists v1_loans_read on public.v1_loans;
create policy v1_loans_read on public.v1_loans for select using (
  v1_is_staff() or lender_fid = v1_my_faction() or borrower_fid = v1_my_faction());

create or replace function public.v1_loan_offer(p_to text, p_amount numeric, p_pct numeric, p_days int, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := v1_my_faction(); id uuid;
begin
  if me is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(me, 'diplomacy') then raise exception 'not_allowed'; end if;
  if p_to = me or not v1_is_active_faction(p_to) then raise exception 'faction_unknown'; end if;
  if p_amount is null or p_amount < 1000 then raise exception 'loan_amount'; end if;
  if p_pct is null or p_pct < 0 or p_pct > 0.3 then raise exception 'loan_pct'; end if;
  if p_days is null or p_days < 7 or p_days > 60 then raise exception 'loan_days'; end if;
  if (select gc from faction_economy where faction_id = me) < p_amount then raise exception 'not_enough_gc'; end if;
  insert into v1_loans(lender_fid, borrower_fid, amount, interest_pct, days, note)
  values (me, p_to, round(p_amount), round(p_pct, 3), p_days, nullif(left(btrim(coalesce(p_note, '')), 300), '')) returning v1_loans.id into id;
  return jsonb_build_object('ok', true, 'loan_id', id);
end $$;

create or replace function public.v1_loan_respond(p_id uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := v1_my_faction(); l v1_loans;
begin
  if me is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(me, 'diplomacy') then raise exception 'not_allowed'; end if;
  select * into l from v1_loans where id = p_id for update;
  if l.id is null or l.borrower_fid <> me then raise exception 'note_foreign'; end if;
  if l.status <> 'offered' then raise exception 'note_done'; end if;
  if not coalesce(p_accept, false) then
    update v1_loans set status = 'declined' where id = p_id;
    return jsonb_build_object('ok', true, 'accepted', false);
  end if;
  update faction_economy set gc = gc - l.amount where faction_id = l.lender_fid and gc >= l.amount;
  if not found then raise exception 'loan_lender_poor'; end if;
  update faction_economy set gc = gc + l.amount where faction_id = me;
  update v1_loans set status = 'active', accepted_at = now(), total_due = round(l.amount * (1 + l.interest_pct)),
         next_due_at = now() + interval '1 day' where id = p_id;
  perform v1_rel_add(me, l.lender_fid, 5);
  return jsonb_build_object('ok', true, 'accepted', true);
end $$;

create or replace function public.v1_loan_cancel(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := v1_my_faction();
begin
  update v1_loans set status = 'cancelled' where id = p_id and lender_fid = me and status = 'offered';
  if not found then raise exception 'note_foreign'; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.v1_loan_forgive(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := v1_my_faction(); l v1_loans;
begin
  if me is null or not v1_can_manage(me, 'diplomacy') then raise exception 'not_allowed'; end if;
  select * into l from v1_loans where id = p_id for update;
  if l.id is null or l.lender_fid <> me then raise exception 'note_foreign'; end if;
  if l.status not in ('active','defaulted') then raise exception 'note_done'; end if;
  update v1_loans set status = 'forgiven' where id = p_id;
  perform v1_rel_add(l.borrower_fid, me, 15);
  perform v1_bulletin('Долг прощён', format('%s прощает державе %s долг: %s ГС.', v1_fname(me), v1_fname(l.borrower_fid), round(l.total_due - l.paid)),
    jsonb_build_array(me, l.borrower_fid));
  return jsonb_build_object('ok', true);
end $$;

-- Погасить остаток досрочно
create or replace function public.v1_loan_repay(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := v1_my_faction(); l v1_loans; rest numeric;
begin
  if me is null or not v1_can_manage(me, 'diplomacy') then raise exception 'not_allowed'; end if;
  select * into l from v1_loans where id = p_id for update;
  if l.id is null or l.borrower_fid <> me then raise exception 'note_foreign'; end if;
  if l.status not in ('active','defaulted') then raise exception 'note_done'; end if;
  rest := l.total_due - l.paid;
  update faction_economy set gc = gc - rest where faction_id = me and gc >= rest;
  if not found then raise exception 'not_enough_gc'; end if;
  update faction_economy set gc = gc + rest where faction_id = l.lender_fid;
  update v1_loans set paid = total_due, status = 'repaid', overdue_since = null where id = p_id;
  perform v1_rel_add(l.lender_fid, me, 5);
  return jsonb_build_object('ok', true, 'paid', rest);
end $$;

-- ── Межгалактическое сообщество ──
create table if not exists public.v1_council_reps (
  faction_id text primary key,
  name text not null,
  portrait_url text,
  appointed_at timestamptz not null default now()
);
alter table public.v1_council_reps enable row level security;
drop policy if exists v1_council_reps_read on public.v1_council_reps;
create policy v1_council_reps_read on public.v1_council_reps for select using (true);

create table if not exists public.v1_council_res (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('condemn_war','support_side','apology','ceasefire','sanctions','recognize')),
  author_fid text not null,
  target_fid text,
  war_id uuid,
  side text,
  text text,
  status text not null default 'open' check (status in ('open','passed','failed','answered')),
  created_at timestamptz not null default now(),
  closes_at timestamptz not null default now() + interval '48 hours',
  result jsonb,
  offer_id uuid,
  answer text,
  answer_deadline timestamptz
);
create index if not exists v1_council_res_status on public.v1_council_res(status, closes_at);
alter table public.v1_council_res enable row level security;
drop policy if exists v1_council_res_read on public.v1_council_res;
create policy v1_council_res_read on public.v1_council_res for select using (true);

create table if not exists public.v1_council_votes (
  res_id uuid not null references public.v1_council_res(id) on delete cascade,
  fid text not null,
  vote text not null check (vote in ('yes','no','abstain')),
  voted_at timestamptz not null default now(),
  primary key (res_id, fid)
);
alter table public.v1_council_votes enable row level security;
drop policy if exists v1_council_votes_read on public.v1_council_votes;
create policy v1_council_votes_read on public.v1_council_votes for select using (true);

create table if not exists public.v1_sanctions (
  id uuid primary key default gen_random_uuid(),
  target_fid text not null,
  res_id uuid,
  voters jsonb not null default '[]'::jsonb,
  until timestamptz not null
);
alter table public.v1_sanctions enable row level security;
drop policy if exists v1_sanctions_read on public.v1_sanctions;
create policy v1_sanctions_read on public.v1_sanctions for select using (true);

insert into public.v1_settings(key, value) values ('council', jsonb_build_object(
  'vote_hours', 48, 'min_votes', 3, 'cooldown_hours', 72, 'apology_days', 3, 'apology_share', 0.05,
  'condemn_rel', -15, 'condemn_order', -10, 'condemn_days', 7, 'support_order', 10, 'support_days', 5,
  'apology_refuse_rel', -20, 'ceasefire_refuse_rel', -10, 'sanction_days', 7, 'recognize_rel', 10))
on conflict (key) do nothing;

create or replace function public.v1_council_appoint(p_name text, p_portrait text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := v1_my_faction(); nm text := btrim(coalesce(p_name, ''));
begin
  if me is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(me, 'diplomacy') then raise exception 'not_allowed'; end if;
  if length(nm) < 2 or length(nm) > 60 then raise exception 'rep_name'; end if;
  if v1_name_problem(nm, auth.uid()) is not null then raise exception 'name_rejected: %', v1_name_problem(nm, auth.uid()); end if;
  if p_portrait is not null and p_portrait !~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/v1-media/' then raise exception 'bad_avatar'; end if;
  insert into v1_council_reps(faction_id, name, portrait_url, appointed_at) values (me, nm, p_portrait, now())
  on conflict (faction_id) do update set name = excluded.name, portrait_url = excluded.portrait_url, appointed_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.v1_council_propose(p_kind text, p_target text, p_war uuid, p_side text, p_text text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := v1_my_faction(); cfg jsonb := coalesce((select value from v1_settings where key = 'council'), '{}'::jsonb); w wars; id uuid;
begin
  if me is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(me, 'diplomacy') then raise exception 'not_allowed'; end if;
  if not exists (select 1 from v1_council_reps where faction_id = me) then raise exception 'rep_missing'; end if;
  if exists (select 1 from v1_council_res where author_fid = me and created_at > now() - make_interval(hours => coalesce((cfg->>'cooldown_hours')::int, 72))) then
    raise exception 'council_cooldown';
  end if;
  if p_kind in ('condemn_war','support_side','ceasefire') then
    select * into w from wars where id = p_war;
    if w.id is null or w.status <> 'active' then raise exception 'war_over'; end if;
    if p_kind = 'condemn_war' then p_target := w.attacker_fid; end if;
    if p_kind = 'support_side' then
      if p_side not in ('attacker','defender') then raise exception 'bad_side'; end if;
      p_target := case p_side when 'attacker' then w.attacker_fid else w.defender_fid end;
    end if;
    if p_kind = 'ceasefire' then p_target := w.defender_fid; end if;
  elsif p_kind in ('apology','sanctions','recognize') then
    if p_target is null or not v1_is_active_faction(p_target) then raise exception 'faction_unknown'; end if;
    if p_kind = 'apology' and p_target = me then raise exception 'bad_target'; end if;
  else
    raise exception 'bad_resolution';
  end if;
  if exists (select 1 from v1_council_res where status = 'open' and kind = p_kind and coalesce(target_fid, '') = coalesce(p_target, '') and coalesce(war_id::text, '') = coalesce(p_war::text, '')) then
    raise exception 'council_duplicate';
  end if;
  insert into v1_council_res(kind, author_fid, target_fid, war_id, side, text, closes_at)
  values (p_kind, me, p_target, case when p_kind in ('condemn_war','support_side','ceasefire') then p_war end, p_side,
          nullif(left(btrim(coalesce(p_text, '')), 1000), ''), now() + make_interval(hours => coalesce((cfg->>'vote_hours')::int, 48)))
  returning v1_council_res.id into id;
  insert into v1_council_votes(res_id, fid, vote) values (id, me, 'yes');
  perform v1_bulletin('Межгалактическое сообщество: новая резолюция',
    format('Представитель державы %s выносит резолюцию «%s»%s. Голосование открыто 48 часов.', v1_fname(me),
      case p_kind when 'condemn_war' then 'Осудить войну' when 'support_side' then 'Поддержать сторону войны' when 'apology' then 'Потребовать извинений'
                  when 'ceasefire' then 'Призвать к перемирию' when 'sanctions' then 'Ввести санкции' else 'Признать державу' end,
      case when p_target is not null then ' в отношении державы ' || v1_fname(p_target) else '' end),
    jsonb_build_array(me) || case when p_target is not null then jsonb_build_array(p_target) else '[]'::jsonb end);
  return jsonb_build_object('ok', true, 'res_id', id);
end $$;

create or replace function public.v1_council_vote(p_res uuid, p_vote text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := v1_my_faction(); r v1_council_res;
begin
  if me is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(me, 'diplomacy') then raise exception 'not_allowed'; end if;
  if not exists (select 1 from v1_council_reps where faction_id = me) then raise exception 'rep_missing'; end if;
  if p_vote not in ('yes','no','abstain') then raise exception 'bad_vote'; end if;
  select * into r from v1_council_res where id = p_res;
  if r.id is null or r.status <> 'open' or r.closes_at < now() then raise exception 'council_closed'; end if;
  insert into v1_council_votes(res_id, fid, vote) values (p_res, me, p_vote)
  on conflict (res_id, fid) do update set vote = excluded.vote, voted_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- Ответ на требование извинений
create or replace function public.v1_council_answer(p_res uuid, p_apologize boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := v1_my_faction(); r v1_council_res; cfg jsonb := coalesce((select value from v1_settings where key = 'council'), '{}'::jsonb);
  pay numeric; v record;
begin
  if me is null then raise exception 'no_faction'; end if;
  if not v1_can_manage(me, 'diplomacy') then raise exception 'not_allowed'; end if;
  select * into r from v1_council_res where id = p_res for update;
  if r.id is null or r.kind <> 'apology' or r.target_fid <> me then raise exception 'note_foreign'; end if;
  if r.status <> 'passed' or r.answer is not null then raise exception 'note_done'; end if;
  if coalesce(p_apologize, false) then
    select round(greatest(gc, 0) * coalesce((cfg->>'apology_share')::numeric, 0.05)) into pay from faction_economy where faction_id = me;
    update faction_economy set gc = gc - pay where faction_id = me;
    update faction_economy set gc = gc + pay where faction_id = r.author_fid;
    perform v1_rel_add(r.author_fid, me, 10);
    update v1_council_res set answer = 'apologized', status = 'answered', result = coalesce(result, '{}'::jsonb) || jsonb_build_object('paid', pay) where id = p_res;
    perform v1_bulletin('Извинения принесены', format('%s приносит извинения державе %s и выплачивает %s ГС.', v1_fname(me), v1_fname(r.author_fid), pay),
      jsonb_build_array(me, r.author_fid));
  else
    for v in select fid from v1_council_votes where res_id = p_res and vote = 'yes' loop
      perform v1_rel_add(v.fid, me, coalesce((cfg->>'apology_refuse_rel')::int, -20));
    end loop;
    update v1_council_res set answer = 'refused', status = 'answered' where id = p_res;
    perform v1_bulletin('Отказ в извинениях', format('%s отказывается извиняться перед державой %s вопреки решению Сообщества.', v1_fname(me), v1_fname(r.author_fid)),
      jsonb_build_array(me, r.author_fid));
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Подвести итог резолюции и применить последствия
create or replace function public.v1_council_close(p_res uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r v1_council_res; cfg jsonb := coalesce((select value from v1_settings where key = 'council'), '{}'::jsonb);
  y int; n int; a int; passed boolean; v record; w wars; oid uuid; voters jsonb;
begin
  select * into r from v1_council_res where id = p_res for update;
  if r.id is null or r.status <> 'open' then return; end if;
  select count(*) filter (where vote = 'yes'), count(*) filter (where vote = 'no'), count(*) filter (where vote = 'abstain')
    into y, n, a from v1_council_votes where res_id = p_res;
  passed := (y + n + a) >= coalesce((cfg->>'min_votes')::int, 3) and y * 2 > (y + n + a);
  select coalesce(jsonb_agg(fid), '[]'::jsonb) into voters from v1_council_votes where res_id = p_res and vote = 'yes';
  update v1_council_res set status = case when passed then 'passed' else 'failed' end,
         result = jsonb_build_object('yes', y, 'no', n, 'abstain', a) where id = p_res;
  if not passed then
    perform v1_bulletin('Сообщество: резолюция отклонена', format('Резолюция в отношении державы %s не набрала голосов: за %s, против %s, воздержались %s.',
      coalesce(v1_fname(r.target_fid), '—'), y, n, a), jsonb_build_array(r.author_fid));
    return;
  end if;
  if r.kind = 'condemn_war' then
    for v in select fid from v1_council_votes where res_id = p_res and vote = 'yes' loop
      perform v1_rel_add(v.fid, r.target_fid, coalesce((cfg->>'condemn_rel')::int, -15));
    end loop;
    insert into v1_order_mods(faction_id, amount, source, until)
    values (r.target_fid, coalesce((cfg->>'condemn_order')::int, -10), 'Война осуждена Сообществом', now() + make_interval(days => coalesce((cfg->>'condemn_days')::int, 7)));
  elsif r.kind = 'support_side' then
    insert into v1_order_mods(faction_id, amount, source, until)
    select fid, coalesce((cfg->>'support_order')::int, 10), 'Поддержка Сообщества', now() + make_interval(days => coalesce((cfg->>'support_days')::int, 5))
      from war_sides where war_id = r.war_id and side = r.side;
  elsif r.kind = 'apology' then
    update v1_council_res set answer_deadline = now() + make_interval(days => coalesce((cfg->>'apology_days')::int, 3)) where id = p_res;
  elsif r.kind = 'ceasefire' then
    select * into w from wars where id = r.war_id;
    if w.status = 'active' then
      insert into war_offers(war_id, from_fid, to_fid, kind, message, expires_at)
      values (w.id, w.attacker_fid, w.defender_fid, 'status_quo', 'Перемирие по призыву Межгалактического сообщества', now() + interval '3 days')
      returning id into oid;
      update v1_council_res set offer_id = oid where id = p_res;
    end if;
  elsif r.kind = 'sanctions' then
    insert into v1_sanctions(target_fid, res_id, voters, until) values (r.target_fid, p_res, voters, now() + make_interval(days => coalesce((cfg->>'sanction_days')::int, 7)));
  elsif r.kind = 'recognize' then
    for v in select fid from v1_council_votes where res_id = p_res and vote = 'yes' loop
      perform v1_rel_add(v.fid, r.target_fid, coalesce((cfg->>'recognize_rel')::int, 10));
    end loop;
  end if;
  perform v1_bulletin('Сообщество: резолюция принята',
    format('Межгалактическое сообщество принимает резолюцию «%s» в отношении державы %s: за %s, против %s, воздержались %s.',
      case r.kind when 'condemn_war' then 'Осудить войну' when 'support_side' then 'Поддержать сторону войны' when 'apology' then 'Потребовать извинений'
                  when 'ceasefire' then 'Призвать к перемирию' when 'sanctions' then 'Ввести санкции' else 'Признать державу' end,
      v1_fname(r.target_fid), y, n, a),
    jsonb_build_array(r.author_fid, r.target_fid));
end $$;

-- ── Часовой тик дипломатии ──
create or replace function public.v1_diplo_tick() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; l v1_loans; part numeric; n_res int := 0; n_pay int := 0; cfg jsonb := coalesce((select value from v1_settings where key = 'council'), '{}'::jsonb);
begin
  for r in select id from v1_council_res where status = 'open' and closes_at <= now() loop
    perform v1_council_close(r.id); n_res := n_res + 1;
  end loop;
  -- молчание на требование извинений = отказ
  for r in select id, target_fid, author_fid from v1_council_res where kind = 'apology' and status = 'passed' and answer is null and answer_deadline <= now() loop
    perform v1_rel_add(v.fid, r.target_fid, coalesce((cfg->>'apology_refuse_rel')::int, -20)) from v1_council_votes v where v.res_id = r.id and v.vote = 'yes';
    update v1_council_res set answer = 'silence', status = 'answered' where id = r.id;
  end loop;
  -- кредитные предложения живут 7 дней
  update v1_loans set status = 'cancelled' where status = 'offered' and created_at < now() - interval '7 days';
  -- платежи по кредитам: раз в сутки (сумма с процентом) / срок
  for l in select * from v1_loans where status in ('active','defaulted') and next_due_at <= now() for update skip locked loop
    part := least(l.total_due - l.paid, ceil(l.total_due / l.days));
    update faction_economy set gc = gc - part where faction_id = l.borrower_fid and gc >= part;
    if found then
      update faction_economy set gc = gc + part where faction_id = l.lender_fid;
      update v1_loans set paid = paid + part, next_due_at = next_due_at + interval '1 day', overdue_since = null,
             status = case when paid + part >= total_due then 'repaid' else 'active' end where id = l.id;
      n_pay := n_pay + 1;
    else
      update v1_loans set overdue_since = coalesce(overdue_since, now()), next_due_at = next_due_at + interval '1 day' where id = l.id;
      if l.overdue_since is not null and l.overdue_since < now() - interval '3 days' and l.status = 'active' then
        update v1_loans set status = 'defaulted' where id = l.id;
        perform v1_rel_add(l.lender_fid, l.borrower_fid, -20);
        perform v1_bulletin('Дефолт по кредиту', format('%s не платит по долгу державе %s. У кредитора есть повод к войне.', v1_fname(l.borrower_fid), v1_fname(l.lender_fid)),
          jsonb_build_array(l.lender_fid, l.borrower_fid));
      end if;
    end if;
  end loop;
  return jsonb_build_object('resolutions', n_res, 'payments', n_pay);
end $$;

-- ── Сводка для страницы «Внешняя политика» ──
create or replace function public.v1_outer_state() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me text := v1_my_faction(); cfg jsonb := coalesce((select value from v1_settings where key = 'war'), '{}'::jsonb);
begin
  if me is null then raise exception 'no_faction'; end if;
  return jsonb_build_object(
    'me', me,
    'can_manage', v1_can_manage(me, 'diplomacy'),
    'gc', (select gc from faction_economy where faction_id = me),
    'cap_share', coalesce((cfg->>'capitulation_share')::numeric, 0.8),
    'senior', v1_union_senior(me),
    'factions', coalesce((select jsonb_agg(jsonb_build_object('id', a.faction_id, 'name', a.name, 'color', a.color, 'herald_url', a.herald_url,
        'rel', (select score from faction_relations where from_fid = me and to_fid = a.faction_id),
        'their_rel', (select score from faction_relations where from_fid = a.faction_id and to_fid = me),
        'systems', (select count(*) from map_systems where faction = a.faction_id),
        'at_war', v1_at_war(me, a.faction_id)) order by a.name)
      from faction_applications a where a.status = 'approved' and a.faction_id is not null and a.faction_id <> me), '[]'::jsonb),
    'wars', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'attacker', w.attacker_fid, 'defender', w.defender_fid, 'cause', w.cause,
        'status', w.status, 'started_at', w.started_at, 'ended_at', w.ended_at, 'note', w.outcome_note, 'my_side', s.side,
        'leader', me in (w.attacker_fid, w.defender_fid),
        'sides', (select jsonb_agg(jsonb_build_object('fid', x.fid, 'side', x.side)) from war_sides x where x.war_id = w.id),
        'held', v1_war_share(me, case when s.side = 'attacker' then w.defender_fid else w.attacker_fid end),
        'lost', v1_war_share(case when s.side = 'attacker' then w.defender_fid else w.attacker_fid end, me),
        'foe_systems', (select count(*) from map_systems where faction = case when s.side = 'attacker' then w.defender_fid else w.attacker_fid end),
        'offers', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'kind', o.kind, 'from', o.from_fid, 'to', o.to_fid, 'message', o.message,
                     'status', o.status, 'expires_at', o.expires_at, 'created_at', o.created_at) order by o.created_at desc), '[]'::jsonb)
                   from war_offers o where o.war_id = w.id and (o.from_fid = me or o.to_fid = me) and (o.status = 'pending' or o.resolved_at > now() - interval '7 days')))
        order by w.status = 'active' desc, w.started_at desc)
      from wars w join war_sides s on s.war_id = w.id and s.fid = me where w.status = 'active' or w.ended_at > now() - interval '30 days'), '[]'::jsonb),
    'calls', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'war', o.war_id, 'from', o.from_fid, 'message', o.message, 'expires_at', o.expires_at,
        'attacker', w.attacker_fid, 'defender', w.defender_fid))
      from war_offers o join wars w on w.id = o.war_id where o.to_fid = me and o.kind = 'call_ally' and o.status = 'pending'), '[]'::jsonb),
    'union', (select jsonb_build_object('id', u.id, 'kind', u.kind, 'name', u.name, 'leader', u.leader_fid,
        'members', (select jsonb_agg(m.fid order by m.joined_at) from diplo_members m where m.union_id = u.id),
        'invited', (select coalesce(jsonb_agg(i.fid), '[]'::jsonb) from diplo_invites i where i.union_id = u.id and i.status = 'pending'))
      from diplo_unions u join diplo_members m on m.union_id = u.id and m.fid = me limit 1),
    'union_invites', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'union', u.name, 'kind', u.kind, 'leader', u.leader_fid))
      from diplo_invites i join diplo_unions u on u.id = i.union_id where i.fid = me and i.status = 'pending'), '[]'::jsonb),
    'unions_all', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'kind', u.kind, 'name', u.name, 'leader', u.leader_fid,
        'members', (select jsonb_agg(m.fid) from diplo_members m where m.union_id = u.id)))
      from diplo_unions u where u.status = 'approved'), '[]'::jsonb),
    'vassals', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'overlord', v.overlord_fid, 'vassal', v.vassal_fid, 'tribute', v.tribute_pct,
        'status', v.status, 'created_at', v.created_at) order by v.created_at desc)
      from diplo_vassals v where (v.overlord_fid = me or v.vassal_fid = me) and v.status in ('pending','active')), '[]'::jsonb),
    'juniors', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'lead', s.lead_fid, 'partner', s.partner_fid, 'status', s.status))
      from state_unions s where (s.lead_fid = me or s.partner_fid = me) and s.status in ('pending','active')), '[]'::jsonb),
    'merges', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'lead', m.lead_fid, 'minor', m.minor_fid, 'status', m.status, 'created_at', m.created_at))
      from v1_merge_requests m where (m.lead_fid = me or m.minor_fid = me) and m.status in ('proposed','agreed')), '[]'::jsonb),
    'loans', coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at desc) from v1_loans l
      where (l.lender_fid = me or l.borrower_fid = me) and (l.status in ('offered','active','defaulted') or l.created_at > now() - interval '30 days')), '[]'::jsonb),
    'old_loans', coalesce((select jsonb_agg(jsonb_build_object('lender', lender_name, 'borrower', borrower_name, 'amount', amount, 'status', status, 'created_at', created_at))
      from loans where lender_fid = me or borrower_fid = me), '[]'::jsonb),
    'rep', (select to_jsonb(r) from v1_council_reps r where r.faction_id = me),
    'reps', (select count(*) from v1_council_reps),
    'council', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'author', c.author_fid, 'target', c.target_fid, 'war', c.war_id,
        'side', c.side, 'text', c.text, 'status', c.status, 'created_at', c.created_at, 'closes_at', c.closes_at, 'result', c.result,
        'answer', c.answer, 'answer_deadline', c.answer_deadline,
        'my_vote', (select vote from v1_council_votes v where v.res_id = c.id and v.fid = me),
        'votes', (select jsonb_build_object('yes', count(*) filter (where vote = 'yes'), 'no', count(*) filter (where vote = 'no'), 'abstain', count(*) filter (where vote = 'abstain'))
                  from v1_council_votes v where v.res_id = c.id)) order by c.status = 'open' desc, c.created_at desc)
      from v1_council_res c where c.status = 'open' or c.created_at > now() - interval '21 days'), '[]'::jsonb),
    'council_wars', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'attacker', w.attacker_fid, 'defender', w.defender_fid, 'cause', w.cause))
      from wars w where w.status = 'active'), '[]'::jsonb),
    'sanctions', coalesce((select jsonb_agg(jsonb_build_object('target', s.target_fid, 'until', s.until)) from v1_sanctions s where s.until > now()), '[]'::jsonb));
end $$;

revoke all on function public.v1_merge_faction(text, text), public.v1_capitulate(uuid, text, text, text), public.v1_rel_add(text, text, int),
  public.v1_bulletin(text, text, jsonb), public.v1_council_close(uuid), public.v1_diplo_tick(), public.v1_war_expire(), public.v1_x_diplo(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.v1_war_declare(text, text), public.v1_war_note(uuid, text, text), public.v1_war_respond(uuid, boolean),
  public.v1_war_call(uuid, text, text), public.v1_war_join(uuid, boolean),
  public.v1_union_create(text, text), public.v1_union_invite(text), public.v1_union_respond(uuid, boolean), public.v1_union_leave(), public.v1_union_kick(text),
  public.v1_vassal_propose(text, numeric), public.v1_vassal_respond(uuid, boolean), public.v1_vassal_end(uuid),
  public.v1_junior_propose(text), public.v1_junior_respond(uuid, boolean), public.v1_junior_end(uuid),
  public.v1_merge_propose(text), public.v1_merge_respond(uuid, boolean),
  public.v1_loan_offer(text, numeric, numeric, int, text), public.v1_loan_respond(uuid, boolean), public.v1_loan_cancel(uuid),
  public.v1_loan_forgive(uuid), public.v1_loan_repay(uuid),
  public.v1_council_appoint(text, text), public.v1_council_propose(text, text, uuid, text, text), public.v1_council_vote(uuid, text),
  public.v1_council_answer(uuid, boolean), public.v1_outer_state() to authenticated;

-- Часовой тик дипломатии (итоги голосований, извинения, кредиты)
do $$ begin
  perform cron.unschedule('v1-diplo-tick') where exists (select 1 from cron.job where jobname = 'v1-diplo-tick');
  perform cron.schedule('v1-diplo-tick', '13 * * * *', 'select public.v1_diplo_tick()');
exception when others then raise notice 'cron: %', sqlerrm; end $$;
