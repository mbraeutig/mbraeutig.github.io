// Zustand, Moduswechsel, Atem-Sequenz, Verdrahtung.

import { dailyGarden, practiceGarden, sizeFor, dayKey } from './generator.js';
import { isValidSolution, freeCount } from './rules.js';
import { drawGarden, palette } from './render.js';
import { bindInput } from './input.js';
import { openBook } from './book.js';

const $ = id => document.getElementById(id);
const canvas = $('garden');
const ctx = canvas.getContext('2d');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const darkMode = matchMedia('(prefers-color-scheme: dark)');
const book = openBook();

const RING_MS = 1400;
const BREATH_MS = 5500;
const THUMB = 68;

// already: Tagesgarten kam gelöst aus dem Buch („Heute schon geharkt.“).
const state = { mode: 'day', date: new Date(), garden: null, path: [], solved: false, rings: 0, already: false };
let size = 0, ringFrame = 0, timers = [];

function draw() {
  if (!size) return;
  drawGarden(ctx, state.garden, state.path, size, { rings: state.rings, done: state.solved });
}

// Bitmap in exakten Geräte-Pixeln, damit der Garten auf HiDPI scharf bleibt.
// Die Geräte-Pixel-Box meldet auch einen DPR-Wechsel bei gleicher CSS-Größe.
// In der DevTools-Geräteemulation meldet sie CSS-Pixel, dann gilt Breite × DPR.
function resize([entry]) {
  const w = entry.contentRect.width;
  if (!w) return;
  const guess = Math.round(w * devicePixelRatio);
  const exact = entry.devicePixelContentBoxSize?.[0].inlineSize;
  const px = exact && Math.abs(exact - guess) <= 1 ? exact : guess;
  size = w;
  canvas.width = px;
  canvas.height = px;
  draw();
}

function setSub() {
  const n = state.garden.n;
  const date = state.date.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' });
  $('sub').textContent = state.mode === 'day'
    ? `Tagesgarten · ${date} · ${n} × ${n}`
    : `Übungsgarten · ${n} × ${n}`;
}

function setStatus(hint) {
  const el = $('status');
  if (hint) el.textContent = hint;
  else if (state.already) el.innerHTML = '<b>Heute schon geharkt.</b> Morgen liegt ein neuer Garten da.';
  else if (state.solved) el.innerHTML = '<b>Der Garten ist geharkt.</b>';
  else if (!state.path.length) el.textContent = 'Beginne am Kreis und ziehe die Harke durch jedes Kiesfeld.';
  else el.innerHTML = `<b>${state.path.length}</b> von ${freeCount(state.garden)} Feldern geharkt`;
}

// ---------- Abschluss (KONZEPT.md §9) ----------

function later(fn, ms) {
  timers.push(setTimeout(fn, ms));
}

// Bricht Ringe und Atem ab. Danach läuft kein Timer und kein Frame mehr.
function stopFinale() {
  cancelAnimationFrame(ringFrame);
  timers.forEach(clearTimeout);
  timers = [];
  $('breath').hidden = true;
}

function showRings() {
  if (reduceMotion.matches) { state.rings = 1; return; }
  const t0 = performance.now();
  const tick = now => {
    state.rings = Math.min(1, (now - t0) / RING_MS);
    draw();
    if (state.rings < 1) ringFrame = requestAnimationFrame(tick);
  };
  ringFrame = requestAnimationFrame(tick);
}

// Drei Atemzüge à 11 s, Text wechselt alle 5,5 s, danach „Der Garten ruht.“
// #breath ist vorher immer verborgen; das Einblenden startet die CSS-Animation neu.
function startBreath() {
  const text = $('breath-text');
  text.textContent = 'Einatmen';
  $('breath').hidden = false;
  for (let i = 1; i < 6; i++) later(() => { text.textContent = i % 2 ? 'Ausatmen' : 'Einatmen'; }, i * BREATH_MS);
  later(() => { text.textContent = 'Der Garten ruht.'; }, 6 * BREATH_MS);
}

