-- Классическая эра 1.0 · состав команды проекта
-- Запускать ПОСЛЕ 20261023_01_roles.sql.
--
-- Суперадмины на старте: владелец проекта и parhodkomisha@gmail.com.
-- Остальных добавьте сами: раскомментируйте строку и выберите уровень
-- 'superadmin' (может всё) или 'admin' (часть действий через одобрение).
insert into public.v1_staff(user_id, level, title)
select id, 'superadmin', 'Владелец проекта' from auth.users where email = 'mvsplaaa@gmail.com'
on conflict (user_id) do update set level = 'superadmin';

insert into public.v1_staff(user_id, level)
select id, 'superadmin' from auth.users where email = 'parhodkomisha@gmail.com'
on conflict (user_id) do update set level = 'superadmin';

-- insert into public.v1_staff(user_id, level)
-- select id, 'admin' from auth.users where email = 'nameredefined@gmail.com'
-- on conflict (user_id) do update set level = excluded.level;

-- insert into public.v1_staff(user_id, level)
-- select id, 'admin' from auth.users where email = 'maximum13b@gmail.com'
-- on conflict (user_id) do update set level = excluded.level;

-- Проверка: кто в команде.
select * from public.v1_team();
