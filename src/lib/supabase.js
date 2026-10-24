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
  unrest_none: 'В колонии спокойно — решение не нужно.',
  unrest_no_garrison: 'Нужен флот в системе или армия на планете.',
  unrest_no_faith: 'У державы нет веры для проповеди.',
  unrest_martial_late: 'При восстании военное положение уже не поможет.',
  bad_choice: 'Неизвестное решение.',
  course_unknown: 'Неизвестный курс.',
  course_council: 'Своя доктрина открывается технологией «Экономический совет».',
  course_axis: 'Ось доктрины — от −2 до +2.',
  faith_name: 'Название веры — от 3 до 60 знаков.',
  faith_has: 'У державы уже есть вера — сначала отрекитесь от неё.',
  faith_taken: 'Вера с таким названием уже есть.',
  faith_unknown: 'Такой веры нет.',
  faith_closed: 'Вход в эту веру закрыт основателем.',
  faith_founder: 'Основатель не может уйти, пока у веры есть другие последователи.',
  faith_not_founder: 'Это может только основатель веры.',
  war_self: 'Нельзя объявить войну самим себе.',
  faction_unknown: 'Такой державы нет.',
  union_junior: 'Внешнюю политику ведёт старший партнёр унии.',
  war_union: 'Нельзя воевать с партнёром по унии.',
  war_exists: 'Война с этой державой уже идёт.',
  war_ally: 'Нельзя напасть на союзника — сначала выйдите из союза.',
  war_vassal: 'Нельзя воевать с вассалом или сюзереном, пока договор действует.',
  war_not_found: 'Война не найдена.',
  war_over: 'Война уже окончена.',
  war_not_leader: 'Мир и капитуляцию подписывают только зачинщики сторон.',
  war_not_member: 'Вы не участвуете в этой войне.',
  note_pending: 'Такая нота уже отправлена — ждите ответа.',
  note_foreign: 'Это предложение адресовано не вам.',
  note_done: 'На это уже ответили.',
  ally_in_war: 'Эта держава уже участвует в войне.',
  bad_union: 'Неизвестный вид союза.',
  union_name: 'Название союза — от 3 до 60 знаков.',
  union_member: 'Держава уже состоит в союзе.',
  union_target_member: 'Эта держава уже состоит в союзе.',
  union_not_leader: 'Приглашать может только глава союза.',
  union_none: 'Держава не состоит в союзе.',
  union_taken: 'Эта держава уже в унии.',
  bad_tribute: 'Дань — от 0 до 30 %.',
  vassal_taken: 'У этой державы уже есть сюзерен.',
  vassal_self: 'Вассал не может брать своих вассалов.',
  merge_pending: 'Объединение с участием этих держав уже обсуждается.',
  merge_not_ready: 'Объединение ещё не согласовано сторонами.',
  loan_amount: 'Кредит — от 1 000 ГС.',
  loan_pct: 'Процент — от 0 до 30.',
  loan_days: 'Срок — от 7 до 60 дней.',
  loan_lender_poor: 'У кредитора больше нет этой суммы.',
  rep_missing: 'Сначала назначьте представителя в Сообществе.',
  rep_name: 'Имя представителя — от 2 до 60 знаков.',
  council_cooldown: 'Держава может вносить одну резолюцию раз в 3 дня.',
  council_duplicate: 'Такая резолюция уже на голосовании.',
  council_closed: 'Голосование уже закрыто.',
  bad_resolution: 'Неизвестная резолюция.',
  bad_side: 'Выберите сторону войны.',
  bad_target: 'Неверная цель.',
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
  const cc = raw.match(/claim_cooldown: (.+)/), ns = raw.match(/need_station: (.+)/), tp = raw.match(/tech_prereq: (.+)/), bf = raw.match(/building_frozen: (.+)/), cl = raw.match(/capitulation_locked: (\d+)/), cc2 = raw.match(/course_cooldown: (.+)/), cb = raw.match(/course_budget: (\d+)/);
  const text = nr ? nr[1] : nc ? `Имя можно менять раз в 7 дней. Следующая смена — ${nc[1]}.`
    : cc ? `Захваты на перерыве до ${new Date(cc[1]).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.` : ns ? `Нужна технология «${ns[1]}».` : tp ? `Сначала изучите: ${tp[1]}.` : bf ? `Строить нельзя: ${bf[1].toLowerCase()}.` : cc2 ? `Курс можно сменить ${new Date(cc2[1]).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.` : cb ? `Не больше ${cb[1]} очков доктрины.` : cl ? `Капитуляцию можно потребовать, когда занято не меньше 80 % систем врага (сейчас ${cl[1]} %).`
    : key ? MESSAGES[key] : raw;
  const err = new Error(text);
  err.raw = raw;
  err.missingSchema = /function .*v1_|relation .*v1_|Could not find the function/i.test(raw);
  return err;
}
