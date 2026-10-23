-- Классическая эра 1.0 · Новая база космических сражений.
--
-- Старый движок (battles, battle_units, _bt_*) остаётся работать, пока новый не
-- готов целиком: таблицы v1_battle_* живут рядом и ничего старого не меняют.
--
-- Что уже есть в базе нового движка:
--   • бой, стороны, отряды (стек одинаковых кораблей = один отряд на поле), журнал;
--   • ходы по очереди с таймером реального времени;
--   • ТТХ отряда снимаются с проекта в момент начала боя и видны ТОЛЬКО своей
--     стороне — противник видит класс, название, позицию и примерный износ;
--   • ОТСТУПЛЕНИЕ: кнопка → 3 хода ожидания → отряды покидают поле, а флот уходит
--     из системы в соседнюю в реальном времени (обычный перелёт, status = 'transit');
--   • черновые правила движения и огня — чтобы базу можно было проверять. Их заменят
--     настоящие правила вместе с модулями.
-- Настройки — v1_settings.battles: turn_minutes (по умолчанию 10), retreat_turns (3),
-- retreat_minutes (сколько длится уход в соседнюю систему, по умолчанию 30).

-- ════════ 1. Таблицы ════════
create table if not exists public.v1_battles (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null default 'war' check (kind in ('war', 'intercept', 'arena', 'test')),
  status        text not null default 'active' check (status in ('forming', 'active', 'done', 'cancelled')),
  system_id     text,
  board_w       integer not null default 16,
  board_h       integer not null default 10,
  turn_no       integer not null default 1,
  side_to_move  text not null default 'a' check (side_to_move in ('a', 'b')),
  turn_deadline timestamptz,
  winner_side   text check (winner_side in ('a', 'b')),
  result        jsonb not null default '{}'::jsonb,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  ended_at      timestamptz
);
create table if not exists public.v1_battle_sides (
  battle_id      uuid not null references public.v1_battles(id) on delete cascade,
  side           text not null check (side in ('a', 'b')),
  faction_id     text not null,
  role           text not null default 'attacker' check (role in ('attacker', 'defender', 'ally')),
  ai             boolean not null default false,       -- сторону ведёт ИИ (решение команды проекта)
  status         text not null default 'fighting' check (status in ('fighting', 'retreating', 'retreated', 'defeated', 'won')),
  retreat_at_turn integer,                              -- на каком ходу уйдёт
  retreat_dest   text,                                  -- куда уходит флот
  left_at        timestamptz,
  primary key (battle_id, side, faction_id)
);
create table if not exists public.v1_battle_units (
  id          uuid primary key default gen_random_uuid(),
  battle_id   uuid not null references public.v1_battles(id) on delete cascade,
  side        text not null check (side in ('a', 'b')),
  faction_id  text not null,
  fleet_id    uuid,                                     -- откуда пришёл (для потерь и отступления)
  design_id   uuid,                                     -- проект из faction_units
  comp_index  integer,                                  -- строка состава флота
  name        text not null,
  class       text not null default '',
  qty         integer not null default 1,               -- кораблей в отряде
  qty_start   integer not null default 1,
  hp          numeric not null,                         -- запас прочности всего отряда
  hp_ship     numeric not null,                         -- прочность одного корабля
  shield      numeric not null default 0,
  shield_max  numeric not null default 0,
  stats       jsonb not null default '{}'::jsonb,       -- снимок ТТХ: видит только своя сторона
  x           integer not null,
  y           integer not null,
  moved       boolean not null default false,
  fired       boolean not null default false,
  alive       boolean not null default true,
  left_field  boolean not null default false            -- ушёл при отступлении
);
create index if not exists v1_battle_units_b on public.v1_battle_units(battle_id);
create table if not exists public.v1_battle_log (
  id         bigserial primary key,
  battle_id  uuid not null references public.v1_battles(id) on delete cascade,
  turn_no    integer not null,
  side       text,
  text       text not null,
  data       jsonb,
  at         timestamptz not null default now()
);
create index if not exists v1_battle_log_b on public.v1_battle_log(battle_id, id);

