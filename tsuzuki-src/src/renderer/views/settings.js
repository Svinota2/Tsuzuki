// ============================================================
//  НАСТРОЙКИ: цвет, резервные копии, импорт с Shikimori.
// ============================================================

// ------------------------------------------------------------
//  ИЗМЕНЕНО В 1.1 (Claude, 02.11.2026):
//  - раздел «Внешний вид и поведение» (из custom.js)
//  - импорт из MAL-файла и AniList
// ------------------------------------------------------------

import * as store from '../store.js';
import { fetchUserList, clearFranchiseCache } from '../api/shikimori.js';
import { parseMalXml, fetchAniList, applyImport } from '../api/importers.js';
import { OPTIONS, GROUPS, valueOf, setOption, resetCustom, applyCustom } from '../custom.js';
import { kodikError } from '../api/kodik.js';
import { ACCENTS, applyAccent } from '../theme.js';
import { esc, toast, confirmDialog } from '../utils.js';
import { resetCatalog } from './catalog.js';
// ИЗМЕНЕНО В 1.3: синхронизация, автообновление, анонимная статистика
// ИЗМЕНЕНО В 1.6: статусы и установка обновления вынесены в api/updater.js
import { getStatus as getSyncStatus, login as syncLogin, loginWithCode, logout as syncLogout, syncNow } from '../api/shikimori-sync.js';
import { checkUpdates, getUpdateState, installUpdate, updateText } from '../api/updater.js';
import { trackDailyOpen, resetInstallId } from '../api/telemetry.js';

// «На лету» обновляем строку статуса на экране настроек
let liveUpdateListener = null;

