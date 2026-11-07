// ============================================================
//  АВТОРАСКЛАДКА ПАПКИ С АНИМЕ (ДОБАВЛЕНО В 1.5)
//  Выбираешь одну общую папку, приложение смотрит подпапки,
//  по названию находит тайтл на Shikimori и предлагает связать.
//  Ничего не записывается без подтверждения.
//
//  Как «чистится» имя папки — функция cleanFolderName ниже.
//  Если что-то находится плохо — добавь свой шаблон в NOISE.
// ============================================================

import * as store from '../store.js';
import { searchForMatch } from '../api/shikimori.js';
import { esc, sleep, toast, titleOf, kindLabel, plural } from '../utils.js';

// Мусор в названиях папок: группы, качество, кодеки, источники
const NOISE = [
  /\[[^\]]*\]/g,                 // [SubsPlease], [1080p]
  /\((?:19|20)\d{2}\)/g,         // (2023)
  /\([^)]*(?:p|bit|rip|dub|sub|bd|web)[^)]*\)/gi, // (1080p BDRip)
  /\b(?:\d{3,4}p|[xh]\.?26[45]|hevc|avc|aac|flac|opus|10bit|8bit|bd|bdrip|bdremux|webrip|web-dl|webdl|dvdrip|hdtv|remux|multi|dual|rus|eng|jap|sub|subs|dub)\b/gi,
  /\b(?:tv|complete|batch|uncensored)\b/gi,
];

// «Season 2», «S2», «2nd Season», «Сезон 2», «2 сезон» → номер сезона
const SEASON_RE = [
  /\bseason\s*(\d{1,2})\b/i,
  /\bs(\d{1,2})\b/i,
  /\b(\d{1,2})(?:st|nd|rd|th)\s*season\b/i,
  /сезон\s*(\d{1,2})/i,
  /(\d{1,2})\s*сезон/i,
];

export function cleanFolderName(name) {
  let s = String(name);
  let season = 1;
  for (const re of SEASON_RE) {
    const m = s.match(re);
    if (m) { season = Number(m[1]) || 1; s = s.replace(re, ' '); break; }
  }
  for (const re of NOISE) s = s.replace(re, ' ');
  s = s.replace(/[._]+/g, ' ').replace(/\s[-–—]\s*$/, ' ').replace(/\s+/g, ' ').trim();
  return { query: s, season };
}

