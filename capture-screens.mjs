// Скриншоты экранов прототипа для тепловой карты — ровно рамка макета, после анимаций.
// Без зависимостей: Node 22+ (встроенный WebSocket) + установленный Chrome/Chromium.
//
//   node capture-screens.mjs <базовый URL> <папка> <селектор рамки> имя=query [имя=query …]
//   node capture-screens.mjs https://site/test/b/ screens/B-swipe .phone-frame \
//        map= "multipin=?select=multipin" "map+sheet_full=?select=multipin&sheet=full"
//
// Имя = имя экрана из setScreen → файл <папка>/<имя>.png. Для каждого экрана печатает
// центры элементов с data-heat (и кнопок) в долях рамки — пригодится, если надо
// восстановить карту по событиям. CHROME=/путь/к/chrome — если Chrome не в стандартном месте.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const [base, outDir, rootSel, ...shots] = process.argv.slice(2);
if (!shots.length) {
  console.error('usage: node capture-screens.mjs <url> <out-dir> <root-selector> name=query …');
  process.exit(1);
}
const CHROME = process.env.CHROME || {
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
}[process.platform] || 'google-chrome';
const WAIT_MS = Number(process.env.WAIT_MS || 4000); // реальное время на анимации
const PORT = 9300 + Math.floor(Math.random() * 500);

mkdirSync(outDir, { recursive: true });
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${tmpdir()}/capture-screens-${PORT}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws;
for (let i = 0; i < 60 && !ws; i++) {
  try {
    const page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page');
    if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
  } catch { /* Chrome ещё стартует */ }
  await sleep(250);
}
if (!ws) { console.error('Chrome не запустился — укажи путь в CHROME=…'); chrome.kill(); process.exit(1); }
if (ws.readyState !== WebSocket.OPEN) await new Promise((r) => (ws.onopen = r)); // мог открыться во время sleep
let seq = 0; const pending = {};
ws.onmessage = (m) => { const d = JSON.parse(m.data); pending[d.id]?.(d); delete pending[d.id]; };
const send = (method, params = {}) => new Promise((r) => { pending[++seq] = r; ws.send(JSON.stringify({ id: seq, method, params })); });

// мобильная ширина: рамка макета рисуется без масштабирования
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

for (const shot of shots) {
  const eq = shot.indexOf('=');
  const name = shot.slice(0, eq), query = shot.slice(eq + 1);
  const url = new URL(base);
  new URLSearchParams(query.replace(/^\?/, '')).forEach((v, k) => url.searchParams.set(k, v));
  url.searchParams.delete('log'); // оверлей событий не должен попасть на скриншот
  await send('Page.navigate', { url: String(url) });
  await sleep(WAIT_MS);
  const { result } = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
    const root = document.querySelector(${JSON.stringify(rootSel)});
    if (!root) return null;
    const R = root.getBoundingClientRect();
    const items = [...root.querySelectorAll('[data-heat], button, [role=button]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { heat: el.getAttribute('data-heat') || '', text: (el.textContent || '').trim().slice(0, 24),
        x: +((r.left + r.width / 2 - R.left) / R.width).toFixed(3), y: +((r.top + r.height / 2 - R.top) / R.height).toFixed(3), w: Math.round(r.width) };
    }).filter((i) => i.w > 0 && i.x >= 0 && i.x <= 1 && i.y >= 0 && i.y <= 1);
    return { rect: { x: R.left, y: R.top, width: R.width, height: R.height }, items };
  })()` });
  const geo = result?.result?.value;
  if (!geo) { console.error(`${name}: рамка ${rootSel} не найдена`); continue; }
  const shotRes = await send('Page.captureScreenshot', { format: 'png', clip: { ...geo.rect, scale: 1 } });
  writeFileSync(`${outDir}/${name}.png`, Buffer.from(shotRes.result.data, 'base64'));
  console.log(`${outDir}/${name}.png`);
  geo.items.forEach((i) => console.log(`  ${i.heat || i.text || '(кнопка)'}  x=${i.x} y=${i.y}`));
}
chrome.kill();
process.exit(0);
