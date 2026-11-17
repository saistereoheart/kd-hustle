import type { PublicConfig } from '@kh/shared';
import { postAuth, saveToken } from '../net/api';
import { el, uiRoot } from './dom';

/** Login / register screen. Calls onAuthed with the new session token. */
export function showAuthScreen(cfg: PublicConfig, onAuthed: (token: string) => void) {
  let mode: 'login' | 'register' = 'register';
  const u = cfg.auth.username;

  const username = el('input', {
    name: 'username', autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false',
    minlength: String(u.min), maxlength: String(u.max), required: true,
  });
  const password = el('input', { name: 'password', type: 'password', autocomplete: 'new-password', minlength: String(cfg.auth.passwordMin), maxlength: String(cfg.auth.passwordMax), required: true });
  const confirm = el('input', { name: 'confirm', type: 'password', autocomplete: 'new-password', required: true });
  const confirmField = el('label', { class: 'field' }, 'Confirm password', confirm);
  const error = el('div', { class: 'error', role: 'alert' });
  const submit = el('button', { class: 'btn primary', type: 'submit' }, 'Create account');
  const tabLogin = el('button', { type: 'button', 'data-tab': 'login' }, 'Log in');
  const tabRegister = el('button', { type: 'button', 'data-tab': 'register', class: 'active' }, 'Register');

  const form = el(
    'form',
    { novalidate: true },
    el('label', { class: 'field' }, `Username (${u.min}–${u.max} letters, numbers, _)`, username),
    el('label', { class: 'field' }, `Password (min ${cfg.auth.passwordMin})`, password),
    confirmField,
    error,
    submit,
  );

  const setMode = (m: typeof mode) => {
    mode = m;
    tabLogin.classList.toggle('active', m === 'login');
    tabRegister.classList.toggle('active', m === 'register');
    confirmField.classList.toggle('hidden', m === 'login');
    confirm.required = m === 'register';
    password.setAttribute('autocomplete', m === 'login' ? 'current-password' : 'new-password');
    submit.textContent = m === 'login' ? 'Log in' : 'Create account';
    error.textContent = '';
  };
  tabLogin.addEventListener('click', () => setMode('login'));
  tabRegister.addEventListener('click', () => setMode('register'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    if (mode === 'register' && password.value !== confirm.value) {
      error.textContent = 'Passwords do not match';
      return;
    }
    submit.disabled = true;
    const res = await postAuth(mode === 'login' ? '/api/login' : '/api/register', {
      username: username.value.trim(),
      password: password.value,
      ...(mode === 'register' ? { confirm: confirm.value } : {}),
    });
    submit.disabled = false;
    if (!res.ok) {
      error.textContent = res.error;
      return;
    }
    saveToken(res.token);
    screen.remove();
    onAuthed(res.token);
  });

  const screen = el(
    'div',
    { class: 'screen', id: 'auth' },
    el(
      'div',
      { class: 'card' },
      el('h1', { class: 'logo' }, 'Kota ', el('span', {}, 'Hustle')),
      el('p', { class: 'tagline' }, 'From RM 300 to Tan Sri. Bring your geng.'),
      el('div', { class: 'tabs' }, tabRegister, tabLogin),
      form,
      el('p', { class: 'hint' }, 'All money in this game is virtual. No real-money purchases.'),
    ),
  );
  uiRoot().append(screen);
  document.body.dataset.state = 'auth';
  username.focus();
}