export async function render(root) {
  root.scrollTop = 0;
  const [dataPath, appInfo] = await Promise.all([
    window.api.dataPath(),
    window.api.deviceInfo ? window.api.deviceInfo().catch(() => ({})) : Promise.resolve({}),
  ]);
  let sync = { loggedIn: false };
  try { sync = await getSyncStatus(); } catch { sync = { loggedIn: false }; }
  const authUrlText = window.api.shikiAuthUrl
    ? await window.api.shikiAuthUrl().catch(() => '')
    : '';

  function draw() {
    // ИЗМЕНЕНО В 1.6: строка статуса обновления обновляется «на лету»
    // (прогресс скачивания приходит из главного процесса событием tsuzuki:update)
    if (liveUpdateListener) window.removeEventListener('tsuzuki:update', liveUpdateListener);
    liveUpdateListener = (e) => {
      const el = root.querySelector('#update-status');
      if (el) el.textContent = updateText(e.detail);
    };
    window.addEventListener('tsuzuki:update', liveUpdateListener);

    const current = store.getPrefs().accent || ACCENTS[0];
    const total = store.listEntries('all').length;
    const adblockEnabled = store.getPrefs().adblock !== false;
    const showAdult = store.getPrefs().showAdult === true;
    // Блокировка рекламы возможна только в Electron (ПК/Linux): в Android WebView
    // сеть не перехватывается, поэтому на ТВ вкладку не показываем.
    const adblockBox = window.api.isTV ? '' : `
          <div class="box">
            <h3>Блокировка рекламы</h3>
            <p>Отключает рекламные и трекерные запросы в самом приложении, внутри Kodik-плеера и в окнах сервисов. В окнах сервисов дополнительно прячутся нативные рекламные блоки по правилам скрытия RU AdList. Списки — EasyList и RU AdList.</p>
            <label class="check-row"><input type="checkbox" id="adblock" ${adblockEnabled ? 'checked' : ''}> <span>${adblockEnabled ? 'Включена' : 'Выключена'}</span></label>
            <p class="faint" id="adblock-stats" style="margin:10px 0 0"></p>
          </div>`;
    // ---------- ИЗМЕНЕНО В 1.3: аккаунт Shikimori, обновления, конфиденциальность ----------
    const lastSync = store.getSyncLast();
    const syncBox = `
          <div class="box">
            <h3>Аккаунт Shikimori</h3>
            ${sync.loggedIn
              ? `<p>Вы вошли${sync.user && sync.user.nickname ? ` как <b>${esc(sync.user.nickname)}</b>` : ''}.
                   Отметки серий, статусы и оценки синхронизируются в обе стороны — это же даёт общий список на ПК и ТВ.</p>
                 <p class="faint">Последняя синхронизация: ${lastSync ? esc(new Date(lastSync).toLocaleString('ru-RU')) : 'ещё не было'}</p>
                 <div class="row">
                   <button class="btn btn-accent" data-act="shiki-sync">Синхронизировать сейчас</button>
                   <button class="btn btn-ghost" data-act="shiki-logout">Выйти</button>
                 </div>`
              : `<p>Вход включает двустороннюю синхронизацию: отметки, статусы и оценки уезжают на Shikimori и приезжают с него. Это же даёт общий список на ПК и ТВ.</p>
                 ${window.api.isTV
                   ? `<p>Вход пультом неудобен: открой ссылку на телефоне, разреши доступ и введи код ниже.</p>
                      ${authUrlText ? `<p class="path" style="word-break:break-all">${esc(authUrlText)}</p>` : ''}
                      <div class="row">
                        <input class="input" id="shiki-code" placeholder="Код из 64 символов" style="flex:1">
                        <button class="btn btn-accent" data-act="shiki-code">Войти по коду</button>
                      </div>`
                   : `<div class="row"><button class="btn btn-accent" data-act="shiki-login">Войти через Shikimori</button></div>
                      <details style="margin-top:12px">
                        <summary class="faint" style="cursor:pointer">Войти по коду (если окно входа не открылось)</summary>
                        <div class="row" style="margin-top:8px">
                          <input class="input" id="shiki-code" placeholder="Код из 64 символов" style="flex:1">
                          <button class="btn" data-act="shiki-code">Войти по коду</button>
                        </div>
                      </details>`}
                 <p class="faint" style="margin:12px 0 0">Для входа нужно OAuth-приложение Shikimori: client_id и client_secret вписываются в src/main/settings.js (раздел «Аккаунт Shikimori»).</p>`
            }
          </div>`;

    const upd = getUpdateState();
    // ИЗМЕНЕНО В 1.6: кнопки под текущий статус (обновить / скачать со страницы релиза)
    const canInstallReady = upd.status === 'ready';
    const canInstallAvailable = upd.status === 'available';
    const installLabel = window.api.manualInstall
      ? 'Скачать обновление'
      : (upd.platform === 'linux' ? 'Скачать (страница релиза)' : 'Скачать обновление');
    const updateBox = `
          <div class="box">
            <h3>Обновления</h3>
            <p>Версия приложения: <b>${esc(appInfo.version || '—')}</b>.
               ${window.api.manualInstall ? 'На телефоне/ТВ обновление ставится новым APK — кнопка ниже проверит и скачает его.'
                 : 'Проверка идёт автоматически, если включено «Проверять обновления автоматически». На Linux вместо установщика откроется страница релиза.'}</p>
            <div class="row">
              <button class="btn" data-act="check-updates">Проверить обновления</button>
              ${canInstallReady ? '<button class="btn btn-accent" data-act="update-install">Перезапустить и обновить</button>' : ''}
              ${canInstallAvailable ? `<button class="btn btn-accent" data-act="update-install">${esc(installLabel)}</button>` : ''}
            </div>
            <p class="faint" id="update-status" style="margin:10px 0 0">${esc(updateText(upd))}</p>
          </div>`;

    const telemetryOn = store.getPrefs().telemetry === true;
    const privacyBox = `
          <div class="box">
            <h3>Конфиденциальность</h3>
            <label class="check-row"><input type="checkbox" id="telemetry" ${telemetryOn ? 'checked' : ''}>
              <span>${telemetryOn ? 'Анонимная статистика включена' : 'Анонимная статистика выключена'}</span></label>
            <p>Отправляются только: версия, платформа, язык и число тайтлов в библиотеке (округлённое до десятков). Ни идентификаторов, ни названий, ни оценок, ни списка, ни путей к файлам. Одно событие в сутки на сервис Aptabase (ЕС); пока выключено — приложение никуда не обращается.</p>
          </div>`;

    root.innerHTML = `
      <div class="page">
        <h1 class="page-title">Настройки</h1>
        <div class="settings">
          <div class="box">
            <h3>Акцентный цвет</h3>
            <p>Цвет кнопок и отметок. Остальные цвета — в файле src/renderer/styles/theme.css.</p>
            <div class="accents">
              ${ACCENTS.map((c) => `<div class="accent-dot ${c === current ? 'active' : ''}" data-accent="${c}" style="background:${c}"></div>`).join('')}
            </div>
          </div>

          ${customHtml()}

          <div class="box">
            <h3>Каталог</h3>
            <p>Shikimori по умолчанию скрывает тайтлы с рейтингом 18+ (R+ и выше). Включи, если хочешь видеть их в поиске и каталоге.</p>
            <label class="check-row"><input type="checkbox" id="show-adult" ${showAdult ? 'checked' : ''}> <span>${showAdult ? 'Показывать 18+' : '18+ скрыты'}</span></label>
          </div>

          <div class="box">
            <h3>Папка с аниме</h3>
            <p>Укажи общую папку, где каждое аниме лежит в своей подпапке, — приложение само найдёт тайтлы на Shikimori и предложит связать их с папками.</p>
            <div class="row"><a class="btn" href="#/autoscan">Разложить папку с аниме…</a></div>
          </div>

          <div class="box">
            <h3>Импорт из других программ</h3>
            <p><b>Файл в формате MyAnimeList</b> (.xml или .xml.gz) — экспорт из MyAnimeList, Shikimori, Kitsu и других программ, которые умеют «экспорт в MAL».
               <b>AniList</b> — просто ник, список должен быть открытым.</p>
            <div class="row">
              <button class="btn" data-act="import-mal">Выбрать файл MAL…</button>
              <input class="input" id="anilist-nick" placeholder="Ник на AniList" style="flex:1">
              <button class="btn" data-act="import-anilist">Импорт с AniList</button>
            </div>
            <label class="check-row" style="margin-top:10px"><input type="checkbox" id="import-skip"> <span>Не трогать тайтлы, которые уже есть в моём списке</span></label>
            <p id="import2-status" style="margin:10px 0 0"></p>
          </div>

          <div class="box">
            <h3>Импорт списка с Shikimori</h3>
            <p>Введи свой ник — заберём статусы, оценки и число просмотренных серий. Список в профиле должен быть открытым. Записи с теми же тайтлами перезапишутся.</p>
            <div class="row">
              <input class="input" id="nick" placeholder="Ник на Shikimori" style="flex:1">
              <button class="btn btn-accent" data-act="import-shiki">Импортировать</button>
            </div>
            <p id="import-status" style="margin:10px 0 0"></p>
          </div>

          <div class="box">
            <h3>Kodik — онлайн-просмотр</h3>
            <p>Свой токен не обязателен: если поле пустое, приложение само найдёт рабочий публичный токен из открытой библиотеки <b>AnimeParsers</b> (токен общий, может перестать работать в любой момент). Свой токен выдаётся владельцам сайтов: <b>support@kodikres.com</b>. Можно также задать переменную окружения <span class="kbd">KODIK_TOKEN</span>.</p>
            <div class="row">
              <input class="input" id="kodik-token" placeholder="Токен Kodik API" style="flex:1" value="${esc(store.getPrefs().kodikToken || '')}">
              <button class="btn btn-accent" data-act="save-kodik">Сохранить</button>
              <button class="btn btn-ghost" data-act="check-kodik">Проверить</button>
            </div>
            <p id="kodik-status" style="margin:10px 0 0"></p>
          </div>

          ${adblockBox}

          ${syncBox}
          ${updateBox}
          ${privacyBox}

          <div class="box">
            <h3>Резервная копия</h3>
            <p>В списке ${total} тайтлов. Данные хранятся тут:</p>
            <div class="path">${esc(dataPath)}</div>
            <div class="row">
              <button class="btn" data-act="export">Сохранить копию…</button>
              <button class="btn" data-act="import">Загрузить из копии…</button>
              <button class="btn btn-ghost btn-danger" data-act="clear">Очистить всё</button>
            </div>
          </div>

          <div class="box">
            <h3>О приложении</h3>
            <p>Tsuzuki — каталог и трекер аниме. Список, история и настройки хранятся только на твоём устройстве.</p>
            <div class="row">
              <a class="btn" href="#/privacy">Политика конфиденциальности</a>
            </div>
          </div>

          <div class="box">
            <h3>Для разработчика</h3>
            <p>Ctrl+R — перезагрузить интерфейс после правок в коде. Ctrl+Shift+I — инструменты разработчика (ошибки, консоль). Запуск с открытыми инструментами: <span class="kbd">npm run dev</span></p>
          </div>
        </div>
      </div>`;

    const page = root.querySelector('.page');
    // Счётчик заблокированных запросов (обновляется при открытии настроек)
    window.api.adblockStats()
      .then((s) => {
        const el = page.querySelector('#adblock-stats');
        if (el) el.textContent = `Заблокировано запросов: ${s.blocked} · доменов в списке: ${s.domains}`;
      })
      .catch(() => {});
    page.addEventListener('input', (e) => { if (e.target.dataset.opt) onOption(e.target, true); });
    page.addEventListener('change', (e) => { if (e.target.dataset.opt) onOption(e.target, false); });
    page.addEventListener('click', async (e) => {
      if (e.target.id === 'telemetry') {
        // ИЗМЕНЕНО В 1.3: анонимная статистика
        const on = e.target.checked;
        store.setPref('telemetry', on);
        if (on) setTimeout(() => { trackDailyOpen().catch(() => {}); }, 1500);
        toast(on ? 'Анонимная статистика включена' : 'Анонимная статистика выключена', 'ok');
        return draw();
      }
      if (e.target.id === 'show-adult') {
        const on = e.target.checked;
        store.setPref('showAdult', on);
        clearFranchiseCache(); // у уже открытых франшиз появятся/исчезнут 18+ сезоны
        resetCatalog(); // каталог перезагрузится с новым фильтром
        toast(on ? '18+ тайтлы включены' : '18+ тайтлы скрыты', 'ok');
        return draw();
      }
      if (e.target.id === 'adblock') {
        const on = e.target.checked;
        store.setPref('adblock', on);
        window.api.setAdblock(on);
        toast(on ? 'Блокировка рекламы включена' : 'Блокировка рекламы выключена', 'ok');
        return draw();
      }
      const accent = e.target.closest('[data-accent]');
      if (accent) {
        store.setPref('accent', accent.dataset.accent === ACCENTS[0] ? null : accent.dataset.accent);
        applyAccent();
        return draw();
      }
      const act = e.target.closest('[data-act]')?.dataset.act;
      try {
        if (act === 'export' && (await store.exportBackup())) toast('Копия сохранена', 'ok');
        if (act === 'import' && (await store.importBackup())) { applyAccent(); applyCustom(); draw(); toast('Данные загружены', 'ok'); }
        if (act === 'clear' && (await confirmDialog('Удалить весь список, историю и отметки? Это нельзя отменить (если нет резервной копии).', { danger: true, ok: 'Удалить всё' }))) {
          store.clearAll(); applyAccent(); applyCustom(); draw(); toast('Всё очищено');
        }
        if (act === 'import-shiki') await importShiki(page);
        if (act === 'import-mal') await importOther(page, 'mal');
        if (act === 'import-anilist') await importOther(page, 'anilist');
        if (act === 'reset-custom' && (await confirmDialog('Вернуть все настройки внешнего вида и поведения к стандартным?', { ok: 'Сбросить' }))) {
          resetCustom(); resetCatalog(); draw(); toast('Настройки сброшены', 'ok');
        }
        if (act === 'save-kodik') saveKodik(page);
        if (act === 'check-kodik') await checkKodik(page);
        // ---------- ИЗМЕНЕНО В 1.3 ----------
        if (act === 'shiki-login') {
          await syncLogin();
          sync = await getSyncStatus();
          return draw();
        }
        if (act === 'shiki-logout' && (await confirmDialog('Выйти из аккаунта Shikimori? Список останется на месте, синхронизация отключится.'))) {
          await syncLogout();
          sync = await getSyncStatus();
          return draw();
        }
        if (act === 'shiki-sync') {
          await syncNow();
          sync = await getSyncStatus();
          return draw();
        }
        if (act === 'shiki-code') {
          const input = page.querySelector('#shiki-code');
          const code = (input?.value || '').trim();
          if (!code) { toast('Введи код из 64 символов', 'error'); return; }
          await loginWithCode(code);
          sync = await getSyncStatus();
          return draw();
        }
        if (act === 'check-updates') {
          const s = await checkUpdates();
          const el = page.querySelector('#update-status');
          if (el) el.textContent = updateText(s);
          toast(updateText(s) || 'Готово', s && s.status === 'error' ? 'error' : 'ok');
          return;
        }
        // ИЗМЕНЕНО В 1.6: кнопка «Перезапустить и обновить» / «Скачать обновление»
        if (act === 'update-install') {
          const btn = page.querySelector('[data-act="update-install"]');
          if (btn) btn.disabled = true;
          await installUpdate();
          const el = page.querySelector('#update-status');
          if (el) el.textContent = updateText(getUpdateState());
          if (btn) btn.disabled = false;
          return;
        }
        if (act === 'reset-install-id') {
          resetInstallId();
          toast('Идентификатор статистики сброшен', 'ok');
          return;
        }
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  function saveKodik(page) {
    const token = page.querySelector('#kodik-token').value.trim();
    store.setPref('kodikToken', token || null);
    const status = page.querySelector('#kodik-status');
    status.style.color = 'var(--text-2)';
    status.textContent = token ? 'Свой токен сохранён.' : 'Свой токен удалён. Будет использован публичный.';
    toast(token ? 'Токен Kodik сохранён' : 'Будет использован публичный токен Kodik', 'ok');
  }

  async function checkKodik(page) {
    const token = page.querySelector('#kodik-token').value.trim();
    const status = page.querySelector('#kodik-status');
    status.style.color = '';
    status.textContent = token ? 'Проверяю токен…' : 'Ищу публичный токен…';
    try {
      const result = await window.api.kodikCheck(token);
      const count = typeof result === 'number' ? result : result.count;
      const source = typeof result === 'object' && result.source ? result.source : 'user';
      status.style.color = 'var(--good)';
      status.textContent = source === 'user'
        ? `Токен рабочий. Доступно переводов: ${count}.`
        : `Публичный токен рабочий. Доступно переводов: ${count}. Свой можно не вводить.`;
    } catch (err) {
      status.style.color = 'var(--bad)';
      status.textContent = 'Ошибка: ' + kodikError(err);
    }
  }

  // ---------- Внешний вид и поведение (пункты берутся из custom.js → OPTIONS) ----------
  function customHtml() {
    const control = (o) => {
      const v = valueOf(o);
      if (o.type === 'toggle') {
        return `<label class="check-row"><input type="checkbox" data-opt="${o.key}" ${v ? 'checked' : ''}> <span>${esc(o.label)}</span></label>`;
      }
      if (o.type === 'select') {
        const choices = typeof o.choices === 'function' ? o.choices() : o.choices;
        return `<div class="opt-row"><span>${esc(o.label)}</span>
          <select class="select" data-opt="${o.key}">${Object.entries(choices).map(([k, label]) =>
            `<option value="${esc(k)}" ${k === v ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></div>`;
      }
      return `<div class="opt-row"><span>${esc(o.label)}</span>
        <input type="range" data-opt="${o.key}" min="${o.min}" max="${o.max}" step="${o.step}" value="${v}">
        <b class="opt-val" data-val="${o.key}">${v}${o.unit || ''}</b></div>`;
    };
    return `
      <div class="box">
        <div class="block-head"><h3>Внешний вид и поведение</h3>
          <button class="btn btn-sm btn-ghost" data-act="reset-custom">Сбросить</button></div>
        <p>Меняется сразу. Свои пункты можно добавить в файле src/renderer/custom.js.</p>
        ${Object.entries(GROUPS).map(([g, title]) => `
          <div class="opt-group">
            <div class="opt-title">${esc(title)}</div>
            ${OPTIONS.filter((o) => o.group === g).map(control).join('')}
          </div>`).join('')}
      </div>`;
  }

  // Эти настройки влияют на выдачу каталога — после них каталог перезагрузится
  const CATALOG_KEYS = ['STRICT_SEARCH', 'DEFAULT_ORDER', 'MIN_VOTES', 'PAGE_SIZE', 'STACK_FRANCHISES', 'HIDE_JUNK_KINDS', 'HIDE_NO_POSTER', 'HIDE_ANONS'];

  // ИЗМЕНЕНО В 1.6.2: ползунки больше не «трясутся».
  // Раньше на каждое движение ползунка настройки сохранялись на диск целиком,
  // а «Масштаб интерфейса» и «Ширина бокового меню» сразу меняли окно —
  // ползунок уезжал из-под мышки, и значение прыгало (80 → 130 → 80…).
  // Теперь пока тянешь — только подпись и лёгкий предпросмотр (карточки, углы),
  // а сохранение и масштаб/ширина меню применяются, когда отпустишь ползунок.
  const PREVIEW = {
    cardWidth: (v) => document.documentElement.style.setProperty('--card-width', v + 'px'),
    radius: (v) => {
      document.documentElement.style.setProperty('--radius', v + 'px');
      document.documentElement.style.setProperty('--radius-sm', Math.round(v * 0.66) + 'px');
    },
  };
  let previewFrame = 0;

  function onOption(el, live) {
    const key = el.dataset.opt;
    const o = OPTIONS.find((x) => x.key === key);
    const value = o.type === 'toggle' ? el.checked : o.type === 'range' ? Number(el.value) : el.value;
    const label = root.querySelector(`[data-val="${key}"]`);
    if (label) label.textContent = value + (o.unit || '');
    if (live) {
      // пока тянешь: без сохранения; предпросмотр — не чаще раза за кадр
      if (PREVIEW[key]) {
        cancelAnimationFrame(previewFrame);
        previewFrame = requestAnimationFrame(() => PREVIEW[key](value));
      }
      return;
    }
    setOption(key, value);
    if (CATALOG_KEYS.includes(key)) resetCatalog();
  }

  // ---------- Импорт MAL / AniList ----------
  async function importOther(page, kind) {
    const status = page.querySelector('#import2-status');
    const mode = page.querySelector('#import-skip').checked ? 'skip' : 'overwrite';
    let rates, note = '';
    if (kind === 'mal') {
      const file = await window.api.openTextFile({ title: 'Файл экспорта в формате MyAnimeList', extensions: ['xml', 'gz'] });
      if (!file) return;
      rates = parseMalXml(file.text);
      status.textContent = `${file.name}: найдено ${rates.length} тайтлов, загружаю сведения…`;
    } else {
      const nick = page.querySelector('#anilist-nick').value.trim();
      if (!nick) return toast('Введи ник на AniList');
      status.textContent = 'Загружаю список с AniList…';
      const res = await fetchAniList(nick);
      rates = res.rates;
      if (res.noMal) note = ` ${res.noMal} шт. нет на Shikimori — пропущены.`;
      status.textContent = `Найдено ${rates.length} тайтлов, загружаю сведения…`;
    }
    const r = await applyImport(rates, {
      mode,
      onProgress: (done, total) => (status.textContent = `Загружаю сведения с Shikimori: ${done} из ${total}…`),
    });
    status.textContent = `Готово: добавлено ${r.added}` +
      (r.skipped ? `, оставлено как было ${r.skipped}` : '') +
      (r.notFound ? `, не найдено на Shikimori ${r.notFound}` : '') +
      '.' + note;
    toast(`Импортировано ${r.added} тайтлов`, 'ok');
  }

  async function importShiki(page) {
    const nick = page.querySelector('#nick').value.trim();
    if (!nick) return toast('Введи ник');
    const status = page.querySelector('#import-status');
    const btn = page.querySelector('[data-act="import-shiki"]');
    btn.disabled = true;
    status.textContent = 'Ищу пользователя…';
    try {
      const { user, rates } = await fetchUserList(nick, (n) => (status.textContent = `Загружено записей: ${n}…`));
      const added = store.importShikimoriRates(rates);
      toast(`Импортировано ${added} тайтлов от ${user.nickname}`, 'ok');
      draw();
    } catch (err) {
      status.textContent = 'Ошибка: ' + err.message;
      btn.disabled = false;
    }
  }

  draw();
  // Ctrl+R здесь работает как обычно — ничего снимать не нужно
  // ИЗМЕНЕНО В 1.6: при уходе со страницы снимаем «живой» слушатель статуса
  return () => {
    if (liveUpdateListener) {
      window.removeEventListener('tsuzuki:update', liveUpdateListener);
      liveUpdateListener = null;
    }
  };
}
