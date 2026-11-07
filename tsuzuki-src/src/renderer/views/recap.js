// ============================================================
//  ИТОГИ ГОДА (ДОБАВЛЕНО В 1.5): «Мой 2026 в аниме».
//  Считается по статистике по дням (store.getStatsByDay) и библиотеке.
//  Картинка рисуется на <canvas> и сохраняется в PNG:
//  1080×1920 (сторис) и 1080×1080 (квадрат для постов).
//  Цвета и надписи картинки — в функциях drawStory / drawSquare ниже.
// ============================================================

import * as store from '../store.js';
import { getAnimesByIds, getGenres } from '../api/shikimori.js';
import { esc, plural, toast } from '../utils.js';

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

// ---------- Подсчёт ----------
export function computeRecap(year, genreNames = new Map()) {
  const byDay = store.getStatsByDay();
  const days = Object.entries(byDay)
    .filter(([k, v]) => k.startsWith(year + '-') && v && v.episodes > 0)
    .sort(([a], [b]) => a.localeCompare(b));

  const ids = new Map(); // id → в скольких днях смотрел
  let episodes = 0, minutes = 0;
  const perMonth = Array(12).fill(0);
  let busiest = null;
  for (const [key, d] of days) {
    episodes += d.episodes;
    minutes += d.minutes || 0;
    perMonth[Number(key.slice(5, 7)) - 1] += d.episodes;
    if (!busiest || d.episodes > busiest.episodes) busiest = { key, episodes: d.episodes };
    for (const id of d.ids || []) ids.set(String(id), (ids.get(String(id)) || 0) + 1);
  }

  // Самая длинная серия дней подряд
  let streak = 0, run = 0, prev = null;
  for (const [key] of days) {
    const t = new Date(key + 'T00:00:00').getTime();
    run = prev !== null && t - prev <= 86400000 * 1.5 ? run + 1 : 1;
    streak = Math.max(streak, run);
    prev = t;
  }

  const all = store.listEntries('all');
  const completed = all.filter((e) => e.status === 'completed' && String(e.completedAt || e.updatedAt || '').startsWith(String(year)));
  for (const e of completed) if (!ids.has(String(e.id))) ids.set(String(e.id), 1);

  const titles = [...ids.keys()].map((id) => store.getEntry(id)).filter(Boolean);

  // Топ года: сначала по твоей оценке, потом по тому, сколько дней смотрел
  const top = [...titles]
    .sort((a, b) => (b.score || 0) - (a.score || 0) || (ids.get(String(b.id)) || 0) - (ids.get(String(a.id)) || 0))
    .slice(0, 5);

  // Любимые жанры — по числу дней просмотра
  const genreCount = new Map();
  for (const e of titles) {
    const w = ids.get(String(e.id)) || 1;
    for (const g of e.genreIds || []) genreCount.set(g, (genreCount.get(g) || 0) + w);
  }
  const genres = [...genreCount.entries()]
    .map(([id, n]) => ({ name: genreNames.get(id) || '', n }))
    .filter((g) => g.name)
    .sort((a, b) => b.n - a.n)
    .slice(0, 3);

  // Строже или мягче Shikimori
  const rated = titles.filter((e) => e.score > 0 && e.shikiScore > 0);
  const diff = rated.length >= 3 ? rated.reduce((s, e) => s + (e.score - e.shikiScore), 0) / rated.length : null;

  const bestMonthIdx = perMonth.some((n) => n > 0) ? perMonth.indexOf(Math.max(...perMonth)) : -1;

  return {
    year,
    episodes,
    hours: Math.round(minutes / 60),
    titles: titles.length,
    completed: completed.length,
    activeDays: days.length,
    busiest: busiest && { date: formatDay(busiest.key), episodes: busiest.episodes },
    bestMonth: bestMonthIdx >= 0 ? { name: MONTHS[bestMonthIdx], episodes: perMonth[bestMonthIdx] } : null,
    perMonth,
    streak,
    top,
    genres,
    diff,
    missingGenres: titles.filter((e) => !e.genreIds && e.id > 0).map((e) => e.id),
  };
}

function formatDay(key) {
  const [, m, d] = key.split('-').map(Number);
  return `${d} ${MONTHS_GEN[m - 1]}`;
}

function yearsWithData() {
  const set = new Set(Object.keys(store.getStatsByDay()).map((k) => Number(k.slice(0, 4))));
  set.add(new Date().getFullYear());
  return [...set].filter(Boolean).sort((a, b) => b - a);
}

// ---------- Рисование ----------
const FONT = '"Segoe UI Variable Display", "Segoe UI", Inter, system-ui, sans-serif';

