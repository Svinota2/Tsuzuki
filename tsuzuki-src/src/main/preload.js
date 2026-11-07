// ============================================================
//  Мост между интерфейсом и главным процессом.
//  Всё, что здесь перечислено, доступно в интерфейсе как window.api.xxx()
//  Хочешь новую возможность (например, удалить файл) — добавь обработчик
//  в main.js (ipcMain.handle) и строчку сюда.
// ============================================================

// ------------------------------------------------------------
//  ИЗМЕНЕНО В 1.1 (Claude, 02.11.2026):
//  - window.api.openTextFile и window.api.anilist (импорт из других программ)
// ------------------------------------------------------------

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Данные (твой список)
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data) => ipcRenderer.invoke('data:save', data),
  dataPath: () => ipcRenderer.invoke('data:path'),
  exportData: (data) => ipcRenderer.invoke('data:export', data),
  importData: () => ipcRenderer.invoke('data:import'),

  // Импорт списков из других программ
  openTextFile: (opts) => ipcRenderer.invoke('file:openText', opts),
  anilist: (query, variables) => ipcRenderer.invoke('anilist:graphql', query, variables),

  // Shikimori
  graphql: (query, variables) => ipcRenderer.invoke('shiki:graphql', query, variables),
  shikiGet: (path) => ipcRenderer.invoke('shiki:get', path),

  // Kodik (онлайн-просмотр с озвучками)
  kodikSearch: (params) => ipcRenderer.invoke('kodik:search', params),
  kodikCheck: (token) => ipcRenderer.invoke('kodik:check', token),

  // Папки с сериями
  pickFolder: () => ipcRenderer.invoke('folder:pick'),
  listVideos: (folder) => ipcRenderer.invoke('folder:videos', folder),
  openPath: (p) => ipcRenderer.invoke('path:open', p), // открыть папку или файл программой по умолчанию

  // ДОБАВЛЕНО В 1.5: «Итоги года», статус в Discord, автораскладка папки с аниме
  imageDataUrl: (url) => ipcRenderer.invoke('image:dataUrl', url),
  saveImage: (dataUrl, fileName) => ipcRenderer.invoke('file:saveImage', { dataUrl, fileName }),
  discordSet: (data) => ipcRenderer.invoke('discord:set', data),
  discordAvailable: () => ipcRenderer.invoke('discord:available'),
  listSubfolders: (root) => ipcRenderer.invoke('folder:subdirs', root),

  // Субтитры (ДОБАВЛЕНО В 1.4)
  subtitleFind: (videoPath) => ipcRenderer.invoke('subtitles:find', videoPath),
  subtitleRead: (subPath) => ipcRenderer.invoke('subtitles:read', subPath),

  // Веб-окна
  openWeb: (url, title) => ipcRenderer.invoke('web:open', url, title),
  openPlayer: (url, title) => ipcRenderer.invoke('player:open', url, title),
  openExternal: (url) => ipcRenderer.invoke('web:external', url),

  // Блокировка рекламы
  setAdblock: (enabled) => ipcRenderer.invoke('adblock:set', enabled),
  adblockStats: () => ipcRenderer.invoke('adblock:stats'),

  // ---------- Аккаунт Shikimori (ИЗМЕНЕНО В 1.3) ----------
  shikiAuthStart: () => ipcRenderer.invoke('shiki:auth-start'),
  shikiAuthUrl: () => ipcRenderer.invoke('shiki:auth-url'),
  shikiAuthCode: (code) => ipcRenderer.invoke('shiki:auth-code', code),
  shikiAuthStatus: () => ipcRenderer.invoke('shiki:auth-status'),
  shikiAuthLogout: () => ipcRenderer.invoke('shiki:auth-logout'),
  shikiApi: (path, opts) => ipcRenderer.invoke('shiki:api', { path, ...(opts || {}) }),

  // ---------- Анонимная статистика (ИЗМЕНЕНО В 1.3) ----------
  telemetrySend: (payload) => ipcRenderer.invoke('telemetry:send', payload),
  deviceInfo: () => ipcRenderer.invoke('device:info'),

  // ---------- Автообновление (ИЗМЕНЕНО В 1.3) ----------
  checkUpdates: () => ipcRenderer.invoke('updater:check'),
  updateState: () => ipcRenderer.invoke('updater:state'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  // ИЗМЕНЕНО В 1.6: выключатель «Автообновление» управляет фоновой проверкой
  updateSetAuto: (enabled) => ipcRenderer.invoke('updater:set-auto', enabled),
  onUpdate: (fn) => {
    const h = (_e, state) => fn(state);
    ipcRenderer.on('updater:status', h);
    return () => ipcRenderer.removeListener('updater:status', h);
  },

  // ---------- Трей, уведомления, автозапуск (ИЗМЕНЕНО В 1.3) ----------
  setCloseToTray: (enabled) => ipcRenderer.invoke('tray:set-close', enabled),
  setAutostart: (enabled) => ipcRenderer.invoke('autostart:set', enabled),
  checkNewEpisodesNow: () => ipcRenderer.invoke('notifications:check-now'),
  setBackgroundNotify: (enabled) => ipcRenderer.invoke('notifications:set-enabled', enabled),
  onNavigate: (fn) => {
    const h = (_e, id) => fn(id);
    ipcRenderer.on('nav:anime', h);
    return () => ipcRenderer.removeListener('nav:anime', h);
  },
  onEpisodesNews: (fn) => {
    const h = (_e, list) => fn(list);
    ipcRenderer.on('episodes:news', h);
    return () => ipcRenderer.removeListener('episodes:news', h);
  },
});
