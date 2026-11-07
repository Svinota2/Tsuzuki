// ============================================================
//  СТРАНИЦА АНИМЕ: описание, статус в списке, серии, где смотреть.
// ============================================================

// ------------------------------------------------------------
//  ИЗМЕНЕНО В 1.1 (Claude, 02.11.2026):
//  - блок «Сезоны и части» с переключателем OVA/спешлов
//  - блок «Статистика Shikimori»
// ------------------------------------------------------------

import { CONFIG } from '../config.js';
import { getAnime, getFranchise, votesOf } from '../api/shikimori.js';
import { shortNumber } from '../components/card.js';
import * as store from '../store.js';
import {
  esc, titleOf, kindLabel, animeStatusLabel, cleanDescription, airedEpisodes,
  parseEpisodeNumber, formatDate, plural, toast, confirmDialog,
} from '../utils.js';

// Кеш: то, что уже видели в каталоге, показываем сразу, пока грузятся подробности
const cache = new Map();
export const rememberAnime = (a) => { if (!cache.has(String(a.id))) cache.set(String(a.id), a); };

// Какие видео с Shikimori показывать как трейлеры
// Ролики с такими словами в названии не показываем (фанатские переводы)
const HIDE_VIDEO_NAMES = /озвучка|субтитры|voice|fandub/i;
const VIDEO_KINDS = { pv: 'Трейлер', op: 'Опенинг', ed: 'Эндинг', character_trailer: 'Трейлер персонажа' };

