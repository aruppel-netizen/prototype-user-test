/*
 * Логгер юзтеста (скилл prototype-user-test), вариант для десктопной страницы без сборки.
 * window.TL: log(type, data), setScreen(name), finish(), summary(), task, sessionId.
 *
 * Отправка — только если в URL есть ?r=<когорта> (иначе прототип молчит, проверки не пачкают таблицу).
 * Группа в таблице: «T1·<r>» / «T2·<r>» — номер задания из ?task=1|2.
 * ?log=1 — оверлей последних событий в углу (для проверки сборки).
 *
 * Тепловая карта (десктоп): каждый клик → событие tap, data «экран|x|y|элемент».
 *   x — доля ширины рамки макета 1440 px (центрирована; на узких экранах — доля ширины окна);
 *   y — для страницы: px от верха страницы / PAGE_H; для модалок — доля высоты окна.
 *   Скриншоты для вьюера: страница — 1440 × PAGE_H от верха, модалка — окно 1440 × 900.
 *   Клик по шапке (.topbar), даже прилипшей при скролле, считается от её верха — как в начале страницы.
 */
(function () {
  var ENDPOINT = 'PASTE_APPS_SCRIPT_URL_HERE'; // веб-приложение Apps Script (…/exec)
  var FRAME_W = 1440, PAGE_H = 3000;

  var qs = new URLSearchParams(location.search);
  var COHORT = qs.get('r') || '';
  var TASK = qs.get('task') || '';
  var SEND = /^https:\/\//.test(ENDPOINT) && COHORT !== '';
  var startedAt = Date.now();
  var sessionId = 's' + startedAt.toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  var group = (TASK ? 'T' + TASK : 'free') + (COHORT && COHORT !== '1' ? '·' + COHORT : '');
  var events = [], queue = [], screen = '', finishedAt = null;

  function flush(beacon) {
    if (!SEND || !queue.length) return;
    var batch = queue.splice(0, queue.length);
    var body = JSON.stringify({ sessionId: sessionId, group: group, startedAt: startedAt, events: batch });
    try {
      if (beacon && navigator.sendBeacon) { navigator.sendBeacon(ENDPOINT, body); return; }
      fetch(ENDPOINT, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: body })
        .catch(function () { queue.unshift.apply(queue, batch); });
    } catch (e) { queue.unshift.apply(queue, batch); }
  }
  if (SEND) {
    setInterval(flush, 4000);
    addEventListener('pagehide', function () { flush(true); });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(true); });
  }

  function log(type, data) {
    var ev = { t: Date.now() - startedAt, type: type, data: data == null ? '' : String(data) };
    events.push(ev); queue.push(ev);
    try { localStorage.setItem('testlog-' + sessionId, JSON.stringify(events)); } catch (e) { /* приватный режим */ }
    overlay();
  }
  function setScreen(name) { if (name && name !== screen) { screen = name; log('screen_view', name); } }

  // ── Экран по тому, что видно: модалка → её имя; открытый поиск → search; иначе — то, что задал код (results, detail…) ──
  var pageScreen = 'results';
  function currentScreen() {
    var dlg = document.querySelector('[role="dialog"]');
    if (dlg) return dlg.closest('.af-modal') || dlg.querySelector('.af') ? 'allfilters' : 'geo';
    if (pageScreen === 'results' && document.body.classList.contains('search-active')) return 'results+search';
    return pageScreen;
  }

  // ── Клики для тепловой карты ──
  var down = null;
  addEventListener('pointerdown', function (e) { if (e.isPrimary) down = { x: e.clientX, y: e.clientY, id: e.pointerId }; }, { capture: true, passive: true });
  addEventListener('pointercancel', function () { down = null; }, { capture: true, passive: true });
  addEventListener('pointerup', function (e) {
    if (!down || e.pointerId !== down.id) return;
    var moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); down = null;
    if (moved > 10) return;
    var vw = document.documentElement.clientWidth, fw = Math.min(vw, FRAME_W), left = (vw - fw) / 2;
    var x = (e.clientX - left) / fw, scr = currentScreen(), y;
    var target = e.target && e.target.closest ? e.target : null;
    if (scr === 'allfilters' || scr === 'geo') y = e.clientY / window.innerHeight;
    else {
      var bar = target && target.closest('.topbar');
      var top = bar ? bar.getBoundingClientRect().top : -window.scrollY;
      y = (e.clientY - top) / PAGE_H;
    }
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    setScreen(scr);
    log('tap', scr + '|' + x.toFixed(3) + '|' + y.toFixed(3) + '|' + label(target));
  }, { capture: true, passive: true });

  // Подпись элемента: data-heat, иначе канал — строка поиска (и её подсказки/чипсы) или конкретный фильтр
  function label(t) {
    if (!t) return '';
    var el = t.closest('[data-heat]');
    if (el) return el.getAttribute('data-heat');
    if (t.closest('.sbox__chip')) return 'search:chip:' + t.closest('.sbox__chip').textContent.trim();
    if (t.closest('.sbox__row')) return 'search:suggest:' + (t.closest('.sbox__row').getAttribute('data-type') || '');
    if (t.closest('.sbox__clear')) return 'search:clear';
    if (t.closest('.sbox__find')) return 'search:button';
    if (t.closest('.sbox')) return t.closest('.sbox__drop, .sbox__layer') && !t.closest('input') ? 'search:panel' : 'search';
    var dlg = t.closest('[role="dialog"]');
    var btn = t.closest('button, [role="button"], a, label, input');
    var raw = btn ? (btn.getAttribute('aria-label') || btn.textContent || '') : (t.textContent || '');
    var txt = raw.trim().replace(/\s+/g, ' ');
    txt = btn ? txt.slice(0, 30) : txt.length <= 30 ? txt : ''; // без кнопки — только короткий текст самого элемента (вкладка, станция)
    if (dlg) return txt ? 'modal:' + txt : 'modal';
    if (t.closest('.filters')) return 'filter:' + txt;
    if (t.closest('.rhead__rec-list')) return 'recommend:' + txt;
    return txt ? 'ui:' + txt : '';
  }
  function fmt(ms) { var s = Math.round(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function finish(detail) {
    if (finishedAt !== null) return;
    finishedAt = Date.now();
    log('test_finish', fmt(finishedAt - startedAt) + (detail ? '|' + detail : ''));
    flush();
  }
  function summary() {
    var c = {}; events.forEach(function (e) { c[e.type] = (c[e.type] || 0) + 1; });
    return { sessionId: sessionId, group: group, task: TASK, duration: fmt((finishedAt || Date.now()) - startedAt), counts: c };
  }

  // ── ?log=1: оверлей событий ──
  var box = null;
  function overlay() {
    if (!qs.has('log')) return;
    if (!box) {
      box = document.createElement('pre');
      box.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:99999;max-width:460px;max-height:40vh;overflow:auto;margin:0;padding:8px 10px;background:rgba(0,0,0,.82);color:#9effa8;font:11px/1.4 ui-monospace,Menlo,monospace;border-radius:8px;pointer-events:none;white-space:pre-wrap';
      document.body.appendChild(box);
    }
    box.textContent = (SEND ? 'SEND ON · ' : 'send off · ') + group + ' · ' + sessionId + '\n' +
      events.slice(-14).map(function (e) { return (e.t / 1000).toFixed(1) + 's ' + e.type + ' ' + e.data; }).join('\n');
  }

  window.TL = {
    log: log, finish: finish, summary: summary, task: TASK, sessionId: sessionId,
    setPage: function (name) { pageScreen = name; setScreen(currentScreen()); },
    PAGE_H: PAGE_H, FRAME_W: FRAME_W
  };
  log('app_start', 'task:' + (TASK || '-') + '|vw:' + window.innerWidth + '|vh:' + window.innerHeight + '|dpr:' + (window.devicePixelRatio || 1));
  setScreen('results');
})();
