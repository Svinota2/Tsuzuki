// ============================================================
//  Управление пультом (D-pad) для Android TV.
//  Стрелки переносят фокус на ближайший элемент в этом направлении,
//  OK (Enter) — нажать, «Меню» — как правый клик (например, отметить
//  все серии до этой), «Назад» обрабатывает сама Android-часть.
//
//  Если какой-то элемент не выбирается пультом — добавь его селектор
//  в FOCUSABLE.
// ============================================================
(function () {
  'use strict';

  var FOCUSABLE = [
    'a[href]', 'button:not([disabled])', 'input:not([type="hidden"])', 'select', 'textarea',
    '[data-open]', '[data-ep]', '[data-goto]', '[data-news-open]', '[data-i]',
    '.tab', '.season', '.rel', '.history-item', '.service', '.accent-dot', '.check-row',
  ].join(',');

  var NATIVE = /^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/;

  // Делаем «кликабельные» div-ы фокусируемыми
  function markFocusable(root) {
    (root || document).querySelectorAll(FOCUSABLE).forEach(function (el) {
      if (!NATIVE.test(el.tagName) && !el.hasAttribute('tabindex')) el.tabIndex = 0;
    });
    // кнопки внутри карточек не нужны как отдельные цели — до них дойдём через карточку
    (root || document).querySelectorAll('.card-plus, .continue-hide, .news-dismiss').forEach(function (el) {
      el.tabIndex = -1;
    });
  }

  // Разделы часто перерисовываются целиком (например, после отметки серии),
  // и фокус с пульта терялся бы. Запоминаем, на чём он стоял, и возвращаем.
  var KEY_ATTRS = ['id', 'data-ep', 'data-open', 'data-act', 'data-goto', 'data-i', 'data-opt', 'data-accent', 'data-service', 'data-web', 'data-news-open', 'href'];
  var lastKey = null;
  function keyOf(el) {
    for (var i = 0; i < KEY_ATTRS.length; i++) {
      var v = el.getAttribute(KEY_ATTRS[i]);
      if (v) return KEY_ATTRS[i] === 'id' ? '#' + CSS.escape(v) : '[' + KEY_ATTRS[i] + '="' + CSS.escape(v) + '"]';
    }
    return null;
  }
  document.addEventListener('focusin', function (e) { lastKey = keyOf(e.target); });
  window.addEventListener('hashchange', function () { lastKey = null; });

  var scheduled = false;
  new MutationObserver(function () {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      markFocusable();
      if (document.activeElement === document.body && lastKey) {
        var el = document.querySelector(lastKey);
        if (el && visible(el)) el.focus({ preventScroll: true });
      }
    });
  }).observe(document.body, { childList: true, subtree: true });

  function visible(el) {
    if (el.tabIndex < 0 && !NATIVE.test(el.tagName)) return false;
    if (el.closest('[hidden]')) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    var cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }

  function candidates() {
    return Array.prototype.filter.call(document.querySelectorAll(FOCUSABLE), function (el) {
      // вложенные цели (кнопка внутри карточки) пропускаем
      return visible(el) && !(el.parentElement && el.parentElement.closest('[data-open][tabindex]') && el.tabIndex < 0);
    });
  }

  // Ищем ближайший элемент в направлении dir
  function findNext(from, dir) {
    var a = from.getBoundingClientRect();
    var ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    var best = null, bestScore = Infinity;
    candidates().forEach(function (el) {
      if (el === from || el.contains(from) || from.contains(el)) return;
      var b = el.getBoundingClientRect();
      var bx = b.left + b.width / 2, by = b.top + b.height / 2;
      var main, cross;
      if (dir === 'right') { if (b.left < a.right - 4 && bx <= ax + 4) return; main = Math.max(0, b.left - a.right); cross = Math.abs(by - ay); }
      if (dir === 'left')  { if (b.right > a.left + 4 && bx >= ax - 4) return; main = Math.max(0, a.left - b.right); cross = Math.abs(by - ay); }
      if (dir === 'down')  { if (b.top < a.bottom - 4 && by <= ay + 4) return; main = Math.max(0, b.top - a.bottom); cross = Math.abs(bx - ax); }
      if (dir === 'up')    { if (b.bottom > a.top + 4 && by >= ay - 4) return; main = Math.max(0, a.top - b.bottom); cross = Math.abs(bx - ax); }
      // по главной оси важнее близость, но и сильный сдвиг вбок штрафуем
      var score = main + cross * 2.2;
      if (score < bestScore) { bestScore = score; best = el; }
    });
    return best;
  }

  function focusEl(el) {
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    // горизонтальные ленты (сезоны) прокручиваем, чтобы элемент был виден целиком
  }

  function firstInContent() {
    var view = document.getElementById('view');
    var list = candidates().filter(function (el) { return view.contains(el); });
    // пропускаем «Назад» и поле поиска, если есть карточки — сразу к делу
    var card = list.find(function (el) { return el.matches('.card, .continue-card'); });
    return card || list[0] || null;
  }

  var longPressFired = false;
  window.__tvMenu = function () {
    var el = document.activeElement;
    if (el && el !== document.body) el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  };

  var DIRS = { ArrowRight: 'right', ArrowLeft: 'left', ArrowUp: 'up', ArrowDown: 'down' };

  document.addEventListener('keydown', function (e) {
    var el = document.activeElement;
    var dir = DIRS[e.key];

    // Пульт: кнопка «Меню» → контекстное меню (правый клик)
    if (e.key === 'ContextMenu' || e.keyCode === 82 /* KEYCODE_MENU в WebView */) {
      if (el && el !== document.body) {
        el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        e.preventDefault();
      }
      return;
    }

    if (e.key === 'Enter') {
      if (!el || el === document.body) return;
      // Долгое нажатие OK = «Меню» (правый клик). Повторы не нажимают кнопку ещё раз.
      if (e.repeat) {
        e.preventDefault();
        if (!longPressFired) {
          longPressFired = true;
          el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        }
        return;
      }
      longPressFired = false;
      if (el.matches('input[type="checkbox"]')) { el.click(); e.preventDefault(); return; }
      if (el.matches('.check-row')) { var cb = el.querySelector('input'); if (cb) cb.click(); e.preventDefault(); return; }
      if (!NATIVE.test(el.tagName)) { el.click(); e.preventDefault(); }
      return;
    }

    if (!dir) return;

    // В текстовом поле влево/вправо двигают курсор, в ползунке — меняют значение
    if (el && el.matches('input[type="text"], input[type="search"], input:not([type]), textarea') && (dir === 'left' || dir === 'right')) {
      var atStart = el.selectionStart === 0, atEnd = el.selectionEnd === el.value.length;
      if (!(dir === 'left' && atStart) && !(dir === 'right' && atEnd)) return;
    }
    if (el && el.matches('input[type="range"]') && (dir === 'left' || dir === 'right')) return;

    e.preventDefault();
    if (!el || el === document.body || !visible(el)) {
      var start = firstInContent() || document.querySelector('.nav a');
      if (start) focusEl(start);
      return;
    }
    // В боковом меню вверх/вниз — только по пунктам меню, вправо — в раздел
    var inSidebar = el.closest('.sidebar');
    if (inSidebar && (dir === 'up' || dir === 'down')) {
      var items = Array.prototype.filter.call(inSidebar.querySelectorAll('a[href]'), visible);
      var i = items.indexOf(el) + (dir === 'down' ? 1 : -1);
      if (items[i]) focusEl(items[i]);
      return;
    }
    if (inSidebar && dir === 'right') {
      var first = firstInContent();
      if (first) focusEl(first);
      return;
    }
    var next = findNext(el, dir);
    if (next) focusEl(next);
    else if (dir === 'up') document.getElementById('view').scrollBy({ top: -300, behavior: 'smooth' });
    else if (dir === 'down') document.getElementById('view').scrollBy({ top: 300, behavior: 'smooth' });
  }, true);

  // После перехода в другой раздел ставим фокус на первый элемент раздела
  // (ждём, пока раздел дорисуется — страница аниме грузится в два этапа)
  window.addEventListener('hashchange', function () {
    var tries = 0;
    (function wait() {
      var a = document.activeElement;
      var inContent = a && a !== document.body && document.body.contains(a) && visible(a) && !a.closest('.sidebar');
      if (inContent) return;
      var view = document.getElementById('view');
      var start = view.querySelector('.spinner') ? null : firstInContent();
      if (start) { markFocusable(); focusEl(start); return; }
      if (++tries < 25) setTimeout(wait, 300);
    })();
  });

  // Первый запуск: ждём, пока каталог загрузится, и ставим фокус на первую карточку
  markFocusable();
  var tries = 0;
  (function waitFirst() {
    var a = document.activeElement;
    // поле поиска в каталоге стоит с autofocus — на ТВ начинаем с карточек
    if (a && a !== document.body && a.id !== 'q') return; // пользователь уже что-то выбрал
    var card = document.querySelector('#view .card, #view .continue-card');
    if (card || ++tries > 20) {
      var start = card || firstInContent() || document.querySelector('.nav a');
      if (start) { markFocusable(); focusEl(start); }
      return;
    }
    setTimeout(waitFirst, 500);
  })();
})();
