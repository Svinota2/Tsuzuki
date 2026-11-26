// ============================================================
//  Все плееры сайта Tsuzuki (1.9.1)
//  Источники: AniLibria (без рекламы), Kodik (iframe), свои файлы,
//  своя ссылка (HLS/MP4). Управление как в приложении:
//  ±10 секунд, пропуск опенинга, качество, скорость.
// ============================================================
import {
  searchReleases, releaseTitle, releaseYear, releaseEpisodes,
  episodeLabel, episodeQualities, episodeOpening,
} from './anilibria.js';

const $ = (id) => document.getElementById(id);
let player = null;
let initialized = false;
let activeSource = 'anilibria';
let qualities = [];
let opening = null;
let currentRelease = null;
let episodes = [];

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function setStatus(text) {
  const node = $('player-status');
  if (node) node.textContent = text || '';
}

function ensurePlayer() {
  if (player) return player;
  if (!window.videojs) {
    setStatus('Плеер не загрузился: не найден video.js.');
    return null;
  }
  player = window.videojs('video', { controls: true, autoplay: true, fluid: true, responsive: true, preload: 'metadata' });
  // video.js добавляет .video-dimensions с размером из метаданных — принудительно растягиваем на ширину блока
  player.el().style.setProperty('width', '100%', 'important');
  player.el().style.setProperty('height', 'auto', 'important');
  player.on('loadedmetadata', () => {
    player.el().style.setProperty('width', '100%', 'important');
    player.el().style.setProperty('height', 'auto', 'important');
  });
  player.on('timeupdate', updateSkipButton);
  return player;
}

function playUrl(url, type) {
  const instance = ensurePlayer();
  if (!instance) return;
  showStage('video');
  instance.src({
    src: url,
    type: type || (/\.m3u8(\?|$)/i.test(url) ? 'application/x-mpegURL' : 'video/mp4'),
  });
  instance.play()?.catch(() => {});
}

function showStage(kind) {
  const video = $('video');
  if (player) player.el().style.display = kind === 'video' ? '' : 'none';
  else if (video) video.style.display = kind === 'video' ? '' : 'none';
  const kodikHost = $('kodik-host');
  if (kodikHost) kodikHost.hidden = kind !== 'kodik';
}

function clearKodik() {
  const host = $('kodik-host');
  if (host) host.replaceChildren();
}

