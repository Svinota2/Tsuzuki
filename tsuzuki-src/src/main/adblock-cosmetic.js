// ============================================================
//  КОСМЕТИЧЕСКАЯ БЛОКИРОВКА РЕКЛАМЫ.
//  Сетевой adblock не может убрать рекламу, которую сайт отдаёт
//  со своего же домена (нативные баннеры). Здесь мы прячем такие блоки
//  по правилам скрытия из RU AdList: для текущего хоста выбираются
//  селекторы и вставляются как CSS «display:none».
//  Применяется только в окнах сервисов (openWebWindow), не в iframe Kodik
//  (кросс-доменный iframe менять нельзя).
// ============================================================

const RULES = require('./cosmetic-rules');

// Селекторы для хоста: точное совпадение или родительский домен
function selectorsFor(hostname) {
  const parts = String(hostname || '').toLowerCase().split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const domain = parts.slice(i).join('.');
    if (RULES[domain]) return RULES[domain];
  }
  return null;
}

// CSS для текущего хоста (пустая строка — правил нет)
function cssFor(hostname) {
  const selectors = selectorsFor(hostname);
  if (!selectors || !selectors.length) return '';
  // Каждый селектор проверяем на простые поломки, :has() Chromium поддерживает
  const safe = selectors.filter((s) => s && !s.includes('{') && !s.includes('}'));
  if (!safe.length) return '';
  return `${safe.join(',\n')} { display: none !important; }`;
}

// Вставляем CSS в окно сервиса и обновляем его при переходах по сайту
function install(webContents) {
  if (!webContents) return;

  const inject = () => {
    if (webContents.isDestroyed()) return;
    // Косметика работает вместе с основной блокировкой (можно выключить в настройках)
    let enabled = true;
    try {
      enabled = require('./adblock').isEnabled();
    } catch {
      enabled = true;
    }
    if (!enabled) return;

    let host = '';
    try {
      host = new URL(webContents.getURL()).hostname;
    } catch {
      return;
    }
    const css = cssFor(host);
    if (!css) return;
    webContents.insertCSS(css).catch(() => {
      // некоторые страницы могут запрещать вставку — молча пропускаем
    });
  };

  webContents.on('did-finish-load', inject);
  inject();
}

module.exports = { install, cssFor, selectorsFor };