// Похожесть строк: доля общих «слов» (0..1)
const norm = (t) => String(t || '').toLowerCase().replaceAll('ё', 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function similarity(a, b) {
  const A = new Set(norm(a).split(' ').filter(Boolean));
  const B = new Set(norm(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return common / Math.max(A.size, B.size);
}

// Балл кандидата: совпадение названия + номер сезона + число файлов ≈ серий
// Из названия кандидата убираем номер сезона, чтобы «Ванпанчмен 2» и
// «Ванпанчмен» одинаково совпадали с запросом «Ванпанчмен»; сезон считаем отдельно
const stripSeason = (t) => String(t || '')
  .replace(/\b(?:\d{1,2}(?:st|nd|rd|th)\s*season|season\s*\d{1,2}|сезон\s*\d{1,2}|\d{1,2}\s*сезон|ii|iii|iv)\b/gi, ' ')
  .replace(/(^|\s)\d{1,2}(?=\s|$)/g, ' ');

function scoreCandidate(anime, { query, season }, videos) {
  const names = [anime.russian, anime.name, anime.english].filter(Boolean);
  let s = Math.max(0, ...names.map((n) => similarity(query, stripSeason(n)))) * 70;
  const all = names.join(' ').toLowerCase();
  const hasNumber = new RegExp(`(?:^|\\s|season\\s*|сезон\\s*)${season}(?:\\s|$|nd|rd|th|:)`, 'i').test(all);
  if (season > 1) s += hasNumber ? 25 : -25;
  else if (/\b(?:2|3|4|5|ii|iii)\b|season|сезон/i.test(all)) s -= 8; // первый сезон: штраф продолжениям
  if (anime.episodes && videos) {
    const diff = Math.abs(anime.episodes - videos);
    s += diff === 0 ? 15 : diff <= 2 ? 8 : diff > anime.episodes ? -10 : 0;
  }
  if (anime.kind === 'tv') s += 3;
  return Math.max(0, Math.min(100, Math.round(s)));
}

let running = null; // текущий поиск (чтобы остановить при уходе со страницы)

export async function render(root) {
  root.scrollTop = 0;
  const prefs = store.getPrefs();
  let rootFolder = prefs.animeRoot || '';
  let rows = [];   // { folder, clean, candidates: [{anime, score}], pick, include }
  let stage = 'start';
  let progress = { done: 0, total: 0 };

  function draw() {
    const assigned = rows.filter((r) => r.include && r.pick >= 0).length;
    root.innerHTML = `
      <div class="page autoscan-page">
        <div class="block-head">
          <h1 class="page-title">Папка с аниме</h1>
          <a class="btn btn-ghost" href="#/settings">← Настройки</a>
        </div>
        <div class="note">Выбери общую папку, где каждое аниме лежит в своей подпапке. Приложение найдёт тайтлы на Shikimori
          и предложит связать. Названия папок и сами файлы никуда не отправляются — на Shikimori уходит только очищенное название для поиска.</div>
        <div class="row" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:18px">
          <button class="btn" data-act="pick">${rootFolder ? 'Сменить папку' : 'Выбрать папку'}</button>
          ${rootFolder ? `<span class="path" style="margin:0">${esc(rootFolder)}</span>
            <button class="btn btn-accent" data-act="scan" ${stage === 'scanning' ? 'disabled' : ''}>Найти сериалы</button>` : ''}
        </div>
        ${stage === 'scanning' ? `
          <div class="box"><h3>Ищу на Shikimori… ${progress.done} из ${progress.total}</h3>
            <div class="ach-progress" style="margin-top:10px"><div style="width:${progress.total ? (progress.done / progress.total) * 100 : 0}%"></div></div>
            <p style="margin-top:10px">Shikimori ограничивает частоту запросов, поэтому это занимает около секунды на папку.</p></div>` : ''}
        ${stage === 'empty' ? '<div class="empty"><div class="empty-big">∅</div>Новых подпапок с видео не найдено.<br><span class="faint">Папки, уже связанные с тайтлами, пропускаются.</span></div>' : ''}
        ${stage === 'review' ? `
          <div class="autoscan-table">
            <div class="autoscan-head"><span></span><span>Папка</span><span>Найденный тайтл</span><span>Уверенность</span></div>
            ${rows.map((r, i) => {
              const best = r.candidates[r.pick];
              const sc = best ? best.score : 0;
              return `
                <div class="autoscan-row ${r.include && r.pick >= 0 ? '' : 'off'}">
                  <input type="checkbox" data-include="${i}" ${r.include && r.pick >= 0 ? 'checked' : ''} ${r.candidates.length ? '' : 'disabled'}>
                  <div><div class="autoscan-folder">${esc(r.folder.name)}</div>
                    <div class="faint">${r.folder.videos} ${plural(r.folder.videos, ['видеофайл', 'видеофайла', 'видеофайлов'])}${r.clean.season > 1 ? ` · сезон ${r.clean.season}` : ''}</div></div>
                  <select class="select" data-pick="${i}">
                    ${r.candidates.length ? '' : '<option value="-1">Ничего не найдено</option>'}
                    ${r.candidates.map((c, j) => `<option value="${j}" ${j === r.pick ? 'selected' : ''}>${esc(titleOf(c.anime))} — ${esc(kindLabel(c.anime.kind))}${c.anime.airedOn?.year ? ', ' + c.anime.airedOn.year : ''}${c.anime.episodes ? ', ' + c.anime.episodes + ' эп.' : ''}</option>`).join('')}
                    ${r.candidates.length ? '<option value="-1">— пропустить —</option>' : ''}
                  </select>
                  <span class="autoscan-score ${sc >= 70 ? 'high' : sc >= 45 ? 'mid' : 'low'}">${best ? sc + '%' : '—'}</span>
                </div>`;
            }).join('')}
          </div>
          <div class="row" style="display:flex;gap:10px;margin-top:16px;align-items:center">
            <button class="btn btn-accent" data-act="apply" ${assigned ? '' : 'disabled'}>Связать ${assigned} ${plural(assigned, ['папку', 'папки', 'папок'])}</button>
            <span class="faint">Тайтлы без статуса попадут в «В планах». Уверенность ниже 45% по умолчанию не отмечена — проверь вручную.</span>
          </div>` : ''}
      </div>`;
  }

  async function scan() {
    const myRun = {};
    running = myRun;
    stage = 'scanning';
    const assignedFolders = new Set(store.listEntries('all').map((e) => e.folder).filter(Boolean));
    const folders = (await window.api.listSubfolders(rootFolder)).filter((f) => !assignedFolders.has(f.path));
    if (!folders.length) { stage = 'empty'; draw(); return; }
    progress = { done: 0, total: folders.length };
    rows = [];
    draw();
    for (const folder of folders) {
      if (running !== myRun) return; // ушли со страницы
      const clean = cleanFolderName(folder.name);
      let candidates = [];
      try {
        let list = await searchForMatch(clean.query);
        // для 2-го и следующих сезонов ищем ещё и «Название 2» — продолжения
        // часто не попадают в первые результаты по общему названию
        if (clean.season > 1) {
          await sleep(350);
          const extra = await searchForMatch(`${clean.query} ${clean.season}`);
          const seen = new Set(list.map((a) => a.id));
          list = list.concat(extra.filter((a) => !seen.has(a.id)));
        }
        candidates = list
          .map((anime) => ({ anime, score: scoreCandidate(anime, clean, folder.videos) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);
      } catch { /* сеть — оставим пустым */ }
      const pick = candidates.length ? 0 : -1;
      rows.push({ folder, clean, candidates, pick, include: pick >= 0 && candidates[0].score >= 45 });
      progress.done++;
      draw();
      await sleep(450); // лимит Shikimori: ~2 запроса в секунду с запасом
    }
    if (running !== myRun) return;
    stage = 'review';
    draw();
  }

  function apply() {
    let n = 0;
    for (const r of rows) {
      if (!r.include || r.pick < 0) continue;
      const anime = r.candidates[r.pick].anime;
      store.ensureEntry(anime);
      store.setFolder(anime, r.folder.path);
      if (!store.getEntry(anime.id).status) store.setStatus(anime, 'planned');
      n++;
    }
    toast(`Связано папок: ${n}`, 'ok');
    stage = 'start';
    rows = [];
    draw();
  }

  draw();
  const page = () => root.querySelector('.autoscan-page');
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);

  async function onClick(e) {
    if (!page()?.contains(e.target)) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'pick') {
      const folder = await window.api.pickFolder();
      if (!folder) return;
      rootFolder = folder;
      store.setPref('animeRoot', folder);
      stage = 'start';
      draw();
    }
    if (act === 'scan') scan();
    if (act === 'apply') apply();
  }
  function onChange(e) {
    if (!page()?.contains(e.target)) return;
    const pick = e.target.closest('[data-pick]');
    if (pick) {
      const r = rows[Number(pick.dataset.pick)];
      r.pick = Number(pick.value);
      r.include = r.pick >= 0;
      draw();
    }
    const inc = e.target.closest('[data-include]');
    if (inc) { rows[Number(inc.dataset.include)].include = inc.checked; draw(); }
  }

  return () => {
    running = null;
    root.removeEventListener('click', onClick);
    root.removeEventListener('change', onChange);
  };
}
