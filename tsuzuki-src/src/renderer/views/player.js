// ============================================================
//  ПЛЕЕР для своих файлов.
//  Запоминает место, отмечает серию на CONFIG.AUTO_MARK_PERCENT %,
//  включает следующую. Горячие клавиши — внизу файла.
// ============================================================

import { CONFIG } from '../config.js';
import * as store from '../store.js';
import { esc, parseEpisodeNumber, formatTime, toast } from '../utils.js';

export async function render(root, [id, indexStr = '0']) {
  const entry = store.getEntry(id);
  if (!entry?.folder) {
    root.innerHTML = `<div class="empty"><div class="empty-big">▶</div>Для этого тайтла не выбрана папка с сериями.<br><br>
      <a class="btn" href="#/anime/${esc(id)}">Открыть страницу аниме</a></div>`;
    return;
  }

  const files = await window.api.listVideos(entry.folder);
  if (!files.length) {
    root.innerHTML = `<div class="empty"><div class="empty-big">∅</div>В папке нет видеофайлов:<br><span class="faint">${esc(entry.folder)}</span><br><br>
      <a class="btn" href="#/anime/${esc(id)}">Назад</a></div>`;
    return;
  }

  // номер серии для каждого файла (если не распознан — по порядку)
  const episodeOf = files.map((f, i) => parseEpisodeNumber(f.name) ?? i + 1);
  let index = Math.min(Math.max(0, Number(indexStr) || 0), files.length - 1);
  let markedThisFile = false;
  let lastSave = 0;

  root.scrollTop = 0;
  root.innerHTML = `
    <div class="player-page">
      <div class="player-main">
        <div class="player-top">
          <a class="btn btn-sm btn-ghost" href="#/anime/${esc(id)}">← К тайтлу</a>
          <a class="t ttl" id="ptitle" href="#/anime/${esc(id)}" title="Открыть страницу тайтла"></a>
        </div>
        <div class="player-video"><video id="video" controls autoplay></video></div>
        <div class="player-bar">
          <button class="btn btn-sm" id="prev">⏮ Пред.</button>
          <button class="btn btn-sm" id="next">След. ⏭</button>
          <button class="btn btn-sm" id="mark"></button>
          <span class="grow"></span>
          <select class="select" id="subs" title="Субтитры" style="height:30px;max-width:190px"></select>
          <button class="btn btn-sm" id="sub-minus" title="Субтитры раньше на 0,5 с">−0,5с</button>
          <button class="btn btn-sm" id="sub-plus" title="Субтитры позже на 0,5 с">+0,5с</button>
          <span class="faint" id="sub-offset"></span>
          <span class="faint">
            <span class="kbd">Пробел</span> пауза
            <span class="kbd">←</span><span class="kbd">→</span> ${CONFIG.SEEK_STEP_SEC} сек
            <span class="kbd">F</span> экран
            <span class="kbd">N</span> след.
          </span>
        </div>
      </div>
      <aside class="player-side">
        <h3>${esc(entry.title)}</h3>
        <div id="files"></div>
      </aside>
    </div>`;

  const page = root.querySelector('.player-page');
  const video = page.querySelector('#video');

  // ---------- Субтитры (ДОБАВЛЕНО В 1.4) ----------
  let subs = [];
  let subOffset = 0; // секунды: + позже, − раньше
  let subUrl = null;

  // Сдвигаем все времена в WebVTT на offset секунд (для рассинхрона)
  function shiftVtt(vtt, offset) {
    if (!offset) return vtt;
    const pad = (n, w = 2) => String(Math.floor(n)).padStart(w, '0');
    const fmt = (sec) => {
      const s = Math.max(0, sec);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const ss = Math.floor(s % 60);
      const ms = Math.round((s - Math.floor(s)) * 1000);
      return `${pad(h)}:${pad(m)}:${pad(ss)}.${pad(ms, 3)}`;
    };
    const parse = (t) => {
      const m = String(t).match(/^(\d+):(\d{2}):(\d{2})[.,](\d{1,3})$/);
      if (!m) return null;
      return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
    };
    return String(vtt).replace(/(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})/g, (all, a, b) => {
      const start = parse(a);
      const end = parse(b);
      if (start == null || end == null) return all;
      return `${fmt(start + offset)} --> ${fmt(end + offset)}`;
    });
  }

  function clearTrack() {
    page.querySelectorAll('track').forEach((t) => t.remove());
    if (subUrl) { URL.revokeObjectURL(subUrl); subUrl = null; }
  }

  async function applySubs() {
    const sel = page.querySelector('#subs');
    const idx = Number(sel.value);
    clearTrack();
    page.querySelector('#sub-offset').textContent = subOffset ? `сдвиг ${subOffset > 0 ? '+' : ''}${subOffset.toFixed(1)} с` : '';
    if (!Number.isInteger(idx) || !subs[idx]) return;
    try {
      const res = await window.api.subtitleRead(subs[idx].path);
      if (!res || !res.ok) throw new Error('Не удалось прочитать субтитры');
      const vtt = shiftVtt(res.vtt, subOffset);
      subUrl = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.label = subs[idx].label;
      track.srclang = /rus|ru/i.test(subs[idx].label) ? 'ru' : 'ru';
      track.default = true;
      track.src = subUrl;
      video.appendChild(track);
      setTimeout(() => {
        try { video.textTracks[0].mode = 'showing'; } catch { /* трек ещё не загрузился */ }
      }, 300);
    } catch (err) {
      toast('Субтитры: ' + err.message, 'error');
    }
  }

  async function refreshSubs() {
    subOffset = 0;
    clearTrack();
    subs = [];
    try { subs = await window.api.subtitleFind(files[index].path); } catch { subs = []; }
    const sel = page.querySelector('#subs');
    sel.innerHTML = `<option value="">Субтитры выкл</option>`
      + subs.map((s, i) => `<option value="${i}">${esc(s.label)}</option>`).join('');
    sel.disabled = !subs.length;
    page.querySelector('#sub-minus').disabled = !subs.length;
    page.querySelector('#sub-plus').disabled = !subs.length;
    if (subs.length) {
      sel.value = '0'; // если рядом лежат субтитры — включаем сразу
      applySubs();
    } else {
      page.querySelector('#sub-offset').textContent = '';
    }
  }

  page.querySelector('#subs').addEventListener('change', applySubs);
  page.querySelector('#sub-minus').addEventListener('click', () => { subOffset -= 0.5; applySubs(); });
  page.querySelector('#sub-plus').addEventListener('click', () => { subOffset += 0.5; applySubs(); });

  // ---------- Отрисовка ----------
  function drawSide() {
    page.querySelector('#files').innerHTML = files
      .map((f, i) => {
        const ep = episodeOf[i];
        const w = store.isWatched(id, ep);
        return `<div class="file ${i === index ? 'current' : ''} ${w ? 'watched' : ''}" data-i="${i}" title="${esc(f.name)}">
          <span class="num">${ep}</span><span class="fname">${esc(f.name)}</span>${w ? '<span class="mark">✓</span>' : ''}
        </div>`;
      })
      .join('');
    page.querySelector('.file.current')?.scrollIntoView({ block: 'nearest' });
  }

  function drawBar() {
    const ep = episodeOf[index];
    page.querySelector('#ptitle').textContent = `${entry.title} — ${ep} серия`;
    page.querySelector('#prev').disabled = index === 0;
    page.querySelector('#next').disabled = index === files.length - 1;
    page.querySelector('#mark').textContent = store.isWatched(id, ep) ? '✓ Просмотрена' : 'Отметить просмотренной';
    page.querySelector('#mark').classList.toggle('btn-accent', store.isWatched(id, ep));
  }

  function play(i) {
    index = i;
    markedThisFile = store.isWatched(id, episodeOf[i]);
    video.src = files[i].url;
    // меняем адрес без перезагрузки раздела (чтобы «Назад» работал как надо)
    history.replaceState(null, '', `#/player/${id}/${i}`);
    drawSide();
    drawBar();
    refreshSubs(); // ДОБАВЛЕНО В 1.4: подхватываем субтитры рядом с файлом
    updatePresence(); // ДОБАВЛЕНО В 1.5: статус в Discord
  }

  // ---------- Статус в Discord (ДОБАВЛЕНО В 1.5) ----------
  // Показываем только при просмотре своих файлов и только если включено
  // в «Настройках» и указан DISCORD_CLIENT_ID в src/main/settings.js.
  let presenceStart = Date.now();
  function updatePresence() {
    if (!CONFIG.DISCORD_PRESENCE || !window.api.discordSet) return;
    presenceStart = Date.now();
    window.api.discordSet({
      title: entry.title,
      episode: episodeOf[index],
      total: entry.episodes || 0,
      startedAt: presenceStart,
    }).catch(() => {});
  }
  function clearPresence() {
    if (window.api.discordSet) window.api.discordSet(null).catch(() => {});
  }

  // ---------- События видео ----------
  video.addEventListener('loadedmetadata', () => {
    const pos = store.getPosition(id, files[index].name);
    if (pos > 10 && pos < video.duration - 30) {
      video.currentTime = pos;
      toast(`Продолжаем с ${formatTime(pos)}`);
    }
  });

  video.addEventListener('timeupdate', () => {
    if (!video.duration) return;
    const now = video.currentTime;
    if (Math.abs(now - lastSave) >= CONFIG.SAVE_POSITION_EVERY_SEC) {
      lastSave = now;
      store.savePosition(id, files[index].name, now);
    }
    if (!markedThisFile && (now / video.duration) * 100 >= CONFIG.AUTO_MARK_PERCENT) {
      markedThisFile = true;
      store.setEpisodeWatched({ id: entry.id, ...asAnime(entry) }, episodeOf[index], true);
      toast(`${episodeOf[index]} серия отмечена просмотренной`, 'ok');
      drawSide();
      drawBar();
    }
  });

  video.addEventListener('ended', () => {
    store.savePosition(id, files[index].name, 0); // досмотрел — в следующий раз с начала
    if (CONFIG.AUTOPLAY_NEXT && index < files.length - 1) play(index + 1);
  });

  video.addEventListener('error', () => {
    toast('Этот файл не воспроизводится встроенным плеером (неподдерживаемый кодек). Открываю в системном плеере.', 'error');
    window.api.openPath(files[index].path);
  });

  // ---------- Кнопки ----------
  page.querySelector('#prev').addEventListener('click', () => index > 0 && play(index - 1));
  page.querySelector('#next').addEventListener('click', () => index < files.length - 1 && play(index + 1));
  page.querySelector('#mark').addEventListener('click', () => {
    const ep = episodeOf[index];
    store.toggleEpisode({ id: entry.id, ...asAnime(entry) }, ep);
    markedThisFile = store.isWatched(id, ep);
    drawSide();
    drawBar();
  });
  page.querySelector('#files').addEventListener('click', (e) => {
    const f = e.target.closest('[data-i]');
    if (f) play(Number(f.dataset.i));
  });

  // ---------- Горячие клавиши (меняй как хочешь) ----------
  function onKey(e) {
    if (e.target.tagName === 'INPUT') return;
    switch (e.code) {
      case 'Space':      e.preventDefault(); video.paused ? video.play() : video.pause(); break;
      case 'ArrowRight': e.preventDefault(); video.currentTime += CONFIG.SEEK_STEP_SEC; break;
      case 'ArrowLeft':  e.preventDefault(); video.currentTime -= CONFIG.SEEK_STEP_SEC; break;
      case 'ArrowUp':    e.preventDefault(); video.volume = Math.min(1, video.volume + 0.1); break;
      case 'ArrowDown':  e.preventDefault(); video.volume = Math.max(0, video.volume - 0.1); break;
      case 'KeyM':       video.muted = !video.muted; break;
      case 'KeyF':       document.fullscreenElement ? document.exitFullscreen() : video.requestFullscreen(); break;
      case 'KeyN':       if (index < files.length - 1) play(index + 1); break;
      case 'KeyP':       if (index > 0) play(index - 1); break;
    }
  }
  document.addEventListener('keydown', onKey);

  play(index);

  // При уходе со страницы: запоминаем позицию, снимаем клавиши, останавливаем видео
  return () => {
    if (video.currentTime > 0 && !video.ended) store.savePosition(id, files[index].name, video.currentTime);
    document.removeEventListener('keydown', onKey);
    clearTrack(); // ДОБАВЛЕНО В 1.4: освобождаем субтитры
    clearPresence(); // ДОБАВЛЕНО В 1.5: убираем статус в Discord
    video.pause();
    video.removeAttribute('src');
    video.load();
  };
}

function asAnime(e) {
  return {
    russian: e.title, name: e.name, kind: e.kind, status: e.animeStatus,
    episodes: e.episodes, episodesAired: e.episodesAired,
    poster: { mainUrl: e.poster }, airedOn: { year: e.year },
  };
}
