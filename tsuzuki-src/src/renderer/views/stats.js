// ============================================================
//  СТАТИСТИКА ПРОСМОТРА.
//  Считаем по истории и отметкам в библиотеке.
// ============================================================

// ------------------------------------------------------------
//  ИЗМЕНЕНО В 1.1 (Claude, 02.11.2026):
//  - «Твои оценки и Shikimori» и «Где ты не согласен с большинством»
// ------------------------------------------------------------

import { CONFIG } from '../config.js';
import * as store from '../store.js';
import { esc } from '../utils.js';
// ДОБАВЛЕНО В 1.4: достижения
import { ACHIEVEMENTS, progressOf, earned } from '../achievements.js';

// Блок «Достижения» для страницы статистики
function achievementsHtml() {
  const state = store.getState();
  const got = earned(state);
  const done = Object.keys(got).length;
  const cards = ACHIEVEMENTS.map((a) => {
    const p = progressOf(a, state);
    const percent = Math.round((p.current / p.target) * 100);
    return `
      <div class="ach-card ${p.done ? 'done' : ''}">
        <div class="ach-icon">${a.icon}</div>
        <div class="ach-title">${esc(a.title)}</div>
        <div class="ach-desc">${esc(a.desc)}</div>
        ${p.done
          ? `<div class="ach-date">Получено ${new Date(p.date).toLocaleDateString('ru-RU')}</div>`
          : `<div class="ach-progress"><div style="width:${percent}%"></div></div>
             <div class="ach-date" style="color:var(--text-3)">${p.current} / ${p.target}</div>`}
      </div>`;
  }).join('');
  return `
    <div class="section">
      <h2>Достижения <span class="muted">${done} из ${ACHIEVEMENTS.length}</span></h2>
      <div class="ach-grid">${cards}</div>
    </div>`;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const pad = (n) => String(n).padStart(2, '0');

const keyOf = (value) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const startOfDay = (value) => {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
};

export function render(root) {
  root.scrollTop = 0;

  function draw() {
    const entries = store.listEntries('all');
    const history = store.getState().history || [];
    const now = new Date();

    // Серии по дням. ИЗМЕНЕНО В 1.5: берём статистику по дням (она не ограничена
    // 200 записями, как история); история — для дней до версии 1.5.
    const byDay = new Map();
    for (const h of history) {
      const key = keyOf(h.at);
      byDay.set(key, (byDay.get(key) || 0) + 1);
    }
    for (const [key, d] of Object.entries(store.getStatsByDay())) {
      if (d && d.episodes > (byDay.get(key) || 0)) byDay.set(key, d.episodes);
    }

    const last14 = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = keyOf(d);
      last14.push({ key, date: d, count: byDay.get(key) || 0 });
    }
    const maxDay = Math.max(1, ...last14.map((x) => x.count));

    const totalWatched = entries.reduce((sum, e) => sum + (e.watched?.length || 0), 0);
    const sinceDays = (n) => {
      let sum = 0;
      for (const [key, count] of byDay) if (now - new Date(key + 'T23:59:59') < n * DAY_MS) sum += count;
      return sum;
    };
    const week = sinceDays(7);
    const month = sinceDays(30);

    // Примерное время: длительность серии из записи или 24 минуты
    let minutes = 0;
    for (const e of entries) {
      const per = Number(e.duration) || 24;
      minutes += (e.watched?.length || 0) * per;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;

    // Дни подряд: сегодня или вчера, затем назад без пропусков
    let streak = 0;
    const cursor = startOfDay(now);
    if (!byDay.has(keyOf(cursor))) cursor.setDate(cursor.getDate() - 1);
    while (byDay.has(keyOf(cursor))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }

    // Чаще всего смотрел за последние 30 дней
    const counts = new Map();
    for (const h of history) {
      if (now - new Date(h.at) > 30 * DAY_MS) continue;
      counts.set(String(h.id), (counts.get(String(h.id)) || 0) + 1);
    }
    const top = [...counts.entries()]
      .map(([id, count]) => {
        const entry = store.getEntry(id);
        const fromHistory = history.find((h) => String(h.id) === id);
        return { id, count, title: entry?.title || fromHistory?.title || 'Без названия' };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    const statusCounts = store.countByStatus();

    // Сравнение твоих оценок с оценками Shikimori (shikiScore дозаполняется при запуске)
    const rated = entries.filter((e) => e.score > 0 && e.shikiScore > 0);
    const myAvg = rated.length ? rated.reduce((s, e) => s + e.score, 0) / rated.length : 0;
    const theirAvg = rated.length ? rated.reduce((s, e) => s + e.shikiScore, 0) / rated.length : 0;
    const diff = myAvg - theirAvg;
    const disagreements = [...rated]
      .map((e) => ({ e, d: e.score - e.shikiScore }))
      .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
      .slice(0, 6);
    const myScores = Array.from({ length: 10 }, (_, i) => entries.filter((e) => e.score === 10 - i).length);
    const maxMine = Math.max(1, ...myScores);

    root.innerHTML = `
      <div class="page">
        <div class="block-head"><h1 class="page-title">Статистика</h1>
          <a class="btn btn-accent" href="#/recap">✦ Итоги ${new Date().getFullYear()} года</a></div>

        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-value">${totalWatched}</div>
            <div class="stat-label">серий отмечено</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${week}</div>
            <div class="stat-label">за 7 дней</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${month}</div>
            <div class="stat-label">за 30 дней</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${streak}</div>
            <div class="stat-label">${streak === 1 ? 'день подряд' : 'дней подряд'}</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${hours}<span class="stat-unit"> ч</span> ${mins}<span class="stat-unit"> мин</span></div>
            <div class="stat-label">примерно времени</div>
          </div>
        </div>

        <h2 class="section-title">Серии за 14 дней</h2>
        <div class="chart">
          ${last14.map((x) => `
            <div class="chart-col" title="${x.count} ${x.count === 1 ? 'серия' : 'серий'} · ${esc(x.date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }))}">
              <div class="chart-count">${x.count || ''}</div>
              <div class="chart-bar-wrap">
                <div class="chart-bar" style="height:${x.count ? Math.max(6, (x.count / maxDay) * 100) : 0}%"></div>
              </div>
              <div class="chart-day">${x.date.toLocaleDateString('ru-RU', { day: 'numeric' })}</div>
            </div>`).join('')}
        </div>

        <div class="stats-cols">
          <div class="box">
            <h3>Чаще всего за месяц</h3>
            ${top.length
              ? `<div class="top-list">
                  ${top.map((t, i) => `
                    <div class="top-row" data-open="${esc(t.id)}">
                      <span class="top-num">${i + 1}</span>
                      <span class="top-title">${esc(t.title)}</span>
                      <span class="top-count">${t.count} сер.</span>
                    </div>`).join('')}
                </div>`
              : '<p>Пока нет отметок за последний месяц.</p>'}
          </div>

          <div class="box">
            <h3>Твои оценки и Shikimori</h3>
            ${rated.length
              ? `<p>Оценено тобой: ${rated.length}. Твоя средняя <b>${myAvg.toFixed(2)}</b>, у Shikimori по этим же тайтлам <b>${theirAvg.toFixed(2)}</b> —
                 ${Math.abs(diff) < 0.15 ? 'оцениваешь как большинство.' : diff > 0 ? `ты щедрее на ${diff.toFixed(2)}.` : `ты строже на ${Math.abs(diff).toFixed(2)}.`}</p>
                 <div class="score-bars">
                   ${myScores.map((c, i) => `
                     <div class="score-row">
                       <span class="score-n">${10 - i}</span>
                       <div class="score-track"><div class="score-fill" style="width:${(c / maxMine) * 100}%;background:var(--accent)"></div></div>
                       <span class="score-c">${c}</span>
                     </div>`).join('')}
                 </div>`
              : '<p>Поставь оценки тайтлам из списка — здесь появится сравнение с оценками зрителей Shikimori.</p>'}
          </div>

          <div class="box">
            <h3>Где ты не согласен с большинством</h3>
            ${disagreements.length
              ? `<div class="top-list">
                  ${disagreements.map(({ e, d }) => `
                    <div class="top-row" data-open="${esc(e.id)}">
                      <span class="top-title">${esc(e.title)}</span>
                      <span class="top-count">ты ${e.score} · все ${e.shikiScore.toFixed(1)}
                        <b style="color:${d > 0 ? 'var(--good)' : 'var(--bad)'}">${d > 0 ? '+' : ''}${d.toFixed(1)}</b></span>
                    </div>`).join('')}
                </div>`
              : '<p>Пока не с чем сравнивать.</p>'}
          </div>

          <div class="box">
            <h3>По статусам</h3>
            <div class="status-list">
              ${CONFIG.STATUSES.map((s) => `
                <div class="status-row">
                  <span class="dot" style="background:${s.color}"></span>
                  <span>${esc(s.label)}</span>
                  <b>${statusCounts[s.id] || 0}</b>
                </div>`).join('')}
            </div>
            <p class="faint" style="margin:12px 0 0">Всего тайтлов: ${entries.length}</p>
          </div>
        </div>

        ${achievementsHtml()}
      </div>`;

    root.querySelector('.page').addEventListener('click', (e) => {
      const row = e.target.closest('[data-open]');
      if (row) location.hash = `#/anime/${row.dataset.open}`;
    });
  }

  draw();
  return store.onChange(draw);
}
