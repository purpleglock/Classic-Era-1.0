-- Классическая эра 1.0 · «Секторные слухи» уходят из вестника в сводку сектора.
--
-- Старый ежедневный тик пишет слухи (кражи из конвоев и т. п.) отдельными
-- новостями — по нескольку штук разом, и они забивают вестник фракций.
-- Старый движок не трогаем: триггер перехватывает такие записи на входе.
--   • слух становится сводкой (kind = 'bulletin') — её видно в кабинете на вкладке «Сектор»,
--     в вестнике её больше нет;
--   • все слухи одного тика (в пределах 30 минут) собираются в ОДНУ сводку «Слухи сектора»:
--     каждый слух — отдельный абзац.

set lock_timeout = '15s';

create or replace function public.v1_news_rumors() returns trigger
language plpgsql security definer set search_path = public as $$
declare rid uuid; line text;
begin
  line := btrim(coalesce(new.title, '')) || ' — ' || btrim(coalesce(new.body, new.excerpt, ''));
  select id into rid from faction_news
   where kind = 'bulletin' and faction_name = new.faction_name and created_at > now() - interval '30 minutes'
   order by created_at desc limit 1;
  if rid is not null then
    update faction_news set body = coalesce(body, '') || E'\n\n' || line, updated_at = now() where id = rid;
    return null;            -- отдельной записи не будет
  end if;
  new.kind := 'bulletin';
  new.title := 'Слухи сектора';
  new.body := line;
  new.excerpt := null;
  return new;
end $$;

drop trigger if exists v1_news_rumors on public.faction_news;
create trigger v1_news_rumors before insert on public.faction_news
  for each row when (new.faction_id is null and new.kind = 'news' and new.faction_name like '%СЕКТОРНЫЕ СЛУХИ%')
  execute function public.v1_news_rumors();

-- уже опубликованные слухи: собрать по тикам в одну сводку каждый
do $$
declare g record; keep uuid;
begin
  for g in select date_trunc('hour', created_at) h, array_agg(id order by created_at) ids,
                  string_agg(btrim(title) || ' — ' || btrim(coalesce(body, excerpt, '')), E'\n\n' order by created_at) txt
             from faction_news
            where faction_id is null and kind = 'news' and faction_name like '%СЕКТОРНЫЕ СЛУХИ%'
            group by 1 loop
    keep := g.ids[1];
    update faction_news set kind = 'bulletin', title = 'Слухи сектора', body = g.txt, excerpt = null where id = keep;
    delete from faction_news where id = any(g.ids[2:]);
  end loop;
end $$;
