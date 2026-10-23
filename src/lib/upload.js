import { sb } from './supabase.js';
import { session } from './session.js';

export const MEDIA_BUCKET = 'v1-media';
export const MODELS_BUCKET = 'v1-models';

/**
 * Сжатие картинки в браузере перед загрузкой: длинная сторона не больше max,
 * формат WebP. GIF и SVG не трогаем (анимация и вектор). Экономит место в
 * хранилище и трафик игроков: снимок экрана 4 МБ превращается в 200–400 КБ.
 */
export async function compressImage(file, { max = 1920, quality = 0.85 } = {}) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return { blob: file, type: file.type, ...(await sizeOf(file)) };
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = await new Promise((res) => cv.toBlob(res, 'image/webp', quality));
  // если WebP вышел тяжелее исходника (маленькие PNG), оставляем исходник
  if (!blob || (blob.size >= file.size && k === 1)) return { blob: file, type: file.type, width: w, height: h };
  return { blob, type: 'image/webp', width: w, height: h };
}

async function sizeOf(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return {};
  try { const b = await createImageBitmap(file); const r = { width: b.width, height: b.height }; b.close?.(); return r; } catch { return {}; }
}

const EXT = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/webm': 'webm' };
// Хранилище Supabase принимает в имени файла только латиницу: кириллицу переводим транслитом.
const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
const slug = (name) => String(name).toLowerCase().replace(/\.[^.]+$/, '')
  .replace(/[а-яё]/g, (c) => TR[c] ?? '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'file';

/**
 * Загрузка файла в медиатеку. folder: 'page', 'tyan', 'news' (команда) или
 * автоматически 'u/<id>' для игроков. Картинки сжимаются (max — длинная сторона).
 * Возвращает { url, path, name, mime, size, width, height }.
 */
export async function uploadMedia(file, { folder = 'page', max = 1920 } = {}) {
  if (file.size > 15 * 1024 * 1024) throw new Error('Файл больше 15 МБ.');
  const isImg = file.type.startsWith('image/');
  const c = isImg ? await compressImage(file, { max }) : { blob: file, type: file.type };
  const dir = session.role === 'team' ? folder : `u/${session.user?.id}`;
  const path = `${dir}/${Date.now().toString(36)}-${slug(file.name)}.${EXT[c.type] || 'bin'}`;
  const { error } = await sb.storage.from(MEDIA_BUCKET).upload(path, c.blob, { contentType: c.type, cacheControl: '31536000', upsert: false });
  if (error) throw new Error(/bucket/i.test(error.message) ? 'Хранилище медиатеки ещё не создано: нужна миграция 06.' : error.message);
  const url = sb.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
  return { url, path, name: file.name, mime: c.type, size: c.blob.size, width: c.width || null, height: c.height || null };
}

/** Загрузка 3D-модели (.glb) или её превью. Только команда проекта. */
export async function uploadModelFile(blob, name, contentType = 'model/gltf-binary') {
  const ext = contentType.startsWith('image/') ? 'webp' : 'glb';
  const path = `${Date.now().toString(36)}-${slug(name)}.${ext}`;
  const { error } = await sb.storage.from(MODELS_BUCKET).upload(path, blob, { contentType, cacheControl: '31536000', upsert: false });
  if (error) throw new Error(/bucket/i.test(error.message) ? 'Хранилище моделей ещё не создано: нужна миграция 06.' : error.message);
  return { path, url: sb.storage.from(MODELS_BUCKET).getPublicUrl(path).data.publicUrl, size: blob.size };
}

/** Удобная подпись размера файла. */
export function fileSize(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} КБ`;
  return `${(n / 1024 / 1024).toFixed(1)} МБ`;
}
