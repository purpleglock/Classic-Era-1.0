-- Классическая эра 1.0 · Карты сражений (генератор).
--
-- Карта строится один раз в начале боя из данных системы и хранится в бою
-- (v1_battles.map) компактной строкой клеток: ~500 знаков. Вся картинка (цвет звезды,
-- планета, астероиды, туманности) рисуется в браузере по этой строке и зерну —
-- сервер не рисует и не хранит изображений.
--
-- Поле: шестиугольники с плоским верхом, столбцы со сдвигом нечётных вниз.
-- Средняя карта 29×17, малая 23×13 (больше не бывает). Ширина нечётная, поэтому
-- карта точно зеркальна слева направо: стороны начинают у левого и правого краёв
-- в равных условиях.
--
-- Клетки:
--   .  открытый космос
--   a  астероиды — проходят только корветы и авиация; укрытие
--   R  глыба / луна — непроходима, закрывает линию огня
--   P  тело планеты — непроходимо, закрывает огонь и радар
--   g  гравитационный колодец у планеты — движение вдвое дороже
--   d  обломки / кольца — крупным (L, XL) движение вдвое дороже; лёгкое укрытие
--   n  туманность — цель внутри видна радару только вблизи
--   i  ионный шторм — радар внутри слабеет вдвое, щиты не восстанавливаются
--   f  корона звезды — щиты теряют заряд каждый ход
-- Место боя — одно из тел системы (у колонии — сама планета), вид карты зависит
-- от него, от цвета звезды, от зоны орбиты и от истории сражений в системе.

set lock_timeout = '15s';

alter table public.v1_battles add column if not exists map jsonb;

-- детерминированное «случайное» число 0…1 от зерна и двух индексов
create or replace function public.v1_bm_rnd(p_seed bigint, a int, b int default 0) returns double precision
language sql immutable parallel safe as $$
  select ('x' || substr(md5(p_seed::text || ':' || a || ':' || b), 1, 8))::bit(32)::bigint / 4294967296.0
$$;

create or replace function public.v1_bmap_gen(p_system text, p_seed bigint default null, p_site int default null, p_size text default 'm')
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  sys map_systems;
  w int := case when p_size = 's' then 23 else 29 end;
  h int := case when p_size = 's' then 13 else 17 end;
  mid int; seed bigint := coalesce(p_seed, floor(random() * 2147483647)::bigint);
  g text[]; sx double precision := sqrt(3);
  bodies jsonb; site jsonb; bg jsonb; cat text := 'void'; tot numeric := 0; pick numeric; wt numeric; e jsonb;
  edge text; star_edge text; corona boolean; star text;
  pr double precision := 0; pdep double precision := 0; pcx double precision; pcy double precision;
  rings int := 0; moons int := 0; old_battles int := 0;
  blobs jsonb := '[]'::jsonb; b jsonb; k int := 0; n int;
  x int; y int; i int; px double precision; py double precision; d double precision; hmax double precision;
  qx int[]; qy int[]; seen boolean[]; head int; ok boolean := false; nx int; ny int; dirs int[];
  gaps int[]; bw double precision; arche text; radar double precision := 1; cnt jsonb;
