-- Классическая эра 1.0 · Закрытие функций базы от посторонних вызовов.
--
-- Проверка безопасности Supabase показала: почти тысяча функций с правами владельца
-- (security definer) вызывались напрямую через адрес базы любым посетителем — в том
-- числе служебные функции старого движка, которые браузер вызывать не должен.
--
-- Что делаем: у функций из списка ниже отзываем право вызова у гостей и игроков
-- (public, anon, authenticated). Список собран сверкой: функция есть в базе, но её
-- название не встречается ни в коде нового сайта, ни в коде старого сайта, ни в
-- edge-функциях — то есть браузер её не вызывает. Из списка дополнительно
-- исключаются функции, на которые ссылаются политики RLS, представления, обычные
-- (не security definer) функции, значения по умолчанию и ограничения таблиц —
-- им нужен доступ вызывающего.
-- Внутри игры ничего не ломается: функции, которые вызывают друг друга, работают
-- с правами владельца; cron работает от владельца; триггеры прав не проверяют.
-- service_role (edge-функции) доступ сохраняет.
--
-- Всё отозванное записывается в v1_revoked_functions — вернуть любую:
--   grant execute on function <signature> to anon, authenticated;
-- Новые функции по умолчанию больше НЕ открыты для гостей и игроков:
-- каждой нужной браузеру функции миграция должна выдавать grant явно.

set lock_timeout = '15s';

create table if not exists public.v1_revoked_functions (
  signature  text primary key,
  had_anon   boolean not null,
  had_auth   boolean not null,
  revoked_at timestamptz not null default now()
);
alter table public.v1_revoked_functions enable row level security;
revoke all on public.v1_revoked_functions from anon, authenticated;

