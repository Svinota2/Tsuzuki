// ============================================================
//  АВТООБНОВЛЕНИЕ (ИЗМЕНЕНО В 1.6).
//  Главный процесс (ПК) читает version.json, скачивает установщик,
//  сверяет SHA-256 и сообщает сюда статусы:
//    disabled / checking / none / available / downloading / ready / error
//  На Linux файл .exe не качается — только «Доступна версия X» и кнопка
//  «Скачать», которая открывает страницу релиза.
//  На Android (manualInstall) — «Обновить»: скачивает APK и открывает установщик.
//  Здесь: плашка, тост «Tsuzuki обновлён до X» после перезапуска.
// ============================================================

import { esc, toast } from '../utils.js';
import { valueOf, OPTIONS } from '../custom.js';

let state = { status: 'idle' };
let listener = null;

export const getUpdateState = () => state;

function autoCheckEnabled() {
  const opt = OPTIONS.find((o) => o.key === 'autoUpdate');
  return opt ? valueOf(opt) !== false : true;
}

// Текст статуса — один для плашки и для «Настроек»
export function updateText(s) {
  switch (s && s.status) {
    case 'disabled':
      return 'Автообновление не настроено: впиши адрес version.json в src/main/settings.js';
    case 'checking':
      return 'Проверяем обновления…';
    case 'available':
      return s.platform === 'linux'
        ? `Доступна версия ${s.version} — нажми «Скачать» (откроется страница релиза)`
        : `Доступна версия ${s.version} — качается…`;
    case 'downloading':
      return `Скачивается обновление… ${Number(s.percent) || 0}%`;
    case 'ready':
      return `Обновление ${s.version} скачано — нажми «Перезапустить»`;
    case 'none':
      return 'Установлена последняя версия';
    case 'error':
      return s.error === 'sha256'
        ? 'Ошибка: скачанный файл не прошёл проверку SHA-256, запускать его нельзя'
        : 'Ошибка проверки обновлений — попробуй позже';
    default:
      return '';
  }
}

export function initUpdater() {
  if (!window.api || !window.api.onUpdate) return;
  // ИЗМЕНЕНО В 1.6: сообщаем главному процессу настройку «Автообновление»
  try {
    if (window.api.updateSetAuto) window.api.updateSetAuto(autoCheckEnabled()).catch(() => {});
  } catch { /* на ТВ метода нет */ }
  if (listener) listener();
  listener = window.api.onUpdate((s) => handle(s));
  window.api.updateState().then((s) => handle(s)).catch(() => {});
  showUpdatedToast().catch(() => {});
  // ИЗМЕНЕНО В 1.5: на Android свою проверку никто не запускал — запускаем через 15 с
  if (window.api.manualInstall) setTimeout(() => checkUpdates(), 15000);
}

// ИЗМЕНЕНО В 1.6: после обновления один раз показываем «Tsuzuki обновлён до X»
async function showUpdatedToast() {
  try {
    const info = await window.api.deviceInfo?.();
    const version = info && info.version;
    if (!version) return;
    const key = 'tsuzuki.lastVersion';
    let prev = null;
    try { prev = localStorage.getItem(key); } catch { /* нет localStorage — не страшно */ }
    try { localStorage.setItem(key, version); } catch { /* ignore */ }
    if (prev && prev !== version) toast(`Tsuzuki обновлён до ${version}`, 'ok');
  } catch { /* версию не узнать — молчим */ }
}

export async function checkUpdates() {
  if (!window.api.checkUpdates) return { status: 'disabled' };
  try {
    const s = await window.api.checkUpdates();
    handle(s);
    return s;
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

export async function installUpdate() {
  if (!window.api.installUpdate) return;
  try {
    const res = await window.api.installUpdate();
    if (res && res.opened) toast('Открыл страницу релиза в браузере', 'ok');
    else if (res && res.ok === false && res.error && res.error !== 'no-page') toast('Не удалось установить обновление', 'error');
  } catch (err) {
    toast(err.message || 'Не удалось обновить', 'error'); // ИЗМЕНЕНО В 1.5: например, нет разрешения на установку
  }
}

function handle(s) {
  if (!s || !s.status) return;
  state = s;
  window.dispatchEvent(new CustomEvent('tsuzuki:update', { detail: state }));
  if (s.status === 'ready' && s.version) {
    showBanner(`Обновление ${s.version} скачано — перезапустить?`, 'Перезапустить', installUpdate);
  } else if (s.status === 'available' && s.version) {
    // ИЗМЕНЕНО В 1.6: Linux — кнопка «Скачать» (страница релиза), Android — «Обновить» (APK)
    if (s.platform === 'linux') showBanner(`Доступна версия ${s.version}`, 'Скачать', installUpdate);
    else if (window.api.manualInstall) showBanner(`Доступна версия ${s.version}`, 'Обновить', installUpdate);
    else showBanner(`Доступна версия ${s.version} — качается…`, '', () => {});
  } else if (s.status === 'downloading') {
    showBanner(`Скачивается обновление… ${Number(s.percent) || 0}%`, '', () => {});
  } else if (s.status === 'error' && s.error === 'sha256') {
    showBanner('Обновление не установлено: файл не прошёл проверку подлинности', '', () => {});
  } else if (s.status === 'none' || s.status === 'disabled') {
    hideBanner();
  }
}

function showBanner(text, action, onClick) {
  let el = document.getElementById('update-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'update-banner';
    el.className = 'update-banner';
    document.body.appendChild(el);
  }
  el.innerHTML = `<span>${esc(text)}</span>${action ? `<button class="btn btn-sm btn-accent">${esc(action)}</button>` : ''}`;
  const btn = el.querySelector('button');
  if (btn) btn.addEventListener('click', onClick);
  requestAnimationFrame(() => el.classList.add('show'));
}

export function hideBanner() {
  const el = document.getElementById('update-banner');
  if (el) el.remove();
}
