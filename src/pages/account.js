import { html, raw, icon, $, toast, confirmBox } from '../lib/dom.js';
import { sb, rpc } from '../lib/supabase.js';
import { session, roleTitle, refreshRole } from '../lib/session.js';
import { openLogin } from '../ui/login.js';
import { dayMonth } from '../lib/format.js';
import { uploadMedia } from '../lib/upload.js';

/** Статус Discord-сертификации текущего пользователя. */
export async function myDiscord() {
  try { return await rpc('v1_my_discord'); } catch { return { linked: false, unavailable: true }; }
}

const ROLE_MSG = {
  ok: ['ok', 'Роль «Игрок» на сервере проекта выдана.'],
  pending: ['', 'Бот выдаёт роль на сервере проекта…'],
  not_in_guild: ['warn', `Вы ещё не на сервере проекта. Зайдите на него по ссылке ${'discord.gg/jApCDH2zyM'} и нажмите «Получить роль».`],
};
function roleLine(ds) {
  const [cls, text] = ROLE_MSG[ds.role_status] || (ds.role_status
    ? ['warn', 'Бот не смог выдать роль на сервере. Попробуйте ещё раз позже или напишите команде проекта.']
    : ['', 'Роль «Игрок» на сервере проекта ещё не выдавалась. Нажмите «Получить роль».']);
  return html`<p class="ds-role ${cls}">${text}</p>`;
}

/** Значок «верифицирован в Discord». */
export function discordBadge(name) {
  return name ? raw(html`<span class="ds-badge" title="Аккаунт подтверждён через Discord">${icon('i-check')}Discord · ${name}</span>`) : '';
}