do $$
declare
  cand text[] := array[
    '_abm_slots', '_abm_targets', '_angel_alive', '_angel_ark_bt', '_angel_dist', '_angel_fid', '_angel_foes',
    '_angel_free_hex', '_angel_grip', '_angel_guard_fell', '_angel_guard_left', '_angel_guard_watch',
    '_angel_host_orders', '_angel_is', '_angel_pace', '_angel_phase', '_angel_sandbox_bt', '_angel_say',
    '_angel_wound_cap', '_annex_pk', '_backfill_capitals', '_ball_boost', '_barter_check', '_battle_lock_fleet',
    '_bld_daily_gc', '_borders_blocked', '_bt_acts_of', '_bt_admin_full', '_bt_arm', '_bt_batteries',
    '_bt_bot_act', '_bt_bot_band', '_bt_bot_committed', '_bt_bot_doctrine', '_bt_bot_draft_due', '_bt_bot_eyes',
    '_bt_bot_focus', '_bt_bot_foe_reach', '_bt_bot_module', '_bt_bot_path', '_bt_bot_reach', '_bt_bot_repair',
    '_bt_bot_role', '_bt_bot_role_kit', '_bt_bot_route', '_bt_bot_slot', '_bt_bot_slot_side', '_bt_bot_target',
    '_bt_bot_work_reach', '_bt_check_end', '_bt_crowd_at', '_bt_flow_at', '_bt_guard_for', '_bt_is_machine_in',
    '_bt_pass_wait', '_bt_perk_block', '_bt_perk_kill', '_bt_perk_side', '_bt_perks_of', '_bt_require_turn',
    '_bt_resist', '_bt_seen_arm', '_bt_seen_calc', '_bt_seen_get', '_bt_side', '_bt_side_aa', '_bt_side_actors',
    '_bt_spawn_free', '_bt_stats', '_bt_threat_at', '_bt_units_acts_fill', '_budget_unit_gate', '_caravan_inflow',
    '_caravan_path', '_ch_of_user', '_corp_can_found', '_corp_fundamental', '_corp_market_cap',
    '_corp_sector_mult', '_corp_spark', '_covert_rumor_after', '_defense_can_see', '_demand_factor',
    '_div_block_unit', '_doom_intercept', '_doom_news', '_ec_build_cost', '_ec_colonize_cost', '_ec_my_fid',
    '_ec_my_fid_opt', '_ec_planet', '_ec_station_for', '_ec_terra_tier', '_econ_adjust', '_econ_policy_cd_days',
    '_econ_policy_fleet_mult', '_econ_policy_key', '_econ_policy_mods', '_econ_policy_points', '_ex_mark',
    '_fac_name', '_fac_owner', '_fac_workers', '_faction_enlightened', '_faction_is_robot', '_faction_mods',
    '_faction_native_all', '_faction_ref_columns', '_faction_unit_delete_guard', '_faith_can_found',
    '_faith_coverage', '_faith_exposed_here', '_faith_flock', '_faith_member', '_faith_monuments_n', '_faith_of',
    '_faith_offers_in', '_faith_strength', '_faith_strength_total', '_faith_temple_rate', '_faith_unit_discount',
    '_fc_arena_price', '_fc_my_open_duel', '_fc_news', '_fc_price_k', '_fc_pw', '_flak_mitigation',
    '_fleet_aa_count', '_fleet_bfs', '_fleet_can_refuel', '_fleet_cap_for', '_fleet_capacity', '_fleet_flak',
    '_fleet_fly_hours', '_fleet_fuel_for', '_fleet_in_battle', '_fleet_jumps', '_fleet_lane_avg',
    '_fleet_leg_hours', '_fleet_overcap_pen', '_fleet_path', '_fleet_schedule', '_fleet_speed', '_fleet_tank_trg',
    '_fleet_used', '_fm_council', '_fm_council_mods', '_fm_coverage', '_fm_gate', '_fm_in_scope', '_fm_member_fid',
    '_fm_my_perms', '_fm_my_row', '_fm_own_fid', '_fm_owner_fid', '_fm_war_mods', '_garrison_free',
    '_garrison_over_ratio', '_garrison_pen', '_garrison_units', '_goods_recipe', '_ground_default_stack',
    '_ground_deploy', '_ground_free_cell', '_ground_holder', '_ground_is_sandbox', '_ground_orbit_ok',
    '_ground_pool', '_ground_war_between', '_hazard_presence', '_house_pool', '_intel_capital_sys',
    '_intel_op_sys', '_intel_posts', '_intel_slots', '_legion_compose', '_legion_debt_lair', '_legion_defenders',
    '_legion_feed', '_legion_grade', '_legion_interest', '_legion_is_lair', '_legion_muscle', '_legion_my_targets',
    '_legion_on_salvo', '_legion_on_salvo_new', '_legion_salvo_grudge', '_legion_salvo_launch_grudge',
    '_legion_sector_fat', '_legion_sector_guard', '_legion_sector_of', '_legion_sys_guard', '_legion_targets',
    '_legion_wrath_targets', '_life_faith_found_after', '_life_faith_join_after', '_life_union_create_after',
    '_life_union_join_after', '_life_vassal_after', '_luck_feed', '_market_news_pulse', '_mine_breakdown',
    '_msl_touch', '_mza_dist_hours', '_mza_hops', '_nemesis_on_building', '_news_vk_notify', '_notif_since',
    '_outpost_can_deploy', '_outpost_fly_hours', '_outpost_manned', '_outpost_right_ok', '_outpost_send_ok',
    '_own_follow_fid', '_pages_set_author', '_pc_arrears_on_act', '_pc_arrears_stage', '_pc_arrears_total',
    '_pc_calm', '_pc_envoy_pick', '_pc_faith_boost', '_pc_forbidden', '_pc_gate', '_pc_has_fleet',
    '_pc_ichor_mult', '_pc_ignite_guard', '_pc_journal', '_pc_risen_price', '_pd_blank_email',
    '_pd_identity_guard', '_pd_users_meta_guard', '_perk_gate_ok', '_poverty_import_active',
    '_poverty_relief_prosp', '_promo_staff', '_prosp_of', '_public_profiles', '_raid_free_design',
    '_raid_free_ships', '_rarity_off', '_rarity_prio', '_repair_cost', '_res_pol_off', '_res_pol_prio',
    '_research_slots', '_rift_patron_ok', '_route_passes', '_rules_can_post', '_sector_claim_after',
    '_sector_newfaction_after', '_ship_power_avg', '_spy_agent_cap', '_spy_agent_xp_mult', '_spy_artifact_det',
    '_spy_artifact_on_agent_gone', '_spy_artifact_succ', '_spy_artifact_xpmult', '_spy_case_build',
    '_spy_case_view', '_spy_ci_power', '_spy_my_captive', '_spy_profile', '_su_is_member', '_su_lead_of',
    '_su_members', '_su_prov_columns', '_su_raw_fid', '_system_balance', '_system_balance_net',
    '_system_is_capital', '_unit_flak', '_war_battle_block', '_war_hostile_fleet', '_war_is_leader', '_war_news',
    '_war_nm', '_war_occ_news', '_war_side_for', '_war_side_of', '_war_sys_share', '_wb_hub_bonus',
    '_wb_hub_level', '_wb_hub_unit', '_wb_identity', '_worker_alloc', '_worker_demand', '_worker_deposits',
    '_world_kind', '_world_map', 'abm_buy_ammo', 'abm_log', 'abm_pick', 'admin_access_history',
    'admin_angel_ascend', 'admin_angel_descend', 'admin_angel_exodus', 'admin_angel_guard_muster',
    'admin_angel_guard_reset', 'admin_angel_host_muster', 'admin_angel_release', 'admin_angel_seals',
    'admin_angel_tick', 'admin_angel_waiver', 'admin_faction_battle_ai', 'admin_get_user_email',
    'admin_multiacc_report', 'admin_purge_orphans', 'admin_war_end', 'admin_world_melted_to_ideal',
    'angel_ai_tick', 'angel_battle_deploy', 'angel_epochs', 'angel_exodus_begin', 'angel_guard_muster',
    'angel_host_muster', 'angel_incoming', 'angel_melt_finish', 'angel_voice', 'assert_not_banned', 'at_war',
    'battle_shield', 'bonds_settle', 'chat_can_read', 'chat_can_subj', 'chat_edit_guard', 'chat_reply_guard',
    'chat_trim', 'chat_typing_trim', 'colony_occupations', 'corp_building_set', 'corp_fix', 'corp_index_tick',
    'counterintel_set', 'current_user_banned', 'current_user_role', 'doom_set_approach', 'econ_policy_status',
    'economy_accrue', 'economy_dev_charge', 'economy_open_slot', 'economy_sell_resource', 'economy_tick_all',
    'ensure_capital_location', 'exchange_session_sync', 'fc_ally_turn', 'fleet_capacity_status', 'fleet_flak',
    'fleet_position', 'fm_council', 'futures_settle', 'goods_recipe_get', 'ground_landing_check',
    'intel_guard_list', 'legal_has_accepted', 'legion_ai_tick', 'legion_battle_deploy', 'legion_campaign_tick',
    'legion_contact_position', 'legion_contacts_notify', 'legion_contacts_scan', 'legion_contacts_sweep',
    'legion_engage_tick', 'legion_intercept_tick', 'legion_losses_sweep', 'legion_press_tick',
    'legion_pressure_tick', 'legion_spoils_tick', 'legion_standoff_tick', 'legion_state', 'legion_vendetta_tick',
    'logistics_close', 'logistics_create', 'map_sys_lanes_build', 'map_sys_lanes_build_all', 'margin_settle',
    'market_tick', 'minefield_clear', 'mining_assign', 'mt_cache_gc', 'news_vk_digest', 'options_settle',
    'orders_sweep', 'outpost_build', 'outpost_set_resource', 'outposts_mine', 'pc_crisis_tick', 'pc_risen_restock',
    'pc_start_attitude', 'pd_erase_me', 'pd_export_me', 'planet_defense_status', 'precursor_anchor_set',
    'precursor_scan_contacts', 'precursor_tick_all', 'relink_dead_units', 'res_flow_clear', 'res_sell_now',
    'resource_priority_set', 'sector_event_set', 'shipyard_damaged', 'slaves_tick', 'spy_counter_list',
    'spy_counter_set', 'spy_investigate', 'spy_mission', 'system_protection', 'tg_faction_page_ensure',
    'tg_faction_page_guard', 'tg_union_page_ensure', 'trade_propose', 'v1_alloy_after_change', 'v1_alloy_calc',
    'v1_app', 'v1_at_war', 'v1_budget_row', 'v1_budget_upkeep', 'v1_build_price', 'v1_can_manage',
    'v1_colony_body', 'v1_colony_rules', 'v1_course_mods', 'v1_discord_role_backfill', 'v1_discord_role_trg',
    'v1_faction_mods', 'v1_fname', 'v1_fuel_after_change', 'v1_fuel_raw', 'v1_is_active_faction', 'v1_is_robot',
    'v1_is_staff', 'v1_is_superadmin', 'v1_my_faction', 'v1_news_guard', 'v1_news_rumors', 'v1_open_slot',
    'v1_part_after_change', 'v1_pop', 'v1_projects_step', 'v1_reactor_calc', 'v1_research_slots',
    'v1_research_step', 'v1_role_of', 'v1_ship_calc', 'v1_team', 'v1_tech_cost', 'v1_terraform_tier',
    'v1_union_senior', 'v1_war_share', 'v1_war_side', 'v1_weapon_calc', 'v1_world_kind', 'war_enemies_of',
    'wellbeing_status', 'wiki_faction_page_ensure', 'wiki_union_page_ensure', 'world_class',
    'world_melted_to_ideal'
  ];
  refs text;
  f record; n_rev int := 0; n_keep int := 0; kept text[] := '{}';