function finish() {
  if (state.mode === 'day') {
    book.save(state.garden, state.path);
    renderBook();
  }
  showRings();
  later(startBreath, reduceMotion.matches ? 0 : RING_MS);
}

// ---------- Linie ----------

// Nach dem Lösen ist die Linie gesperrt, bis clearGarden() sie freigibt (KONZEPT.md §6.3).
function setPath(path) {
  if (state.solved) return;
  state.path = path;
  if (isValidSolution(state.garden, path)) {
    state.solved = true;
    finish();
  } else if (state.mode === 'day') {
    book.saveProgress(state.garden, path);
  }
  draw();
  setStatus();
}

function clearGarden() {
  stopFinale();
  state.path = [];
  state.solved = false;
  state.rings = 0;
  state.already = false;
}

function reset() {
  clearGarden();
  if (state.mode === 'day') book.saveProgress(state.garden, []);
  draw();
  setStatus();
}

// Tagesgarten: gelöst aus dem Buch, sonst frisch. Ein angefangener Spielstand von heute
// hat Vorrang, auch nach „Neu harken“ an einem schon gelösten Tag.
function load(mode) {
  clearGarden();
  const day = mode === 'day';
  state.mode = mode;
  state.date = new Date();
  if (day) {
    const done = book.entry(dayKey(state.date));
    state.garden = done ? done.garden : dailyGarden(state.date);
    state.path = book.progress(state.garden);
    if (done && !state.path.length) Object.assign(state, { path: done.path, solved: true, rings: 1, already: true });
  } else {
    state.garden = practiceGarden(sizeFor(state.date));
  }
  $('practice').hidden = !day;
  $('another').hidden = day;
  $('back').hidden = day;
  setSub();
  draw();
  setStatus();
}

// ---------- Gartenbuch ----------

function renderBook() {
  const box = $('book');
  const entries = book.entries();
  box.replaceChildren();
  if (!entries.length) {
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = 'Noch leer. Der erste geharkte Tagesgarten erscheint hier.';
    box.append(p);
    return;
  }
  const px = Math.round(THUMB * (devicePixelRatio || 1)), col = palette();
  for (const { key, garden, path } of entries) {
    const [y, m, d] = key.split('-');
    const c = document.createElement('canvas');
    c.width = px;
    c.height = px;
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', `Garten vom ${d}.${m}.${y}`);
    drawGarden(c.getContext('2d'), garden, path, THUMB, { rings: 1, done: true, detail: false, col });
    const label = document.createElement('span');
    label.textContent = `${d}.${m}.`;
    const item = document.createElement('div');
    item.className = 'thumb';
    item.append(c, label);
    box.append(item);
  }
}

// ---------- Verdrahtung ----------

const input = bindInput(canvas, {
  state: () => ({ garden: state.garden, path: state.path }),
  setPath,
  hint: () => setStatus('Die Harke setzt am Kreis an.'),
  reset,
});

$('reset').addEventListener('click', reset);
$('practice').addEventListener('click', () => load('practice'));
$('another').addEventListener('click', () => load('practice'));
$('back').addEventListener('click', () => load('day'));

const observer = new ResizeObserver(resize);
try { observer.observe(canvas, { box: 'device-pixel-content-box' }); } catch { observer.observe(canvas); }
darkMode.addEventListener('change', () => { draw(); renderBook(); });

// Tageswechsel (KONZEPT.md §10): Eine PWA bleibt tagelang offen. Kommt sie zurück
// und das Datum passt nicht mehr zum Tagesgarten, liegt der neue Garten da.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || state.mode !== 'day' || input.dragging()) return;
  if (dayKey(new Date()) !== state.garden.key) load('day');
});

try { navigator.storage?.persist?.()?.catch(() => {}); } catch { /* Ablehnung ignorieren */ }
navigator.serviceWorker?.register('sw.js').catch(() => {});

load('day');
renderBook();
