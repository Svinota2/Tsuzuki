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
let hls = null;
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
let kodikTokenCandidates = null;
let kodikTokenAt = 0;
let kodikWorkingToken = '';
let lastKodikQuery = '';

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

function destroyPlayer() {
  if (hls) { try { hls.destroy(); } catch { /* ignore */ } hls = null; }
  if (player) { try { player.destroy(false); } catch { /* ignore */ } player = null; }
  const holder = $('video');
  if (holder) holder.replaceChildren();
}

function attachHls(video, src, art) {
  if (hls) { try { hls.destroy(); } catch { /* ignore */ } hls = null; }
  if (window.Hls && Hls.isSupported()) {
    const instance = new Hls({ enableWorker: true });
    hls = instance;
    instance.loadSource(src);
    instance.attachMedia(video);
    instance.on(Hls.Events.ERROR, (_event, data) => {
      if (!data || !data.fatal) return;
      if (hls === instance) { try { instance.destroy(); } catch { /* ignore */ } hls = null; }
      setStatus('Поток не открылся: ' + (data.details || 'HLS error'));
      if (activeSource === 'anilibria' && !qualitySwitching) handlePlaybackError();
      else if (activeSource === 'anilibria') showFallback('Видео не открылось. Попробуй другую озвучку или Kodik.', currentQuery);
    });
    art.once('destroy', () => {
      if (hls === instance) { try { instance.destroy(); } catch { /* ignore */ } hls = null; }
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = src;
  } else {
    setStatus('Браузер не поддерживает HLS.');
  }
}

function playUrl(url, type) {
  showStage('video');
  destroyPlayer();
  const holder = $('video');
  if (!holder) return;
  if (!window.Artplayer) { setStatus('Плеер не загрузился: ArtPlayer.'); return; }
  const isHls = /mpegurl|m3u8/i.test(String(type || '')) || /\.m3u8(\?|$)/i.test(url);
  const qualityList = isHls && qualities.length > 1
    ? qualities.map((quality, index) => ({ html: quality.label, url: quality.url, default: index === currentQuality }))
    : [];
  try {
    player = new Artplayer({
      container: holder,
      url,
      type: isHls ? 'm3u8' : 'mp4',
      autoplay: false,
      playsinline: true,
      theme: '#ff6b5f',
      setting: true,
      playbackRate: true,
      aspectRatio: true,
      fullscreen: true,
      fullscreenWeb: true,
      pip: true,
      miniProgressBar: true,
      mutex: true,
      backdrop: true,
      lang: 'ru',
      quality: qualityList,
      customType: { m3u8: (video, src, art) => attachHls(video, src, art) },
    });
    player.on('video:timeupdate', updateSkipButton);
    player.on('video:loadedmetadata', () => {
      qualitySwitching = false;
      updateSkipButton();
    });
    player.on('video:error', () => {
      if (activeSource === 'anilibria' && !qualitySwitching) handlePlaybackError();
    });
  } catch (error) {
    setStatus('Не удалось открыть плеер: ' + (error?.message || error));
  }
}

function showStage(kind) {
  const video = $('video');
  if (video) video.style.display = kind === 'video' ? '' : 'none';
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

function updateSkipButton() {
  const button = $('player-skip');
  if (!button) return;
  if (!opening || !player) { button.hidden = true; return; }
  const time = Number(player.currentTime) || 0;
  button.hidden = !(time >= Math.max(0, opening.start - 5) && time <= opening.stop);
}

function hideFallback() {
  const host = $('anilibria-fallback');
  if (host) { host.hidden = true; host.replaceChildren(); }
  fallbackVisible = false;
}

function updateKodikHelp(title) {
  const value = String(title || currentQuery || releaseTitle(currentRelease) || '').trim();
  const copy = $('kodik-copy-title');
  if (copy) copy.dataset.title = value;
}


// ============================================================
//  Kodik API в браузере (1.9.12)
//  Публичные токены AnimeParsers пробуем по очереди: Kodik API
//  доступен с CORS, но конкретный токен может протухнуть.
// ============================================================
const KODIK_TOKENS_URL = 'https://raw.githubusercontent.com/YaNesyTortiK/AnimeParsers/refs/heads/main/kdk_tokns/tokens.json';

function base64Utf8(value) {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function decodeKodikToken(encoded) {
  const mid = Math.floor(encoded.length / 2);
  const tail = base64Utf8(encoded.slice(0, mid).split('').reverse().join(''));
  const head = base64Utf8(encoded.slice(mid).split('').reverse().join(''));
  return head + tail;
}

async function loadKodikTokens() {
  if (kodikTokenCandidates && Date.now() - kodikTokenAt < 10 * 60 * 1000) return kodikTokenCandidates;
  const response = await fetch(KODIK_TOKENS_URL, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('не удалось получить список токенов Kodik');
  const list = await response.json();
  const tokens = [];
  for (const group of ['stable', 'unstable']) {
    for (const item of list?.[group] || []) {
      try {
        const token = decodeKodikToken(String(item?.tokn || ''));
        if (token && !tokens.includes(token)) tokens.push(token);
      } catch { /* следующий токен */ }
    }
  }
  if (!tokens.length) throw new Error('нет доступных токенов Kodik');
  kodikTokenCandidates = tokens;
  kodikTokenAt = Date.now();
  return tokens;
}

async function kodikSearchRequest(token, title) {
  const params = new URLSearchParams({
    token,
    title,
    limit: '24',
    with_episodes: 'true',
    types: 'anime,anime-serial',
  });
  const response = await fetch('https://kodik-api.com/search?' + params, {
    cache: 'no-store',
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const data = await response.json();
  if (data?.error) throw new Error(data.error);
  return Array.isArray(data?.results) ? data.results : [];
}

async function searchKodik(title) {
  const value = String(title || currentQuery || currentOriginal || '').trim();
  if (!value) throw new Error('нет названия для поиска');
  const tokens = await loadKodikTokens();
  const ordered = kodikWorkingToken
    ? [kodikWorkingToken, ...tokens.filter((token) => token !== kodikWorkingToken)]
    : tokens;
  let lastError = null;
  for (const token of ordered) {
    try {
      const results = await kodikSearchRequest(token, value);
      kodikWorkingToken = token;
      return results;
    } catch (error) {
      lastError = error;
    }
  }
  kodikTokenCandidates = null;
  throw lastError || new Error('Kodik не ответил');
}

function renderKodikResults(results, title) {
  const host = $('kodik-results');
  if (!host) return;
  host.hidden = false;
  host.replaceChildren();
  const card = el('div', null, 'fallback-card');
  card.append(
    el('strong', 'Kodik — выбери озвучку'),
    el('p', 'Нажми озвучку, затем выбери серию в плеере Kodik. Внутри iframe есть реклама; без рекламы Kodik играет в приложении Tsuzuki.', 'hint')
  );
  const list = el('div', null, 'kodik-results');
  for (const result of results.slice(0, 12)) {
    const row = el('div', null, 'kodik-result-row');
    const button = el('button', null, 'kodik-result');
    button.type = 'button';
    const label = String(result.title || title || 'Без названия');
    const translation = result.translation?.title ? ' · ' + result.translation.title : '';
    const meta = [];
    if (result.year) meta.push(result.year);
    if (result.episodes_count) meta.push(result.episodes_count + ' сер.');
    button.append(
      el('span', label + translation, 'kodik-result-title'),
      el('span', meta.join(' · ') || 'Kodik', 'kodik-result-meta')
    );
    const linkValue = String(result.link || '');
    const link = linkValue.startsWith('//') ? 'https:' + linkValue : linkValue;
    button.onclick = () => {
      if (!link) { setStatus('У этой озвучки нет ссылки на плеер.'); return; }
      setSource('kodik');
      openKodik(link);
      $('kodik-host')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    const external = el('a', '↗', 'kodik-result-open');
    external.href = link;
    external.target = '_blank';
    external.rel = 'noopener noreferrer';
    external.title = 'Открыть Kodik в новой вкладке';
    row.append(button, external);
    list.append(row);
  }
  card.append(list);
  const retry = el('button', 'Повторить поиск', 'fallback-button ghost');
  retry.type = 'button';
  retry.onclick = () => findOnKodik(title);
  card.append(retry);
  host.append(card);
  lastKodikQuery = String(title || currentQuery || '').trim();
  setStatus('Kodik: найдено вариантов — ' + results.length + '. Выбери озвучку и серию.');
  host.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function findOnKodik(title) {
  const query = String(title || currentQuery || currentOriginal || '').trim();
  const host = $('kodik-results');
  if (!query) {
    if (host) {
      host.hidden = false;
      host.replaceChildren(el('p', 'Сначала найди тайтл на AniLibria или введи название в поиске выше.', 'hint'));
    }
    setStatus('Сначала найди тайтл на AniLibria.');
    return;
  }
  setSource('kodik');
  updateKodikHelp(query);
  if (host) {
    host.hidden = false;
    host.replaceChildren(el('p', 'Ищу на Kodik…', 'hint'));
    host.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  setStatus('Ищу на Kodik…');
  try {
    const results = await searchKodik(query);
    if (!results.length) {
      if (host) {
        host.replaceChildren(el('p', 'Kodik ничего не нашёл. Вставь прямую ссылку на плеер в поле выше.', 'hint'));
      }
      setStatus('Kodik ничего не нашёл.');
      return;
    }
    renderKodikResults(results, query);
  } catch (error) {
    if (host) {
      host.replaceChildren(el('p', 'Kodik не ответил: ' + (error?.message || 'ошибка') + '. Вставь прямую ссылку вручную.', 'hint'));
    }
    setStatus('Kodik не ответил.');
  }
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
  const kodik = el('button', 'Найти на Kodik', 'fallback-button');
  kodik.type = 'button';
  kodik.onclick = () => findOnKodik(title);
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
  actions.append(kodik, paste);
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
  const code = player?.video?.error?.code;
  const codec = Number(code) === 4 ? 'Кодек или формат потока не поддерживается браузером.' : 'Браузер не смог декодировать поток AniLibria.';
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
      if (button.dataset.source === 'kodik') {
        const title = currentQuery || releaseTitle(currentRelease) || currentOriginal;
        if (title && title !== lastKodikQuery) findOnKodik(title);
        else updateKodikHelp(title);
      }
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
  const idleSearch = $('player-idle-search');
  if (idleSearch) {
    idleSearch.addEventListener('click', () => {
      setSource('anilibria');
      search?.elements.q?.focus();
      search?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
  const seekHost = $('player-tools');
  if (seekHost) {
    seekHost.addEventListener('click', (event) => {
      const seek = event.target.closest('[data-seek]');
      if (seek && player) {
        player.currentTime = Math.max(0, (Number(player.currentTime) || 0) + Number(seek.dataset.seek));
        return;
      }
      if (event.target.closest('[data-skip]') && opening && player) player.currentTime = opening.stop;
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
