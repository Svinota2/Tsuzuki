// Смоук-тест Tsuzuki 1.1 на Windows: новые фичи + регресс v1.0.
import fs from 'node:fs';
const PORT = Number(process.env.TSUZUKI_PORT || 9350);
const OUT = process.env.TSUZUKI_OUT || 'shots';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function targets() {
  for (let i = 0; i < 60; i++) {
    try { return await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch {}
    await sleep(500);
  }
  throw new Error('no CDP');
}
function connect(url) {
  const ws = new WebSocket(url);
  let seq = 0; const waiting = new Map(); const errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id) { const p = waiting.get(m.id); if (p) { waiting.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } return; }
    if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails.exception?.description || '').slice(0, 300));
  };
  return new Promise((resolve) => {
    ws.onopen = () => resolve({
      ws, errors,
      send: (method, params = {}) => new Promise((res, rej) => { const id = ++seq; waiting.set(id, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id, method, params })); }),
      ev: async (expr) => {
        const r = await new Promise((res, rej) => { const id = ++seq; waiting.set(id, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true } })); });
        if (r.exceptionDetails) return { error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
        return { value: r.result?.value };
      },
    });
  });
}
const list = await targets();
const page = list.find((t) => t.type === 'page' && /index\.html/.test(t.url));
const c = await connect(page.webSocketDebuggerUrl);
await c.send('Runtime.enable'); await c.send('Page.enable'); await sleep(3000);
const shot = async (name) => { try { const { data } = await c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${OUT}\\${name}.png`, Buffer.from(data, 'base64')); } catch {} };
const original = (await c.ev('window.api.loadData()')).value ?? {};
const out = {};

// 1. Каталог: сортировка, оценки, склейка сезонов
out.boot = (await c.ev(`(() => ({
  hash: location.hash,
  h1: document.querySelector('.page-title')?.innerText,
  cards: document.querySelectorAll('.card').length,
  orderOptions: [...document.querySelectorAll('#order option')].map((o) => o.textContent),
  orderValue: document.querySelector('#order')?.value,
  votes: [...document.querySelectorAll('.card-votes, .card-meta')].slice(0, 3).map((e) => e.innerText),
  theme: document.documentElement.getAttribute('data-theme') || document.body.className || '',
}))()`)).value;
await shot('v11-01-catalog');

await c.ev(`(() => { const q = document.querySelector('#q'); q.value = 'Атака титанов'; q.dispatchEvent(new Event('input')); })()`);
await sleep(5000);
out.stacks = (await c.ev(`(() => {
  const cards = [...document.querySelectorAll('.card')];
  return {
    cards: cards.length,
    stacks: [...document.querySelectorAll('.card-stack')].map((e) => e.innerText),
    titles: cards.slice(0, 5).map((x) => x.querySelector('.card-title')?.innerText),
  };
})()`)).value;
await shot('v11-02-stacks');

// 2. Страница тайтла: сезоны + статистика Shikimori
await c.ev(`location.hash = '#/anime/16498'`); await sleep(6000);
out.anime = (await c.ev(`(() => ({
  hash: location.hash,
  h2: [...document.querySelectorAll('h2')].map((h) => h.innerText.replace(/\\s+/g, ' ').slice(0, 80)),
  seasons: document.querySelectorAll('.season').length,
  shikiStats: !!document.querySelector('.shiki-stats'),
  scoreBars: document.querySelectorAll('.score-bars > *').length,
  text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 120),
}))()`)).value;
await shot('v11-03-anime');

// 3. Настройки: кастомизация, импорт, 18+, adblock
await c.ev(`location.hash = '#/settings'`); await sleep(2500);
out.settings = (await c.ev(`(() => ({
  boxes: [...document.querySelectorAll('.box h3')].map((h) => h.innerText),
  optControls: document.querySelectorAll('[data-opt]').length,
  themeSelect: !!document.querySelector('[data-opt="theme"]'),
  importMal: !!document.querySelector('[data-act="import-mal"]'),
  anilist: !!document.querySelector('#anilist-nick'),
  showAdult: !!document.querySelector('#show-adult'),
  adblock: !!document.querySelector('#adblock'),
}))()`)).value;
// переключаем тему
out.themeChange = (await c.ev(`(async () => {
  const sel = document.querySelector('[data-opt="theme"]');
  const before = document.documentElement.getAttribute('data-theme');
  const values = [...sel.options].map((o) => o.value);
  const target = values.find((v) => v !== sel.value) || values[0];
  sel.value = target;
  sel.dispatchEvent(new Event('change'));
  await new Promise((r) => setTimeout(r, 600));
  return { values, target, before, after: document.documentElement.getAttribute('data-theme') };
})()`)).value;
await shot('v11-04-settings');
// вернуть тему
await c.ev(`(async () => { const sel = document.querySelector('[data-opt="theme"]'); if (sel) { sel.value = 'dark'; sel.dispatchEvent(new Event('change')); } })()`);
await sleep(500);

// 4. «Продолжить просмотр»: очистка
await c.ev(`location.hash = '#/catalog'`); await sleep(3000);
out.continueBefore = (await c.ev(`(() => ({ cards: document.querySelectorAll('.continue-card').length, clearBtn: !!document.querySelector('[data-continue-clear]'), hideBtns: document.querySelectorAll('.continue-hide').length }))()`)).value;
await c.ev(`document.querySelector('.continue-hide')?.click()`); await sleep(1200);
out.continueAfterHide = (await c.ev(`(async () => ({ cards: document.querySelectorAll('.continue-card').length, online: Object.keys((await window.api.loadData()).online || {}).length }))()`)).value;

// 5. 18+ поиск (регресс)
await c.ev(`location.hash = '#/settings'`); await sleep(1500);
await c.ev(`document.querySelector('#show-adult')?.click()`); await sleep(800);
await c.ev(`location.hash = '#/catalog'`); await sleep(2500);
await c.ev(`(() => { const q = document.querySelector('#q'); q.value = 'Маг-целитель'; q.dispatchEvent(new Event('input')); })()`);
await sleep(5000);
out.adult = (await c.ev(`(() => ({ found: !!document.querySelector('.card[data-open="40750"]'), cards: document.querySelectorAll('.card').length }))()`)).value;

// 6. История: удаление (регресс)
await c.ev(`location.hash = '#/history'`); await sleep(1500);
out.history = (await c.ev(`(async () => ({
  items: document.querySelectorAll('.history-item').length,
  delBtns: document.querySelectorAll('.history-del').length,
  clearBtn: !!document.querySelector('[data-act="clear-history"]'),
  dataLen: ((await window.api.loadData()).history || []).length,
}))()`)).value;

// 7. Kodik: плеер, 18+ (регресс)
await c.ev(`location.hash = '#/watch/40750'`);
let watch = null;
for (let i = 0; i < 10; i++) { await sleep(2500); watch = (await c.ev(`(() => ({ tr: document.querySelectorAll('#translations .file').length, eps: document.querySelectorAll('#episodes .ep').length, iframe: document.querySelector('#kodik')?.src?.slice(0, 60) || '', err: document.querySelector('.empty')?.innerText?.slice(0, 80) || '' }))()`)).value; if (watch && (watch.tr || watch.err)) break; }
out.watch = watch;
await shot('v11-05-watch');

// 8. Окно плеера через обёртку (регресс)
await c.ev(`document.querySelector('[data-act="external"]')?.click()`); await sleep(6000);
const list2 = await targets();
const player = list2.find((t) => t.type === 'page' && /player-window\.html/.test(t.url));
out.playerWindow = player ? { opened: true } : { opened: false };
if (player) {
  const p = await connect(player.webSocketDebuggerUrl);
  await p.send('Runtime.enable'); await sleep(3000);
  out.playerWindow.iframe = (await p.ev(`(() => ({ iframes: document.querySelectorAll('iframe').length, src: document.querySelector('iframe')?.src?.slice(0, 70) || '' }))()`)).value;
  p.ws.close();
}

// 9. adblock stats (регресс)
out.adblock = (await c.ev('window.api.adblockStats()')).value;
out.errors = c.errors;
await c.ev(`window.api.saveData(${JSON.stringify(original)})`);
await sleep(800);
c.ws.close();
console.log(JSON.stringify(out, null, 2));
process.exit(0);
