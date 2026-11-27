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
let currentEpisode = null;
let currentQuality = 0;
let currentQuery = '';
let currentOriginal = '';
let expectedEpisodes = 0;
let fallbackVisible = false;
let qualitySwitching = false;

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
  player.on('loadeddata', () => {
    qualitySwitching = false;
    hideFallback();
  });
  player.on('error', () => {
    if (activeSource === 'anilibria' && !qualitySwitching) handlePlaybackError();
  });
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

function hideFallback() {
  const host = $('anilibria-fallback');
  if (host) { host.hidden = true; host.replaceChildren(); }
  fallbackVisible = false;
}

function kodikSearchUrl(title) {
  return 'https://kodik.info/search?title=' + encodeURIComponent(String(title || currentQuery || '').trim());
}

function updateKodikHelp(title) {
  const value = String(title || currentQuery || releaseTitle(currentRelease) || '').trim();
  const link = $('kodik-search-link');
  if (link) link.href = kodikSearchUrl(value);
  const copy = $('kodik-copy-title');
  if (copy) copy.dataset.title = value;
}

function showFallback(reason, title) {
  const host = $('anilibria-fallback');
  if (!host) return;
  host.replaceChildren();
  const card = el('div', null, 'fallback-card');
  card.append(
    el('strong', 'На AniLibria это не открылось'),
    el('p', reason || 'Тайтл может быть недоступен по лицензии или у релиза нет видео.', 'hint')
  );
  const actions = el('div', null, 'fallback-actions');
  const kodik = el('a', 'Найти на Kodik', 'fallback-button');
  kodik.href = kodikSearchUrl(title);
  kodik.target = '_blank';
  kodik.rel = 'noopener noreferrer';
  const external = el('a', 'Открыть Kodik в новой вкладке', 'fallback-button ghost');
  external.href = kodikSearchUrl(title);
  external.target = '_blank';
  external.rel = 'noopener noreferrer';
  const paste = el('button', 'Вставить ссылку Kodik', 'fallback-button ghost');
  paste.type = 'button';
  paste.onclick = () => {
    setSource('kodik');
    updateKodikHelp(title || currentQuery);
    const form = $('kodik-form');
    if (form) {
      form.hidden = false;
      form.elements.url?.focus();
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };
  actions.append(kodik, external, paste);
  card.append(actions);
  host.append(card);
  host.hidden = false;
  fallbackVisible = true;
}

function handlePlaybackError() {
  if (activeSource !== 'anilibria' || !currentEpisode) return;
  if (currentQuality < qualities.length - 1) {
    currentQuality += 1;
    qualitySwitching = true;
    const quality = qualities[currentQuality];
    setStatus('Поток не открылся, пробую ' + quality.label + '…');
    hideFallback();
    playUrl(quality.url, 'application/x-mpegURL');
    return;
  }
  const error = player && player.error && player.error();
  const codec = error && Number(error.code) === 4 ? 'Кодек или формат потока не поддерживается браузером.' : 'Браузер не смог декодировать поток AniLibria.';
  setStatus('AniLibria: ' + codec);
  showFallback(codec + ' Можно посмотреть этот тайтл через Kodik.', currentQuery);
}

function playEpisode(episode, index) {
  currentRelease = currentRelease || null;
  currentEpisode = episode;
  qualities = episodeQualities(episode);
  opening = episodeOpening(episode);
  currentQuality = 0;
  qualitySwitching = false;
  if (!qualities.length) {
    setStatus('У этой серии нет видео в AniLibria.');
    showFallback('У релиза нет доступного HLS-потока. Открой его через Kodik.', currentQuery);
    return;
  }
  hideFallback();
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
    const meta = [release.type?.description, releaseYear(release), release.episodes_total ? release.episodes_total + ' сер.' : '']
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
  currentEpisode = null;
  hideFallback();
  setStatus('Загружаю серии «' + releaseTitle(release) + '»…');
  try {
    episodes = await releaseEpisodes(release.id);
    renderEpisodes(episodes);
    if (!episodes.length) {
      setStatus(`${releaseTitle(release)} · у релиза нет серий.`);
      showFallback('У этого релиза AniLibria нет серий. Открой тайтл через Kodik.', currentQuery);
      return;
    }
    setStatus(`${releaseTitle(release)} · ${episodes.length} сер.`);
  } catch (error) {
    setStatus(error.message || 'Не удалось загрузить серии.');
    showFallback('Не удалось получить серии из AniLibria. Попробуй Kodik.', currentQuery);
  }
}

function normalizeTitle(value) {
  return String(value || '').toLowerCase().replace(/[^a-zа-яё0-9]+/g, '');
}

async function searchAnilibria(query, alternate = '') {
  const text = String(query || '').trim();
  currentQuery = text;
  currentOriginal = String(alternate || '').trim();
  if (!text) { setStatus('Введи название тайтла.'); return; }
  hideFallback();
  currentRelease = null;
  currentEpisode = null;
  setStatus('Ищу в AniLibria…');
  const host = $('anilibria-episodes');
  if (host) host.replaceChildren();
  try {
    const wantedTitles = [text, currentOriginal]
      .filter(Boolean)
      .map(normalizeTitle)
      .filter((value, index, list) => value && list.indexOf(value) === index);
    const queries = [text];
    if (currentOriginal && normalizeTitle(currentOriginal) !== normalizeTitle(text)) queries.push(currentOriginal);
    const releases = [];
    const seen = new Set();
    for (const value of queries) {
      const rows = await searchReleases(value);
      for (const release of rows) {
        if (release && !seen.has(release.id)) { seen.add(release.id); releases.push(release); }
      }
    }
    renderReleases(releases);
    let best = null;
    let bestScore = 0;
    for (const release of releases) {
      const names = [
        releaseTitle(release),
        release?.name?.english,
        release?.name?.alternative,
        release?.alias,
      ].map(normalizeTitle).filter(Boolean);
      let score = 0;
      for (const name of names) {
        for (const wanted of wantedTitles) {
          if (name === wanted) score = Math.max(score, 100);
          else if (name.startsWith(wanted) || wanted.startsWith(name)) score = Math.max(score, 80);
          else if (name.includes(wanted) || wanted.includes(name)) score = Math.max(score, 60);
        }
      }
      if (score > bestScore) { best = release; bestScore = score; }
    }
    if (best && bestScore >= 60) {
      const isMovie = best?.type?.value === 'MOVIE';
      if (isMovie && expectedEpisodes > 1) {
        setStatus(`На AniLibria есть только фильм «${releaseTitle(best)}». Сериала в AniLibria нет.`);
        showFallback('Сериал недоступен на AniLibria по лицензии — доступен только фильм. Открой тайтл через Kodik.', text);
        return;
      }
      await loadRelease(best);
    } else if (!releases.length) {
      setStatus('В AniLibria этого тайтла нет — скорее всего, он недоступен по лицензии.');
      showFallback('AniLibria не отдаёт этот тайтл (лицензия или удалён из каталога). Можно найти его на Kodik.', text);
    } else {
      setStatus('Точного совпадения нет — выбери релиз из списка или открой тайтл через Kodik.');
      showFallback('Подходящего релиза на AniLibria нет. Открой нужный тайтл через Kodik.', text);
    }
  } catch (error) {
    setStatus(error.message || 'AniLibria недоступна.');
    showFallback('AniLibria не ответила. Можно попробовать Kodik.', text);
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
  const openExternal = document.createElement('a');
  openExternal.href = url.href;
  openExternal.target = '_blank';
  openExternal.rel = 'noopener noreferrer';
  openExternal.className = 'kodik-open-external';
  openExternal.textContent = 'Если чёрный экран — открыть этот плеер в новой вкладке ↗';
  host.append(openExternal);
  setStatus('Kodik открыт как есть — выбери серию. Без рекламы Kodik играет в приложении Tsuzuki.');
  showStage('kodik');
}

export function openPlayer(title, original = '', episodeCount = 0) {
  expectedEpisodes = Number(episodeCount) || 0;
  location.hash = 'player';
  setSource('anilibria');
  initPlayer();
  const form = $('anilibria-search');
  if (form && form.elements.q) form.elements.q.value = title || '';
  if (title) searchAnilibria(title, original);
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
    button.addEventListener('click', () => {
      setSource(button.dataset.source);
      if (button.dataset.source === 'kodik') updateKodikHelp();
    });
  });
  const search = $('anilibria-search');
  if (search) {
    search.addEventListener('submit', (event) => {
      event.preventDefault();
      expectedEpisodes = 0;
      currentOriginal = '';
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
      currentQuality = Math.max(0, Number(quality.value) || 0);
      qualitySwitching = false;
      hideFallback();
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
  const kodikCopy = $('kodik-copy-title');
  if (kodikCopy) {
    kodikCopy.addEventListener('click', async () => {
      const title = kodikCopy.dataset.title || currentQuery;
      if (!title) { setStatus('Сначала найди тайтл.'); return; }
      try {
        await navigator.clipboard.writeText(title);
        setStatus('Название скопировано: ' + title);
      } catch {
        setStatus('Не удалось скопировать. Название: ' + title);
      }
    });
  }
  updateKodikHelp();
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
