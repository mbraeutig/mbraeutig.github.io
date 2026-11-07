// Canvas-Zeichnung des Gartens (KONZEPT.md §7.1). Farben kommen bei jedem Zeichnen
// aus den CSS-Variablen, damit ein Theme-Wechsel nur neu zeichnen muss.

import { rngFromSeed } from './rng.js';

const TAU = Math.PI * 2;
const speckCache = new WeakMap();
const shapeCache = new Map();

export function palette() {
  const style = getComputedStyle(document.documentElement);
  const css = name => style.getPropertyValue(name).trim();
  return {
    gravel: css('--gravel'), groove: css('--groove'), ridge: css('--ridge'), dot: css('--dot'),
    stone: css('--stone'), stoneHi: css('--stone-hi'), moss: css('--moss'), accent: css('--accent'),
  };
}

// Sprenkel und Steinformen hängen nur am Garten selbst, damit sie stabil bleiben,
// auch für gespeicherte Gärten aus dem Buch. Die kleinen Steinformen werden je Saat
// gemerkt (Buch-Gärten sind bei jedem Zeichnen neue Objekte), die großen Sprenkel
// und der vorgezeichnete Grund nur je Garten-Objekt und nur für das Spielfeld.
const decorSeed = g => `deko-${g.n}-${g.start}-${g.stones.join(',')}`;

function makeDecor(g, withSpeck) {
  const rng = rngFromSeed(decorSeed(g));
  const speck = [];
  for (let i = 0; i < g.n * g.n * 30; i++) {
    const v = [rng(), rng(), rng() * 0.9 + 0.3, rng()];
    if (withSpeck) speck.push(v);
  }
  const shapes = new Map();
  for (const s of g.stones) {
    const rot = rng() * TAU, pts = [];
    for (let i = 0; i < 9; i++) pts.push([rot + (i / 9) * TAU, 0.3 + rng() * 0.12]);
    shapes.set(s, pts);
  }
  shapeCache.set(decorSeed(g), shapes);
  return { speck, shapes };
}

function shapesOf(g) {
  return shapeCache.get(decorSeed(g)) ?? makeDecor(g, false).shapes;
}

function decor(g) {
  let d = speckCache.get(g);
  if (d) return d;
  d = { ...makeDecor(g, true), bg: null, bgKey: '' };
  speckCache.set(g, d);
  return d;
}

// Kiesgrund mit Sprenkel und Rasterpunkten ändert sich nur mit Garten, Größe und Theme.
// Er wird einmal in Geräte-Pixeln vorgezeichnet und danach nur noch kopiert.
function background(g, size, px, col) {
  const d = decor(g);
  const key = [size, px, col.gravel, col.groove, col.ridge, col.dot].join('|');
  if (d.bgKey === key) return d.bg;
  const bg = d.bg ?? document.createElement('canvas');
  bg.width = px;
  bg.height = px;
  const c = bg.getContext('2d'), cl = size / g.n;
  c.setTransform(px / size, 0, 0, px / size, 0, 0);
  c.fillStyle = col.gravel;
  c.fillRect(0, 0, size, size);
  for (const [x, y, r, a] of d.speck) {
    c.globalAlpha = 0.2 + a * 0.3;
    c.fillStyle = a > 0.5 ? col.ridge : col.groove;
    c.beginPath();
    c.arc(x * size, y * size, (r * size) / 380, 0, TAU);
    c.fill();
  }
  c.globalAlpha = 1;
  c.fillStyle = col.dot;
  for (let r = 1; r < g.n; r++) {
    for (let q = 1; q < g.n; q++) {
      c.beginPath();
      c.arc(q * cl, r * cl, 1.3, 0, TAU);
      c.fill();
    }
  }
  d.bg = bg;
  d.bgKey = key;
  return bg;
}

