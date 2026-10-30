-- Классическая эра 1.0 · Экономика: снятие лишнего.
--
-- Решение команды проекта (30.10.2026):
--   • финансовые инструменты сняты навсегда: маржа, фьючерсы, опционы, облигации;
--   • невольничий рынок «Синли-Бэй» закрыт, его лоты сняты;
--   • концессии убраны и не вернутся; действующие концессии расторгнуты;
--   • корпорации заморожены «на переработку»: данные целы, действия закрыты.
-- Открытые позиции возвращаются деньгами (залог маржи). Журнал выплат — v1_compensations,
-- копии снятого — v1_removed_units. Старому сайту закрыты только действия; чтение оставлено.

set lock_timeout = '15s';

do $$
declare r record; total numeric := 0; fids jsonb := '[]'::jsonb; why text := 'Финансовые инструменты сняты';
begin
  -- маржа: открытые позиции закрываются по залогу
  for r in select * from margin_positions where status not in ('closed', 'liquidated') loop
    update faction_economy set gc = gc + coalesce(r.collateral, 0) where faction_id = r.faction_id;
    insert into v1_compensations(faction_id, amount, reason, detail)
    values (r.faction_id, coalesce(r.collateral, 0), why, jsonb_build_object('margin', r.id, 'resource', r.resource));
    update margin_positions set status = 'closed', closed_at = now(), realized = 0 where id = r.id;
    total := total + coalesce(r.collateral, 0); fids := fids || to_jsonb(r.faction_id);
  end loop;
  -- фьючерсы и опционы: открытые — залог/премия назад
  for r in select * from futures_positions where status = 'open' loop
    update faction_economy set gc = gc + coalesce(r.collateral, 0) where faction_id = r.faction_id;
    insert into v1_compensations(faction_id, amount, reason, detail) values (r.faction_id, coalesce(r.collateral, 0), why, jsonb_build_object('futures', r.id));
    update futures_positions set status = 'closed', closed_at = now() where id = r.id;
    total := total + coalesce(r.collateral, 0); fids := fids || to_jsonb(r.faction_id);
  end loop;
  for r in select * from option_positions where status = 'open' loop
    update faction_economy set gc = gc + coalesce(r.premium_paid, 0) where faction_id = r.faction_id;
    insert into v1_compensations(faction_id, amount, reason, detail) values (r.faction_id, coalesce(r.premium_paid, 0), why, jsonb_build_object('option', r.id));
    update option_positions set status = 'closed', closed_at = now() where id = r.id;
    total := total + coalesce(r.premium_paid, 0); fids := fids || to_jsonb(r.faction_id);
  end loop;
  -- облигации в обращении: держателям — номинал
  for r in select h.holder_fid, h.units, i.face, i.id from bond_holdings h join bond_issues i on i.id = h.issue_id where i.status = 'active' loop
    update faction_economy set gc = gc + r.units * r.face where faction_id = r.holder_fid;
    insert into v1_compensations(faction_id, amount, reason, detail) values (r.holder_fid, r.units * r.face, why, jsonb_build_object('bond', r.id, 'units', r.units));
    total := total + r.units * r.face; fids := fids || to_jsonb(r.holder_fid);
  end loop;
  update bond_issues set status = 'cancelled' where status = 'active';

  -- «Синли-Бэй»: лоты сняты
  insert into v1_removed_units(id, unit, reason) select l.id, to_jsonb(l) || jsonb_build_object('kind', 'sinli_lot'), 'Рынок «Синли-Бэй» закрыт' from sinli_lots l on conflict (id) do nothing;
  delete from sinli_lots;

  -- концессии: расторгнуты
  insert into v1_removed_units(id, unit, reason) select c.id, to_jsonb(c) || jsonb_build_object('kind', 'concession'), 'Концессии убраны' from mining_concessions c on conflict (id) do nothing;
  delete from mining_concessions;
  for r in select * from concession_slots loop
    update faction_economy set gc = gc + coalesce(r.paid, 0) where faction_id = r.fid;
    insert into v1_compensations(faction_id, amount, reason, detail) values (r.fid, coalesce(r.paid, 0), 'Концессии убраны', jsonb_build_object('slot', r.id));
    total := total + coalesce(r.paid, 0); fids := fids || to_jsonb(r.fid);
  end loop;
  insert into v1_removed_units(id, unit, reason) select c.id, to_jsonb(c) || jsonb_build_object('kind', 'concession_slot'), 'Концессии убраны' from concession_slots c on conflict (id) do nothing;
  delete from concession_slots;

  perform v1_bulletin('Экономика: снятие лишнего',
    'Команда проекта сняла финансовые инструменты (маржа, фьючерсы, опционы, облигации), закрыла рынок «Синли-Бэй» и убрала концессии. '
    || 'Открытые позиции возвращены деньгами' || case when total > 0 then ' — всего ' || to_char(total, 'FM999G999G990') || ' ГС' else '' end || '. '
    || 'Корпорации заморожены на переработку: их данные сохранены, действия временно закрыты.',
    (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from jsonb_array_elements_text(fids) x));
end $$;

-- старому сайту — закрыть действия
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('margin_open', 'margin_close', 'futures_open', 'futures_close', 'options_buy', 'options_close',
                                'bond_buy', 'bond_cancel', 'bond_issue', 'sinli_buy', 'sinli_sell',
                                'concession_build', 'concession_grant', 'concession_revoke', 'concession_slot_buy',
                                'corp_buy_shares', 'corp_cancel_listing', 'corp_create', 'corp_dissolve', 'corp_edit',
                                'corp_list_shares', 'corp_recompose', 'corp_review') loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    insert into v1_revoked_functions(signature, had_anon, had_auth) values (f.sig::text, false, true) on conflict do nothing;
  end loop;
end $$;
