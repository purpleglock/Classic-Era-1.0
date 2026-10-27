-- Классическая эра 1.0 · Карты наземных сражений (генератор).
--
-- Как и космические карты (миграция 34): строятся один раз в начале боя из данных
-- планеты и хранятся строкой клеток; картинку (2D и 3D) рисует браузер.
-- Среда — по типу планеты: умеренная, тундра, пустыня, океан, вулканическая, лёд,
-- безжизненная (малые тела, металл, силикаты…), углеродная, экзотическая, руины,
-- газовый гигант (бой на парящих платформах). У каждой среды 1–3 варианта рельефа.
--
-- Клетки (названия в каждой среде свои, правила общие):
--   .  равнина
--   F  укрытие: лес, тайга, кристаллы, заросли — пехоте укрытие, технике вдвое дороже
--   R  неровности: дюны, пепел, снег, реголит, обломки — технике вдвое дороже
--   h  холмы — технике вдвое дороже, обзор +1
--   M  горы, скалы, месы, шпили — только пехота и авиация; закрывают обзор и прямой огонь
--   W  глубокая вода — только авиация
--   w  брод, мелководье, тонкий лёд — медленно
--   L  лава, кислота, смола — только авиация
--   X  пропасть, трещина, пустота под платформами — только авиация
--   S  постройки колонии и руины — пехоте укрытие, технике не пройти
--   C  сердце колонии — цель атакующего
--   r  дорога, мост — технике вдвое быстрее
-- Артиллерия бьёт навесом через препятствия (по цели, которую видит своя сторона).
-- Авиация летает где угодно. Десант садится в зоне высадки на любом ходу.
-- Карта зеркальна слева направо, кроме колонии защитника (справа).

set lock_timeout = '15s';

create or replace function public.v1_gm_biome(p_type text, p_kind text default 'planet') returns text
language sql immutable as $$
  select case
    when coalesce(p_kind, '') = 'belt' then 'barren'
    when p_type ~* 'гигант' then 'gas'
    when p_type ~* 'руин|структур' then 'ruins'
    when p_type ~* 'экзот|аномал' then 'exotic'
    when p_type ~* 'тундр' then 'tundra'
    when p_type ~* 'пустын|дюн|литара|псамор' then 'desert'
    when p_type ~* 'океан' then 'ocean'
    when p_type ~* 'вулкан|лав' then 'volcanic'
    when p_type ~* 'крио|ледян|гельвард' then 'ice'
    when p_type ~* 'углерод' then 'carbon'
    when p_type ~* 'землепод|суперзем|идеальн' then 'temperate'
    else 'barren' end
$$;

-- пятно: заполняет клетки левой половины (x ≤ lim) типом typ, если текущая клетка из over
create or replace function public.v1_gm_blob(g text[], w int, h int, lim int, seed bigint, k int, typ text,
  cx double precision, cy double precision, r double precision, over text default '.') returns text[]
language plpgsql immutable as $$
declare x int; y int; i int; sx double precision := sqrt(3);
begin
  for x in 0..lim loop for y in 0..h - 1 loop
    i := y * w + x + 1;
    if position(g[i] in over) > 0
       and sqrt(power(1.5 * x - cx, 2) + power(sx * (y + 0.5 * (x % 2)) - cy, 2)) + (v1_bm_rnd(seed, 900 + k, i) - 0.5) * 1.5 < r then
      g[i] := typ;
    end if;
  end loop; end loop;
  return g;
end $$;

-- извилистая линия (река лавы, трещина, каньон): случайное блуждание по левой половине
create or replace function public.v1_gm_walk(g text[], w int, h int, lim int, seed bigint, k int, typ text, over text, len int) returns text[]
language plpgsql immutable as $$
declare x int; y int; i int; j int; d int;
begin
  x := 2 + floor(v1_bm_rnd(seed, 700 + k) * (lim - 3))::int;
  y := floor(v1_bm_rnd(seed, 710 + k) * h)::int;
  for j in 1..len loop
    i := y * w + x + 1;
    if position(g[i] in over) > 0 then g[i] := typ; end if;
    d := floor(v1_bm_rnd(seed, 720 + k, j) * 6)::int;
    if d < 3 then y := y + 1; elsif d = 3 then x := x + 1; elsif d = 4 then x := x - 1; else y := y - 1; end if;
    x := greatest(2, least(lim, x)); y := greatest(0, least(h - 1, y));
  end loop;
  return g;
