import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/** Вызов функции базы с понятной ошибкой. */
export async function rpc(name, args = {}) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw humanError(error);
  return data;
}

const MESSAGES = {
  not_staff: 'Это действие доступно только команде проекта.',
  no_faction: 'У вас пока нет державы.',
  not_yours: 'Это не ваша держава.',
  not_allowed: 'У вас нет права колонизировать от имени державы.',
  not_adjacent: 'Система должна граничить по гиперпути с вашей территорией.',
  not_enough_gc: 'Не хватает ГС в казне.',
  system_taken: 'Систему уже кто-то занял.',
  system_foreign: 'Система принадлежит другой державе.',
  system_not_found: 'Система не найдена.',
  body_not_found: 'Планета не найдена.',
  body_taken: 'Здесь уже есть колония.',
  body_closed: 'Этот мир нельзя заселить.',
  need_terraform: 'Мир не родной для вашей расы — нужен терраформ.',
  tech_unknown: 'Такой технологии нет.',
  colony_foreign: 'Это не ваша колония.',
  building_foreign: 'Это не ваша постройка.',
  building_unknown: 'Такой постройки нет.',
  building_tech: 'Для этой постройки нужна технология.',
  building_world: 'Эта постройка не подходит для этого мира.',
  temple_no_faith: 'Храм можно строить, только если у державы есть вера.',
  no_cells: 'В колонии нет свободных ячеек.',
  slots_max: 'Все слоты уже открыты.',
  slot_busy: 'Слот уже строится.',
  habitat_busy: 'Обустройство уже идёт.',
  terraform_busy: 'Терраформ уже идёт.',
  terraform_not_needed: 'Этот мир можно заселить без терраформа.',
  capital_abandon: 'Столицу покинуть нельзя.',
  project_foreign: 'Проект не найден.',
  tech_frozen: 'Эта технология сейчас заморожена.',
  tech_done: 'Технология уже изучена.',
  tech_running: 'Технология уже изучается.',
  tech_queued: 'Технология уже в очереди.',
  slots_full: 'Все слоты исследований заняты — поставьте в очередь.',
  queue_full: 'Очередь заполнена: не больше 12 технологий.',
  not_enough_science: 'Не хватает очков науки.',
  bad_avatar: 'Аватар можно загрузить только через кнопку на этой странице.',
  bad_version: 'Неизвестная редакция документов.',
  superadmin_only: 'Это действие может выполнить только суперадмин.',
  request_already_decided: 'Заявку уже рассмотрели.',
  request_not_cancellable: 'Заявку уже нельзя отозвать.',
  last_superadmin: 'Нельзя убрать последнего суперадмина.',
  policy_locked: 'Правила для этого действия меняться не могут.',
  empty_body: 'Напишите текст ответа.',
  empty_title: 'Нужен заголовок.',
  system_in_use: 'В системе есть колонии, флоты, аванпосты или владелец — удалить её нельзя.',
  lane_exists: 'Такой гиперпуть уже есть.',
  bad_lane: 'Гиперпуть нужно прокладывать между двумя разными системами.',
  bad_system_id: 'Неверный идентификатор системы.',
  not_signed_in: 'Сначала войдите.',
  not_in_battle: 'Вы не участвуете в этом бою.',
  battle_over: 'Бой уже окончен.',
  not_your_turn: 'Сейчас ход другой стороны.',
  already_retreating: 'Отступление уже начато.',
  bad_retreat_dest: 'Отступать можно только в соседнюю систему.',
  already_moved: 'Этот отряд уже ходил.',
  already_fired: 'Этот отряд уже стрелял.',
  too_far: 'Слишком далеко для этого отряда.',
  out_of_range: 'Цель вне дальности огня.',
  cell_busy: 'Клетка занята.',
  need_two_sides: 'Нужны флоты двух разных держав.',
  empty_fleet: 'Во флоте нет кораблей с проектами.',
  bad_factor: 'Множитель должен быть от 1 до 20.',
};

export function humanError(error) {
  const raw = error?.message || String(error);
  const key = Object.keys(MESSAGES).find((k) => raw.includes(k));
  // причины с текстом из базы: «name_rejected: …», «name_cooldown: 31.10 00:59»
  const nr = raw.match(/name_rejected: (.+)/), nc = raw.match(/name_cooldown: (.+)/);
  const cc = raw.match(/claim_cooldown: (.+)/), ns = raw.match(/need_station: (.+)/), tp = raw.match(/tech_prereq: (.+)/), bf = raw.match(/building_frozen: (.+)/);
  const text = nr ? nr[1] : nc ? `Имя можно менять раз в 7 дней. Следующая смена — ${nc[1]}.`
    : cc ? `Захваты на перерыве до ${new Date(cc[1]).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.` : ns ? `Нужна технология «${ns[1]}».` : tp ? `Сначала изучите: ${tp[1]}.` : bf ? `Строить нельзя: ${bf[1].toLowerCase()}.`
    : key ? MESSAGES[key] : raw;
  const err = new Error(text);
  err.raw = raw;
  err.missingSchema = /function .*v1_|relation .*v1_|Could not find the function/i.test(raw);
  return err;
}
