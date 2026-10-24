const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

export const num = (n) => nf.format(Math.floor(Number(n) || 0));
export const signed = (n) => (Number(n) >= 0 ? '+' : '−') + nf.format(Math.abs(Math.round(Number(n) || 0)));

/** Коротко: 54,9 млн. */
export function short(n) {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  if (a >= 1e9) return `${nf1.format(v / 1e9)} млрд`;
  if (a >= 1e6) return `${nf1.format(v / 1e6)} млн`;
  if (a >= 1e4) return `${nf1.format(v / 1e3)} тыс.`;
  return nf.format(v);
}

/** Звёздная дата игры: 3000.<день года> · ЧЧ:ММ. */
export function starDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return '';
  const start = new Date(d.getFullYear(), 0, 0);
  const day = Math.floor((d - start) / 864e5);
  const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `зв.дата 3000.${String(day).padStart(3, '0')} · ${hm}`;
}

export const dayMonth = (iso) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
export const dateShort = (iso) => new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
export const dateTime = (iso) => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Текст новости без разметки старого редактора ([c:gold]…[/c], ##, >, [fac:…|…], [music:…]). */
export function plain(text = '') {
  return String(text)
    .replace(/\[lock:[^\]\n]*\][\s\S]*?\[\/lock\]/gi, ' 🔒 ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]\n]+)\]\(https?:[^)]*\)/g, '$1')
    .replace(/\*\*|`/g, '')
    .replace(/\[(?:music|img|video):[^\]]*\]/gi, ' ')
    .replace(/\[fac:[^|\]]*\|?[^\]]*\]/gi, ' ')
    .replace(/\[\/?[a-z]+(?::[^\]]*)?\]/gi, '')
    .replace(/^[#>\s]+/gm, '')
    .replace(/(^|\s)#{1,6}(?=\s)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** «через 18 ч 36 мин». */
export function untilText(ms) {
  if (ms <= 0) return 'начисление скоро';
  const h = Math.floor(ms / 36e5);
  const m = Math.floor((ms % 36e5) / 6e4);
  return `до начисления ${h} ч ${m} мин`;
}

/** Сколько осталось: «2 д 4 ч», «17 ч 46 мин», «12 мин». */
export function leftText(ms) {
  if (ms <= 0) return 'скоро';
  const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5), m = Math.floor((ms % 36e5) / 6e4);
  return d ? `${d} д ${h} ч` : h ? `${h} ч ${m} мин` : `${m} мин`;
}