end $$;

create or replace function public.v1_gmap_gen(p_system text, p_pid int default null, p_seed bigint default null, p_size text default 'm')
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  sys map_systems;
  w int := case when p_size = 's' then 23 else 29 end;
  h int := case when p_size = 's' then 13 else 17 end;
  mid int; seed0 bigint := coalesce(p_seed, floor(random() * 2147483647)::bigint); seed bigint;
  sx double precision := sqrt(3); hmax double precision;
  body jsonb; biome text; variant int; vname text;
  g text[]; spec jsonb; b jsonb; k int := 100; j int; n int;
  x int; y int; i int; px double precision; py double precision; d double precision;
  ccx int; ccy int; qx int[]; qy int[]; seen boolean[]; head int; ok boolean; nx int; ny int; dirs int[];
  cnt jsonb; tot numeric := 0; pick numeric; e jsonb; blocked text := 'MWLXSC';
begin
  select * into sys from map_systems where id = p_system;
  if sys.id is null then raise exception 'system_not_found'; end if;
  seed := seed0 # hashtext(p_system || ':' || coalesce(p_pid, 0));
  mid := (w - 1) / 2; hmax := sx * (h - 0.5);

  -- ── тело: заданное или случайное из тех, где бывают колонии ──
  if p_pid is not null then
    select x2.value into body from jsonb_array_elements(coalesce(sys.planets, '[]')) x2 where (x2.value->>'pid')::int = p_pid;
  end if;
  if body is null then
    select x2.value into body from jsonb_array_elements(coalesce(sys.planets, '[]')) x2
     where x2.value->>'kind' in ('planet', 'belt')
     order by v1_bm_rnd(seed, 1, (x2.value->>'pid')::int) limit 1;
  end if;
  biome := v1_gm_biome(body->>'type', body->>'kind');
  variant := floor(v1_bm_rnd(seed, 2) * 3)::int;

  g := array_fill(case when biome = 'gas' then 'X' when biome = 'ocean' and variant % 2 = 0 then 'W' else '.' end, array[w * h]);

  -- ── рецепт среды: список пятен [тип, сколько, радиус от, до, поверх чего] + особые черты ──
  case biome
  when 'temperate' then
    vname := (array['Речная долина', 'Горный перевал', 'Лесной край'])[variant + 1];
    spec := case variant
      when 0 then '[["F",4,1.8,3.2,"."],["h",3,1.6,2.6,"."],["M",1,1.2,2.0,"."]]'
      when 1 then '[["M",3,2.2,3.4,"."],["h",4,1.6,2.8,"."],["F",2,1.6,2.6,"."]]'
      else '[["F",6,2.2,3.6,"."],["h",2,1.6,2.4,"."],["w",1,1.2,1.8,"."]]' end;
  when 'tundra' then
    vname := (array['Мерзлота', 'Ледниковые холмы', 'Тайга'])[variant + 1];
    spec := case variant
      when 0 then '[["W",2,1.4,2.2,"."],["F",3,1.8,2.8,"."],["R",3,2.0,3.2,"."],["h",2,1.4,2.2,"."]]'
      when 1 then '[["h",5,1.8,2.8,"."],["M",2,1.2,2.0,"."],["R",3,2.0,3.0,"."]]'
      else '[["F",6,2.0,3.4,"."],["w",2,1.2,2.0,"."],["h",2,1.4,2.2,"."]]' end;
  when 'desert' then
    vname := (array['Дюнное море', 'Каньоны', 'Плато месас'])[variant + 1];
    spec := case variant
      when 0 then '[["R",6,2.0,3.4,"."],["h",3,1.4,2.4,"."],["M",1,1.0,1.6,"."],["w",1,0.9,1.3,"."]]'
      when 1 then '[["M",3,1.4,2.4,"."],["R",3,2.0,3.0,"."]]'
      else '[["M",5,1.2,2.0,"."],["h",3,1.6,2.4,"."],["R",2,2.0,3.0,"."]]' end;
  when 'ocean' then
    vname := (array['Архипелаг', 'Побережье', 'Архипелаг'])[variant + 1];
    spec := case when variant % 2 = 0
      then '[[".",6,2.2,3.8,"W"],["F",3,1.2,2.0,"."],["h",2,1.0,1.6,"."]]'
      else '[["W",3,2.6,3.8,"."],["F",3,1.6,2.6,"."],["h",2,1.2,2.0,"."]]' end;
  when 'volcanic' then
    vname := (array['Лавовые реки', 'Базальтовые поля', 'Жерла'])[variant + 1];
    spec := case variant
      when 0 then '[["R",4,2.0,3.2,"."],["M",1,1.4,2.0,"."],["h",2,1.4,2.2,"."]]'
      when 1 then '[["M",3,1.6,2.6,"."],["R",5,2.0,3.2,"."],["L",3,1.0,1.6,"."]]'
      else '[["M",3,1.6,2.2,"."],["R",3,2.0,3.0,"."],["h",3,1.4,2.2,"."]]' end;
  when 'ice' then
    vname := (array['Ледяной щит', 'Торосы', 'Ледяные шпили'])[variant + 1];
    spec := case variant
      when 0 then '[["R",3,2.0,3.2,"."],["M",2,1.0,1.6,"."]]'
      when 1 then '[["h",5,1.6,2.6,"."],["M",2,1.2,2.0,"."],["W",2,1.2,1.8,"."]]'
      else '[["M",5,0.9,1.5,"."],["R",4,2.0,3.0,"."],["w",2,1.2,2.0,"."]]' end;
  when 'carbon' then
    vname := (array['Смоляные топи', 'Графитовые шпили', 'Сажевые заросли'])[variant + 1];
    spec := case variant
      when 0 then '[["L",3,1.4,2.4,"."],["R",3,2.0,3.0,"."],["F",2,1.6,2.4,"."]]'
      when 1 then '[["M",4,1.0,1.8,"."],["R",3,2.0,3.0,"."],["L",1,1.2,1.8,"."]]'
      else '[["F",5,2.0,3.2,"."],["L",2,1.0,1.6,"."],["h",2,1.4,2.2,"."]]' end;
  when 'exotic' then
    vname := (array['Кристаллический лес', 'Кислотные озёра', 'Монолиты'])[variant + 1];
    spec := case variant
      when 0 then '[["F",5,2.0,3.2,"."],["L",1,1.0,1.6,"."],["h",2,1.4,2.2,"."]]'
      when 1 then '[["L",3,1.4,2.4,"."],["F",3,1.6,2.6,"."],["R",2,1.8,2.6,"."]]'
      else '[["M",4,0.8,1.3,"."],["F",3,1.8,2.8,"."],["h",3,1.4,2.2,"."]]' end;
  when 'ruins' then
    vname := 'Мёртвый город';
    spec := '[["R",4,1.6,2.6,"."],["F",2,1.2,2.0,"."]]';
  when 'gas' then
    vname := (array['Облачные платформы', 'Станция над бурей', 'Облачные платформы'])[variant + 1];
    spec := '[[".",5,1.9,3.0,"X"]]';
  else -- barren
    vname := (array['Кратерное поле', 'Плато', 'Реголитовая равнина'])[variant + 1];
    spec := case variant
      when 0 then '[["R",3,1.8,2.6,"."]]'
      when 1 then '[["M",4,1.4,2.4,"."],["X",1,1.0,1.6,"."],["R",3,2.0,3.0,"."]]'
      else '[["R",6,2.0,3.2,"."],["h",3,1.6,2.4,"."]]' end;
  end case;

  -- ── особые черты (левая половина, до зеркала) ──
  if biome = 'temperate' and variant = 0 then          -- река по центру
    for x in 0..mid loop for y in 0..h - 1 loop
      if abs(1.5 * x - 1.5 * mid) + sin(y * 0.9 + v1_bm_rnd(seed, 3) * 6) * 0.7 < 1.6 then g[y * w + x + 1] := 'W'; end if;
    end loop; end loop;
  elsif biome = 'volcanic' and variant = 0 then
    for j in 1..3 loop g := v1_gm_walk(g, w, h, mid, seed, j, 'L', '.', 16); end loop;
  elsif biome = 'ice' and variant = 0 or biome = 'desert' and variant = 1 then
    for j in 1..3 loop g := v1_gm_walk(g, w, h, mid, seed, j, 'X', '.R', 14); end loop;
  elsif biome = 'ocean' and variant % 2 = 1 then      -- побережье: море по центру
    for x in 0..mid loop for y in 0..h - 1 loop
      if 1.5 * x > 1.5 * mid - 4.2 + sin(y * 0.7) * 1.2 then g[y * w + x + 1] := 'W'; end if;
    end loop; end loop;
  elsif biome = 'ruins' then                           -- сетка улиц и кварталы
    for x in 0..mid loop for y in 0..h - 1 loop
      i := y * w + x + 1;
      if x % 5 = 2 or y % 4 = 1 then g[i] := 'r';
      elsif v1_bm_rnd(seed, 40, i) < 0.55 then g[i] := 'S';
      end if;
    end loop; end loop;
  end if;

  for b in select * from jsonb_array_elements(spec) loop
    n := (b->>1)::int;
    for j in 1..n loop
      k := k + 1;
      px := 1.5 * (2.5 + v1_bm_rnd(seed, 200 + k) * (mid - 2.5));
      py := 1.0 + v1_bm_rnd(seed, 300 + k) * (hmax - 2.0);
      d := (b->>2)::numeric + v1_bm_rnd(seed, 400 + k) * ((b->>3)::numeric - (b->>2)::numeric);
      g := v1_gm_blob(g, w, h, mid, seed, k, b->>0, px, py, d, b->>4);
      -- кратер: кольцо холмов вокруг впадины
      if biome = 'barren' and variant = 0 then
        g := v1_gm_blob(g, w, h, mid, seed, k + 50, 'h', px, py, d + 1.4, '.');
      end if;
      -- вулкан: жерло лавы в горе
      if biome = 'volcanic' and variant = 2 and b->>0 = 'M' then
        g := v1_gm_blob(g, w, h, mid, seed, k + 50, 'L', px, py, 0.9, 'M');
      end if;
      -- острова: мелководье вокруг
      if biome = 'ocean' and b->>0 = '.' then
        g := v1_gm_blob(g, w, h, mid, seed, k + 50, 'w', px, py, d + 1.3, 'W');
      end if;
    end loop;
  end loop;

  -- платформы газового гиганта: мосты между соседними платформами (по дорожке клеток)
  if biome = 'gas' then
    for j in 0..(mid - 1) loop
      y := (h - 1) / 2 + round(sin(j * 0.6 + v1_bm_rnd(seed, 5) * 6) * (h / 4.0))::int;
      i := greatest(0, least(h - 1, y)) * w + j + 1;
      if g[i] = 'X' then g[i] := 'r'; end if;
    end loop;
    for x in 0..mid loop for y in 0..h - 1 loop      -- на платформах — постройки
      i := y * w + x + 1;
      if g[i] = '.' and v1_bm_rnd(seed, 60, i) < 0.12 then g[i] := 'S'; end if;
    end loop; end loop;
  end if;

  -- ── зона высадки (слева) — без препятствий у самого края ──
  for x in 0..1 loop for y in 0..h - 1 loop
    i := y * w + x + 1;
    if g[i] in ('M', 'L', 'X', 'S', 'W') then g[i] := case when biome = 'gas' and v1_bm_rnd(seed, 61, i) < 0.4 then 'X' else '.' end; end if;
  end loop; end loop;

  -- ── зеркало ──
  for x in mid + 1..w - 1 loop for y in 0..h - 1 loop
    g[y * w + x + 1] := g[y * w + (w - 1 - x) + 1];
  end loop; end loop;

  -- ── колония защитника справа: сердце, постройки вокруг, дорога к краю ──
  ccx := w - 5; ccy := (h - 1) / 2 + floor((v1_bm_rnd(seed, 7) - 0.5) * (h / 3.0))::int;
  for x in ccx - 3..w - 1 loop for y in greatest(0, ccy - 3)..least(h - 1, ccy + 3) loop
    i := y * w + x + 1;
    d := sqrt(power(1.5 * (x - ccx), 2) + power(sx * (y + 0.5 * (x % 2) - ccy - 0.5 * (ccx % 2)), 2));
    if d < 1.2 then g[i] := 'C';
    elsif d < 2.4 then g[i] := case when v1_bm_rnd(seed, 70, i) < 0.6 then 'S' else 'r' end;
    elsif d < 3.6 and g[i] in ('M', 'L', 'X', 'W', 'w') then g[i] := '.';
    end if;
  end loop; end loop;
  for x in ccx + 2..w - 1 loop
    i := ccy * w + x + 1; if g[i] <> 'C' then g[i] := 'r'; end if;
  end loop;

  -- ── технике нужен путь от зоны высадки к колонии; если нет — дорога/мост по прямой ──
  for attempt in 1..2 loop
    seen := array_fill(false, array[w * h]); qx := '{}'; qy := '{}';
    for y in 0..h - 1 loop for x in 0..2 loop
      i := y * w + x + 1;
      if position(g[i] in blocked) = 0 and not seen[i] then seen[i] := true; qx := qx || x; qy := qy || y; end if;
    end loop; end loop;
    head := 1; ok := false;
    while head <= coalesce(array_length(qx, 1), 0) loop
      x := qx[head]; y := qy[head]; head := head + 1;
      if abs(x - ccx) <= 3 and abs(y - ccy) <= 3 then ok := true; exit; end if;
      dirs := case when x % 2 = 0 then array[1,-1, 1,0, -1,-1, -1,0, 0,-1, 0,1] else array[1,0, 1,1, -1,0, -1,1, 0,-1, 0,1] end;
      for j in 0..5 loop
        nx := x + dirs[j * 2 + 1]; ny := y + dirs[j * 2 + 2];
        if nx between 0 and w - 1 and ny between 0 and h - 1 and not seen[ny * w + nx + 1] and position(g[ny * w + nx + 1] in blocked) = 0 then
          seen[ny * w + nx + 1] := true; qx := qx || nx; qy := qy || ny;
        end if;
      end loop;
    end loop;
    exit when ok;
    for x in 0..ccx - 2 loop
      i := ccy * w + x + 1;
      if position(g[i] in blocked) > 0 then g[i] := 'r'; end if;
    end loop;
  end loop;

  select jsonb_object_agg(c, n2) into cnt from (select c, count(*) n2 from unnest(g) c group by c) z;
  return jsonb_build_object(
    'v', 1, 'kind', 'ground', 'w', w, 'h', h, 'seed', seed0, 'size', case when p_size = 's' then 's' else 'm' end,
    'grid', array_to_string(g, ''),
    'system', jsonb_build_object('id', sys.id, 'name', sys.name, 'star', coalesce(sys.star_type, 'yellow')),
    'body', case when body is null then null else jsonb_build_object('pid', body->'pid', 'name', body->>'name', 'type', body->>'type', 'kind', body->>'kind', 'zone', body->>'zone') end,
    'biome', biome, 'variant', variant, 'vname', vname,
    'colony', jsonb_build_array(ccx, ccy),
    'landing', jsonb_build_array(0, 6), 'defend', jsonb_build_array(w - 8, w - 1),
    'counts', coalesce(cnt, '{}'::jsonb));