function accentColor() {
  return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff5d48';
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Текст в несколько строк с обрезкой
function wrapText(ctx, text, x, y, maxW, lineH, maxLines) {
  const words = String(text).split(/\s+/);
  let line = '', lines = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? line + ' ' + words[i] : words[i];
    if (ctx.measureText(test).width > maxW && line) {
      lines++;
      if (lines === maxLines) {
        let cut = line;
        while (ctx.measureText(cut + '…').width > maxW && cut.length) cut = cut.slice(0, -1);
        ctx.fillText(cut + '…', x, y);
        return;
      }
      ctx.fillText(line, x, y);
      y += lineH;
      line = words[i];
    } else line = test;
  }
  if (line) ctx.fillText(line, x, y);
}

function background(ctx, W, H, accent) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0f1115');
  g.addColorStop(1, '#171320');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // мягкое свечение акцентным цветом
  const glow = ctx.createRadialGradient(W * 0.85, H * 0.08, 0, W * 0.85, H * 0.08, W * 0.9);
  glow.addColorStop(0, accent + '55');
  glow.addColorStop(1, accent + '00');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
}

function logo(ctx, x, y, size, accent) {
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(x, y - size); ctx.lineTo(x + size, y); ctx.lineTo(x, y + size); ctx.lineTo(x - size, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#0f1115';
  const s = size * 0.4;
  ctx.beginPath();
  ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y);
  ctx.closePath();
  ctx.fill();
}

function statBlock(ctx, x, y, w, h, value, label, accent) {
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  roundRect(ctx, x, y, w, h, 28);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${Math.round(h * 0.42)}px ${FONT}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(String(value), x + 32, y + h * 0.58);
  ctx.fillStyle = accent;
  ctx.font = `600 ${Math.round(h * 0.17)}px ${FONT}`;
  ctx.fillText(label, x + 32, y + h * 0.84);
}

function posterRow(ctx, items, x, y, w, posterW, gap, accent, withTitles) {
  const posterH = Math.round(posterW * 1.5);
  items.forEach((it, i) => {
    const px = x + i * (posterW + gap);
    ctx.save();
    roundRect(ctx, px, y, posterW, posterH, 18);
    ctx.clip();
    if (it.img) {
      // заполняем, сохраняя пропорции
      const r = Math.max(posterW / it.img.width, posterH / it.img.height);
      const iw = it.img.width * r, ih = it.img.height * r;
      ctx.drawImage(it.img, px + (posterW - iw) / 2, y + (posterH - ih) / 2, iw, ih);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(px, y, posterW, posterH);
    }
    ctx.restore();
    // номер места
    ctx.fillStyle = accent;
    roundRect(ctx, px + 10, y + 10, 46, 40, 10);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `700 26px ${FONT}`;
    ctx.fillText(String(i + 1), px + 25, y + 39);
    if (it.entry.score) {
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      roundRect(ctx, px + posterW - 76, y + 10, 66, 40, 10);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `600 22px ${FONT}`;
      ctx.fillText('★ ' + it.entry.score, px + posterW - 68, y + 38);
    }
    if (withTitles) {
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.font = `600 22px ${FONT}`;
      wrapText(ctx, it.entry.title, px, y + posterH + 34, posterW, 28, 2);
    }
  });
  return posterH;
}