-- Браузер не читает таблицы боя напрямую: только через v1_battle_state, которая
-- прячет чужие ТТХ.
alter table public.v1_battles enable row level security;
alter table public.v1_battle_sides enable row level security;
alter table public.v1_battle_units enable row level security;
alter table public.v1_battle_log enable row level security;
revoke all on public.v1_battles, public.v1_battle_sides, public.v1_battle_units, public.v1_battle_log from anon, authenticated;

insert into public.v1_settings(key, value)
values ('battles', jsonb_build_object('turn_minutes', 10, 'retreat_turns', 3, 'retreat_minutes', 30))
on conflict (key) do nothing;

-- ════════ 2. Помощники ════════
create or replace function public._v1_bset(p_key text, p_def numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select (value->>p_key)::numeric from v1_settings where key = 'battles'), p_def)
$$;

create or replace function public._v1_blog(p_battle uuid, p_side text, p_text text, p_data jsonb default null) returns void
language sql security definer set search_path = public as $$
  insert into v1_battle_log(battle_id, turn_no, side, text, data)
  select p_battle, turn_no, p_side, p_text, p_data from v1_battles where id = p_battle
$$;

/** За какую сторону этого боя играет текущий пользователь (null — не участник). Команда проекта может вести любую сторону тестового боя. */
create or replace function public._v1_my_side(p_battle uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare fid text; s text;
begin
  begin fid := public._ec_my_fid_opt(); exception when others then fid := null; end;
  select side into s from v1_battle_sides where battle_id = p_battle and faction_id = fid limit 1;
  return s;
end $$;

-- Отряд из строки состава флота: ТТХ берём из проекта (faction_units.summary).
create or replace function public._v1_unit_from_design(p_battle uuid, p_side text, p_fid text, p_fleet uuid, p_idx integer,
                                                       p_design uuid, p_qty integer, p_x integer, p_y integer) returns void
language plpgsql security definer set search_path = public as $$
declare u record; s jsonb; hp numeric; sh numeric;
begin
  select id, name, summary into u from faction_units where id = p_design;
  s := coalesce(u.summary, '{}'::jsonb);
  hp := greatest(1, coalesce((s->>'hp')::numeric, 100));
  sh := greatest(0, coalesce((s->>'shield')::numeric, 0)) * greatest(1, p_qty);
  insert into v1_battle_units(battle_id, side, faction_id, fleet_id, design_id, comp_index, name, class, qty, qty_start,
                              hp, hp_ship, shield, shield_max, stats, x, y)
  values (p_battle, p_side, p_fid, p_fleet, p_design, p_idx, coalesce(u.name, 'Отряд'), coalesce(s->>'className', ''),
          greatest(1, p_qty), greatest(1, p_qty), hp * greatest(1, p_qty), hp, sh, sh,
          jsonb_build_object('hp', hp, 'shield', coalesce((s->>'shield')::numeric, 0), 'armor', coalesce((s->>'armor')::numeric, 0),
                             'dmg', coalesce((s->>'dmg')::numeric, 0), 'rng', greatest(1, coalesce((s->>'rng')::numeric, 0)),
                             'speed', greatest(1, least(6, coalesce((s->>'speed')::numeric, 2)))),
          p_x, p_y);
end $$;

-- ════════ 3. Создание боя ════════
-- Флоты двух держав в одной системе выходят на поле. Сейчас вызывается из админ-панели
-- (тестовый бой); боевой движок войны будет звать её же при встрече флотов.
create or replace function public.v1_battle_create(p_kind text, p_system text, p_fleets_a uuid[], p_fleets_b uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare b uuid; fl record; el jsonb; i integer; side text; fl_ids uuid[]; n integer; w int := 16; h int := 10; fa text; fb text;
begin
  if not public.v1_is_staff() then raise exception 'not_staff'; end if;
  if coalesce(array_length(p_fleets_a, 1), 0) = 0 or coalesce(array_length(p_fleets_b, 1), 0) = 0 then raise exception 'need_two_sides'; end if;
  select faction_id into fa from fleets where id = p_fleets_a[1];
  select faction_id into fb from fleets where id = p_fleets_b[1];
  if fa is null or fb is null or fa = fb then raise exception 'need_two_sides'; end if;
  insert into v1_battles(kind, system_id, board_w, board_h, turn_deadline, created_by)
  values (coalesce(p_kind, 'test'), p_system, w, h, now() + make_interval(mins => public._v1_bset('turn_minutes', 10)::int), auth.uid())
  returning id into b;
  insert into v1_battle_sides(battle_id, side, faction_id, role) values (b, 'a', fa, 'attacker'), (b, 'b', fb, 'defender');
  foreach side in array array['a', 'b'] loop
    fl_ids := case when side = 'a' then p_fleets_a else p_fleets_b end;
    n := 0;
    for fl in select * from fleets f where f.id = any(fl_ids) loop
      i := 0;
      for el in select value from jsonb_array_elements(coalesce(fl.composition, '[]'::jsonb)) loop
        if coalesce((el->>'qty')::int, 0) > 0 and nullif(el->>'unit_id', '') is not null then
          perform public._v1_unit_from_design(b, side, fl.faction_id, fl.id, i, (el->>'unit_id')::uuid, (el->>'qty')::int,
            case when side = 'a' then n / h else w - 1 - n / h end, n % h);
          n := n + 1;
        end if;
        i := i + 1;
      end loop;
    end loop;
    if n = 0 then raise exception 'empty_fleet'; end if;
  end loop;
  perform public._v1_blog(b, null, 'Бой начался.');
  return b;
end $$;

-- Для тестового боя в админ-панели: системы, где стоят флоты хотя бы двух держав.
create or replace function public.v1_battle_candidates() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.v1_is_staff() then raise exception 'not_staff'; end if;
  return (select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb) from (
    select jsonb_build_object('system_id', f.system_id, 'name', coalesce(m.name, f.system_id),
      'fleets', jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'faction_id', f.faction_id,
        'faction', (select name from faction_applications a where a.faction_id = f.faction_id and a.status = 'approved' limit 1),
        'ships', (select coalesce(sum((e->>'qty')::int), 0) from jsonb_array_elements(coalesce(f.composition, '[]'::jsonb)) e)))) x
      from fleets f left join map_systems m on m.id = f.system_id
     where f.status = 'idle' and f.system_id is not null and not coalesce(f.is_station, false)
     group by f.system_id, m.name
    having count(distinct f.faction_id) >= 2) q);
