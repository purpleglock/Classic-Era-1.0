-- Классическая эра 1.0 · Верфь: орудия из «Арсенала» и описания в палитре.
--
-- Общедоступные орудия каталога ставятся на палубу так же, как свои:
-- у борта, со своей энергией, уроном и дальностью. Зенитные орудия и
-- активная защита дают перехват ракет (pd). В палитру верфи уходят
-- описания модулей, приписки и подробности своих реакторов и орудий.

set lock_timeout = '15s';

update public.v1_modules set in_shipyard = true where kind = 'weapon';

create or replace function public.v1_ship_calc(p_class text, p_cfg jsonb, p_fid text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  set_ jsonb := coalesce((select value from v1_settings where key = 'shipyard'), '{}'::jsonb);
  cl v1_ship_classes; cp jsonb; v_done jsonb := '[]'::jsonb;
  items jsonb := coalesce(p_cfg->'layout', '[]'::jsonb);
  it jsonb; i int; n int; t text; iid text; x int; y int; rot int;
  w int; h int; sz text; nm text; st jsonb; mp jsonb; mkind text;
  occ jsonb := '{}'::jsonb; cx int; cy int; dx int; dy int; ok_edge boolean; ok_stern boolean; bad boolean;
  errs jsonb := '[]'::jsonb; warns jsonb := '[]'::jsonb; locked jsonb := '[]'::jsonb;
  cells int := 0; used int := 0;
  pw numeric := 0; pu numeric := 0; mass numeric; cost numeric; thrust numeric := 0; shield numeric := 0;
  dmg numeric := 0; heal numeric := 0; rng numeric := 0; radar numeric := 1; crew_cap numeric; crew_need numeric;
  cargo numeric := 0; craft numeric := 0; tank_cap numeric := 0; tank_risk numeric := 0; fuel_use numeric := 0;
  bridges int := 0; engines int := 0; reactors int := 0; guns int := 0; mods int := 0; pd_miss numeric := 1;
  bill jsonb := '{}'::jsonb;
  al jsonb; al_name text := 'Стандартная сталь'; al_recipe jsonb;
  resist jsonb := '{"kinetic":0.3,"energy":0.1,"missile":0.1}'::jsonb; hp_pct numeric := 0; mf numeric := 1; al_speed numeric := 0;
  fu jsonb; fst jsonb; fname text; jumps int := 0; autonomy numeric;
  hp numeric; speed numeric; counts jsonb := '{}'::jsonb;
begin
  select * into cl from v1_ship_classes where id = p_class and not frozen;
  if cl.id is null then return jsonb_build_object('ok', false, 'error', 'ship_class'); end if;
  cp := cl.params;
  if p_fid is not null then
    select coalesce(research, '[]'::jsonb) into v_done from faction_economy where faction_id = p_fid;
    v_done := coalesce(v_done, '[]'::jsonb);
    if cl.tech is not null and not v_done ? cl.tech then locked := locked || to_jsonb(cl.name); end if;
  end if;
  if jsonb_typeof(items) <> 'array' then return jsonb_build_object('ok', false, 'error', 'ship_layout'); end if;
  n := jsonb_array_length(items);
  if n > coalesce((set_->>'max_items')::int, 240) then return jsonb_build_object('ok', false, 'error', 'ship_too_many'); end if;

  for cy in 0 .. cl.h - 1 loop
    cells := cells + length(cl.mask[cy + 1]) - length(replace(cl.mask[cy + 1], '#', ''));
  end loop;
  mass := (cp->>'mass')::numeric; cost := (cp->>'cost')::numeric;
  crew_cap := (cp->>'crew')::numeric; crew_need := (cp->>'crew')::numeric;

  for i in 0 .. n - 1 loop
    it := items->i;
    t := it->>'t'; iid := it->>'id';
    x := coalesce((it->>'x')::int, -1); y := coalesce((it->>'y')::int, -1); rot := coalesce((it->>'r')::int, 0);
    st := null; mp := null; mkind := null; sz := null; nm := null;
    if t = 'reactor' then
      select r.stats, r.cfg->>'size', r.name into st, sz, nm from v1_reactors r where r.id::text = iid and (p_fid is null or r.faction_id = p_fid);
    elsif t = 'weapon' then
      select wp.stats, wp.cfg->>'size', wp.name into st, sz, nm from v1_weapons wp where wp.id::text = iid and (p_fid is null or wp.faction_id = p_fid);
    elsif t = 'module' then
      select md.params, md.size, md.name, md.kind into mp, sz, nm, mkind from v1_modules md where md.id = iid and not md.frozen and md.in_shipyard;
      if mp is not null and p_fid is not null and (select tech from v1_modules where id = iid) is not null
         and not v_done ? (select tech from v1_modules where id = iid) then
        locked := locked || to_jsonb(nm);
      end if;
    end if;
    if st is null and mp is null then
      errs := errs || jsonb_build_object('i', i, 'msg', 'Предмет не найден — возможно, проект удалён');
      continue;
    end if;
    if v1_size_rank(sz) > v1_size_rank(cl.size) then
      errs := errs || jsonb_build_object('i', i, 'msg', format('«%s» размера %s не встанет на класс %s', nm, sz, cl.size));
    end if;
    if mp is not null then w := coalesce((mp->>'w')::int, 1); h := coalesce((mp->>'h')::int, 1);
    else w := case sz when 'S' then 1 when 'M' then 2 when 'L' then 2 else 3 end;
         h := case sz when 'S' then 1 when 'M' then 1 when 'L' then 2 else 2 end; end if;
    if rot = 1 then dx := w; w := h; h := dx; end if;

    -- клетки
    ok_edge := false; ok_stern := false; bad := false;
    for dy in 0 .. h - 1 loop
      for dx in 0 .. w - 1 loop
        cx := x + dx; cy := y + dy;
        if cx < 0 or cy < 0 or cx >= cl.w or cy >= cl.h or substr(cl.mask[cy + 1], cx + 1, 1) <> '#' then
          bad := true;
        else
          if occ ? (cx || ':' || cy) then
            errs := errs || jsonb_build_object('i', i, 'msg', format('«%s» наезжает на другой предмет', nm));
          end if;
          occ := occ || jsonb_build_object(cx || ':' || cy, i);
          used := used + 1;
          if cx = 0 or substr(cl.mask[cy + 1], cx, 1) <> '#' then ok_stern := true; ok_edge := true; end if;
          if cx = cl.w - 1 or substr(cl.mask[cy + 1], cx + 2, 1) <> '#' or cy = 0 or cy = cl.h - 1
             or substr(cl.mask[cy], cx + 1, 1) <> '#' or substr(cl.mask[cy + 2], cx + 1, 1) <> '#' then
            ok_edge := true;
          end if;
        end if;
      end loop;
    end loop;
    if bad then errs := errs || jsonb_build_object('i', i, 'msg', format('«%s» выходит за корпус', nm)); end if;

    if t = 'reactor' then
      reactors := reactors + 1;
      pw := pw + coalesce((st->>'power')::numeric, 0);
      mass := mass + coalesce((st->>'mass')::numeric, 0);
      cost := cost + coalesce((st->>'cost')::numeric, 0);
      fuel_use := fuel_use + coalesce((st->>'fuel_use')::numeric, 0);
      bill := v1_bill_add(bill, st->'bill');
      crew_need := crew_need + 3;
      if st ? 'broken' then errs := errs || jsonb_build_object('i', i, 'msg', format('Реактор «%s» сломан: пересоберите его', nm)); end if;
    elsif t = 'weapon' then
      guns := guns + 1;
      pu := pu + coalesce((st->>'energy')::numeric, 0);
      dmg := dmg + coalesce((st->>'damage')::numeric, 0);
      heal := heal + coalesce((st->>'heal')::numeric, 0);
      rng := greatest(rng, coalesce((st->>'dalnost')::numeric, 0));
      mass := mass + coalesce((st->>'mass')::numeric, 0);
      cost := cost + coalesce((st->>'cost')::numeric, 0);
      bill := v1_bill_add(bill, st->'bill');
      crew_need := crew_need + 2 * v1_size_rank(sz);
      if not ok_edge then errs := errs || jsonb_build_object('i', i, 'msg', format('Орудие «%s» должно касаться борта', nm)); end if;
    elsif mkind = 'weapon' then
      -- орудие из общедоступного каталога «Арсенал»
      guns := guns + 1;
      pu := pu + coalesce((mp->>'energy')::numeric, 0);
      dmg := dmg + coalesce((mp->>'dmg')::numeric, 0);
      heal := heal + coalesce((mp->>'heal')::numeric, 0);
      rng := greatest(rng, coalesce((mp->>'rng')::numeric, 0));
      mass := mass + coalesce((mp->>'mass')::numeric, 0);
      cost := cost + coalesce((mp->>'cost')::numeric, 0);
      pd_miss := pd_miss * (1 - least(0.9, coalesce((mp->>'pd')::numeric, 0)));
      bill := v1_bill_add(bill, case mp->>'type'
        when 'kinetic' then jsonb_build_object('Железо', (mp->>'mass')::numeric / 2, 'Медь', (mp->>'mass')::numeric / 6)
        when 'energy'  then jsonb_build_object('Редкоземельные руды', (mp->>'mass')::numeric / 4, 'Силикаты', (mp->>'mass')::numeric / 4)
        when 'missile' then jsonb_build_object('Железо', (mp->>'mass')::numeric / 3, 'Изотопы', (mp->>'mass')::numeric / 10)
        else jsonb_build_object('Редкоземельные руды', (mp->>'mass')::numeric / 4) end);
      crew_need := crew_need + 2 * v1_size_rank(sz);
      if not ok_edge then errs := errs || jsonb_build_object('i', i, 'msg', format('Орудие «%s» должно касаться борта', nm)); end if;
    else
      mods := mods + 1;
      if mp->>'pd' is not null then pd_miss := pd_miss * (1 - least(0.9, (mp->>'pd')::numeric)); end if;
      counts := jsonb_set(counts, array[mkind], to_jsonb(coalesce((counts->>mkind)::int, 0) + 1));
      pu := pu + coalesce((mp->>'energy')::numeric, 0);
      mass := mass + coalesce((mp->>'mass')::numeric, 0);
      cost := cost + coalesce((mp->>'cost')::numeric, 0);
      if mkind = 'engine' then
        engines := engines + 1; thrust := thrust + (mp->>'thrust')::numeric; crew_need := crew_need + 2;
        if not ok_stern then errs := errs || jsonb_build_object('i', i, 'msg', format('Двигатель «%s» должен стоять у кормы', nm)); end if;
      elsif mkind = 'bridge' then bridges := bridges + 1; crew_cap := crew_cap + (mp->>'crew')::numeric;
      elsif mkind = 'shield' then shield := shield + (mp->>'shield')::numeric; crew_need := crew_need + 1;
      elsif mkind = 'sensor' then radar := radar + (mp->>'radar')::numeric;
      elsif mkind = 'quarters' then crew_cap := crew_cap + (mp->>'crew')::numeric;
      elsif mkind = 'cargo' then cargo := cargo + (mp->>'cargo')::numeric;
      elsif mkind = 'hangar' then craft := craft + (mp->>'craft')::numeric; crew_need := crew_need + 20;
      elsif mkind = 'fuel_tank' then tank_cap := tank_cap + (mp->>'capacity')::numeric;
        tank_risk := greatest(tank_risk, coalesce((mp->>'risk')::numeric, 1));
      end if;
    end if;
  end loop;

  -- броня
  if nullif(p_cfg->>'alloy', '') is not null then
    select a.stats, a.name, a.recipe into al, al_name, al_recipe from v1_alloys a
     where a.id::text = p_cfg->>'alloy' and (p_fid is null or a.faction_id = p_fid);
    if al is null then errs := errs || jsonb_build_object('i', -1, 'msg', 'Сплав брони не найден');
    else
      resist := al->'resist'; hp_pct := coalesce((al->>'hpPercentBoost')::numeric, 0);
      mf := coalesce((al->>'mass_factor')::numeric, 1); al_speed := coalesce((al->>'speed')::numeric, 0);
      bill := v1_bill_add(bill, al_recipe, cells / 100.0);
    end if;
  end if;
  mass := mass + cells * coalesce((set_->>'armor_mass_per_cell')::numeric, 0.6) * mf;
  cost := cost + cells * coalesce((set_->>'armor_cost_per_cell')::numeric, 100) * case when al is null then 1 else 1.5 end;
  hp := round((cp->>'hp')::numeric * (1 + hp_pct));

  -- топливо в баках
  fu := p_cfg->'fuel';
  if tank_cap > 0 then
    if fu->>'kind' = 'fuel' then
      select f.stats, f.name into fst, fname from v1_fuels f where f.id::text = fu->>'id' and (p_fid is null or f.faction_id = p_fid);
    elsif fu->>'kind' = 'res' then
      fst := v1_fuel_raw(fu->>'res'); fname := fu->>'res';
    end if;
    if fst is null then warns := warns || '["Выберите топливо для баков"]';
    else jumps := greatest(case when (fst->>'energy')::numeric > 0 then 1 else 0 end, floor(tank_cap * (fst->>'energy')::numeric * (fst->>'efficiency')::numeric / 300))::int; end if;
  elsif coalesce((cp->>'engines')::boolean, true) then
    warns := warns || '["Без топливных баков корабль не сможет ходить между системами"]';
  end if;
  autonomy := case when fuel_use > 0 and tank_cap > 0 then round(tank_cap / fuel_use, 1) else null end;

  speed := case when coalesce((cp->>'engines')::boolean, true)
                then round(coalesce((set_->>'speed_k')::numeric, 2.2) * (cp->>'speed')::numeric * thrust / greatest(mass, 1) * (1 + al_speed / 100.0), 1)
                else 0 end;

  -- обязательные узлы
  if bridges = 0 then errs := errs || '{"i":-1,"msg":"Нужен командный мостик"}'::jsonb; end if;
  if bridges > 1 then errs := errs || '{"i":-1,"msg":"Мостик может быть только один"}'::jsonb; end if;
  if reactors = 0 then errs := errs || '{"i":-1,"msg":"Нужен хотя бы один реактор"}'::jsonb; end if;
  if engines = 0 and coalesce((cp->>'engines')::boolean, true) then errs := errs || '{"i":-1,"msg":"Нужен хотя бы один двигатель"}'::jsonb; end if;
  if engines > 0 and not coalesce((cp->>'engines')::boolean, true) then errs := errs || '{"i":-1,"msg":"Станции двигатели не ставятся"}'::jsonb; end if;
  if pu > pw then errs := errs || jsonb_build_object('i', -1, 'msg', format('Не хватает энергии: нужно %s ЭЕ, реакторы дают %s', round(pu), round(pw))); end if;
  if crew_need > crew_cap then
    warns := warns || jsonb_build_array(format('Экипажа не хватает: нужно %s, мест %s. Добавьте жилые отсеки', round(crew_need), round(crew_cap)));
  end if;
  if jsonb_array_length(locked) > 0 then
    errs := errs || jsonb_build_object('i', -1, 'msg', 'Не изучены технологии: ' || (select string_agg(z, ', ') from jsonb_array_elements_text(locked) z));
  end if;

  return jsonb_build_object(
    'ok', true, 'class', cl.id, 'class_name', cl.name, 'size', cl.size,
    'cells', cells, 'used', used,
    'hp', hp, 'resist', resist, 'shield', shield, 'alloy_name', al_name,
    'damage', round(dmg), 'heal', round(heal), 'dalnost', rng, 'pd', round(1 - pd_miss, 3),
    'power', round(pw), 'energy_use', round(pu), 'energy_free', round(pw - pu),
    'mass', round(mass), 'thrust', thrust, 'speed', speed,
    'crew', round(crew_need), 'crew_cap', round(crew_cap), 'radar', radar, 'cargo', cargo, 'craft', craft,
    'tank', tank_cap, 'tank_risk', tank_risk, 'fuel_name', fname, 'jumps', jumps, 'fuel_use', round(fuel_use, 2), 'autonomy', autonomy,
    'cost', round(cost), 'bill', bill,
    'counts', jsonb_build_object('reactors', reactors, 'weapons', guns, 'engines', engines, 'modules', mods) || counts,
    'errors', errs, 'warnings', warns,
    'registrable', jsonb_array_length(errs) = 0);
end $$;
revoke execute on function public.v1_ship_calc(text, jsonb, text) from public, anon;
grant execute on function public.v1_ship_calc(text, jsonb, text) to authenticated;

create or replace function public.v1_shipyard_state() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_fid text := v1_my_faction(); v_done jsonb;
begin
  if v_fid is null then raise exception 'no_faction'; end if;
  select coalesce(research, '[]'::jsonb) into v_done from faction_economy where faction_id = v_fid;
  v_done := coalesce(v_done, '[]'::jsonb);
  return jsonb_build_object(
    'can_edit', v1_can_manage(v_fid, 'produce'),
    'settings', coalesce((select value from v1_settings where key = 'shipyard'), '{}'::jsonb),
    'classes', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'descr', c.descr, 'size', c.size,
        'w', c.w, 'h', c.h, 'mask', to_jsonb(c.mask), 'params', c.params, 'tech_name', t.name,
        'open', c.tech is null or v_done ? c.tech) order by c.sort), '[]'::jsonb)
      from v1_ship_classes c left join v1_tech t on t.id = c.tech where not c.frozen),
    'modules', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'name', m.name, 'size', m.size,
        'params', m.params, 'descr', m.descr, 'tech_name', t.name, 'code', m.code, 'nick', m.nick, 'base_name', m.base_name, 'grp', m.grp, 'open', m.tech is null or v_done ? m.tech) order by m.sort), '[]'::jsonb)
      from v1_modules m left join v1_tech t on t.id = m.tech where not m.frozen and m.in_shipyard),
    'reactors', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'size', r.cfg->>'size',
        'power', r.stats->'power', 'mass', r.stats->'mass', 'fuel_use', r.stats->'fuel_use', 'broken', r.stats ? 'broken',
        'type_name', p.name, 'fuel_name', r.stats->>'fuel_name', 'reliability', r.stats->'reliability', 'cost', r.stats->'cost') order by r.created_at), '[]'::jsonb)
      from v1_reactors r left join v1_reactor_parts p on p.kind = 'type' and p.id = r.cfg->>'type' where r.faction_id = v_fid),
    'weapons', (select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'size', w.cfg->>'size', 'kind', w.stats->>'kind',
        'damage', w.stats->'damage', 'heal', w.stats->'heal', 'energy', w.stats->'energy', 'mass', w.stats->'mass', 'dalnost', w.stats->'dalnost',
        'accuracy', w.stats->'accuracy', 'cost', w.stats->'cost', 'type_name', p.name, 'barrels', w.stats->'barrels') order by w.created_at), '[]'::jsonb)
      from v1_weapons w left join v1_weapon_parts p on p.kind = 'type' and p.id = w.cfg->>'type' where w.faction_id = v_fid),
    'alloys', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'grade', stats->'grade') order by created_at), '[]'::jsonb)
      from v1_alloys where faction_id = v_fid),
    'fuels', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'grade', stats->'grade') order by created_at), '[]'::jsonb)
      from v1_fuels where faction_id = v_fid),
    'raw', (select coalesce(jsonb_agg(res order by sort), '[]'::jsonb) from v1_fuel_components),
    'ships', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'class', class, 'cfg', cfg, 'stats', stats,
        'created_at', created_at) order by created_at), '[]'::jsonb)
      from v1_ships where faction_id = v_fid));
end $$;
grant execute on function public.v1_shipyard_state() to authenticated;