export function drawStory(canvas, r, posters) {
  const W = 1080, H = 1920;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const accent = accentColor();
  background(ctx, W, H, accent);

  logo(ctx, 96, 120, 26, accent);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = `700 34px ${FONT}`;
  ctx.fillText('TSUZUKI', 140, 132);

  ctx.fillStyle = '#fff';
  ctx.font = `800 104px ${FONT}`;
  ctx.fillText(`Мой ${r.year}`, 72, 270);
  ctx.fillStyle = accent;
  ctx.fillText('в аниме', 72, 375);

  const bw = (W - 72 * 2 - 24) / 2, bh = 170;
  statBlock(ctx, 72, 430, bw, bh, r.episodes, plural(r.episodes, ['серия', 'серии', 'серий']), accent);
  statBlock(ctx, 72 + bw + 24, 430, bw, bh, r.hours, plural(r.hours, ['час', 'часа', 'часов']), accent);
  statBlock(ctx, 72, 430 + bh + 24, bw, bh, r.titles, plural(r.titles, ['тайтл', 'тайтла', 'тайтлов']), accent);
  statBlock(ctx, 72 + bw + 24, 430 + bh + 24, bw, bh, r.completed, 'досмотрено', accent);

  let y = 885;
  if (posters.length) {
    ctx.fillStyle = '#fff';
    ctx.font = `700 46px ${FONT}`;
    ctx.fillText('Топ года', 72, y);
    const gap = 18, pw = Math.floor((W - 72 * 2 - gap * 4) / 5);
    const ph = posterRow(ctx, posters, 72, y + 34, W - 144, pw, gap, accent, true);
    y += 34 + ph + 160;
  }

  if (r.genres.length) {
    ctx.fillStyle = '#fff';
    ctx.font = `700 46px ${FONT}`;
    ctx.fillText('Любимые жанры', 72, y);
    const max = r.genres[0].n;
    r.genres.forEach((g, i) => {
      const gy = y + 36 + i * 66;
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      roundRect(ctx, 72, gy, W - 144, 52, 16); ctx.fill();
      ctx.fillStyle = accent + (i === 0 ? '' : i === 1 ? 'cc' : '99');
      roundRect(ctx, 72, gy, Math.max(120, (W - 144) * (g.n / max)), 52, 16); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `600 30px ${FONT}`;
      ctx.fillText(g.name, 96, gy + 36);
    });
    y += 36 + r.genres.length * 66 + 70;
  }

  const facts = [];
  if (r.busiest) facts.push(`Самый «запойный» день — ${r.busiest.date}: ${r.busiest.episodes} ${plural(r.busiest.episodes, ['серия', 'серии', 'серий'])}`);
  if (r.streak > 1) facts.push(`${r.streak} ${plural(r.streak, ['день', 'дня', 'дней'])} подряд без перерыва`);
  if (r.bestMonth) facts.push(`Лучший месяц — ${r.bestMonth.name}`);
  if (r.diff !== null) facts.push(Math.abs(r.diff) < 0.15 ? 'Оцениваешь как большинство на Shikimori' : r.diff > 0 ? `Ты щедрее Shikimori на ${r.diff.toFixed(1)}` : `Ты строже Shikimori на ${Math.abs(r.diff).toFixed(1)}`);
  ctx.font = `500 32px ${FONT}`;
  for (const f of facts.slice(0, Math.max(0, Math.floor((H - 140 - y) / 54)))) {
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(84, y - 11, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    wrapText(ctx, f, 108, y, W - 180, 40, 1);
    y += 54;
  }

  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = `500 28px ${FONT}`;
  ctx.fillText('Сделано в Tsuzuki · данные о тайтлах: Shikimori', 72, H - 72);
}

export function drawSquare(canvas, r, posters) {
  const W = 1080, H = 1080;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const accent = accentColor();
  background(ctx, W, H, accent);

  logo(ctx, 90, 100, 22, accent);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = `700 30px ${FONT}`;
  ctx.fillText('TSUZUKI', 128, 111);

  ctx.fillStyle = '#fff';
  ctx.font = `800 84px ${FONT}`;
  ctx.fillText(`Мой ${r.year} `, 64, 230);
  const w = ctx.measureText(`Мой ${r.year} `).width;
  ctx.fillStyle = accent;
  ctx.fillText('в аниме', 64 + w, 230);

  const gap = 18, bw = (W - 64 * 2 - gap * 3) / 4, bh = 150;
  [[r.episodes, plural(r.episodes, ['серия', 'серии', 'серий'])], [r.hours, plural(r.hours, ['час', 'часа', 'часов'])],
   [r.titles, plural(r.titles, ['тайтл', 'тайтла', 'тайтлов'])], [r.completed, 'досмотрено']]
    .forEach(([v, l], i) => statBlock(ctx, 64 + i * (bw + gap), 290, bw, bh, v, l, accent));

  if (posters.length) {
    const pw = Math.floor((W - 64 * 2 - gap * 4) / 5);
    posterRow(ctx, posters, 64, 500, W - 128, pw, gap, accent, true);
  }

  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = `500 26px ${FONT}`;
  ctx.fillText('Сделано в Tsuzuki · данные о тайтлах: Shikimori', 64, H - 56);
}

async function loadPosters(top) {
  const out = [];
  for (const entry of top) {
    let img = null;
    if (entry.poster && window.api.imageDataUrl) {
      try {
        const url = await window.api.imageDataUrl(entry.poster);
        img = new Image();
        img.src = url;
        await img.decode();
      } catch { img = null; } // без постера — нарисуем серую плашку
    }
    out.push({ entry, img });
  }
  return out;
}

// ---------- Раздел ----------
export async function render(root, [yearParam]) {
  root.scrollTop = 0;
  store.migrateHistoryToStats();
  const years = yearsWithData();
  let year = Number(yearParam) || years[0];

  root.innerHTML = '<div class="page"><h1 class="page-title">Итоги года</h1><div class="spinner"></div></div>';

  // Названия жанров (id → «Драма»)
  const genreNames = new Map();
  try { (await getGenres()).forEach((g) => genreNames.set(String(g.id), g.russian)); } catch { /* без жанров */ }

  // У старых записей может не быть жанров — дозапросим один раз
  const first = computeRecap(year, genreNames);
  if (first.missingGenres.length) {
    try { store.applyGenres(await getAnimesByIds(first.missingGenres)); } catch { /* ничего страшного */ }
  }
  const r = computeRecap(year, genreNames);

  if (!root.querySelector('.page')) return; // успели уйти со страницы
  const empty = !r.episodes && !r.completed;
  const maxMonth = Math.max(1, ...r.perMonth);

  root.innerHTML = `
    <div class="page recap-page">
      <div class="block-head">
        <h1 class="page-title">Итоги ${year} года</h1>
        <select class="select" id="recap-year">
          ${years.map((y) => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`).join('')}
        </select>
      </div>
      ${empty ? `<div class="empty"><div class="empty-big">✦</div>За ${year} год пока нет отметок.<br>
        <span class="faint">Итоги считаются по сериям, отмеченным с версии 1.5 (и по последним 200 отметкам из истории).</span></div>` : `
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-value">${r.episodes}</div><div class="stat-label">${plural(r.episodes, ['серия', 'серии', 'серий'])}</div></div>
        <div class="stat-card"><div class="stat-value">${r.hours}</div><div class="stat-label">${plural(r.hours, ['час', 'часа', 'часов'])} просмотра</div></div>
        <div class="stat-card"><div class="stat-value">${r.titles}</div><div class="stat-label">${plural(r.titles, ['тайтл', 'тайтла', 'тайтлов'])}</div></div>
        <div class="stat-card"><div class="stat-value">${r.completed}</div><div class="stat-label">досмотрено</div></div>
        <div class="stat-card"><div class="stat-value">${r.activeDays}</div><div class="stat-label">${plural(r.activeDays, ['день', 'дня', 'дней'])} с аниме</div></div>
        <div class="stat-card"><div class="stat-value">${r.streak}</div><div class="stat-label">дней подряд — рекорд</div></div>
      </div>
      <div class="stats-cols">
        <div class="box">
          <h3>По месяцам</h3>
          <div class="recap-months">
            ${r.perMonth.map((n, i) => `<div class="recap-month" title="${MONTHS[i]}: ${n}">
              <div class="recap-bar" style="height:${Math.round((n / maxMonth) * 100)}%"></div>
              <span>${MONTHS[i].slice(0, 3)}</span></div>`).join('')}
          </div>
        </div>
        <div class="box">
          <h3>Факты</h3>
          <ul class="recap-facts">
            ${r.busiest ? `<li>Самый «запойный» день — <b>${esc(r.busiest.date)}</b>: ${r.busiest.episodes} ${plural(r.busiest.episodes, ['серия', 'серии', 'серий'])}</li>` : ''}
            ${r.bestMonth ? `<li>Лучший месяц — <b>${r.bestMonth.name}</b> (${r.bestMonth.episodes})</li>` : ''}
            ${r.genres.length ? `<li>Любимые жанры: <b>${r.genres.map((g) => esc(g.name)).join(', ')}</b></li>` : ''}
            ${r.diff !== null ? `<li>${Math.abs(r.diff) < 0.15 ? 'Оцениваешь как большинство на Shikimori' : r.diff > 0 ? `Ты щедрее Shikimori на <b>${r.diff.toFixed(1)}</b>` : `Ты строже Shikimori на <b>${Math.abs(r.diff).toFixed(1)}</b>`}</li>` : ''}
          </ul>
        </div>
      </div>
      <div class="section" style="padding-left:0">
        <h2>Картинка для соцсетей</h2>
        <div class="row" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
          <button class="btn btn-accent" data-fmt="story">Сохранить сторис (1080×1920)</button>
          <button class="btn" data-fmt="square">Сохранить квадрат (1080×1080)</button>
        </div>
        <canvas id="recap-canvas" class="recap-canvas"></canvas>
      </div>`}
    </div>`;

  const page = root.querySelector('.recap-page');
  page.querySelector('#recap-year').addEventListener('change', (e) => (location.hash = `#/recap/${e.target.value}`));
  if (empty) return;

  const canvas = page.querySelector('#recap-canvas');
  const posters = await loadPosters(r.top);
  drawStory(canvas, r, posters); // предпросмотр

  page.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-fmt]');
    if (!btn) return;
    const fmt = btn.dataset.fmt;
    (fmt === 'story' ? drawStory : drawSquare)(canvas, r, posters);
    const dataUrl = canvas.toDataURL('image/png');
    try {
      const saved = await window.api.saveImage(dataUrl, `tsuzuki-itogi-${year}-${fmt === 'story' ? 'storis' : 'kvadrat'}.png`);
      if (saved) toast('Картинка сохранена', 'ok');
    } catch (err) {
      toast('Не удалось сохранить: ' + err.message, 'error');
    }
  });
}
