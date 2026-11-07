// ============================================================
//  МОСТ МИНИ-ПЛЕЕРА (ДОБАВЛЕНО В 1.6.3).
//  Окно мини-плеера не имеет доступа к Node — всё через эти методы:
//  принять данные для воспроизведения, переключить «поверх всех»,
//  закрыть, вернуть в основное окно, сообщить о смене серии/времени.
// ============================================================

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mini', {
  // данные приходят после загрузки окна (см. mini-player.js → mini:init)
  onInit: (fn) => ipcRenderer.on('mini:init', (_e, data) => fn(data)),
  // «поверх всех окон»: без аргумента — переключить, с true/false — задать
  pin: (on) => ipcRenderer.invoke('mini:pin', on),
  state: () => ipcRenderer.invoke('mini:state'),
  close: () => ipcRenderer.invoke('mini:close'),
  toMain: () => ipcRenderer.invoke('mini:return'),
  // сообщить основному окну: сменили серию, время, пауза/плей
  update: (payload) => ipcRenderer.send('mini:update', payload),
});
