-- Классическая эра 1.0 · ДЕНЬ ПЕРЕЕЗДА: включить собственную экономику.
-- ⚠ Применять только в день переезда, вместе с 07, 08, 09 и 26. До этого — не трогать.
--
--   • выключает старый суточный тик экономики и старые задачи рынка и биржи;
--   • включает новый тик (settings.economy.live = true): с этого дня деньги, склад,
--     население, наука и агенты начисляются им; рынок нового движка становится настоящим;
--   • цены нового рынка переносятся в общий прайс (по нему считают верфь и заправка);
--   • старые заявки биржи закрываются с возвратом залога, старые торговые маршруты закрываются;
--   • last_tick всех держав выравнивается на «сейчас», чтобы первые сутки не задвоились.

set lock_timeout = '15s';

do $$
declare j text; r record;
begin
  foreach j in array array['economy-daily-tick', 'market-auto-tick', 'exchange-orders-sweep', 'exchange-session-sync'] loop
    perform cron.unschedule(j) where exists (select 1 from cron.job where jobname = j);
  end loop;

  update v1_settings set value = jsonb_set(value, '{live}', 'true'::jsonb), updated_at = now() where key = 'economy';
  update market_resources m set price = v.price from v1_market v where v.name = m.name;
  update faction_economy set last_tick = now();

  for r in select * from exchange_orders where status in ('open', 'active', 'partial') loop
    update faction_economy set gc = gc + greatest(0, coalesce(r.escrow, 0)) where faction_id = r.buyer_fid;
    update exchange_orders set status = 'cancelled', updated_at = now() where id = r.id;
  end loop;
  update trade_routes set status = 'closed' where status in ('active', 'pending');

  perform v1_bulletin('Экономика на новом движке',
    'С сегодняшнего дня суточные начисления, добыча, склад и рынок работают по новым правилам. Старые заявки биржи закрыты с возвратом залога, старые торговые маршруты закрыты — торговля теперь идёт через биржу и караваны.',
    '[]'::jsonb);
end $$;