end $$;

-- ════════ 4. Что видит игрок ════════
create or replace function public.v1_battle_state(p_battle uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me text; staff boolean := public.v1_is_staff(); b record;
begin
  select * into b from v1_battles where id = p_battle;
  if b.id is null then raise exception 'battle_not_found'; end if;
  me := public._v1_my_side(p_battle);
  if me is null and not staff then raise exception 'not_in_battle'; end if;
  return jsonb_build_object(
    'battle', to_jsonb(b) - 'created_by',
    'me', me, 'staff', staff,
    'sides', (select jsonb_agg(jsonb_build_object('side', s.side, 'faction_id', s.faction_id, 'role', s.role, 'status', s.status,
                'retreat_at_turn', s.retreat_at_turn, 'name', (select name from faction_applications a where a.faction_id = s.faction_id and a.status = 'approved' limit 1)))
              from v1_battle_sides s where s.battle_id = p_battle),
    'units', (select coalesce(jsonb_agg(
                case when u.side = me or staff then to_jsonb(u) - 'battle_id'
                -- противник: без ТТХ и точного запаса прочности
                else jsonb_build_object('id', u.id, 'side', u.side, 'name', u.name, 'class', u.class, 'x', u.x, 'y', u.y,
                       'alive', u.alive, 'left_field', u.left_field, 'qty', u.qty,
                       'wear', round((1 - u.hp / nullif(u.hp_ship * u.qty_start, 0)) * 10) * 10,
                       'shielded', u.shield > 0)
                end order by u.side, u.y, u.x), '[]'::jsonb)
              from v1_battle_units u where u.battle_id = p_battle),
    'log', (select coalesce(jsonb_agg(l order by l.id), '[]'::jsonb) from (
              select id, turn_no, side, text, at from v1_battle_log where battle_id = p_battle order by id desc limit 40) l));
end $$;

-- Бои, где я участвую (или все — для команды проекта).
create or replace function public.v1_battle_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'kind', b.kind, 'status', b.status, 'system_id', b.system_id, 'turn_no', b.turn_no,
           'created_at', b.created_at, 'sides', (select jsonb_agg(jsonb_build_object('side', s.side, 'faction_id', s.faction_id, 'status', s.status)) from v1_battle_sides s where s.battle_id = b.id))
         order by b.created_at desc), '[]'::jsonb)
    from v1_battles b
   where public.v1_is_staff() or exists (select 1 from v1_battle_sides s where s.battle_id = b.id and s.faction_id = public._ec_my_fid_opt())
