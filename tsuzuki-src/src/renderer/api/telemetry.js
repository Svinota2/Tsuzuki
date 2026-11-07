// ============================================================
//  АНОНИМНАЯ СТАТИСТИКА (ИЗМЕНЕНО В 1.3, В 1.5 — счётчик Aptabase).
//  Единственное место, откуда уходит статистика.
//
//  Отправляем ТОЛЬКО: версию приложения, платформу, язык интерфейса
//  и число тайтлов в библиотеке (округлённое до десятков).
//  НЕ отправляем: идентификатор установки, ники, названия тайтлов, список,
//  оценки, пути, токены. (installId с 1.5 остаётся только на устройстве.)
//  События: «install» — один раз после согласия, «app_open» — раз в сутки.
//  Куда уходит — main/services.js (ПК) и tv-web/android-api.js (Android).
//
//  Пока пользователь не нажал «Разрешить» (prefs.telemetry === null)
//  или нажал «Не отправлять» (false) — не уходит НИЧЕГО.
// ============================================================

import { CONFIG } from '../config.js';
import * as store from '../store.js';

const today = () => new Date().toISOString().slice(0, 10);
let device = null;

// Один раз узнаём версию и платформу у главного процесса (или у моста ТВ)
async function getDevice() {
  if (device) return device;
  try {
    const info = await window.api.deviceInfo();
    device = {
      version: info?.version || '1.3.0',
      platform: info?.platform || (window.api.isTV ? 'android-tv' : 'desktop'),
    };
  } catch {
    device = { version: '1.3.0', platform: window.api.isTV ? 'android-tv' : 'desktop' };
  }
  return device;
}

export function allowed() {
  return store.getPrefs().telemetry === true;
}

// Случайный идентификатор установки. Ни с чем не связан, сбросить можно в настройках.
export function getOrCreateInstallId() {
  let id = store.getInstallId();
  if (!id) {
    try {
      id = (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID()
        : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    } catch {
      id = 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    }
    store.ensureInstallId(id);
  }
  return id;
}

// «Сбросить идентификатор»: новый случайный UUID, статистика пойдёт заново
export function resetInstallId() {
  store.ensureInstallId('reset-' + Date.now()); // сбросим принудительно
  const fresh = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : 'id-' + Date.now().toString(36);
  store.ensureInstallId(fresh);
  store.setTelemetryLast(null);
  return store.getInstallId();
}

function basePayload(event) {
  const count = Object.keys(store.getState().library || {}).length;
  return {
    schema: 2,
    event,
    version: device?.version,
    platform: device?.platform,
    lang: (navigator.language || 'ru').slice(0, 2),
    lib: Math.floor(count / 10) * 10, // 0, 10, 20… — без точного числа
    at: new Date().toISOString(),
  };
}

// Отправка события (никогда не бросает ошибку наружу и не мешает работе)
export async function track(event, props = {}) {
  if (!allowed()) return false;
  await getDevice();
  try {
    const res = await window.api.telemetrySend({ ...basePayload(event), ...(props || {}) });
    return !!(res && res.ok);
  } catch {
    return false;
  }
}

// app_open — не чаще одного раза в сутки.
// Перед первым app_open один раз уходит «install» — так видно число новых установок.
export async function trackDailyOpen() {
  if (!allowed()) return false;
  if (!store.getPrefs().telemetryInstallSent) {
    if (await track('install')) store.setPref('telemetryInstallSent', true);
  }
  if (store.getTelemetryLast() === today()) return false;
  const ok = await track('app_open');
  if (ok) store.setTelemetryLast(today());
  return ok;
}

// Запуск после согласия: чуть подождать, чтобы не тормозить старт
export function startTelemetry() {
  getDevice().catch(() => {});
  if (!allowed()) return;
  setTimeout(() => { trackDailyOpen().catch(() => {}); }, 15000);
}

// Экран-согласие при первом запуске (если выбор ещё не сделан)
export function needsConsent() {
  return store.getPrefs().telemetry === null;
}

export function setConsent(allow) {
  store.setPref('telemetry', !!allow);
  if (allow) setTimeout(() => { trackDailyOpen().catch(() => {}); }, 2000);
}

// Короткий экран «что отправляется» — рисуем поверх приложения
export function showConsent() {
  if (!needsConsent() || document.getElementById('telemetry-consent')) return;
  const box = document.createElement('div');
  box.id = 'telemetry-consent';
  box.className = 'modal-backdrop';
  box.innerHTML = `
    <div class="modal-box consent-box">
      <div class="modal-head"><span class="modal-title">Помочь развитию Tsuzuki?</span></div>
      <div class="modal-text">
        Приложение может отправлять <b>анонимную</b> статистику использования:
        версию, платформу (Windows/Linux/Android), язык и число тайтлов в библиотеке,
        округлённое до десятков. Счётчик — Aptabase (серверы в ЕС), IP-адреса не хранятся.
        <br><br>
        Ни названий тайтлов, ни оценок, ни списка, ни путей к файлам — ничего личного
        не отправляется. Одно событие в сутки. Отключить можно в любой момент:
        «Настройки» → «Конфиденциальность».
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-act="deny">Не отправлять</button>
        <button class="btn btn-accent" data-act="allow">Разрешить</button>
      </div>
    </div>`;
  document.body.appendChild(box);
  box.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    setConsent(act === 'allow');
    box.remove();
  });
}
