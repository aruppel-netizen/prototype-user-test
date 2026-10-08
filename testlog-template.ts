/*
 * Логгер событий для юзтест-прототипа. Без зависимостей, работает в любом
 * фронтенде (React, Vue, чистый JS — для JS просто уберите типы).
 * Подключение: setLogGroup('A-gallery') при старте, logEvent('pin_tap', 'id:42')
 * на взаимодействиях, markFinished() на финише теста (см. таблицу типов в SKILL.md).
 * Серия заданий: startTask(1) / endTask(1, 'ok').
 * Тепловая карта: trackTaps(рамкаМакета) один раз при старте + setScreen('map')
 * при каждой смене экрана; смотреть — heatmap-viewer.html.
 * Адрес вебхука (Apps Script /exec) — в константу ENDPOINT ниже, либо
 * window.TESTLOG_ENDPOINT = '...' до загрузки скрипта.
 * Отправка работает ТОЛЬКО если в URL есть ?r=<когорта> — значение дописывается
 * к группе в таблице («A-gallery·35»). Без параметра прототип молчит.
 */

export interface LogEvent {
  t: number; // мс от старта сессии
  type: string;
  data?: string;
}

const startedAt = Date.now();
// Session id кодирует время старта: parseInt(id.slice(1, 9), 36) → epoch ms
const sessionId = `s${startedAt.toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
const events: LogEvent[] = [];
let finishedAt: number | null = null;
const listeners = new Set<() => void>();

// Vite: можно заменить на import.meta.env.VITE_LOG_ENDPOINT и задавать при сборке.
const ENDPOINT: string = (window as unknown as { TESTLOG_ENDPOINT?: string }).TESTLOG_ENDPOINT || '';
const COHORT = new URLSearchParams(window.location.search).get('r') || '';
const SEND_ENABLED = Boolean(ENDPOINT) && COHORT !== '';
let group = 'unknown';
const sendQueue: LogEvent[] = [];

export function setLogGroup(g: string) {
  group = g;
}

function flush(useBeacon = false) {
  if (!SEND_ENABLED || sendQueue.length === 0) return;
  const batch = sendQueue.splice(0, sendQueue.length);
  const body = JSON.stringify({
    sessionId,
    group: COHORT && COHORT !== '1' ? `${group}·${COHORT}` : group,
    startedAt,
    events: batch,
  });
  try {
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, body);
      return;
    }
    // no-cors + text/plain — обход CORS-preflight для Apps Script; ответ не читаем
    fetch(ENDPOINT, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body,
    }).catch(() => {
      sendQueue.unshift(...batch);
    });
  } catch {
    sendQueue.unshift(...batch);
  }
}

if (SEND_ENABLED) {
  setInterval(() => flush(), 4000);
  addEventListener('pagehide', () => flush(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true);
  });
}

function persist() {
  try {
    localStorage.setItem(`testlog-${sessionId}`, JSON.stringify({ startedAt, events }));
  } catch {
    /* приватный режим — живём без localStorage */
  }
}

export function logEvent(type: string, data?: string) {
  const ev = { t: Date.now() - startedAt, type, data };
  events.push(ev);
  sendQueue.push(ev);
  persist();
  listeners.forEach((fn) => fn());
}

/** Серия заданий: метрики считаются по каждому заданию отдельно. */
export function startTask(n: number) {
  logEvent('task_start', String(n));
}

export function endTask(n: number, result?: string) {
  logEvent('task_end', result ? `${n}:${result}` : String(n));
}

// ── Тепловая карта ──────────────────────────────────────────────────────────

let currentScreen = '';

/**
 * Вызывать при каждой смене того, что видно на экране (экран, раскрытая шторка,
 * модалка): 'map', 'map+sheet_full', 'detail'. Тапы привязываются к этому имени,
 * и скриншот для вьюера называется так же: screens/map+sheet_full.png.
 */
export function setScreen(name: string) {
  if (name === currentScreen) return;
  currentScreen = name;
  logEvent('screen_view', name);
}

/**
 * Пишет каждый тап для тепловой карты: событие `tap`, data `экран|x|y|элемент`.
 * x, y — доли 0..1 от рамки макета `root`, поэтому точки с разных телефонов
 * и при любом масштабе ложатся в одно место. root — элемент фиксированного
 * мобильного макета (тот, что масштабируется под экран), не body.
 * Свайпы и перетаскивания (сдвиг > 10 px) не пишутся — их покрывают именованные события.
 * Элемент — ближайший предок с data-heat="…" (пометь ключевые кнопки и карточки).
 */
export function trackTaps(root: HTMLElement) {
  let start: { x: number; y: number; id: number } | null = null;
  const onDown = (e: PointerEvent) => {
    if (e.isPrimary) start = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const onCancel = () => {
    start = null;
  };
  const onUp = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.id) return;
    const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
    start = null;
    if (moved > 10) return;
    // getBoundingClientRect учитывает transform/zoom, которым макет вписан в экран
    const r = root.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    const hit = (e.target as Element | null)?.closest?.('[data-heat]')?.getAttribute('data-heat') || '';
    logEvent('tap', `${currentScreen || 'main'}|${x.toFixed(3)}|${y.toFixed(3)}|${hit}`);
  };
  // capture — чтобы тап записался, даже если компонент гасит всплытие
  const opts = { capture: true, passive: true };
  root.addEventListener('pointerdown', onDown, opts);
  root.addEventListener('pointerup', onUp, opts);
  root.addEventListener('pointercancel', onCancel, opts);
  return () => {
    root.removeEventListener('pointerdown', onDown, opts);
    root.removeEventListener('pointerup', onUp, opts);
    root.removeEventListener('pointercancel', onCancel, opts);
  };
}

/** Вызывать на финише теста (тип финиша — по типу теста) — пишет test_finish и добивает очередь. */
export function markFinished() {
  if (finishedAt === null) {
    finishedAt = Date.now();
    logEvent('test_finish', formatDuration(finishedAt - startedAt));
    flush();
  }
}

export function onLog(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getEvents(): LogEvent[] {
  return events;
}

export function formatDuration(ms: number) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Сводка для финишного экрана — метрики попадают в запись экрана панели.
 * counts — число событий каждого типа; на экран выводи те, что важны для типа теста.
 */
export function getSummary() {
  const counts: Record<string, number> = {};
  events.forEach((e) => {
    counts[e.type] = (counts[e.type] || 0) + 1;
  });
  return {
    sessionId,
    group,
    durationMs: (finishedAt ?? Date.now()) - startedAt,
    counts,
  };
}
