import { rpc } from './supabase.js';
import { toast } from './dom.js';

/**
 * Действие команды проекта. Суперадмин выполняет сразу; админ — сразу или
 * через заявку суперадмину, как решает база. Возвращает { status: 'done' | 'pending' }.
 */
export async function act(action, target, payload = {}, note = null, { quiet = false } = {}) {
  try {
    const r = await rpc('v1_admin_do', { p_action: action, p_target: target == null ? null : String(target), p_payload: payload, p_note: note });
    if (r.status === 'pending') toast('Заявка отправлена суперадмину на одобрение');
    else if (!quiet) toast('Готово');
    return r;
  } catch (e) {
    toast(e.message, 'err');
    throw e;
  }
}
