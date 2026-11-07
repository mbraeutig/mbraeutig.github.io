// Zeiger- und Tastatureingabe (KONZEPT.md §6). Die Logik selbst steckt in rules.js;
// hier wird nur übersetzt, welches Feld gemeint ist.
//
// game: { state() → { garden, path }, setPath(path), hint(), reset() }
// Rückgabe: { dragging() } – ob gerade ein Zeiger zieht.

import { press, stepToward, move, back } from './rules.js';

const ARROWS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

export function bindInput(canvas, game) {
  let pointer = null; // pointerId des ziehenden Zeigers, null = kein Zug

  // clamp: beim Ziehen über den Rand hinaus zählt das Randfeld, damit ein Wisch nichts verliert.
  function cellAt(e, n, clamp) {
    const r = canvas.getBoundingClientRect();
    let x = Math.floor(((e.clientX - r.left) / r.width) * n);
    let y = Math.floor(((e.clientY - r.top) / r.height) * n);
    if (clamp) {
      x = Math.min(n - 1, Math.max(0, x));
      y = Math.min(n - 1, Math.max(0, y));
    } else if (x < 0 || y < 0 || x >= n || y >= n) return -1;
    return y * n + x;
  }

  canvas.addEventListener('pointerdown', e => {
    if (pointer !== null || e.button !== 0) return;
    const { garden, path } = game.state();
    const i = cellAt(e, garden.n, false);
    if (i < 0) return;
    const next = press(garden, path, i);
    if (!next) {
      if (!path.length) game.hint();
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    pointer = e.pointerId;
    e.preventDefault();
    game.setPath(next);
  });

  canvas.addEventListener('pointermove', e => {
    if (e.pointerId !== pointer) return;
    const { garden, path } = game.state();
    const next = stepToward(garden, path, cellAt(e, garden.n, true));
    if (next !== path) game.setPath(next);
  });

  // Folgt auf pointerup und pointercancel, beendet den Zug also in jedem Fall.
  canvas.addEventListener('lostpointercapture', e => {
    if (e.pointerId === pointer) pointer = null;
  });

  canvas.addEventListener('keydown', e => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Escape') { e.preventDefault(); game.reset(); return; }
    const { garden, path } = game.state();
    let next = path;
    if (ARROWS[e.key]) next = move(garden, path, ...ARROWS[e.key]);
    else if (e.key === 'Backspace') next = back(path);
    else return;
    e.preventDefault();
    if (next !== path) game.setPath(next);
  });

  return { dragging: () => pointer !== null };
}
