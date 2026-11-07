// ============================================================
//  ДОБАВЛЕНО В 1.5: возможности главного процесса для новых разделов.
//  - картинки постеров в виде data-URL (для «Итогов года» на canvas);
//  - сохранение готовой картинки (PNG) через диалог;
//  - статус в Discord (Rich Presence) — без сторонних библиотек;
//  - список подпапок с видео (автораскладка папки с аниме).
//  Подключается из main.js: require('./extras').registerExtras(() => mainWindow)
// ============================================================

const { ipcMain, dialog, net: electronNet } = require('electron');
const nodeNet = require('net');
const path = require('path');
const fs = require('fs');
const settings = require('./settings');

// ---------- Картинки для canvas ----------
// Постеры с чужого сайта «портят» canvas (CORS), и сохранить PNG нельзя.
// Поэтому качаем их здесь и отдаём интерфейсу как data-URL.
const IMAGE_HOSTS = ['shikimori.io', 'shikimori.one', 'shikimori.me'];
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

async function imageDataUrl(url) {
  const u = new URL(String(url));
  if (u.protocol !== 'https:' || !IMAGE_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h))) {
    throw new Error('Картинки загружаются только с Shikimori');
  }
  const res = await electronNet.fetch(u.href, { headers: { 'User-Agent': settings.USER_AGENT } });
  if (!res.ok) throw new Error(`Картинка не загрузилась (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) throw new Error('Слишком большая картинка');
  const type = res.headers.get('content-type') || 'image/jpeg';
  return `data:${type};base64,${buf.toString('base64')}`;
}

async function saveImage(win, { dataUrl, fileName } = {}) {
  const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('Нет картинки для сохранения');
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Сохранить картинку',
    defaultPath: fileName || 'tsuzuki.png',
    filters: [{ name: 'Картинка PNG', extensions: ['png'] }],
  });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, Buffer.from(m[2], 'base64'));
  return filePath;
}

// ---------- Discord Rich Presence ----------
// Discord слушает локальный канал discord-ipc-0..9. Протокол простой:
// [код операции: int32][длина: int32][JSON]. 0 — рукопожатие, 1 — команда.
// Client ID создаётся на discord.com/developers → settings.DISCORD_CLIENT_ID.
const discord = { socket: null, ready: false, connecting: null, lastTry: 0, activity: null };

function discordPipeCandidates() {
  const out = [];
  for (let i = 0; i < 10; i++) {
    if (process.platform === 'win32') out.push(`\\\\?\\pipe\\discord-ipc-${i}`);
    else {
      const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp';
      // обычный Discord, Flatpak и Snap
      out.push(path.join(base, `discord-ipc-${i}`));
      out.push(path.join(base, 'app', 'com.discordapp.Discord', `discord-ipc-${i}`));
      out.push(path.join(base, 'snap.discord', `discord-ipc-${i}`));
    }
  }
  return out;
}

function encode(op, payload) {
  const json = Buffer.from(JSON.stringify(payload), 'utf8');
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(json.length, 4);
  return Buffer.concat([head, json]);
}

function tryPipe(p) {
  return new Promise((resolve, reject) => {
    const s = nodeNet.createConnection(p);
    const fail = () => { s.destroy(); reject(new Error('нет')); };
    s.once('connect', () => { s.off('error', fail); resolve(s); });
    s.once('error', fail);
  });
}

async function discordConnect() {
  const clientId = String(settings.DISCORD_CLIENT_ID || '').trim();
  if (!clientId) return false;                      // не настроено — молча выключено
  if (discord.socket && discord.ready) return true;
  if (discord.connecting) return discord.connecting;
  if (Date.now() - discord.lastTry < 60_000) return false; // переподключаемся не чаще раза в минуту
  discord.lastTry = Date.now();

  discord.connecting = (async () => {
    for (const p of discordPipeCandidates()) {
      let s;
      try { s = await tryPipe(p); } catch { continue; }
      discord.socket = s;
      discord.ready = false;
      let buf = Buffer.alloc(0);
      s.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        while (buf.length >= 8) {
          const len = buf.readInt32LE(4);
          if (buf.length < 8 + len) break;
          let msg = null;
          try { msg = JSON.parse(buf.slice(8, 8 + len).toString('utf8')); } catch { /* ignore */ }
          buf = buf.slice(8 + len);
          if (msg && msg.evt === 'READY') {
            discord.ready = true;
            if (discord.activity) sendActivity(discord.activity); // отправляем то, что ждало подключения
          }
        }
      });
      const reset = () => { discord.socket = null; discord.ready = false; };
      s.on('close', reset);
      s.on('error', reset);
      s.write(encode(0, { v: 1, client_id: clientId }));
      return true;
    }
    return false; // Discord не запущен
  })();
  try { return await discord.connecting; } finally { discord.connecting = null; }
}

function sendActivity(activity) {
  if (!discord.socket || !discord.ready) return;
  discord.socket.write(encode(1, {
    cmd: 'SET_ACTIVITY',
    args: { pid: process.pid, activity: activity || null },
    nonce: Math.random().toString(36).slice(2),
  }));
}

// data: { title, episode, total, startedAt }              — плеер;
//       { kind: 'browse', details, state, startedAt }      — ДОБАВЛЕНО В 1.6.2: раздел приложения;
//       null                                               — убрать статус
// Discord требует, чтобы строки были от 2 до 128 символов — иначе отклоняет статус.
const presenceText = (v) => {
  const t = String(v || '').trim().slice(0, 120);
  return t.length >= 2 ? t : undefined;
};

async function setPresence(data) {
  if (!data) {
    discord.activity = null;
    sendActivity(null);
    return { ok: true };
  }
  const assets = { large_image: settings.DISCORD_LARGE_IMAGE || 'logo', large_text: 'Tsuzuki' };
  const timestamps = data.startedAt ? { start: Math.floor(Number(data.startedAt) / 1000) } : undefined;
  if (data.kind === 'browse') {
    discord.activity = {
      details: presenceText(data.details) || 'В Tsuzuki',
      state: presenceText(data.state),
      timestamps,
      assets,
    };
  } else {
    const ep = data.episode ? `Серия ${data.episode}${data.total ? ' из ' + data.total : ''}` : undefined;
    discord.activity = {
      details: presenceText(data.title) || 'Смотрит аниме',
      state: presenceText(ep),
      timestamps,
      assets,
    };
  }
  const ok = await discordConnect().catch(() => false);
  if (ok) sendActivity(discord.activity);
  return { ok: !!ok };
}

// ---------- Папка со всем аниме: подпапки с видео ----------
function countVideos(dir, depth = 0) {
  let n = 0;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    if (e.isDirectory() && depth < 2) n += countVideos(path.join(dir, e.name), depth + 1);
    else if (e.isFile() && settings.VIDEO_EXTENSIONS.includes(path.extname(e.name).toLowerCase())) n++;
  }
  return n;
}

function listSubfolders(root) {
  let entries = [];
  try { entries = fs.readdirSync(String(root), { withFileTypes: true }); } catch { return []; }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => {
      const full = path.join(String(root), e.name);
      return { name: e.name, path: full, videos: countVideos(full) };
    })
    .filter((f) => f.videos > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }));
}

function registerExtras(getWindow) {
  ipcMain.handle('image:dataUrl', (_e, url) => imageDataUrl(url));
  ipcMain.handle('file:saveImage', (_e, opts) => saveImage(getWindow(), opts));
  ipcMain.handle('discord:set', (_e, data) => setPresence(data));
  ipcMain.handle('discord:available', () => ({ configured: !!String(settings.DISCORD_CLIENT_ID || '').trim() }));
  ipcMain.handle('folder:subdirs', (_e, root) => listSubfolders(root));
}

module.exports = { registerExtras, setPresence };
