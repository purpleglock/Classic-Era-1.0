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
  const text = nr ? nr[1] : nc ? `Имя можно менять раз в 7 дней. Следующая смена — ${nc[1]}.` : key ? MESSAGES[key] : raw;
  const err = new Error(text);
  err.raw = raw;
  err.missingSchema = /function .*v1_|relation .*v1_|Could not find the function/i.test(raw);
  return err;
}