end $$;
revoke execute on function public.v1_gmap_gen(text, int, bigint, text) from public, anon, authenticated;
revoke execute on function public.v1_gm_blob(text[], int, int, int, bigint, int, text, double precision, double precision, double precision, text) from public, anon, authenticated;
revoke execute on function public.v1_gm_walk(text[], int, int, int, bigint, int, text, text, int) from public, anon, authenticated;

create or replace function public.v1_gmap_preview(p_system text, p_pid int default null, p_seed bigint default null, p_size text default 'm')
returns jsonb
language sql stable security definer set search_path = public as $$
  select v1_gmap_gen(p_system, p_pid, p_seed, p_size)
    || jsonb_build_object('bodies', (select coalesce(jsonb_agg(jsonb_build_object('pid', bd.value->'pid', 'name', bd.value->>'name', 'type', bd.value->>'type', 'kind', bd.value->>'kind',
                                       'biome', v1_gm_biome(bd.value->>'type', bd.value->>'kind'))), '[]'::jsonb)
                                     from map_systems s, jsonb_array_elements(coalesce(s.planets, '[]'::jsonb)) bd
                                     where s.id = p_system and bd.value->>'kind' in ('planet', 'belt')));
$$;
revoke execute on function public.v1_gmap_preview(text, int, bigint, text) from public, anon;
grant execute on function public.v1_gmap_preview(text, int, bigint, text) to authenticated;
