// ============================================================
//  ЛЮДИ (ДОБАВЛЕНО В 1.4): профили пользователей Shikimori,
//  друзья, недавняя активность, оценки и любимое.
//
//  Маршруты:
//    #/people        — поиск людей + мои друзья (если вошёл)
//    #/people/<id>   — профиль человека
// ============================================================

import {
  getUser, getUserFriends, getUserHistory, getUserRates, getUserFavourites,
  findUsers, legacyAnime, userAvatar, USER_HOST,
} from '../api/shikimori.js';
import { getStatus as getSyncStatus } from '../api/shikimori-sync.js';
import { cardHtml } from '../components/card.js';
import { esc, toast, plural } from '../utils.js';

// Убираем HTML-теги и простые сущности из строк Shikimori (в common_info и описаниях
// истории приходит разметка — показываем чистый текст)
function plain(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const fmtDate = (iso) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
};

const ago = (iso) => {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = Date.now() - t;
  const m = Math.round(diff / 60000);
  if (m < 1) return 'только что';
  if (m < 60) return `${m} мин назад`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} ${plural(d, ['день', 'дня', 'дней'])} назад`;
  return fmtDate(iso);
};

export async function render(root, [userId]) {
  root.scrollTop = 0;
  root.innerHTML = '';
  const page = document.createElement('div');
  page.className = 'page';
  root.appendChild(page);
  try {
    if (userId) await renderProfile(page, Number(userId), root);
    else await renderList(page, root);
  } catch (err) {
    page.innerHTML = `<div class="empty"><div class="empty-big">⚠</div>Не удалось загрузить профиль<br><span class="faint">${esc(err.message)}</span></div>`;
  }
  return null;
}

// ---------- Список людей: поиск + друзья ----------
async function renderList(page) {
  page.innerHTML = `
    <h1 class="page-title">Люди <span class="muted" style="font-size:14px;font-weight:400">пользователи Shikimori</span></h1>
    <div class="box people-search">
      <h3>Найти человека</h3>
      <p>Введи ник на Shikimori — покажем профиль, его активность и оценки.</p>
      <div class="row">
        <input class="input" id="people-q" placeholder="Ник на Shikimori" style="flex:1" autocomplete="off">
        <button class="btn btn-accent" data-act="search">Найти</button>
      </div>
      <div class="people-results" id="people-results"></div>
    </div>
    <div class="box" id="friends-box">
      <h3>Мои друзья на Shikimori</h3>
      <p class="faint" id="friends-hint">Проверяем вход…</p>
      <div class="people-grid" id="friends-grid"></div>
    </div>`;

  const results = page.querySelector('#people-results');

  async function doSearch() {
    const q = page.querySelector('#people-q').value.trim();
    if (!q) return;
    results.innerHTML = `<div class="people-loading"><span class="spinner"></span></div>`;
    const list = await findUsers(q);
    if (!list.length) {
      results.innerHTML = `<p class="faint" style="margin:12px 0 0">Никого не нашли. Попробуй точный ник.</p>`;
      return;
    }
    results.innerHTML = `<div class="people-grid">${list.map((u) => chipHtml(u)).join('')}</div>`;
  }

  page.querySelector('[data-act="search"]').addEventListener('click', doSearch);
  page.querySelector('#people-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

  // Друзья — только если вошли в аккаунт
  const hint = page.querySelector('#friends-hint');
  const grid = page.querySelector('#friends-grid');
  const status = await getSyncStatus();
  if (!status || !status.loggedIn || !status.user) {
    hint.innerHTML = 'Чтобы увидеть своих друзей, войди в аккаунт Shikimori: «Настройки» → «Аккаунт Shikimori».';
    return;
  }
  hint.textContent = 'Загружаем…';
  const friends = await getUserFriends(status.user.id);
  if (!friends.length) {
    hint.textContent = 'Друзей пока нет — но ты можешь найти любого человека по нику.';
    return;
  }
  hint.innerHTML = `${friends.length} ${plural(friends.length, ['человек', 'человека', 'человек'])}`;
  grid.innerHTML = friends.map((u) => chipHtml(u)).join('');
}

function chipHtml(user) {
  const av = userAvatar(user, 'x80');
  const id = Number(user.id);
  return `
    <a class="user-chip" href="#/people/${id}" title="${esc(user.nickname || '')}">
      <span class="user-avatar">${av ? `<img src="${esc(av)}" loading="lazy" alt="">` : '👤'}</span>
      <span class="user-name">${esc(user.nickname || String(id))}</span>
    </a>`;
}

// ---------- Профиль человека ----------
async function renderProfile(page, id, root) {
  page.innerHTML = `<div class="empty"><span class="spinner"></span></div>`;
  const [user, history, rates, favourites] = await Promise.all([
    getUser(id),
    getUserHistory(id, 20),
    getUserRates(id, 30),
    getUserFavourites(id),
  ]);
  if (!user || !user.id) {
    page.innerHTML = `<a class="back" href="#/people">← Люди</a><div class="empty"><div class="empty-big">👤</div>Профиль закрыт или не найден</div>`;
    return;
  }

  const avatar = userAvatar(user, 'x160');
  const online = user.last_online_at ? `был(а) ${ago(user.last_online_at)}` : '';
  const favAnime = (favourites && Array.isArray(favourites.animes)) ? favourites.animes : [];
  const favCards = favAnime.slice(0, 12).map((a) => legacyAnime(a)).filter(Boolean);
  const rateCards = rates
    .map((r) => ({ anime: legacyAnime(r.anime || r.target || {}), rate: r }))
    .filter((x) => x.anime);

  const activityRows = history.slice(0, 12).map((h) => {
    const target = legacyAnime(h.target);
    return target ? `
      <a class="activity-row" href="#/anime/${target.id}">
        <img class="activity-poster" src="${esc(target.poster || '')}" loading="lazy" alt="">
        <span class="activity-text">
          <b>${esc(plain(h.description) || 'Активность')}</b>
          <span class="faint">${esc(target.title)} · ${esc(ago(h.created_at))}</span>
        </span>
      </a>` : '';
  }).join('');

  page.innerHTML = `
    <a class="back" href="#/people">← Люди</a>
    <div class="profile-head">
      <span class="avatar-lg">${avatar ? `<img src="${esc(avatar)}" alt="">` : '👤'}</span>
      <div class="profile-info">
        <h1 class="anime-title">${esc(user.nickname || String(user.id))}</h1>
        <div class="meta-row">
          ${online ? `<span>${esc(online)}</span>` : ''}
          ${user.common_info ? `<span class="faint">${esc(plain(user.common_info.join(' · ')))}</span>` : ''}
        </div>
        <div class="row">
          <button class="btn btn-sm" data-act="open-profile">Открыть профиль на сайте</button>
        </div>
      </div>
    </div>

    <div class="section">
      <h2>Недавняя активность <span class="muted">${history.length ? 'что смотрит и оценивает' : ''}</span></h2>
      ${activityRows || '<p class="faint">Активность скрыта или пуста.</p>'}
    </div>

    <div class="section">
      <h2>Оценки <span class="muted">${rateCards.length ? `последние ${rateCards.length}` : ''}</span></h2>
      ${rateCards.length
        ? `<div class="people-grid rates-grid">${rateCards.map(({ anime, rate }) => `
            <a class="rate-card" href="#/anime/${anime.id}">
              <span class="rate-poster"><img src="${esc(anime.poster || '')}" loading="lazy" alt=""></span>
              <span class="rate-title">${esc(anime.title)}</span>
              <span class="rate-score">★ ${Number(rate.score) || '—'}</span>
            </a>`).join('')}</div>`
        : '<p class="faint">Оценки скрыты или пользователь их не ставил.</p>'}
    </div>

    <div class="section">
      <h2>Любимое</h2>
      ${favCards.length ? `<div class="grid">${favCards.map((a) => cardHtml(a)).join('')}</div>`
        : '<p class="faint">Любимых тайтлов нет или они скрыты.</p>'}
    </div>`;

  page.querySelector('[data-act="open-profile"]')?.addEventListener('click', () => {
    window.api.openExternal(user.url || (USER_HOST + '/' + encodeURIComponent(user.nickname || '')));
  });
}