$$;

-- ════════ 5. Ход ════════
create or replace function public._v1_battle_check_end(p_battle uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare a_on int; b_on int; a_st text; b_st text; win text; why text;
begin
  select count(*) filter (where side = 'a' and alive and not left_field), count(*) filter (where side = 'b' and alive and not left_field)
    into a_on, b_on from v1_battle_units where battle_id = p_battle;
  select max(status) filter (where side = 'a'), max(status) filter (where side = 'b') into a_st, b_st from v1_battle_sides where battle_id = p_battle;
  if a_on > 0 and b_on > 0 then return false; end if;
  if a_on = 0 and b_on = 0 then win := null; why := 'обе стороны покинули поле';
  elsif a_on = 0 then win := 'b'; why := case when a_st = 'retreated' then 'сторона A отступила' else 'сторона A разбита' end;
  else win := 'a'; why := case when b_st = 'retreated' then 'сторона B отступила' else 'сторона B разбита' end;
  end if;
  update v1_battle_sides set status = 'defeated' where battle_id = p_battle and status in ('fighting', 'retreating') and side is distinct from win;
  update v1_battle_sides set status = 'won' where battle_id = p_battle and side = win and status in ('fighting', 'retreating');
  update v1_battles set status = 'done', winner_side = win, ended_at = now(), turn_deadline = null,
         result = jsonb_build_object('why', why) where id = p_battle;
  perform public._v1_blog(p_battle, win, 'Бой окончен: ' || why || '.');
  perform public._v1_battle_writeback(p_battle);
  return true;
end $$;

-- Потери и выжившие возвращаются во флоты (кроме тестовых боёв).
-- p_side: только эта сторона (при отступлении); null — все, кто ещё не записан (конец боя).
create or replace function public._v1_battle_writeback(p_battle uuid, p_side text default null) returns void
language plpgsql security definer set search_path = public as $$
declare k text; fl record; comp jsonb; u record;
begin
  select kind into k from v1_battles where id = p_battle;
  if k = 'test' then return; end if;
  for fl in select distinct un.fleet_id from v1_battle_units un
             where un.battle_id = p_battle and un.fleet_id is not null
               and (un.side = p_side or (p_side is null and not exists (
                    select 1 from v1_battle_sides s where s.battle_id = p_battle and s.side = un.side and s.status = 'retreated'))) loop
    select composition into comp from fleets where id = fl.fleet_id for update;
    if comp is null then continue; end if;
    for u in select comp_index, qty, alive from v1_battle_units where battle_id = p_battle and fleet_id = fl.fleet_id and comp_index is not null loop
      comp := jsonb_set(comp, array[u.comp_index::text, 'qty'], to_jsonb(case when u.alive then u.qty else 0 end));
    end loop;
    update fleets set composition = (select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements(comp) e where coalesce((e->>'qty')::int, 0) > 0)
     where id = fl.fleet_id;
  end loop;
end $$;

-- Отступившая сторона: отряды уходят с поля, флоты летят в соседнюю систему в реальном времени.
create or replace function public._v1_battle_leave(p_battle uuid, p_side text) returns void
language plpgsql security definer set search_path = public as $$
declare s record; b record; fl uuid; mins int;
begin
  select * into b from v1_battles where id = p_battle;
  mins := public._v1_bset('retreat_minutes', 30)::int;
  for s in select * from v1_battle_sides where battle_id = p_battle and side = p_side and status = 'retreating' loop
    update v1_battle_units set left_field = true where battle_id = p_battle and side = p_side and alive;
    update v1_battle_sides set status = 'retreated', left_at = now() where battle_id = p_battle and side = p_side and faction_id = s.faction_id;
    if b.kind <> 'test' and s.retreat_dest is not null then
      perform public._v1_battle_writeback(p_battle, p_side);
      for fl in select distinct fleet_id from v1_battle_units where battle_id = p_battle and side = p_side and faction_id = s.faction_id and fleet_id is not null loop
        update fleets set status = 'transit', from_sys = b.system_id, dest_sys = s.retreat_dest,
               route = jsonb_build_array(b.system_id, s.retreat_dest), depart_at = now(), arrive_at = now() + make_interval(mins => mins)
         where id = fl;
      end loop;
    end if;
    perform public._v1_blog(p_battle, p_side, 'Отряды отступили с поля и уходят в систему ' ||
      coalesce((select name from map_systems where id = s.retreat_dest), s.retreat_dest, '—') || ' (~' || mins || ' мин).');
  end loop;
end $$;

create or replace function public._v1_battle_advance(p_battle uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b record; nxt text; s record;
begin
  select * into b from v1_battles where id = p_battle for update;
  if b.status <> 'active' then return; end if;
  nxt := case when b.side_to_move = 'a' then 'b' else 'a' end;
  if nxt = 'a' then
    -- новый полный ход: сначала те, кому пора уходить
    update v1_battles set turn_no = turn_no + 1 where id = p_battle;
    for s in select distinct side from v1_battle_sides where battle_id = p_battle and status = 'retreating' and retreat_at_turn <= b.turn_no + 1 loop
      perform public._v1_battle_leave(p_battle, s.side);
    end loop;
    -- щиты восстанавливаются на 25 % за ход (черновое правило)
    update v1_battle_units set shield = least(shield_max, shield + shield_max * 0.25) where battle_id = p_battle and alive;
  end if;
  if public._v1_battle_check_end(p_battle) then return; end if;
  update v1_battle_units set moved = false, fired = false where battle_id = p_battle and side = nxt;
  update v1_battles set side_to_move = nxt, turn_deadline = now() + make_interval(mins => public._v1_bset('turn_minutes', 10)::int) where id = p_battle;
end $$;

create or replace function public.v1_battle_end_turn(p_battle uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text; b record;
begin
  select * into b from v1_battles where id = p_battle;
  me := coalesce(public._v1_my_side(p_battle), case when public.v1_is_staff() and b.kind = 'test' then b.side_to_move end);
  if me is null then raise exception 'not_in_battle'; end if;
  if b.status <> 'active' then raise exception 'battle_over'; end if;
  if b.side_to_move <> me then raise exception 'not_your_turn'; end if;
  perform public._v1_blog(p_battle, me, 'Сторона ' || upper(me) || ' завершила ход.');
  perform public._v1_battle_advance(p_battle);
  return public.v1_battle_state(p_battle);
end $$;

-- Ход по таймеру: кто не успел — пропускает. Повесить на cron раз в минуту при запуске движка:
--   select cron.schedule('v1-battle-tick', '* * * * *', 'select public.v1_battle_tick()');
create or replace function public.v1_battle_tick() returns integer
language plpgsql security definer set search_path = public as $$
declare b uuid; n int := 0;
begin
  for b in select id from v1_battles where status = 'active' and turn_deadline < now() loop
    perform public._v1_blog(b, null, 'Время хода вышло.');
    perform public._v1_battle_advance(b); n := n + 1;
  end loop;
  return n;
end $$;

-- ════════ 6. Отступление ════════
-- Нажал — через N ходов (по умолчанию 3) отряды покинут поле, флот уйдёт в p_dest
-- (соседняя по гиперпути система; если не указана — своя соседняя или первая попавшаяся).
create or replace function public.v1_battle_retreat(p_battle uuid, p_dest text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text; b record; dest text; turns int; fid text;
begin
  select * into b from v1_battles where id = p_battle;
  me := coalesce(public._v1_my_side(p_battle), case when public.v1_is_staff() and b.kind = 'test' then b.side_to_move end);
  if me is null then raise exception 'not_in_battle'; end if;
  if b.status <> 'active' then raise exception 'battle_over'; end if;
  select faction_id into fid from v1_battle_sides where battle_id = p_battle and side = me limit 1;
  if exists (select 1 from v1_battle_sides where battle_id = p_battle and side = me and status = 'retreating') then raise exception 'already_retreating'; end if;
  -- куда уходить: только соседние по гиперпути системы
  with nb as (
    select case when a_id = b.system_id then b_id else a_id end id from map_hyperlanes where a_id = b.system_id or b_id = b.system_id)
  select nb.id into dest from nb left join map_systems m on m.id = nb.id
   where p_dest is null or nb.id = p_dest
   order by (m.faction = fid) desc nulls last, m.faction is null desc, nb.id limit 1;
  if p_dest is not null and dest is null then raise exception 'bad_retreat_dest'; end if;
  turns := public._v1_bset('retreat_turns', 3)::int;
  update v1_battle_sides set status = 'retreating', retreat_at_turn = b.turn_no + turns, retreat_dest = dest
   where battle_id = p_battle and side = me;
  perform public._v1_blog(p_battle, me, 'Сторона ' || upper(me) || ' начала отступление: уйдёт с поля через ' || turns || ' хода.');
  return public.v1_battle_state(p_battle);
end $$;

create or replace function public.v1_battle_retreat_cancel(p_battle uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text; b record;
begin
  select * into b from v1_battles where id = p_battle;
  me := coalesce(public._v1_my_side(p_battle), case when public.v1_is_staff() and b.kind = 'test' then b.side_to_move end);
  if me is null then raise exception 'not_in_battle'; end if;
  update v1_battle_sides set status = 'fighting', retreat_at_turn = null, retreat_dest = null
   where battle_id = p_battle and side = me and status = 'retreating';
  if found then perform public._v1_blog(p_battle, me, 'Сторона ' || upper(me) || ' отменила отступление.'); end if;
  return public.v1_battle_state(p_battle);
end $$;

-- ════════ 7. Действия отряда (черновые правила) ════════
-- move: до speed клеток (по Чебышёву), клетка свободна.
-- fire: цель в пределах rng; урон = dmg × кораблей; сперва снимается щит, потом прочность
--       с учётом брони (броня гасит до 80 %). Каждый отряд за ход один раз движется и один раз стреляет.
create or replace function public.v1_battle_act(p_battle uuid, p_unit uuid, p_kind text, p_x integer default null, p_y integer default null, p_target uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text; b record; u record; t record; d int; dmg numeric; through numeric; armor numeric; lost int;
begin
  select * into b from v1_battles where id = p_battle;
  me := coalesce(public._v1_my_side(p_battle), case when public.v1_is_staff() and b.kind = 'test' then b.side_to_move end);
  if me is null then raise exception 'not_in_battle'; end if;
  if b.status <> 'active' then raise exception 'battle_over'; end if;
  if b.side_to_move <> me then raise exception 'not_your_turn'; end if;
  select * into u from v1_battle_units where id = p_unit and battle_id = p_battle for update;
  if u.id is null or u.side <> me or not u.alive or u.left_field then raise exception 'bad_unit'; end if;

  if p_kind = 'move' then
    if u.moved then raise exception 'already_moved'; end if;
    if p_x not between 0 and b.board_w - 1 or p_y not between 0 and b.board_h - 1 then raise exception 'off_board'; end if;
    d := greatest(abs(p_x - u.x), abs(p_y - u.y));
    if d = 0 or d > (u.stats->>'speed')::int then raise exception 'too_far'; end if;
    if exists (select 1 from v1_battle_units where battle_id = p_battle and alive and not left_field and x = p_x and y = p_y) then raise exception 'cell_busy'; end if;
    update v1_battle_units set x = p_x, y = p_y, moved = true where id = u.id;
    perform public._v1_blog(p_battle, me, u.name || ' перешёл на позицию.');
  elsif p_kind = 'fire' then
    if u.fired then raise exception 'already_fired'; end if;
    select * into t from v1_battle_units where id = p_target and battle_id = p_battle for update;
    if t.id is null or t.side = me or not t.alive or t.left_field then raise exception 'bad_target'; end if;
    d := greatest(abs(t.x - u.x), abs(t.y - u.y));
    if d > (u.stats->>'rng')::int then raise exception 'out_of_range'; end if;
    dmg := greatest(0, (u.stats->>'dmg')::numeric) * u.qty;
    through := greatest(0, dmg - t.shield);
    armor := least(0.8, greatest(0, (t.stats->>'armor')::numeric) / 1000);
    through := through * (1 - armor);
    update v1_battle_units set shield = greatest(0, t.shield - dmg), hp = greatest(0, t.hp - through),
           qty = greatest(0, ceil(greatest(0, t.hp - through) / t.hp_ship))::int,
           alive = (t.hp - through) > 0
     where id = t.id;
    lost := t.qty - greatest(0, ceil(greatest(0, t.hp - through) / t.hp_ship))::int;
    update v1_battle_units set fired = true where id = u.id;
    perform public._v1_blog(p_battle, me, u.name || ' → ' || t.name || ': ' || round(dmg) || ' урона' ||
      case when lost > 0 then ', потеряно кораблей: ' || lost else '' end || '.', jsonb_build_object('from', u.id, 'to', t.id));
    perform public._v1_battle_check_end(p_battle);
  else
    raise exception 'unknown_act';
  end if;
  return public.v1_battle_state(p_battle);
end $$;

-- ════════ 8. Права ════════
revoke execute on function public._v1_bset(text, numeric), public._v1_blog(uuid, text, text, jsonb), public._v1_my_side(uuid),
  public._v1_unit_from_design(uuid, text, text, uuid, integer, uuid, integer, integer, integer),
  public._v1_battle_check_end(uuid), public._v1_battle_writeback(uuid, text), public._v1_battle_leave(uuid, text),
  public._v1_battle_advance(uuid), public.v1_battle_tick() from public, anon, authenticated;
revoke execute on function public.v1_battle_candidates(), public.v1_battle_create(text, text, uuid[], uuid[]), public.v1_battle_state(uuid), public.v1_battle_list(),
  public.v1_battle_end_turn(uuid), public.v1_battle_retreat(uuid, text), public.v1_battle_retreat_cancel(uuid),
  public.v1_battle_act(uuid, uuid, text, integer, integer, uuid) from public, anon;
grant execute on function public.v1_battle_candidates(), public.v1_battle_create(text, text, uuid[], uuid[]), public.v1_battle_state(uuid), public.v1_battle_list(),
  public.v1_battle_end_turn(uuid), public.v1_battle_retreat(uuid, text), public.v1_battle_retreat_cancel(uuid),
  public.v1_battle_act(uuid, uuid, text, integer, integer, uuid) to authenticated;
