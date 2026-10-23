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
};

export function humanError(error) {
  const raw = error?.message || String(error);
  const key = Object.keys(MESSAGES).find((k) => raw.includes(k));
  const err = new Error(key ? MESSAGES[key] : raw);
  err.raw = raw;
  err.missingSchema = /function .*v1_|relation .*v1_|Could not find the function/i.test(raw);
  return err;
}