begin
  -- всё, где имя функции может понадобиться вызывающему
  select coalesce(string_agg(t, ' '), '') into refs from (
    select pg_get_expr(polqual, polrelid) t from pg_policy
    union all select pg_get_expr(polwithcheck, polrelid) from pg_policy
    union all select pg_get_viewdef(c.oid) from pg_class c join pg_namespace s on s.oid = c.relnamespace
              where c.relkind in ('v', 'm') and s.nspname in ('public', 'storage')
    union all select prosrc from pg_proc where pronamespace = 'public'::regnamespace and not prosecdef
    union all select pg_get_expr(adbin, adrelid) from pg_attrdef
    union all select pg_get_constraintdef(oid) from pg_constraint where contype = 'c'
  ) z where t is not null;

  for f in select p.oid, p.proname, p.oid::regprocedure::text sig,
                  has_function_privilege('anon', p.oid, 'execute') a,
                  has_function_privilege('authenticated', p.oid, 'execute') u
             from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname = any(cand) loop
    if refs ~ ('(^|[^a-z0-9_])' || f.proname || '\s*\(') then
      n_keep := n_keep + 1; kept := kept || f.proname; continue;
    end if;
    if not (f.a or f.u) then continue; end if;
    insert into v1_revoked_functions(signature, had_anon, had_auth) values (f.sig, f.a, f.u)
      on conflict (signature) do nothing;
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
    n_rev := n_rev + 1;
  end loop;
  raise notice 'закрыто функций: %, оставлено из-за ссылок: % (%)', n_rev, n_keep, array_to_string(kept, ', ');
end $$;

-- новые функции — закрыты по умолчанию
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public grant execute on functions to service_role;
