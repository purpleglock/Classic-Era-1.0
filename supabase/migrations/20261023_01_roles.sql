-- Классическая эра 1.0 · роли, одобрения, журнал
--
-- Роли для игроков:
--   • Команда проекта — суперадмин (может всё) или админ (часть действий
--     только с одобрения суперадмина);
--   • Игрок — есть своя держава или членство в державе;
--   • Гость — просмотр и регистрация.
--
-- Миграция только ДОБАВЛЯЕТ объекты с префиксом v1_. Старые таблицы
-- и старый сайт не меняются. Все действия админки идут через функции
-- v1_admin_do / v1_admin_decide: проверка прав и одобрение — на сервере,
-- обойти их из браузера нельзя.
-- Команда проекта
create table if not exists public.v1_staff (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  level      text not null check (level in ('superadmin','admin')),
  title      text,
  granted_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Политика действий: что админ делает сам, а что через одобрение
--   free       — админ выполняет сразу;
--   approval   — админ создаёт заявку, выполняет суперадмин;
--   superadmin — только суперадмин.
create table if not exists public.v1_action_policy (
  action     text primary key,
  label      text not null,
  mode       text not null check (mode in ('free','approval','superadmin')),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

-- Заявки админов на одобрение
create table if not exists public.v1_admin_requests (
  id            uuid primary key default gen_random_uuid(),
  requested_by  uuid not null references auth.users(id),
  action        text not null references public.v1_action_policy(action),
  target        text,
  payload       jsonb not null default '{}'::jsonb,
  note          text,
  status        text not null default 'pending' check (status in ('pending','approved','rejected','cancelled','failed')),
  decided_by    uuid references auth.users(id),
  decided_at    timestamptz,
  decision_note text,
  result        jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists v1_admin_requests_status_idx on public.v1_admin_requests(status, created_at desc);

-- Журнал всех действий команды
create table if not exists public.v1_audit_log (
  id         bigint generated always as identity primary key,
  actor      uuid references auth.users(id),
  action     text not null,
  target     text,
  payload    jsonb,
  outcome    text not null,            -- done | requested | approved | rejected | cancelled | failed
  request_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists v1_audit_log_created_idx on public.v1_audit_log(created_at desc);

-- Посты администрации на главной (ивенты, лор, объявления)
create table if not exists public.v1_posts (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null default 'announce' check (kind in ('event','lore','announce')),
  title      text not null,
  body       text not null default '',
  published  boolean not null default false,
  author_id  uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Гайдбук и правила: тексты, которые команда правит в админ-панели
create table if not exists public.v1_docs (
  id         text primary key,                 -- 'guide/start', 'rules/main'
  kind       text not null check (kind in ('guide','rules')),
  grp        text not null default '',
  title      text not null,
  body       text not null default '',
  sort       integer not null default 0,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
create index if not exists v1_docs_kind_idx on public.v1_docs(kind, sort);

-- Проверки ролей
create or replace function public.v1_is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from v1_staff where user_id = auth.uid());
$$;

create or replace function public.v1_is_superadmin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from v1_staff where user_id = auth.uid() and level = 'superadmin');
$$;

-- Кто я: роль, уровень команды, бан, держава, число заявок для суперадмина.
create or replace function public.v1_my_role() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  lvl text; fid text; banned boolean := false; dname text;
begin
  if uid is null then
    return jsonb_build_object('role','guest');
  end if;
  select level into lvl from v1_staff where user_id = uid;
  select coalesce(bool_or(is_banned), false), max(display_name) into banned, dname from user_roles where user_id = uid;
  select faction_id into fid from faction_economy where owner_id = uid order by created_at limit 1;
  if fid is null then
    select faction_id into fid from faction_members where user_id = uid and status = 'active' order by created_at limit 1;
  end if;
  if dname is null then
    select display_name into dname from profiles where user_id = uid limit 1;
  end if;
  return jsonb_build_object(
    'role', case when lvl is not null then 'team'
                 when banned then 'guest'
                 when fid is not null then 'player'
                 else 'guest' end,
    'level', lvl,
    'banned', banned,
    'faction_id', fid,
    'display_name', dname,
    'pending_requests', case when lvl = 'superadmin'
                             then (select count(*) from v1_admin_requests where status = 'pending') end
  );
end $$;

-- Публичный состав команды (для значков «Команда проекта» у игроков).
create or replace function public.v1_team() returns table(user_id uuid, display_name text, level text, title text)
language sql stable security definer set search_path = public as $$
  select s.user_id,
         coalesce((select max(r.display_name) from user_roles r where r.user_id = s.user_id),
                  (select max(p.display_name) from profiles p where p.user_id = s.user_id),
                  'Команда проекта'),
         s.level, s.title
  from v1_staff s order by s.level desc, s.created_at;
$$;

-- Публичная роль любого пользователя: team | player | guest.
create or replace function public.v1_role_of(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from v1_staff where user_id = p_user) then 'team'
    when exists (select 1 from faction_economy where owner_id = p_user)
      or exists (select 1 from faction_members where user_id = p_user and status = 'active') then 'player'
    else 'guest' end;
$$;

-- Сводка галактики для главной.
create or replace function public.v1_galaxy_stats() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'factions', (select count(*) from faction_economy),
    'colonies', (select count(*) from colonies),
    'battles',  (select count(*) from battles)
  );
$$;

-- Исполнитель действий (вызывается только изнутри, не из браузера)
create or replace function public.v1__exec(p_action text, p_target text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  n integer := 0;
  actor uuid := auth.uid();
  actor_name text := coalesce((select max(display_name) from user_roles where user_id = auth.uid()), 'Команда проекта');
  actor_email text := (select email from auth.users where id = auth.uid());
begin
  case p_action
  -- тикеты
  when 'ticket.reply' then
    if coalesce(trim(p_payload->>'body'),'') = '' then raise exception 'empty_body'; end if;
    insert into ticket_messages(ticket_id, author_id, author_name, is_staff, body)
    values (p_target::uuid, actor, actor_name, true, p_payload->>'body');
    get diagnostics n = row_count;
  when 'ticket.close' then
    update tickets set status = 'closed', closed_at = now(), closed_by = actor_email where id = p_target::uuid;
    get diagnostics n = row_count;
  when 'ticket.reopen' then
    update tickets set status = 'open', closed_at = null, closed_by = null where id = p_target::uuid;
    get diagnostics n = row_count;

  -- новости
  when 'news.approve' then
    update faction_news set status = 'approved', published_at = coalesce(published_at, now()),
           reviewed_by = actor_email, updated_at = now()
     where id = p_target::uuid and status = 'pending';
    get diagnostics n = row_count;
  when 'news.reject' then
    update faction_news set status = 'rejected', reject_reason = p_payload->>'reason',
           reviewed_by = actor_email, updated_at = now()
     where id = p_target::uuid and status = 'pending';
    get diagnostics n = row_count;

  -- заявки на регистрацию держав
  when 'app.reject' then
    update faction_applications set status = 'rejected', pending_review = false,
           reject_reason = p_payload->>'reason', reviewed_by = actor_email, updated_at = now()
     where id = p_target::uuid;
    get diagnostics n = row_count;
  when 'app.return' then
    update faction_applications set status = 'draft', pending_review = false,
           reject_reason = p_payload->>'reason', reviewed_by = actor_email, updated_at = now()
     where id = p_target::uuid;
    get diagnostics n = row_count;

  -- страницы
  when 'page.update' then
    update pages set title = coalesce(p_payload->>'title', title),
                     content = coalesce(p_payload->>'content', content),
                     updated_at = now(), updated_by = actor
     where id = p_target::bigint;
    get diagnostics n = row_count;
  when 'page.delete' then
    delete from pages where id = p_target::bigint;
    get diagnostics n = row_count;

  -- посты администрации
  when 'doc.save' then
    if coalesce(trim(p_payload->>'title'),'') = '' then raise exception 'empty_title'; end if;
    insert into v1_docs(id, kind, grp, title, body, sort, updated_by, updated_at)
    values (p_target, coalesce(p_payload->>'kind', split_part(p_target, '/', 1)), coalesce(p_payload->>'grp', ''),
            p_payload->>'title', coalesce(p_payload->>'body', ''), coalesce((p_payload->>'sort')::int, 0), actor, now())
    on conflict (id) do update set
      grp = coalesce(p_payload->>'grp', v1_docs.grp), title = excluded.title, body = excluded.body,
      sort = coalesce((p_payload->>'sort')::int, v1_docs.sort), updated_by = actor, updated_at = now();
    n := 1;
  when 'doc.delete' then
    delete from v1_docs where id = p_target; get diagnostics n = row_count;
  when 'post.delete' then
    delete from v1_posts where id = p_target::uuid;
    get diagnostics n = row_count;

  -- пользователи
  when 'user.ban' then
    update user_roles set is_banned = true where user_id = p_target::uuid;
    get diagnostics n = row_count;
    if n = 0 then
      insert into user_roles(user_id, role, is_banned) values (p_target::uuid, 'viewer', true);
      n := 1;
    end if;
  when 'user.unban' then
    update user_roles set is_banned = false where user_id = p_target::uuid;
    get diagnostics n = row_count;
  when 'user.set_level' then
    update member_levels set level = (p_payload->>'level')::int, updated_at = now() where user_id = p_target::uuid;
    get diagnostics n = row_count;

  -- держава
  when 'faction.treasury' then
    update faction_economy
       set gc = gc + coalesce((p_payload->>'gc')::numeric, 0),
           science = science + coalesce((p_payload->>'science')::numeric, 0)
     where faction_id = p_target;
    get diagnostics n = row_count;

  -- команда проекта и политика (только суперадмин)
  when 'staff.grant' then
    if (p_payload->>'level') not in ('superadmin','admin') then raise exception 'bad_level'; end if;
    insert into v1_staff(user_id, level, granted_by) values (p_target::uuid, p_payload->>'level', actor)
    on conflict (user_id) do update set level = excluded.level, granted_by = excluded.granted_by;
    n := 1;
  when 'staff.revoke' then
    if (select level from v1_staff where user_id = p_target::uuid) = 'superadmin'
       and (select count(*) from v1_staff where level = 'superadmin') <= 1 then
      raise exception 'last_superadmin';
    end if;
    delete from v1_staff where user_id = p_target::uuid;
    get diagnostics n = row_count;
  when 'policy.set' then
    if p_target in ('staff.grant','staff.revoke','policy.set') then raise exception 'policy_locked'; end if;
    if (p_payload->>'mode') not in ('free','approval','superadmin') then raise exception 'bad_mode'; end if;
    update v1_action_policy set mode = p_payload->>'mode', updated_by = actor, updated_at = now() where action = p_target;
    get diagnostics n = row_count;

  else
    -- Действия модулей: 'map.lane.add' → функция v1_x_map(action, target, payload).
    -- Каждый модуль приносит свою функцию своей миграцией.
    if split_part(p_action, '.', 1) ~ '^[a-z]+$'
       and to_regprocedure(format('public.v1_x_%s(text,text,jsonb)', split_part(p_action, '.', 1))) is not null then
      execute format('select public.v1_x_%s($1, $2, $3)', split_part(p_action, '.', 1))
        into strict n using p_action, p_target, p_payload;
    else
      raise exception 'unknown_action: %', p_action;
    end if;
  end case;

  return jsonb_build_object('rows', n);
end $$;

-- Действия команды и одобрения
create or replace function public.v1_admin_do(p_action text, p_target text, p_payload jsonb default '{}'::jsonb, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  lvl text; pmode text; rid uuid; res jsonb;
begin
  select level into lvl from v1_staff where user_id = uid;
  if lvl is null then raise exception 'not_staff' using errcode = '42501'; end if;

  select mode into pmode from v1_action_policy where action = p_action;
  if pmode is null then raise exception 'unknown_action: %', p_action; end if;
  if pmode = 'superadmin' and lvl <> 'superadmin' then
    raise exception 'superadmin_only' using errcode = '42501';
  end if;

  if lvl = 'superadmin' or pmode = 'free' then
    res := v1__exec(p_action, p_target, coalesce(p_payload, '{}'::jsonb));
    insert into v1_audit_log(actor, action, target, payload, outcome) values (uid, p_action, p_target, p_payload, 'done');
    return jsonb_build_object('status', 'done', 'result', res);
  end if;

  insert into v1_admin_requests(requested_by, action, target, payload, note)
  values (uid, p_action, p_target, coalesce(p_payload, '{}'::jsonb), p_note)
  returning id into rid;
  insert into v1_audit_log(actor, action, target, payload, outcome, request_id) values (uid, p_action, p_target, p_payload, 'requested', rid);
  return jsonb_build_object('status', 'pending', 'request_id', rid);
end $$;

create or replace function public.v1_admin_decide(p_request uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r v1_admin_requests%rowtype;
  res jsonb;
begin
  if not v1_is_superadmin() then raise exception 'superadmin_only' using errcode = '42501'; end if;
  select * into r from v1_admin_requests where id = p_request for update;
  if not found then raise exception 'request_not_found'; end if;
  if r.status <> 'pending' then raise exception 'request_already_decided'; end if;

  if not p_approve then
    update v1_admin_requests set status = 'rejected', decided_by = uid, decided_at = now(), decision_note = p_note where id = r.id;
    insert into v1_audit_log(actor, action, target, payload, outcome, request_id) values (uid, r.action, r.target, r.payload, 'rejected', r.id);
    return jsonb_build_object('status', 'rejected');
  end if;

  begin
    res := v1__exec(r.action, r.target, r.payload);
  exception when others then
    update v1_admin_requests set status = 'failed', decided_by = uid, decided_at = now(), decision_note = p_note,
           result = jsonb_build_object('error', sqlerrm) where id = r.id;
    insert into v1_audit_log(actor, action, target, payload, outcome, request_id) values (uid, r.action, r.target, r.payload, 'failed', r.id);
    return jsonb_build_object('status', 'failed', 'error', sqlerrm);
  end;
  update v1_admin_requests set status = 'approved', decided_by = uid, decided_at = now(), decision_note = p_note, result = res where id = r.id;
  insert into v1_audit_log(actor, action, target, payload, outcome, request_id) values (uid, r.action, r.target, r.payload, 'approved', r.id);
  return jsonb_build_object('status', 'approved', 'result', res);
end $$;

-- Админ может отозвать свою заявку, пока её не рассмотрели.
create or replace function public.v1_admin_cancel(p_request uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update v1_admin_requests set status = 'cancelled', decided_at = now()
   where id = p_request and requested_by = auth.uid() and status = 'pending';
  if not found then raise exception 'request_not_cancellable'; end if;
  insert into v1_audit_log(actor, action, outcome, request_id) values (auth.uid(), 'request.cancel', 'cancelled', p_request);
  return jsonb_build_object('status', 'cancelled');
end $$;

-- Списки для админ-панели (только команда)
-- Почты и IP видит только суперадмин: админу они не нужны.
create or replace function public.v1_admin_list(p_kind text, p_q text default null, p_limit integer default 50)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  sa boolean := v1_is_superadmin();
  lim integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  q text := nullif(trim(coalesce(p_q, '')), '');
  out jsonb;
begin
  if not v1_is_staff() then raise exception 'not_staff' using errcode = '42501'; end if;

  case p_kind
  when 'tickets' then
    select coalesce(jsonb_agg(t order by t.created_at desc), '[]') into out from (
      select k.id, k.category, k.description, k.status, k.user_name, k.created_at, k.closed_at,
             (select coalesce(jsonb_agg(jsonb_build_object('author', m.author_name, 'staff', m.is_staff, 'body', m.body, 'at', m.created_at) order by m.created_at), '[]')
                from ticket_messages m where m.ticket_id = k.id) as messages
      from tickets k
      where (q is null or k.status = q)
      order by k.created_at desc limit lim) t;

  when 'apps' then
    select coalesce(jsonb_agg(a order by a.created_at desc), '[]') into out from (
      select f.id, f.owner_id, f.name, f.color, f.gov, f.regime, f.race, f.civ_type, f.system_name, f.planet_name,
             f.ideology, f.culture, left(f.history, 2000) as history, f.herald_url, f.status, f.pending_review,
             f.created_at, f.updated_at,
             coalesce((select max(display_name) from user_roles where user_id = f.owner_id), 'Игрок') as owner_name
      from faction_applications f
      where f.status = 'pending' or f.pending_review is true
      order by f.created_at desc limit lim) a;

  when 'news' then
    select coalesce(jsonb_agg(x order by x.created_at desc), '[]') into out from (
      select n.id, n.faction_id, n.faction_name, n.title, n.excerpt, left(n.body, 4000) as body, n.image_url, n.created_at
      from faction_news n where n.status = 'pending'
      order by n.created_at desc limit lim) x;

  when 'factions' then
    select coalesce(jsonb_agg(x order by x.name), '[]') into out from (
      select e.faction_id, coalesce(f.name, e.faction_id) as name, f.herald_url, e.gc, e.science,
             coalesce((select max(display_name) from user_roles where user_id = e.owner_id), 'Игрок') as owner_name,
             (select count(*) from colonies c where c.faction_id = e.faction_id) as colonies
      from faction_economy e
      left join lateral (select name, herald_url from faction_applications fa
                          where fa.faction_id = e.faction_id and fa.status = 'approved' limit 1) f on true
      where q is null or f.name ilike '%' || q || '%'
      limit lim) x;

  when 'users' then
    select coalesce(jsonb_agg(u), '[]') into out from (
      select au.id,
             coalesce((select max(display_name) from user_roles where user_id = au.id),
                      (select max(display_name) from profiles where user_id = au.id), 'Без имени') as name,
             case when sa then au.email end as email,
             v1_role_of(au.id) as role,
             (select level from v1_staff where user_id = au.id) as staff_level,
             coalesce((select bool_or(is_banned) from user_roles where user_id = au.id), false) as banned,
             (select level from member_levels where user_id = au.id) as level,
             au.created_at, au.last_sign_in_at
      from auth.users au
      where q is null
         or au.email ilike '%' || q || '%'
         or exists (select 1 from user_roles r where r.user_id = au.id and r.display_name ilike '%' || q || '%')
      order by au.last_sign_in_at desc nulls last
      limit lim) u;

  when 'multi' then
    with s as (
      select user_id, count(*) as logins, max(created_at) as last_at,
             array_agg(distinct ip) filter (where ip is not null) as ips,
             array_agg(distinct fingerprint) filter (where fingerprint is not null) as fps
      from access_log where user_id is not null group by user_id
    )
    select coalesce(jsonb_agg(x order by (x->>'ip_shared')::int + (x->>'fp_shared')::int desc, x->>'last_at' desc), '[]') into out from (
      select jsonb_build_object(
        'user_id', s.user_id,
        'name', coalesce((select max(display_name) from user_roles where user_id = s.user_id), 'Без имени'),
        'logins', s.logins, 'last_at', s.last_at,
        'ip_shared', (select count(distinct o.user_id) from s o where o.user_id <> s.user_id and o.ips && s.ips),
        'fp_shared', (select count(distinct o.user_id) from s o where o.user_id <> s.user_id and o.fps && s.fps),
        'ips', case when sa then to_jsonb(s.ips) end
      ) as x from s limit lim) t;

  when 'pages' then
    select coalesce(jsonb_agg(p order by p.section, p.sort_order, p.title), '[]') into out from (
      select id, slug, title, section, page_type, status, sort_order, updated_at
      from pages where q is null or title ilike '%' || q || '%' or section = q limit lim) p;

  when 'page' then
    select to_jsonb(p) into out from (select id, slug, title, content, section, page_type, status from pages where id = q::bigint) p;

  when 'requests' then
    select coalesce(jsonb_agg(r order by r.created_at desc), '[]') into out from (
      select rq.id, rq.action, (select label from v1_action_policy where action = rq.action) as label,
             rq.target, rq.payload, rq.note, rq.status, rq.created_at, rq.decided_at, rq.decision_note,
             coalesce((select max(display_name) from user_roles where user_id = rq.requested_by), 'Админ') as requested_by_name,
             rq.requested_by = auth.uid() as mine
      from v1_admin_requests rq
      where (sa or rq.requested_by = auth.uid()) and (q is null or rq.status = q)
      order by rq.created_at desc limit lim) r;

  when 'audit' then
    select coalesce(jsonb_agg(a order by a.created_at desc), '[]') into out from (
      select l.id, l.action, l.target, l.outcome, l.created_at,
             coalesce((select max(display_name) from user_roles where user_id = l.actor), 'Команда') as actor_name
      from v1_audit_log l order by l.created_at desc limit lim) a;

  when 'docs' then
    select coalesce(jsonb_agg(d order by d.kind, d.sort), '[]') into out from (
      select id, kind, grp, title, sort, updated_at from v1_docs where q is null or kind = q) d;

  when 'policy' then
    select coalesce(jsonb_agg(p order by p.action), '[]') into out from (select action, label, mode from v1_action_policy) p;

  when 'staff' then
    select coalesce(jsonb_agg(s), '[]') into out from (select * from v1_team()) s;

  else
    raise exception 'unknown_list: %', p_kind;
  end case;

  return out;
end $$;

-- Доступ
alter table public.v1_staff          enable row level security;
alter table public.v1_action_policy  enable row level security;
alter table public.v1_admin_requests enable row level security;
alter table public.v1_audit_log      enable row level security;
alter table public.v1_posts          enable row level security;
alter table public.v1_docs           enable row level security;

-- Гайдбук и правила читают все; пишут только через v1_admin_do('doc.save' / 'doc.delete').
drop policy if exists v1_docs_read on public.v1_docs;
create policy v1_docs_read on public.v1_docs for select using (true);
revoke insert, update, delete on public.v1_docs from anon, authenticated;
grant select on public.v1_docs to anon, authenticated;

-- Таблицы команды из браузера не читаются и не пишутся напрямую — только через функции выше.
revoke all on public.v1_staff, public.v1_action_policy, public.v1_admin_requests, public.v1_audit_log from anon, authenticated;

-- Посты: опубликованные видят все, команда пишет и правит, удаление — через v1_admin_do('post.delete').
drop policy if exists v1_posts_read   on public.v1_posts;
drop policy if exists v1_posts_insert on public.v1_posts;
drop policy if exists v1_posts_update on public.v1_posts;
create policy v1_posts_read   on public.v1_posts for select using (published or public.v1_is_staff());
create policy v1_posts_insert on public.v1_posts for insert to authenticated with check (public.v1_is_staff() and author_id = auth.uid());
create policy v1_posts_update on public.v1_posts for update to authenticated using (public.v1_is_staff()) with check (public.v1_is_staff());
revoke delete on public.v1_posts from anon, authenticated;

revoke execute on function public.v1__exec(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.v1_my_role(), public.v1_team(), public.v1_role_of(uuid), public.v1_galaxy_stats() to anon, authenticated;
grant execute on function public.v1_is_staff(), public.v1_is_superadmin() to anon, authenticated;
revoke execute on function public.v1_admin_do(text, text, jsonb, text), public.v1_admin_decide(uuid, boolean, text),
                           public.v1_admin_cancel(uuid), public.v1_admin_list(text, text, integer) from public, anon;
grant execute on function public.v1_admin_do(text, text, jsonb, text), public.v1_admin_decide(uuid, boolean, text),
                          public.v1_admin_cancel(uuid), public.v1_admin_list(text, text, integer) to authenticated;

-- Политика по умолчанию (суперадмин может менять через policy.set)
insert into public.v1_action_policy(action, label, mode) values
  ('ticket.reply',     'Ответить на тикет',                 'free'),
  ('ticket.close',     'Закрыть тикет',                     'free'),
  ('ticket.reopen',    'Открыть тикет заново',              'free'),
  ('news.approve',     'Одобрить новость',                  'free'),
  ('news.reject',      'Отклонить новость',                 'free'),
  ('app.reject',       'Отклонить заявку державы',          'free'),
  ('app.return',       'Вернуть заявку на доработку',       'free'),
  ('page.update',      'Изменить страницу',                 'free'),
  ('page.delete',      'Удалить страницу',                  'approval'),
  ('post.delete',      'Удалить пост администрации',        'approval'),
  ('doc.save',         'Изменить гайдбук или правила',      'free'),
  ('doc.delete',       'Удалить раздел гайдбука или правил','approval'),
  ('user.ban',         'Забанить пользователя',             'approval'),
  ('user.unban',       'Снять бан',                         'free'),
  ('user.set_level',   'Изменить уровень пользователя',     'approval'),
  ('faction.treasury', 'Изменить казну державы',            'approval'),
  ('staff.grant',      'Назначить в команду проекта',       'superadmin'),
  ('staff.revoke',     'Убрать из команды проекта',         'superadmin'),
  ('policy.set',       'Изменить правила одобрения',        'superadmin')
on conflict (action) do nothing;
