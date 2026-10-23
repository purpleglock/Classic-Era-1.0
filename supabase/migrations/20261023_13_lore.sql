-- Классическая эра 1.0 · Лор: летопись и вики фракций.
-- Переносит со старого сайта:
--   • летопись — «ЭРА ОТКРЫТИЙ» и «ЭРА ВОЙНЫ»;
--   • страницы фракций — только тех держав, у которых сейчас есть системы на карте
--     (страница ищется по названию державы).
-- Текст хранится теми же блоками, что и на старом сайте (текст, заголовок, цитата,
-- врезка, хроника, таблица, инфобокс…): так ничего не теряется при переносе.
-- Старые страницы (таблица pages) не трогаются.

create table if not exists public.v1_lore (
  id          text primary key,                    -- 'history/era-vojny', 'faction/fac_…'
  kind        text not null check (kind in ('history', 'faction')),
  slug        text unique,                          -- старый адрес страницы — для ссылок [page:…]
  title       text not null,
  cover_url   text,
  blocks      jsonb not null default '[]'::jsonb,
  faction_id  text,
  sort        integer not null default 0,
  published   boolean not null default true,
  source_page bigint,                               -- откуда перенесено (pages.id)
  updated_by  uuid,
  updated_at  timestamptz not null default now()
);
create index if not exists v1_lore_kind on public.v1_lore(kind, sort);
alter table public.v1_lore enable row level security;
drop policy if exists v1_lore_read on public.v1_lore;
create policy v1_lore_read on public.v1_lore for select using (published or public.v1_is_staff());
revoke insert, update, delete on public.v1_lore from anon, authenticated;
grant select on public.v1_lore to anon, authenticated;

-- ── летопись ──
insert into public.v1_lore(id, kind, slug, title, cover_url, blocks, sort, source_page)
select 'history/' || p.slug, 'history', p.slug,
       upper(left(lower(p.title), 1)) || substr(lower(p.title), 2), p.image_url,
       case when p.content ~ '^\s*\[' then p.content::jsonb else jsonb_build_array(jsonb_build_object('type', 'text', 'content', coalesce(p.content, ''))) end,
       case p.slug when 'era-otkrytyj' then 10 when 'era-vojny' then 20 else 30 end, p.id
  from public.pages p
 where p.section = 'history' and p.status = 'published'
on conflict (id) do nothing;

-- ── фракции, которые остались на карте ──
insert into public.v1_lore(id, kind, slug, title, cover_url, blocks, faction_id, sort, source_page)
select distinct on (fa.faction_id)
       'faction/' || fa.faction_id, 'faction', p.slug, fa.name, p.image_url,
       case when p.content ~ '^\s*\[' then p.content::jsonb else jsonb_build_array(jsonb_build_object('type', 'text', 'content', coalesce(p.content, ''))) end,
       fa.faction_id, 0, p.id
  from (select faction, count(*) n from public.map_systems where faction is not null group by faction) m
  join public.faction_applications fa on fa.faction_id = m.faction and fa.status = 'approved'
  join public.pages p on p.page_type = 'faction' and p.status = 'published' and lower(btrim(p.title)) = lower(btrim(fa.name))
 order by fa.faction_id, p.updated_at desc nulls last
on conflict (id) do nothing;

-- ── правка из админ-панели ──
create or replace function public.v1_x_lore(p_action text, p_target text, p_payload jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0;
begin
  case p_action
  when 'lore.save' then
    if coalesce(btrim(p_payload->>'title'), '') = '' then raise exception 'empty_title'; end if;
    if jsonb_typeof(p_payload->'blocks') <> 'array' then raise exception 'bad_blocks'; end if;
    insert into v1_lore(id, kind, slug, title, cover_url, blocks, faction_id, sort, published, updated_by, updated_at)
    values (p_target, coalesce(p_payload->>'kind', split_part(p_target, '/', 1)), nullif(p_payload->>'slug', ''), btrim(p_payload->>'title'),
            nullif(p_payload->>'cover_url', ''), p_payload->'blocks', nullif(p_payload->>'faction_id', ''),
            coalesce((p_payload->>'sort')::int, 0), coalesce((p_payload->>'published')::boolean, true), auth.uid(), now())
    on conflict (id) do update set title = excluded.title, cover_url = excluded.cover_url, blocks = excluded.blocks,
      slug = coalesce(excluded.slug, v1_lore.slug), faction_id = coalesce(excluded.faction_id, v1_lore.faction_id),
      sort = excluded.sort, published = excluded.published, updated_by = auth.uid(), updated_at = now();
    n := 1;
  when 'lore.delete' then
    delete from v1_lore where id = p_target; get diagnostics n = row_count;
  else raise exception 'unknown_action: %', p_action;
  end case;
  return n;
end $$;
revoke execute on function public.v1_x_lore(text, text, jsonb) from public, anon, authenticated;

insert into public.v1_action_policy(action, label, mode) values
  ('lore.save',   'Изменить страницу лора', 'free'),
  ('lore.delete', 'Удалить страницу лора',  'approval')
on conflict (action) do nothing;

select kind, count(*), string_agg(title, ', ' order by sort, title) from public.v1_lore group by kind;