begin
  select * into sys from map_systems where id = p_system;
  if sys.id is null then raise exception 'system_not_found'; end if;
  mid := (w - 1) / 2;
  hmax := sx * (h - 0.5);
  star := coalesce(sys.star_type, 'yellow');
  g := array_fill('.'::text, array[w * h]);
  bodies := coalesce(sys.planets, '[]'::jsonb);

  -- ── место боя: заданное тело или взвешенный выбор (гиганты и пояса — чаще) ──
  if p_site is not null then
    select x2.value into site from jsonb_array_elements(bodies) x2 where (x2.value->>'pid')::int = p_site;
  end if;
  if site is null and jsonb_array_length(bodies) > 0 then
    for e in select * from jsonb_array_elements(bodies) loop
      tot := tot + case when e->>'type' ~* 'гигант' then 4 when e->>'kind' = 'belt' then 3 when e->>'kind' = 'anomaly' then 2 else 2 end;
    end loop;
    pick := v1_bm_rnd(seed, 1) * tot;
    for e in select * from jsonb_array_elements(bodies) loop
      wt := case when e->>'type' ~* 'гигант' then 4 when e->>'kind' = 'belt' then 3 when e->>'kind' = 'anomaly' then 2 else 2 end;
      if pick < wt then site := e; exit; end if;
      pick := pick - wt;
    end loop;
  end if;
  if site is not null then
    cat := case when site->>'kind' = 'belt' then 'belt'
                when site->>'kind' = 'anomaly' or site->>'type' in ('Аномалия', 'Структура', 'Руины') then 'anomaly'
                when site->>'type' ~* 'гигант' then 'giant' else 'rock' end;
    rings := coalesce((site->>'rings')::int, 0);
    moons := coalesce((site->>'moons')::int, 0);
  end if;
  -- планета на фоне, если место боя — пояс или аномалия: самое крупное другое тело
  select x2.value into bg from jsonb_array_elements(bodies) x2
   where x2.value->>'kind' = 'planet' and (site is null or x2.value->>'pid' <> site->>'pid')
   order by (x2.value->>'type' ~* 'гигант') desc, coalesce((x2.value->>'slotsK')::int, 0) desc limit 1;

  edge := case when v1_bm_rnd(seed, 2) < 0.5 then 'top' else 'bottom' end;
  star_edge := case when edge = 'top' then 'bottom' else 'top' end;
  corona := coalesce(site->>'zone', '') = 'Внутр.' or (star = 'blue' and v1_bm_rnd(seed, 3) < 0.5);
  select count(*) into old_battles from battles where system_id = p_system;
  arche := case cat when 'giant' then 'orbit' when 'rock' then 'field' when 'belt' then 'belt' when 'anomaly' then 'storm' else 'void' end;
  if star = 'white' then radar := 1.2; end if;

  -- ── тело планеты, гравитация, кольца ──
  if cat in ('giant', 'rock') then
    pr := case when cat = 'giant' then 19 + v1_bm_rnd(seed, 4) * 5 else 9 + v1_bm_rnd(seed, 4) * 3 end;
    pdep := case when cat = 'giant' then 4.2 + v1_bm_rnd(seed, 5) * 1.4 else 3 + v1_bm_rnd(seed, 5) * 1.2 end;
    if p_size = 's' then pr := pr * 0.8; pdep := pdep * 0.85; end if;
    pcx := 1.5 * mid;
    pcy := case when edge = 'top' then pdep - pr else hmax + pr - pdep end;
    for x in 0..mid loop for y in 0..h - 1 loop
      i := y * w + x + 1;
      d := sqrt(power(1.5 * x - pcx, 2) + power(sx * (y + 0.5 * (x % 2)) - pcy, 2));
      if d < pr then g[i] := 'P';
      elsif d < pr + 2.1 then g[i] := 'g';
      elsif rings > 0 and d > pr + 4.6 and d < pr + 6.4 then g[i] := 'd';
      end if;
    end loop; end loop;
  end if;

  -- ── корона звезды у противоположного края ──
  if corona then
    for x in 0..mid loop for y in 0..h - 1 loop
      i := y * w + x + 1;
      py := sx * (y + 0.5 * (x % 2));
      if g[i] = '.' and ((star_edge = 'top' and py < 2.4) or (star_edge = 'bottom' and py > hmax - 2.4)) then g[i] := 'f'; end if;
    end loop; end loop;
  end if;

  -- ── пояс: полоса астероидов по центру с 2–3 проходами для крупных кораблей ──
  if cat = 'belt' then
    bw := 2.2 + v1_bm_rnd(seed, 6) * 1.6;
    gaps := array[floor(h * (0.2 + v1_bm_rnd(seed, 7) * 0.15))::int, floor(h * (0.62 + v1_bm_rnd(seed, 8) * 0.15))::int];
    if v1_bm_rnd(seed, 9) < 0.5 then gaps := gaps || ((h - 1) / 2); end if;
    for x in 0..mid loop for y in 0..h - 1 loop
      i := y * w + x + 1;
      d := abs(1.5 * x - 1.5 * mid) + (v1_bm_rnd(seed, 100 + y, x) - 0.5) * 1.8;
      if d < bw and not (y = any(gaps) or y - 1 = any(gaps)) and g[i] = '.' then g[i] := 'a'; end if;
    end loop; end loop;
  end if;

  -- ── пятна: астероидные скопления, глыбы, обломки, туманности, шторма ──
  -- [тип, сколько, радиус от, радиус до]
  for b in select * from jsonb_array_elements(jsonb_build_array(
      jsonb_build_array('R', case when cat = 'giant' then least(moons, 2) when cat = 'anomaly' then 1 else 0 end, 0.9, 1.4),
      jsonb_build_array('a', case cat when 'belt' then 3 when 'rock' then 4 + floor(v1_bm_rnd(seed, 10) * 2) when 'giant' then 2 + floor(v1_bm_rnd(seed, 10) * 2) when 'anomaly' then 2 else 3 end, 1.8, 3.2),
      jsonb_build_array('d', case when old_battles > 0 then 1 + least(old_battles / 5, 1) else 0 end + case when cat = 'rock' then 1 else 0 end, 2.0, 3.2),
      jsonb_build_array('n', case star when 'red' then 2 when 'green' then 1 when 'yellow' then floor(v1_bm_rnd(seed, 11) * 2) else 0 end + case when cat = 'void' then 1 else 0 end, 3.2, 5.0),
      jsonb_build_array('i', case star when 'blue' then 2 when 'green' then 1 else 0 end + case when cat = 'anomaly' then 3 else 0 end, 2.6, 4.0))) loop
    n := (b->>1)::int;
    for j in 1..n loop
      k := k + 1;
      -- центр пятна — в левой половине, не у самого края старта
      px := 1.5 * (3 + v1_bm_rnd(seed, 200 + k) * (mid - 3));
      py := 1.2 + v1_bm_rnd(seed, 300 + k) * (hmax - 2.4);
      if b->>0 = 'R' and cat = 'anomaly' then px := 1.5 * mid; py := hmax / 2; end if;
      d := (b->>2)::numeric + v1_bm_rnd(seed, 400 + k) * ((b->>3)::numeric - (b->>2)::numeric);
      blobs := blobs || jsonb_build_object('t', b->>0, 'x', round(px::numeric, 2), 'y', round(py::numeric, 2), 'r', round(d::numeric, 2));
      for x in 0..mid loop for y in 0..h - 1 loop
        i := y * w + x + 1;
        if sqrt(power(1.5 * x - px, 2) + power(sx * (y + 0.5 * (x % 2)) - py, 2)) + (v1_bm_rnd(seed, 500 + k, i) - 0.5) * 1.6 < d then
          if b->>0 = 'R' and g[i] in ('.', 'a', 'd') then g[i] := 'R';
          elsif g[i] = '.' then g[i] := b->>0;
          end if;
        end if;
      end loop; end loop;
      -- вокруг луны — каменная крошка
      if b->>0 = 'R' then
        for x in 0..mid loop for y in 0..h - 1 loop
          i := y * w + x + 1;
          if g[i] = '.' and sqrt(power(1.5 * x - px, 2) + power(sx * (y + 0.5 * (x % 2)) - py, 2)) < d + 1.9 + (v1_bm_rnd(seed, 600 + k, i) - 0.5) * 1.4 then g[i] := 'a'; end if;
        end loop; end loop;
      end if;
    end loop;
  end loop;

  -- ── стартовые зоны: три крайних столбца без препятствий ──
  for x in 0..2 loop for y in 0..h - 1 loop
    i := y * w + x + 1;
    if g[i] in ('a', 'R', 'd') then g[i] := '.'; end if;
  end loop; end loop;

  -- ── зеркало: правая половина — отражение левой ──
  for x in mid + 1..w - 1 loop for y in 0..h - 1 loop
    g[y * w + x + 1] := g[y * w + (w - 1 - x) + 1];
  end loop; end loop;

  -- ── крупный корабль должен дойти от одного края до другого ──
  for attempt in 1..2 loop
    seen := array_fill(false, array[w * h]); qx := '{}'; qy := '{}';
    for y in 0..h - 1 loop
      if g[y * w + 1] not in ('a', 'R', 'P') then qx := qx || 0; qy := qy || y; seen[y * w + 1] := true; end if;
    end loop;
    head := 1; ok := false;
    while head <= coalesce(array_length(qx, 1), 0) loop
      x := qx[head]; y := qy[head]; head := head + 1;
      if x = w - 1 then ok := true; exit; end if;
      dirs := case when x % 2 = 0 then array[1,-1, 1,0, -1,-1, -1,0, 0,-1, 0,1] else array[1,0, 1,1, -1,0, -1,1, 0,-1, 0,1] end;
      for j in 0..5 loop
        nx := x + dirs[j * 2 + 1]; ny := y + dirs[j * 2 + 2];
        if nx between 0 and w - 1 and ny between 0 and h - 1 and not seen[ny * w + nx + 1] and g[ny * w + nx + 1] not in ('a', 'R', 'P') then
          seen[ny * w + nx + 1] := true; qx := qx || nx; qy := qy || ny;
        end if;
      end loop;
    end loop;
    exit when ok;
    -- прорубить проход по среднему ряду
    for x in 0..w - 1 loop
      i := ((h - 1) / 2) * w + x + 1;
      if g[i] in ('a', 'R') then g[i] := '.'; end if;
    end loop;
  end loop;

  select jsonb_object_agg(c, n2) into cnt from (select c, count(*) n2 from unnest(g) c group by c) z;

  return jsonb_build_object(
    'v', 1, 'w', w, 'h', h, 'seed', seed, 'size', case when p_size = 's' then 's' else 'm' end,
    'grid', array_to_string(g, ''),
    'system', jsonb_build_object('id', sys.id, 'name', sys.name, 'star', star, 'stars', sys.stars),
    'site', case when site is null then null else jsonb_build_object('pid', site->'pid', 'name', site->>'name', 'type', site->>'type', 'kind', site->>'kind',
              'zone', site->>'zone', 'rings', rings, 'moons', moons) end,
    'backdrop', case when bg is null then null else jsonb_build_object('name', bg->>'name', 'type', bg->>'type', 'rings', coalesce((bg->>'rings')::int, 0)) end,
    'cat', cat, 'arche', arche, 'edge', edge, 'star_edge', star_edge, 'corona', corona,
    'planet', case when pr > 0 then jsonb_build_object('r', round(pr::numeric, 2), 'depth', round(pdep::numeric, 2)) else null end,
    'blobs', blobs, 'old_battles', old_battles, 'radar', radar, 'counts', coalesce(cnt, '{}'::jsonb),
    'spawn', jsonb_build_object('a', jsonb_build_array(0, 2), 'b', jsonb_build_array(w - 3, w - 1)));
end $$;
revoke execute on function public.v1_bmap_gen(text, bigint, int, text) from public, anon, authenticated;

-- Предпросмотр для страницы карт: тот же генератор, данные системы и так открыты.
create or replace function public.v1_bmap_preview(p_system text, p_seed bigint default null, p_site int default null, p_size text default 'm')
returns jsonb
language sql stable security definer set search_path = public as $$
  select v1_bmap_gen(p_system, p_seed, p_site, p_size)
    || jsonb_build_object('bodies', (select coalesce(jsonb_agg(jsonb_build_object('pid', bd.value->'pid', 'name', bd.value->>'name', 'type', bd.value->>'type', 'kind', bd.value->>'kind')), '[]'::jsonb)
                                     from map_systems s, jsonb_array_elements(coalesce(s.planets, '[]'::jsonb)) bd where s.id = p_system));
$$;
revoke execute on function public.v1_bmap_preview(text, bigint, int, text) from public, anon;
grant execute on function public.v1_bmap_preview(text, bigint, int, text) to authenticated;