export async function renderAccount(root) {
  if (!session.user) {
    root.innerHTML = html`<section class="panel gate"><span class="m-ic">${icon('i-users')}</span><div><h1>Аккаунт</h1><p>Войдите, чтобы управлять аккаунтом.</p></div><button type="button" class="btn gold" id="a-in">Войти</button></section>`;
    $('#a-in', root).onclick = () => openLogin();
    return;
  }

  // возврат из Discord после привязки
  const back = new URLSearchParams(location.hash.split('?')[1] || '').get('discord');
  let ds = back ? await rpc('v1_discord_sync').catch(() => null) : null;
  if (back) { history.replaceState(null, '', '#/account'); if (ds?.linked) toast(`Discord подтверждён: ${ds.name}`); }
  ds = ds || await myDiscord();

  const { data: nameRow } = await sb.from('v1_names').select('name,changed_at').eq('user_id', session.user.id).maybeSingle();
  const { data: app } = await sb.from('faction_applications').select('id,name,status,reject_reason,updated_at')
    .eq('owner_id', session.user.id).order('updated_at', { ascending: false }).limit(1).maybeSingle();

  root.innerHTML = html`
    <section class="panel gate acc-head">
      <span class="m-ic">${icon('i-users')}</span>
      <div><span class="role-badge" data-role="${session.role}">${roleTitle()}</span><h1>${session.displayName || 'Аккаунт'}</h1><p>${session.user.email || ''}</p>
        ${ds.linked ? raw(html`<p class="ds-line">${discordBadge(ds.name)}</p>`) : ''}</div>
      <a class="btn sm" href="#/cabinet">В кабинет</a>
    </section>

    <section class="panel acc-card" id="ava-card">
      <label class="ava-big" for="av-file" title="Загрузить аватар">${session.avatar ? raw(html`<img src="${session.avatar}" alt="">`) : (session.displayName || '?').slice(0, 1).toUpperCase()}</label>
      <div class="acc-body">
        <h2>Аватар</h2>
        <p>Показывается в шапке и рядом с вашим именем. Картинка ужимается до 256×256.</p>
        <div class="acts"><label class="btn gold sm" for="av-file">${icon('i-image')}${session.avatar ? 'Заменить' : 'Загрузить'}</label>${session.avatar ? raw('<button type="button" class="btn sm" id="av-del">Убрать</button>') : ''}</div>
        <input type="file" id="av-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
        <p class="nm-msg" id="av-msg" aria-live="polite"></p>
        <p class="hint">PNG, JPG, WebP или GIF до 15 МБ. Без чужих лиц без разрешения, без политики и непристойного — правила те же, что для имени.</p>
      </div>
    </section>

    <section class="panel acc-card" id="name-card">
      <div class="acc-ic">${icon('i-users')}</div>
      <div class="acc-body">
        <h2>Имя в игре</h2>
        <p>Так вас видят другие игроки и команда проекта.${nameRow ? '' : raw(' <b>Пока имя не задано.</b>')}</p>
        <div class="name-row"><input id="nm-in" type="text" maxlength="24" value="${nameRow?.name || ''}" placeholder="Например: Архонт Вейл" aria-label="Имя в игре" autocomplete="nickname">
          <button type="button" class="btn gold sm" id="nm-save">Сохранить</button></div>
        <p class="nm-msg" id="nm-msg" aria-live="polite"></p>
        <p class="hint">3–24 знака: буквы, цифры, пробел и - _ . ' Без мата, без имён реальных политиков и без служебных слов вроде «Админ». Менять имя можно раз в 7 дней${nameRow ? ` (последняя смена — ${dayMonth(nameRow.changed_at)})` : ''}.</p>
      </div>
    </section>

    <section class="panel acc-card">
      <div class="acc-ic ds-ic">${icon('i-chat')}</div>
      <div class="acc-body">
        <h2>Сертификация через Discord</h2>
        ${ds.unavailable
          ? raw('<p class="empty warn">Сертификация ещё не подключена в базе: примените миграцию 20261023_05_discord_map.sql.</p>')
          : ds.linked
            ? raw(html`<p>Аккаунт подтверждён: в Discord вы — <b>${ds.name}</b>${ds.username && ds.username !== ds.name ? ` (@${ds.username})` : ''}. Подтверждён ${ds.linked_at ? dayMonth(ds.linked_at) : ''}.</p>
                <p class="hint">Команда проекта и игроки видят значок рядом с вашим именем, так они знают, кто стоит за державой.</p>
                ${ds.roles_on ? raw(roleLine(ds)) : ''}`)
            : raw(html`<p>Привяжите Discord, чтобы подтвердить, кто вы в сообществе. Рядом с вашим именем появится значок, например <span class="ds-badge">${icon('i-check')}Discord · M</span></p>
                <p class="hint">Пароль от Discord сайт не видит. Мы получаем только ваш ник и аватар.</p>`)}
      </div>
      <div class="acc-act">${ds.unavailable ? '' : ds.linked
        ? raw(`${ds.roles_on && ds.role_status !== 'ok' ? '<button type="button" class="btn gold sm" id="ds-role">Получить роль</button>' : ''}<button type="button" class="btn sm" id="ds-sync">Обновить ник</button><button type="button" class="btn sm danger" id="ds-unlink">Отвязать</button>`)
        : raw('<button type="button" class="btn gold" id="ds-link">Привязать Discord</button>')}</div>
    </section>

    <section class="panel acc-card">
      <div class="acc-ic">${icon('i-flag')}</div>
      <div class="acc-body">
        <h2>Держава</h2>
        ${session.factionId ? raw('<p>Ваша держава в игре.</p>')
          : app ? raw(html`<p>Заявка «${app.name || 'без названия'}»: <b>${STATUS[app.status] || app.status}</b>.</p>${app.reject_reason ? raw(html`<p class="hint">Причина: ${app.reject_reason}</p>`) : ''}`)
          : raw('<p>У вас пока нет державы.</p>')}
      </div>
      <div class="acc-act">${session.factionId ? raw('<a class="btn sm" href="#/cabinet">Открыть кабинет</a>') : raw(html`<a class="btn gold sm" href="#/apply">${app ? 'Открыть заявку' : 'Подать заявку'}</a>`)}</div>
    </section>`;

  // имя: проверка на лету и сохранение
  const nmIn = $('#nm-in', root), nmMsg = $('#nm-msg', root);
  let nmT = 0;
  nmIn.addEventListener('input', () => {
    clearTimeout(nmT);
    nmMsg.className = 'nm-msg'; nmMsg.textContent = '';
    const v = nmIn.value.trim();
    if (!v || v === nameRow?.name) return;
    nmT = setTimeout(async () => {
      const r = await rpc('v1_name_check', { p_name: v }).catch(() => null);
      if (!r || nmIn.value.trim() !== v) return;
      nmMsg.className = `nm-msg ${r.ok ? 'ok' : 'bad'}`;
      nmMsg.textContent = r.ok ? 'Имя свободно' : r.reason;
    }, 350);
  });
  $('#nm-save', root).onclick = async () => {
    try {
      const r = await rpc('v1_set_name', { p_name: nmIn.value });
      toast(`Имя сохранено: ${r.name}`);
      await refreshRole();
      import('../ui/header.js').then((m) => m.renderHeader());
      renderAccount(root);
    } catch (e) { nmMsg.className = 'nm-msg bad'; nmMsg.textContent = e.missingSchema ? 'Имена ещё не подключены в базе (миграция 12).' : e.message; }
  };

  const avMsg = $('#av-msg', root);
  const setAva = async (url) => {
    await rpc('v1_set_avatar', { p_url: url });
    await refreshRole();
    import('../ui/header.js').then((m) => m.renderHeader());
    renderAccount(root);
  };
  $('#av-file', root).onchange = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) { avMsg.className = 'nm-msg bad'; avMsg.textContent = 'Нужна картинка.'; return; }
    avMsg.className = 'nm-msg'; avMsg.textContent = 'Загружаем…';
    try {
      const up = await uploadMedia(f, { own: true, max: 256 });
      await setAva(up.url);
      toast('Аватар обновлён');
    } catch (err) { avMsg.className = 'nm-msg bad'; avMsg.textContent = err.missingSchema ? 'Аватары ещё не подключены в базе (миграция 14).' : err.message; }
  };
  $('#av-del', root)?.addEventListener('click', async () => {
    try { await setAva(null); toast('Аватар убран'); } catch (err) { avMsg.className = 'nm-msg bad'; avMsg.textContent = err.message; }
  });

  $('#ds-link', root)?.addEventListener('click', async () => {
    const { error } = await sb.auth.linkIdentity({ provider: 'discord', options: { redirectTo: `${location.origin}${location.pathname}#/account?discord=1` } });
    if (error) toast(/manual linking|not enabled|provider/i.test(error.message) ? 'Привязка Discord ещё не включена в настройках Supabase.' : error.message, 'err');
  });
  $('#ds-role', root)?.addEventListener('click', async () => {
    const r = await rpc('v1_discord_role_retry').catch((e) => { toast(e.message, 'err'); });
    if (!r) return;
    if (r.status === 'off') { toast('Выдача ролей в Discord сейчас выключена', 'err'); return; }
    toast('Запрос отправлен боту');
    setTimeout(() => renderAccount(root), 3000);
  });
  $('#ds-sync', root)?.addEventListener('click', async () => {
    const r = await rpc('v1_discord_sync').catch((e) => { toast(e.message, 'err'); });
    if (r) { toast('Ник обновлён'); renderAccount(root); }
  });
  $('#ds-unlink', root)?.addEventListener('click', async () => {
    if (!(await confirmBox('Отвязать Discord? Значок подтверждения пропадёт.', 'Отвязать'))) return;
    const { data } = await sb.auth.getUserIdentities();
    const id = data?.identities?.find((x) => x.provider === 'discord');
    if (id) {
      const { error } = await sb.auth.unlinkIdentity(id);
      if (error) { toast(error.message, 'err'); return; }
    }
    await rpc('v1_discord_sync').catch(() => {});
    await refreshRole();
    toast('Discord отвязан');
    renderAccount(root);
  });
}

export const STATUS = { draft: 'черновик', pending: 'на рассмотрении', rejected: 'отклонена', approved: 'одобрена', annexed: 'аннексирована', capitulated: 'капитулировала' };
