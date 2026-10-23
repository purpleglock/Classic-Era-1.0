import { LEGAL_VERSION } from '../content/legal.js';
import { html, raw, icon, $ } from '../lib/dom.js';
import { signInWithPassword, signUp, signInWithGoogle } from '../lib/session.js';
import { go } from '../lib/router.js';
import { applyArt } from '../lib/settings.js';

/** Окно входа и регистрации. После входа игрок сразу попадает в кабинет. */
export function openLogin(mode = 'in') {
  closeLogin();
  const veil = document.createElement('div');
  veil.className = 'veil';
  veil.id = 'veil-login';
  veil.innerHTML = html`
    <form class="panel modal login" id="login" aria-labelledby="lt" novalidate>
      <button type="button" class="ib x" data-close aria-label="Закрыть">${icon('i-x')}</button>
      <h2 id="lt">${mode === 'up' ? 'Регистрация' : 'Вход'}</h2>
      <p>${mode === 'up' ? 'Создайте аккаунт, затем подайте заявку на державу.' : 'Войдите, чтобы управлять своей державой.'}</p>
      <label for="email">Почта</label>
      <input id="email" type="email" autocomplete="email" placeholder="you@mail.com" required>
      <label for="pass">Пароль</label>
      <input id="pass" type="password" autocomplete="${mode === 'up' ? 'new-password' : 'current-password'}" minlength="6" required>
      ${mode === 'up' ? raw(html`<label class="check legal-ok"><input type="checkbox" id="legal-ok"> <span>Принимаю <a href="#/legal?d=terms" target="_blank">Пользовательское соглашение</a> и <a href="#/legal?d=privacy" target="_blank">Политику конфиденциальности</a>, даю <a href="#/legal?d=consent" target="_blank">согласие на обработку персональных данных</a></span></label>`) : ''}
      <button type="submit" class="btn gold">${mode === 'up' ? 'Зарегистрироваться' : 'Войти'}</button>
      <div class="or">или</div>
      <button type="button" class="btn" id="google">Войти через Google</button>
      <p class="msg" id="msg" aria-live="polite"></p>
      <p class="alt">${mode === 'up' ? 'Уже есть аккаунт? ' : 'Нет аккаунта? '}<a href="#" id="switch">${mode === 'up' ? 'Войти' : 'Зарегистрироваться'}</a></p>
    </form>`;
  document.body.appendChild(veil);
  applyArt($('#login', veil), 'login');
  const msg = $('#msg', veil);
  const form = $('#login', veil);
  $('#email', veil).focus();

  veil.addEventListener('click', (e) => { if (e.target === veil || e.target.closest('[data-close]')) closeLogin(); });
  $('#switch', veil).onclick = (e) => { e.preventDefault(); openLogin(mode === 'up' ? 'in' : 'up'); };
  $('#google', veil).onclick = async () => {
    msg.textContent = 'Переходим в Google…';
    try { await signInWithGoogle(); } catch (err) { msg.textContent = err.message; }
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const email = $('#email', veil).value.trim();
    const pass = $('#pass', veil).value;
    if (!email) { msg.textContent = 'Введите почту.'; return; }
    if (pass.length < 6) { msg.textContent = 'Пароль — не короче 6 символов.'; return; }
    if (mode === 'up' && !$('#legal-ok', veil).checked) { msg.textContent = 'Чтобы зарегистрироваться, примите документы.'; return; }
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      if (mode === 'up') {
        await signUp(email, pass);
        // галочка при регистрации: при первом входе согласие запишется без повторного окна
        try { localStorage.setItem('ce-legal', `${email.toLowerCase()}|${LEGAL_VERSION}`); } catch { /* приватный режим */ }
        msg.textContent = 'Готово. Подтвердите почту по ссылке из письма, затем войдите.';
      } else {
        await signInWithPassword(email, pass);
        closeLogin();
        go('/cabinet');
      }
    } catch (err) {
      msg.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  };
}

export function closeLogin() { document.getElementById('veil-login')?.remove(); }
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLogin(); });
