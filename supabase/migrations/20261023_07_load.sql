-- Классическая эра 1.0 · разгрузка базы.
-- В базе по расписанию работают задачи вырезанных механик. Они грызут процессор
-- базы круглые сутки, даже когда на сайте никого нет. Самая тяжёлая —
-- legion-ai-tick: ИИ Железного Легиона запускается КАЖДУЮ МИНУТУ, хотя набеги
-- Легиона выключены.
--
-- Запускать при переходе на новый сайт. Задачи только снимаются с расписания,
-- сами функции остаются — вернуть любую можно через cron.schedule.

select cron.unschedule(jobname) from cron.job where jobname in (
  'legion-ai-tick',            -- ИИ Железного Легиона, каждую минуту (набеги выключены)
  'angel-ai-tick',             -- ИИ «ангела», каждые 5 минут (вырезано)
  'angel-econ-tick',           -- экономика «ангела», каждый час (вырезано)
  'market-auto-tick',          -- биржа, каждые 10 минут (биржа на переработке)
  'exchange-session-sync',     -- биржа, каждый час
  'exchange-orders-sweep',     -- биржа, каждый час
  'news-vk-digest',            -- рассылка в VK, каждый час (VK больше не используется)
  'precursor-contacts-bonds',  -- дозвёздные миры, каждый час (вырезано)
  'precursor-levy',            -- дозвёздные миры, каждый час
  'pc-risen-tick'              -- дозвёздные миры, каждый час
);

-- Остаются: economy-daily-tick (доход раз в сутки), ground-landing-tick,
-- ground-battle-tick, ground-occupation-tick (наземная война), war-offers-expire
-- (ноты войны), access-log-prune и mt-cache-gc (уборка).
select jobname, schedule from cron.job where active order by jobname;

-- Журнал запусков cron — самая большая таблица базы (38 МБ из 141): каждые сутки
-- в него пишется ~2 800 строк. Чистим историю старше 3 дней и делаем это каждую ночь.
delete from cron.job_run_details where end_time < now() - interval '3 days';
select cron.unschedule('v1-cron-log-prune') where exists (select 1 from cron.job where jobname = 'v1-cron-log-prune');
select cron.schedule('v1-cron-log-prune', '29 4 * * *', $$delete from cron.job_run_details where end_time < now() - interval '3 days'$$);