export async function render(root, [id]) {
  const stored = store.getEntry(id);
  const manual = stored?.manual ? stored : null;

  let anime = manual ? animeFromEntry(manual) : (cache.get(String(id)) || null);
  let full = !!manual;
  let files = [];            // видео в привязанной папке
  let fileByEp = new Map();  // номер серии → индекс файла
  let seasons = [];          // все сезоны этой франшизы (Shikimori)
  let showExtras = false;    // показывать ли OVA, спешлы и рекапы в «Сезонах»
  let disposed = false;      // страницу уже закрыли — отложенные ответы игнорируем

  root.scrollTop = 0;
  if (!anime) root.innerHTML = '<div class="spinner"></div>';
  else draw();

  // Подробности с Shikimori (для своих записей они уже есть локально)
  if (!manual) {
    try {
      const data = await getAnime(id);
      if (!data) throw new Error('Тайтл не найден');
      anime = data;
      full = true;
      cache.set(String(id), data);
      // обновляем сведения в библиотеке (вдруг вышли новые серии)
      if (store.getEntry(id)) store.ensureEntry(anime);
    } catch (err) {
      if (!anime) throw err;
      toast('Не удалось загрузить подробности: ' + err.message, 'error');
    }
  }
  await scanFolder();
  draw();

  // Сезоны франшизы подгружаем отдельно — страница уже на экране
  if (anime.franchise) {
    getFranchise(anime.franchise)
      .then((list) => {
        if (disposed) return; // ушли на другой тайтл/раздел — не перерисовываем
        seasons = list;
        if (root.querySelector('.anime-page')) draw();
      })
      .catch(() => {});
  }

  async function scanFolder() {
    const folder = store.getEntry(id)?.folder;
    files = folder ? await window.api.listVideos(folder) : [];
    fileByEp = new Map();
    files.forEach((f, i) => {
      const n = parseEpisodeNumber(f.name) ?? i + 1; // номер не нашёлся — берём по порядку
      if (!fileByEp.has(n)) fileByEp.set(n, i);
    });
  }

  // Перерисовка при любом изменении списка (например, отметил серию)
  const unsubscribe = store.onChange(() => draw());

  function draw() {
    const scroll = root.scrollTop;
    root.innerHTML = pageHtml();
    root.scrollTop = scroll;
    bind(root.querySelector('.anime-page'));
  }

  // ---------- Разметка ----------
  function pageHtml() {
    const entry = store.getEntry(id);
    const title = titleOf(anime);
    const poster = anime.poster?.mainUrl || '';
    const year = anime.airedOn?.year;
    const aired = airedEpisodes(anime);
    const total = anime.episodes || 0;
    const watched = entry?.watched.length || 0;

    const meta = [
      kindLabel(anime.kind) && `<span>${esc(kindLabel(anime.kind))}</span>`,
      year && `<span>${year}</span>`,
      `<span>${esc(animeStatusLabel(anime.status))}</span>`,
      (total || aired) && `<span><b>${anime.status === 'ongoing' ? `${aired} из ${total || '?'}` : total || aired}</b> ${plural(total || aired, ['серия', 'серии', 'серий'])}</span>`,
      anime.duration && `<span>по ${anime.duration} мин</span>`,
      anime.score && `<span class="score-big">★ ${Number(anime.score).toFixed(2)}</span>`,
    ].filter(Boolean).join('');

    const genres = (anime.genres || []).map((g) => `<span class="chip">${esc(g.russian)}</span>`).join('')
      + (manual ? '<span class="chip">Своя запись</span>' : '');
    const studios = (anime.studios || []).map((s) => s.name).join(', ');

    return `
      <div class="anime-page">
        <div class="hero">
          <div class="hero-bg" style="background-image:url('${esc(poster)}')"></div>
          <div class="hero-fade"></div>
          <div class="hero-inner">
            ${poster ? `<img class="hero-poster" src="${esc(poster)}" alt="">` : '<div class="hero-poster"></div>'}
            <div class="hero-info">
              <a class="back" data-act="back">← Назад</a>
              <h1 class="anime-title">${esc(title)}</h1>
              <div class="anime-sub">${esc([anime.name, anime.japanese].filter(Boolean).join(' · '))}</div>
              <div class="meta-row">${meta}</div>
              <div class="chips">${genres}</div>
              ${studios ? `<div class="muted" style="margin-top:12px">Студия: ${esc(studios)}</div>` : ''}
              ${anime.nextEpisodeAt ? `<div class="muted" style="margin-top:6px">Следующая серия: <b>${esc(formatDate(anime.nextEpisodeAt))}</b></div>` : ''}

              <div class="actions">
                <select class="select status-select" data-act="status">
                  <option value="">${entry?.status ? 'Убрать из списка' : '＋ Добавить в список'}</option>
                  ${CONFIG.STATUSES.map((s) => `<option value="${s.id}" ${entry?.status === s.id ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
                </select>
                <select class="select" data-act="score" title="Твоя оценка">
                  <option value="0">Оценка</option>
                  ${[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => `<option value="${n}" ${entry?.score === n ? 'selected' : ''}>★ ${n}</option>`).join('')}
                </select>
                ${files.length ? `<button class="btn btn-accent" data-act="play">▶ Смотреть ${store.nextEpisode(id)} серию</button>` : ''}
                <button class="btn btn-online" data-act="online">🌐 Онлайн с озвучками</button>
                ${manual ? `<button class="btn btn-sm btn-ghost" data-act="edit">✎ Редактировать</button>
                            <button class="btn btn-sm btn-danger" data-act="delete">Удалить</button>` : ''}
                ${watched ? `<span class="muted">Просмотрено ${watched}${total ? ' из ' + total : ''}</span>` : ''}
              </div>
            </div>
          </div>
        </div>

        <div class="section">
          ${seasonsHtml()}
          ${episodesHtml(entry)}
          ${watchHtml(entry)}
          ${shikiStatsHtml()}
          ${trailersHtml()}
          ${anime.description ? `<h2>Описание</h2><div class="description">${esc(cleanDescription(anime.description))}</div>` : ''}
          ${noteHtml()}
          ${relatedHtml()}
          ${!full ? '<div class="spinner"></div>' : ''}
        </div>
      </div>`;
  }

  function episodesHtml(entry) {
    const aired = airedEpisodes(anime);
    const maxWatched = Math.max(0, ...(entry?.watched || []));
    const maxFile = Math.max(0, ...fileByEp.keys());
    const count = Math.max(anime.episodes || 0, aired, maxWatched, maxFile);
    if (!count) {
      return `<h2>Серии</h2><div class="muted">Количество серий пока неизвестно.
        <button class="btn btn-sm" data-act="plus">+1 серия</button> (отмечено: ${entry?.watched.length || 0})</div>`;
    }
    let buttons = '';
    for (let n = 1; n <= count; n++) {
      const cls = [
        'ep',
        entry?.watched.includes(n) && 'watched',
        n > aired && aired > 0 && 'unaired',
        fileByEp.has(n) && 'has-file',
      ].filter(Boolean).join(' ');
      buttons += `<button class="${cls}" data-ep="${n}">${n}</button>`;
    }
    return `
      <h2>Серии <span class="muted">клик — смотреть серию, Alt+клик — отметить/снять, правый клик — отметить все до этой${fileByEp.size ? ', двойной клик — свой файл' : ''}</span></h2>
      <div class="episodes">${buttons}</div>
      <div class="legend">
        <span><span class="dot" style="background:var(--accent)"></span> просмотрена</span>
        ${fileByEp.size ? '<span><span class="dot" style="background:var(--good)"></span> есть файл</span>' : ''}
        ${aired < count ? '<span style="opacity:.5">▢ ещё не вышла</span>' : ''}
      </div>`;
  }

  function watchHtml(entry) {
    const folder = entry?.folder;
    const ext = Object.fromEntries((anime.externalLinks || []).map((l) => [l.kind, l.url]));
    return `
      <h2>Где смотреть</h2>
      <div class="watch-box">
        <div class="box">
          <h3>Онлайн с озвучками</h3>
          <p>Kodik: авторские озвучки и субтитры. Плеер открывается прямо в приложении, без перехода в браузер.</p>
          <div class="row">
            <button class="btn btn-online" data-act="online">▶ Смотреть онлайн</button>
          </div>
        </div>
        <div class="box">
          <h3>Свои файлы</h3>
          ${folder
            ? `<div class="path">${esc(folder)}</div>
               <p>Найдено ${files.length} ${plural(files.length, ['видеофайл', 'видеофайла', 'видеофайлов'])}</p>`
            : `<p>Укажи папку с сериями на диске — приложение само найдёт номера серий и отметит просмотренное.</p>`}
          <div class="row">
            <button class="btn btn-sm" data-act="folder">${folder ? 'Сменить папку' : 'Выбрать папку'}</button>
            ${folder ? `<button class="btn btn-sm btn-ghost" data-act="open-folder">Открыть в проводнике</button>
                        <button class="btn btn-sm btn-ghost" data-act="rescan">Обновить</button>` : ''}
          </div>
        </div>
        <div class="box">
          <h3>Официальные сервисы</h3>
          <p>Откроется окно сервиса — войди в свой аккаунт и смотри по подписке. Серии отмечай здесь.</p>
          <div class="row">
            ${ext.kinopoisk ? `<button class="btn btn-sm" data-web="${esc(ext.kinopoisk)}">Кинопоиск: страница тайтла</button>` : ''}
            ${CONFIG.SERVICES.filter((s) => !(ext.kinopoisk && s.name === 'Кинопоиск'))
              .map((s, i) => `<button class="btn btn-sm btn-ghost" data-service="${CONFIG.SERVICES.indexOf(s)}">${esc(s.name)}</button>`).join('')}
            ${ext.official_site ? `<button class="btn btn-sm btn-ghost" data-external="${esc(ext.official_site)}">Официальный сайт ↗</button>` : ''}
          </div>
        </div>
      </div>`;
  }

  // Все сезоны франшизы по порядку выхода; точка — твой статус
  function seasonsHtml() {
    if (seasons.length < 2) return '';
    // Основное — сериалы, фильмы и ONA; остальное (OVA, спешлы, рекапы) по кнопке
    const MAIN = ['tv', 'movie', 'ona'];
    const main = seasons.filter((a) => MAIN.includes(a.kind) || String(a.id) === String(id));
    const extras = seasons.length - main.length;
    const list = showExtras ? seasons : main;
    if (list.length < 2 && !extras) return '';
    return `<h2>Сезоны и части <span class="muted">по порядку выхода</span>
        ${extras ? `<button class="btn btn-sm btn-ghost" data-act="extras">${showExtras ? 'Только основное' : `+ OVA и спешлы (${extras})`}</button>` : ''}</h2>
      <div class="seasons">
        ${list.map((a, i) => {
          const e = store.getEntry(a.id);
          const st = e?.status ? CONFIG.STATUSES.find((x) => x.id === e.status) : null;
          const current = String(a.id) === String(id);
          return `
            <div class="season ${current ? 'current' : ''}" data-goto="${a.id}" title="${esc(titleOf(a))}">
              ${a.poster?.mainUrl ? `<img src="${esc(a.poster.mainUrl)}" loading="lazy" alt="">` : '<div class="season-ph"></div>'}
              <div class="season-num">${i + 1}</div>
              ${st ? `<span class="card-badge" style="background:${st.color}" title="${esc(st.label)}"></span>` : ''}
              <div class="season-title">${esc(titleOf(a))}</div>
              <div class="season-meta">${esc([kindLabel(a.kind), a.airedOn?.year, a.episodes ? a.episodes + ' эп.' : ''].filter(Boolean).join(' · '))}</div>
            </div>`;
        }).join('')}
      </div>`;
  }

  // Настоящая статистика с Shikimori: как оценивают и сколько людей смотрит
  function shikiStatsHtml() {
    const scores = (anime.scoresStats || []).filter((x) => x.score);
    const statuses = anime.statusesStats || [];
    if (!scores.length && !statuses.length) return '';
    const votes = votesOf(anime);
    const maxCount = Math.max(1, ...scores.map((x) => x.count));
    const people = statuses.reduce((sum, x) => sum + x.count, 0);
    const avg = votes ? scores.reduce((sum, x) => sum + x.score * x.count, 0) / votes : 0;
    const STATUS_LABELS = { planned: 'Запланировали', watching: 'Смотрят', completed: 'Просмотрели', on_hold: 'Отложили', dropped: 'Бросили' };
    const order = ['completed', 'watching', 'planned', 'on_hold', 'dropped'];
    const mine = store.getEntry(id)?.score || 0;

    return `<h2>Статистика Shikimori <span class="muted">${shortNumber(votes)} оценок · ${shortNumber(people)} в списках</span></h2>
      <div class="shiki-stats">
        <div class="box">
          <h3>Оценки зрителей</h3>
          <p>Средняя ${avg.toFixed(2)}${mine ? ` · твоя ${mine}` : ''}</p>
          <div class="score-bars">
            ${[...scores].sort((a, b) => b.score - a.score).map((x) => `
              <div class="score-row ${x.score === mine ? 'mine' : ''}">
                <span class="score-n">${x.score}</span>
                <div class="score-track"><div class="score-fill" style="width:${(x.count / maxCount) * 100}%"></div></div>
                <span class="score-c">${shortNumber(x.count)}</span>
              </div>`).join('')}
          </div>
        </div>
        <div class="box">
          <h3>В списках у людей</h3>
          <p>Сколько пользователей Shikimori добавили тайтл к себе</p>
          <div class="status-bars">
            ${order.map((k) => statuses.find((x) => x.status === k)).filter(Boolean).map((x) => {
              const st = CONFIG.STATUSES.find((s) => s.id === x.status);
              return `
                <div class="score-row">
                  <span class="status-n">${STATUS_LABELS[x.status] || x.status}</span>
                  <div class="score-track"><div class="score-fill" style="width:${people ? (x.count / people) * 100 : 0}%;background:${st?.color || 'var(--accent)'}"></div></div>
                  <span class="score-c">${people ? Math.round((x.count / people) * 100) : 0}%</span>
                </div>`;
            }).join('')}
          </div>
        </div>
      </div>`;
  }

  function trailersHtml() {
    const vids = (anime.videos || [])
      .filter((v) => VIDEO_KINDS[v.kind] && /youtu\.?be/.test(v.url))
      // любительские озвучки и сабы пропускаем — оставляем официальные ролики
      .filter((v) => !HIDE_VIDEO_NAMES.test(v.name || ''))
      .slice(0, 8);
    if (!vids.length) return '';
    return `<h2>Трейлеры и видео</h2><div class="trailers">
      ${vids.map((v) => `<button class="btn btn-sm" data-web="${esc(v.url)}">▶ ${esc(VIDEO_KINDS[v.kind])}${v.name ? ': ' + esc(v.name) : ''}</button>`).join('')}
    </div>`;
  }

  function relatedHtml() {
    const rel = (anime.related || []).filter((r) => r.anime).slice(0, 12);
    if (!rel.length) return '';
    return `<h2>Связанное</h2><div class="related">
      ${rel.map((r) => `
        <div class="rel" data-goto="${r.anime.id}">
          ${r.anime.poster?.previewUrl ? `<img src="${esc(r.anime.poster.previewUrl)}" loading="lazy" alt="">` : '<img alt="">'}
          <div>
            <div class="rel-type">${esc(r.relationText)} · ${esc(kindLabel(r.anime.kind))} ${r.anime.airedOn?.year || ''}</div>
            <div class="rel-name">${esc(titleOf(r.anime))}</div>
          </div>
        </div>`).join('')}
    </div>`;
  }

  // ---------- Действия ----------
  function openPlayer(ep) {
    const index = fileByEp.has(ep) ? fileByEp.get(ep) : 0;
    location.hash = `#/player/${id}/${index}`;
  }

  // Один клик по номеру серии: открыть эту серию в Kodik-плеере.
  // 'auto' — плеер сам сопоставит плоский номер Shikimori с сезоном/серией
  // Kodik (у озвучек бывает разбивка на сезоны с нумерацией серий заново с 1).
  // Отметку ставит плеер после того, как реально найдёт серию.
  function openEpisodeOnline(n) {
    location.hash = `#/watch/${id}//auto/${n}`;
  }

  // ДОБАВЛЕНО В 1.4: заметка к тайтлу и подборки
  function noteHtml() {
    const e = store.getEntry(id);
    return `<h2>Заметка <span class="muted">только для тебя</span></h2>
      <textarea class="input note-area" data-note placeholder="Что запомнить об этом тайтле: где смотреть, с кем, на чём остановился…">${esc(e?.note || '')}</textarea>
      <div class="row" style="margin-top:8px;align-items:center">
        <button class="btn btn-sm" data-act="collections">🗂 В подборку</button>
        <span class="faint" data-note-status></span>
      </div>`;
  }

  function openCollectionsModal() {
    store.ensureEntry(anime); // чтобы запись была в библиотеке
    const list = store.getCollections();
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal-box">
        <div class="modal-head">
          <span class="modal-title">Подборки</span>
          <button class="modal-x" data-act="close" title="Закрыть">×</button>
        </div>
        <p class="faint">Отметь, в какие подборки добавить «${esc(titleOf(anime))}».</p>
        <div class="modal-list">
          ${list.length
            ? list.map((c) => `<label class="check-row compact"><input type="checkbox" data-col="${esc(c.id)}" ${store.isInCollection(c.id, id) ? 'checked' : ''}> <span>${esc(c.name)}</span></label>`).join('')
            : '<p class="faint">Подборок пока нет — создай ниже.</p>'}
        </div>
        <div class="row" style="margin-top:12px">
          <input class="input" id="new-col-name" placeholder="Новая подборка" style="flex:1">
          <button class="btn btn-sm btn-accent" data-act="new-col">Создать</button>
        </div>
        <div class="modal-actions"><button class="btn btn-ghost" data-act="close">Готово</button></div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('change', (e) => {
      const cb = e.target.closest('[data-col]');
      if (!cb) return;
      const added = store.toggleCollectionItem(cb.dataset.col, id);
      toast(added ? 'Добавлено в подборку' : 'Убрано из подборки', 'ok');
    });
    modal.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close' || e.target === modal) return modal.remove();
      if (act === 'new-col') {
        const input = modal.querySelector('#new-col-name');
        const c = store.createCollection(input.value, '#ff5d48');
        if (!c) return toast('Введи название подборки', 'error');
        store.toggleCollectionItem(c.id, id);
        modal.querySelector('.modal-list').insertAdjacentHTML('beforeend',
          `<label class="check-row compact"><input type="checkbox" data-col="${esc(c.id)}" checked> <span>${esc(c.name)}</span></label>`);
        input.value = '';
        toast('Подборка создана', 'ok');
      }
    });
  }

  // ДОБАВЛЕНО В 1.4: долгое нажатие на номер серии (телефон) = отметить все до этой
  function bindLongPress(page) {
    page.querySelectorAll('[data-ep]').forEach((b) => {
      let timer = null;
      let long = false;
      const start = () => {
        long = false;
        timer = setTimeout(() => {
          long = true;
          const n = Number(b.dataset.ep);
          store.markUpTo(anime, n);
          toast(`Отмечены серии 1–${n}`, 'ok');
        }, 600);
      };
      const stop = () => clearTimeout(timer);
      b.addEventListener('touchstart', start, { passive: true });
      b.addEventListener('touchend', stop);
      b.addEventListener('touchcancel', stop);
      b.addEventListener('touchmove', stop, { passive: true });
      b.addEventListener('click', (e) => {
        if (!long) return;
        e.preventDefault();
        e.stopPropagation();
        long = false;
      }, true);
    });
  }

  function bind(page) {
    page.querySelector('[data-act="status"]').addEventListener('change', async (e) => {
      const v = e.target.value;
      if (!v) {
        if (await confirmDialog('Убрать тайтл из списка? Отметки серий тоже удалятся.', { danger: true, ok: 'Убрать' })) store.removeEntry(id);
        else draw();
      } else store.setStatus(anime, v);
    });
    page.querySelector('[data-act="score"]').addEventListener('change', (e) => store.setScore(anime, e.target.value));

    // ДОБАВЛЕНО В 1.4: заметка сохраняется сама (через 500 мс после ввода)
    const note = page.querySelector('[data-note]');
    if (note) {
      let noteTimer = null;
      note.addEventListener('input', () => {
        store.ensureEntry(anime);
        clearTimeout(noteTimer);
        const status = page.querySelector('[data-note-status]');
        if (status) status.textContent = 'Сохраняем…';
        noteTimer = setTimeout(() => {
          store.setNote(id, note.value);
          if (status) status.textContent = 'Сохранено';
          setTimeout(() => { if (status) status.textContent = ''; }, 1500);
        }, 500);
      });
    }
    bindLongPress(page);

    page.addEventListener('click', async (e) => {
      const t = e.target.closest('[data-act],[data-ep],[data-web],[data-service],[data-external],[data-goto]');
      if (!t) return;
      const d = t.dataset;

      if (d.ep && e.detail === 1) {
        const n = Number(d.ep);
        if (e.altKey) {
          // Alt+клик — отметить/снять отметку, не открывая плеер
          store.toggleEpisode(anime, n);
          return;
        }
        // Обычный клик: открыть серию в онлайн-плеере (отметку ставит плеер).
        // Небольшая задержка — чтобы успеть отличить от двойного клика (свой файл).
        t._clickTimer = setTimeout(() => openEpisodeOnline(n), 320);
      }
      if (d.web) window.api.openWeb(d.web, titleOf(anime));
      if (d.external) window.api.openExternal(d.external);
      if (d.goto) location.hash = `#/anime/${d.goto}`;
      if (d.service) {
        const s = CONFIG.SERVICES[d.service];
        const q = s.lang === 'en' ? anime.english || anime.name : titleOf(anime);
        window.api.openWeb(s.search.replace('{q}', encodeURIComponent(q)), s.name);
      }

      switch (d.act) {
        case 'back': history.back(); break;
        case 'extras': showExtras = !showExtras; draw(); break;
        case 'collections': openCollectionsModal(); break;
        case 'play': openPlayer(store.nextEpisode(id)); break;
        case 'online': location.hash = `#/watch/${id}`; break;
        case 'edit': location.hash = `#/add/${id}`; break;
        case 'delete':
          if (await confirmDialog('Удалить эту запись вместе с отметками серий?', { danger: true, ok: 'Удалить' })) {
            store.removeEntry(id);
            location.hash = '#/library';
          }
          break;
        case 'plus': store.setEpisodeWatched(anime, (store.getEntry(id)?.watched.length || 0) + 1); break;
        case 'open-folder': window.api.openPath(store.getEntry(id).folder); break;
        case 'rescan': await scanFolder(); draw(); toast(`Найдено файлов: ${files.length}`); break;
        case 'folder': {
          const folder = await window.api.pickFolder();
          if (!folder) return;
          store.setFolder(anime, folder);
          if (!store.getEntry(id).status) store.setStatus(anime, 'watching');
          await scanFolder();
          draw();
          toast(`Найдено файлов: ${files.length}`, 'ok');
          break;
        }
      }
    });

    // двойной клик по серии — открыть в плеере
    page.addEventListener('dblclick', (e) => {
      const t = e.target.closest('[data-ep]');
      if (!t || !fileByEp.has(Number(t.dataset.ep))) return;
      page.querySelectorAll('[data-ep]').forEach((b) => clearTimeout(b._clickTimer));
      openPlayer(Number(t.dataset.ep));
    });

    // правый клик — отметить все серии до этой включительно
    page.addEventListener('contextmenu', (e) => {
      const t = e.target.closest('[data-ep]');
      if (!t) return;
      e.preventDefault();
      store.markUpTo(anime, Number(t.dataset.ep));
      toast(`Отмечено серий: ${t.dataset.ep}`);
    });
  }

  return () => {
    disposed = true;
    unsubscribe();
    // отменяем отложенные переходы по клику на серию
    root.querySelectorAll('[data-ep]').forEach((b) => clearTimeout(b._clickTimer));
  };
}

// Запись библиотеки → объект «как с Shikimori», чтобы страница аниме
// и онлайн-плеер работали без запросов к Shikimori.
export function animeFromEntry(e) {
  return {
    id: e.id,
    russian: e.title,
    name: e.name || '',
    kind: e.kind || 'tv',
    status: e.animeStatus || 'released',
    episodes: e.episodes || 0,
    episodesAired: e.episodesAired || e.episodes || 0,
    duration: e.duration || 0,
    nextEpisodeAt: e.nextEpisodeAt || null,
    airedOn: { year: e.year || null },
    poster: { mainUrl: e.poster || '' },
    description: e.description || '',
    genres: [],
    studios: [],
    related: [],
    videos: [],
    externalLinks: [],
  };
}