// Unregelmäßiger Stein: Punkte über Mittelpunkt-Quadratkurven glatt verbunden.
function blob(c, x, y, pts, scale) {
  const q = pts.map(([a, r]) => [x + Math.cos(a) * r * scale, y + Math.sin(a) * r * scale]);
  const mid = (u, v) => [(u[0] + v[0]) / 2, (u[1] + v[1]) / 2];
  const m0 = mid(q[q.length - 1], q[0]);
  c.beginPath();
  c.moveTo(m0[0], m0[1]);
  for (let i = 0; i < q.length; i++) {
    const m = mid(q[i], q[(i + 1) % q.length]);
    c.quadraticCurveTo(q[i][0], q[i][1], m[0], m[1]);
  }
  c.closePath();
}

// rings: 0…1 Einblendung der Ringe um die Steine. done: Kopf nicht zeichnen.
// detail: false für Vorschaubilder im Buch – glatter Kies, zwei Linien, kein Start.
// col: vorab gelesene Farben, damit viele Vorschaubilder das CSS nur einmal lesen.
export function drawGarden(c, g, path, size, { rings = 0, done = false, detail = true, col = palette() } = {}) {
  const shapes = detail ? decor(g).shapes : shapesOf(g), cl = size / g.n;
  const ctr = i => [((i % g.n) + 0.5) * cl, (Math.floor(i / g.n) + 0.5) * cl];

  // Gezeichnet wird in CSS-Pixeln (size), die Bitmap hat Geräte-Pixel.
  const scale = c.canvas.width / size;
  c.setTransform(scale, 0, 0, scale, 0, 0);
  c.globalAlpha = 1;
  if (detail) c.drawImage(background(g, size, c.canvas.width, col), 0, 0, size, size);
  else {
    c.fillStyle = col.gravel;
    c.fillRect(0, 0, size, size);
  }

  // Harkenlinie: fünf Polylinien, abwechselnd Rille und Grat → drei Rillen.
  if (path.length) {
    const pts = path.map(ctr);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    (detail ? [0.8, 0.64, 0.48, 0.32, 0.16] : [0.62, 0.3]).forEach((w, k) => {
      c.strokeStyle = k % 2 ? col.ridge : col.groove;
      c.lineWidth = w * cl;
      c.beginPath();
      c.moveTo(pts[0][0], pts[0][1]);
      if (pts.length === 1) c.lineTo(pts[0][0] + 0.01, pts[0][1]);
      for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
      c.stroke();
    });
  }

  if (rings > 0) {
    c.globalAlpha = Math.min(1, rings) * 0.7;
    c.strokeStyle = col.groove;
    c.lineWidth = Math.max(1, cl * 0.055);
    for (const s of g.stones) {
      const [x, y] = ctr(s);
      for (let k = 1; k <= 3; k++) {
        c.beginPath();
        c.arc(x, y, cl * (0.4 + k * 0.15), 0, TAU);
        c.stroke();
      }
    }
    c.globalAlpha = 1;
  }

  for (const s of g.stones) {
    const [x, y] = ctr(s), pts = shapes.get(s);
    c.globalAlpha = 0.6;
    c.fillStyle = col.moss;
    blob(c, x, y, pts, cl * 1.2);
    c.fill();
    c.globalAlpha = 0.22;
    c.fillStyle = '#000';
    blob(c, x + cl * 0.03, y + cl * 0.05, pts, cl);
    c.fill();
    c.globalAlpha = 1;
    c.fillStyle = col.stone;
    blob(c, x, y, pts, cl);
    c.fill();
    if (!detail) continue;
    c.globalAlpha = 0.35;
    c.fillStyle = col.stoneHi;
    c.beginPath();
    c.ellipse(x - cl * 0.08, y - cl * 0.1, cl * 0.12, cl * 0.06, -0.5, 0, TAU);
    c.fill();
    c.globalAlpha = 1;
  }

  if (!detail) return;
  const [sx, sy] = ctr(g.start);
  c.strokeStyle = col.accent;
  c.lineWidth = 2;
  c.beginPath();
  c.arc(sx, sy, cl * 0.2, 0, TAU);
  c.stroke();
  if (path.length && !done) {
    const [hx, hy] = ctr(path[path.length - 1]);
    c.fillStyle = col.accent;
    c.beginPath();
    c.arc(hx, hy, cl * 0.1, 0, TAU);
    c.fill();
  }
}
