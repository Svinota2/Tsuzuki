// ============================================================
//  СЕРВИСЫ: быстрый вход в официальные онлайн-кинотеатры.
//  Список правится в config.js → SERVICES.
// ============================================================

import { CONFIG } from '../config.js';
import { esc } from '../utils.js';

export function render(root) {
  root.scrollTop = 0;
  root.innerHTML = `
    <div class="page">
      <h1 class="page-title">Сервисы</h1>
      <div class="note">
        Сервис откроется в отдельном окне. Вход в аккаунт сохраняется, так что логиниться нужно один раз.
        Если видео в окне не запускается (часть сервисов пускает только в обычный браузер из-за защиты от копирования),
        нажми «в браузере».
      </div>
      <div class="services">
        ${CONFIG.SERVICES.map((s, i) => `
          <div class="service" data-i="${i}">
            <div class="service-logo" style="background:${esc(s.color || 'var(--panel-3)')}">${esc(s.name[0])}</div>
            <div>
              <div class="service-name">${esc(s.name)}</div>
              <div class="service-url">${esc(new URL(s.home).hostname)}</div>
            </div>
            <div class="row" style="display:flex;gap:8px">
              <button class="btn btn-sm btn-accent" data-open="${i}">Открыть</button>
              <button class="btn btn-sm btn-ghost" data-ext="${i}">в браузере ↗</button>
            </div>
          </div>`).join('')}
      </div>
    </div>`;

  root.querySelector('.page').addEventListener('click', (e) => {
    const ext = e.target.closest('[data-ext]');
    if (ext) return window.api.openExternal(CONFIG.SERVICES[ext.dataset.ext].home);
    const card = e.target.closest('[data-i]');
    if (card) {
      const s = CONFIG.SERVICES[card.dataset.i];
      window.api.openWeb(s.home, s.name);
    }
  });
}