function setSource(name) {
  activeSource = name;
  document.querySelectorAll('.source').forEach((button) => {
    const active = button.dataset.source === name;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('.source-panel').forEach((panel) => {
    panel.hidden = panel.id !== 'panel-' + name;
  });
  if (name !== 'kodik') clearKodik();
  if (name === 'kodik' && player) player.pause();
  showStage(name === 'kodik' ? 'kodik' : 'video');
  if (name !== 'anilibria') {
    const tools = $('player-tools');
    if (tools) tools.hidden = true;
  }
}

function fillQualities() {
  const select = $('player-quality');
  if (!select) return;
  select.replaceChildren();
  qualities.forEach((quality, index) => select.add(new Option(quality.label, String(index), false, index === 0)));
  select.hidden = qualities.length < 2;
}

function updateSkipButton() {
  const button = $('player-skip');
  if (!button) return;
  if (!opening || !player) { button.hidden = true; return; }
  const time = player.currentTime() || 0;
  button.hidden = !(time >= Math.max(0, opening.start - 5) && time <= opening.stop);
}

function playEpisode(episode, index) {
  qualities = episodeQualities(episode);
  opening = episodeOpening(episode);
  if (!qualities.length) {
    setStatus('У этой серии нет видео в AniLibria.');
    return;
  }
  showStage('video');
  const tools = $('player-tools');
  if (tools) tools.hidden = false;
  fillQualities();
  setStatus(`${releaseTitle(currentRelease)} · ${episodeLabel(episode, index)}`);
  playUrl(qualities[0].url, 'application/x-mpegURL');
  updateSkipButton();
}

function renderEpisodes(list) {
  const host = $('anilibria-episodes');
  if (!host) return;
  host.replaceChildren();
  if (!list.length) {
    host.append(el('p', 'У релиза пока нет серий.', 'hint'));
    return;
  }
  list.forEach((episode, index) => {
    const button = el('button', episodeLabel(episode, index), 'episode');
    button.type = 'button';
    button.onclick = () => playEpisode(episode, index);
    host.append(button);
  });
}

function renderReleases(list) {
  const host = $('anilibria-releases');
  if (!host) return;
  host.replaceChildren();
  if (!list.length) {
    host.append(el('p', 'Ничего не нашлось. Попробуй другое название.', 'hint'));
    return;
  }
  list.forEach((release) => {
    const meta = [releaseYear(release), release.episodes_total ? release.episodes_total + ' сер.' : '']
      .filter(Boolean).join(' · ');
    const button = el('button', '', 'release');
    button.type = 'button';
    const strong = el('strong', releaseTitle(release));
    const small = el('small', meta || 'AniLibria');
    button.append(strong, small);
    button.onclick = () => loadRelease(release);
    host.append(button);
  });
}

async function loadRelease(release) {
  currentRelease = release;
  setStatus('Загружаю серии «' + releaseTitle(release) + '»…');
  try {
    episodes = await releaseEpisodes(release.id);
    renderEpisodes(episodes);
    setStatus(`${releaseTitle(release)} · ${episodes.length} сер.`);
  } catch (error) {
    setStatus(error.message || 'Не удалось загрузить серии.');
  }
}

function normalizeTitle(value) {
  return String(value || '').toLowerCase().replace(/[^a-zа-яё0-9]+/g, '');
}

async function searchAnilibria(query) {
  const text = String(query || '').trim();
  if (!text) { setStatus('Введи название тайтла.'); return; }
  setStatus('Ищу в AniLibria…');
  const host = $('anilibria-episodes');
  if (host) host.replaceChildren();
  try {
    const releases = await searchReleases(text);
    renderReleases(releases);
    const wanted = normalizeTitle(text);
    let best = null;
    let bestScore = 0;
    for (const release of releases) {
      const name = normalizeTitle(releaseTitle(release));
      if (!name || !wanted) continue;
      if (name === wanted) { best = release; bestScore = 100; break; }
      let score = 0;
      if (name.startsWith(wanted) || wanted.startsWith(name)) score = 80;
      else if (name.includes(wanted) || wanted.includes(name)) score = 60;
      if (score > bestScore) { best = release; bestScore = score; }
    }
    if (best && bestScore >= 60) {
      await loadRelease(best);
    } else if (!releases.length) {
      setStatus('В AniLibria ничего не нашлось. Попробуй название иначе.');
    } else {
      setStatus('Точного совпадения нет — выбери подходящий релиз из списка.');
    }
  } catch (error) {
    setStatus(error.message || 'AniLibria недоступна.');
  }
}

function validateHttps(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function openKodik(value) {
  const url = validateHttps(value);
  const host = $('kodik-host');
  if (!url || !host) { setStatus('Нужна HTTPS-ссылка на плеер Kodik.'); return; }
  if (!/(^|\.)(kodikplayer\.com|kodik\.info|kodik\.biz)$/i.test(url.hostname)) {
    setStatus('Это не ссылка Kodik. Нужен адрес вида https://kodikplayer.com/…');
    return;
  }
  clearKodik();
  const frame = document.createElement('iframe');
  frame.src = url.href;
  frame.allowFullscreen = true;
  frame.setAttribute('allow', 'autoplay; fullscreen; encrypted-media; picture-in-picture');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  host.append(frame);
  setStatus('Kodik открыт как есть — с рекламой плеера. Без рекламы Kodik играет в приложении Tsuzuki.');
  showStage('kodik');
}

export function openPlayer(title) {
  location.hash = 'player';
  setSource('anilibria');
  initPlayer();
  const form = $('anilibria-search');
  if (form && form.elements.q) form.elements.q.value = title || '';
  if (title) searchAnilibria(title);
  else setStatus('Найди тайтл по названию.');
}

export function enterPlayer() {
  initPlayer();
}

export function pausePlayer() {
  if (player) player.pause();
}

export function initPlayer() {
  if (initialized) return;
  initialized = true;
  document.querySelectorAll('.source').forEach((button) => {
    button.addEventListener('click', () => setSource(button.dataset.source));
  });
  const search = $('anilibria-search');
  if (search) {
    search.addEventListener('submit', (event) => {
      event.preventDefault();
      searchAnilibria(search.elements.q.value);
    });
  }
  const seekHost = $('player-tools');
  if (seekHost) {
    seekHost.addEventListener('click', (event) => {
      const seek = event.target.closest('[data-seek]');
      if (seek && player) {
        player.currentTime(Math.max(0, (player.currentTime() || 0) + Number(seek.dataset.seek)));
        return;
      }
      if (event.target.closest('[data-skip]') && opening && player) player.currentTime(opening.stop);
    });
  }
  const quality = $('player-quality');
  if (quality) {
    quality.addEventListener('change', () => {
      if (!player) return;
      const selected = qualities[Number(quality.value)] || qualities[0];
      if (!selected) return;
      const time = player.currentTime() || 0;
      player.src({ src: selected.url, type: 'application/x-mpegURL' });
      player.currentTime(time);
      player.play()?.catch(() => {});
    });
  }
  const speed = $('player-speed');
  if (speed) {
    speed.addEventListener('change', () => {
      if (player) player.playbackRate(Number(speed.value) || 1);
    });
  }
  const kodik = $('kodik-form');
  if (kodik) {
    kodik.addEventListener('submit', (event) => {
      event.preventDefault();
      openKodik(kodik.elements.url.value);
    });
  }
  const local = $('local');
  if (local) {
    local.addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      setSource('file');
      setStatus('Открыт локальный файл: ' + file.name);
      playUrl(URL.createObjectURL(file), '');
    });
  }
  const stream = $('stream');
  if (stream) {
    stream.addEventListener('submit', (event) => {
      event.preventDefault();
      const url = validateHttps(stream.elements.url.value);
      if (!url) { setStatus('Введи HTTPS-ссылку на видео.'); return; }
      setSource('link');
      setStatus('Открыта ссылка: ' + url.hostname);
      playUrl(url.href);
    });
  }
  setSource('anilibria');
}
