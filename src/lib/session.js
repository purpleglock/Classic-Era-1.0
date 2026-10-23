import { sb, rpc } from './supabase.js';

/**
 * Текущий пользователь и его роль.
 * role: 'guest' | 'player' | 'team'; level (для команды): 'superadmin' | 'admin'.
 */
const state = {
  ready: false,
  user: null,
  role: 'guest',
  level: null,
  banned: false,
  factionId: null,
  displayName: null,
  avatar: null,
  pendingRequests: 0,
  schemaMissing: false,
};

const listeners = new Set();
export const session = state;
export function onSession(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach((fn) => fn(state)); }

export const isTeam = () => state.role === 'team';
export const isSuperadmin = () => state.role === 'team' && state.level === 'superadmin';
export const isPlayer = () => state.role === 'player' || (state.role === 'team' && !!state.factionId);

export const ROLE_LABEL = { team: 'Команда проекта', player: 'Игрок', guest: 'Гость' };
export const LEVEL_LABEL = { superadmin: 'Суперадмин', admin: 'Админ' };

/** Короткая подпись роли для шапки. */
export function roleShort(s = state) {
  if (s.role === 'team') return LEVEL_LABEL[s.level] || ROLE_LABEL.team;
  return ROLE_LABEL[s.role] || ROLE_LABEL.guest;
}

export function roleTitle(s = state) {
  if (s.role === 'team') return `${ROLE_LABEL.team} · ${LEVEL_LABEL[s.level] || ''}`.trim();
  return ROLE_LABEL[s.role] || ROLE_LABEL.guest;
}

async function loadRole() {
  if (!state.user) {
    Object.assign(state, { role: 'guest', level: null, banned: false, factionId: null, displayName: null, pendingRequests: 0 });
    return;
  }
  try {
    const r = await rpc('v1_my_role');
    Object.assign(state, {
      role: r.role || 'guest',
      level: r.level || null,
      banned: !!r.banned,
      factionId: r.faction_id || null,
      displayName: r.display_name || 'Игрок',
      pendingRequests: Number(r.pending_requests || 0),
      schemaMissing: false,
    });
    const { data: pr } = await sb.from('v1_profile').select('avatar_url').eq('user_id', state.user.id).maybeSingle();
    state.avatar = pr?.avatar_url || null;
  } catch (e) {
    // Миграция ролей ещё не применена: показываем сайт как гостю, но предупреждаем.
    Object.assign(state, { role: 'guest', level: null, schemaMissing: !!e.missingSchema, displayName: 'Игрок' });
  }
}

export async function initSession() {
  const { data } = await sb.auth.getSession();
  state.user = data.session?.user || null;
  await loadRole();
  state.ready = true;
  emit();
  sb.auth.onAuthStateChange(async (_event, s) => {
    const next = s?.user || null;
    if (next?.id === state.user?.id && state.ready) return;
    state.user = next;
    await loadRole();
    emit();
  });
}

export async function refreshRole() { await loadRole(); emit(); }

export async function signInWithPassword(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Неверная почта или пароль.' : error.message);
}

export async function signUp(email, password) {
  const { error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
  if (error) throw new Error(error.message);
}

export async function signInWithGoogle() {
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}${location.pathname}#/cabinet` } });
  if (error) throw new Error(error.message);
}

export async function signOut() {
  await sb.auth.signOut();
}
