// Garten erzeugen (KONZEPT.md §5). Rein, ohne DOM, deterministisch je Saat.
// Jede Änderung, die bei gleicher Saat einen anderen Garten ergibt, erhöht GEN_VERSION.

import { rngFromSeed } from './rng.js';
import { neighbors } from './rules.js';

export const GEN_VERSION = 1;

const ATTEMPTS = 800;
const K_MIN = { 5: 2, 6: 3, 7: 4 };

// Lokales Datum, nie UTC.
export function dayKey(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Mo, Di 5 · Mi, Do 6 · Fr, Sa, So 7
export function sizeFor(d) {
  const w = d.getDay();
  return w === 1 || w === 2 ? 5 : w === 3 || w === 4 ? 6 : 7;
}

export function dailyGarden(d) {
  const key = dayKey(d);
  return { ...generate(`samon-v${GEN_VERSION}-${key}`, sizeFor(d)), key };
}

export function practiceGarden(n) {
  const seed = `uebung-${Date.now()}-${Math.random()}`;
  return { ...generate(seed, n), key: seed };
}

export function generate(seed, n) {
  const rng = rngFromSeed(seed);
  const N = n * n;
  const maxStones = Math.floor(N * 0.2);
  const kMin = K_MIN[n] ?? 3;
  let best = null;

  for (let a = 0; a < ATTEMPTS; a++) {
    const stones = new Set();
    const k = kMin + Math.floor(rng() * 2);
    while (stones.size < k) stones.add(Math.floor(rng() * N));
    const gravel = [];
    for (let i = 0; i < N; i++) if (!stones.has(i)) gravel.push(i);
    const start = gravel[Math.floor(rng() * gravel.length)];

    // Warnsdorff: zum Nachbarn mit den wenigsten freien Folge-Nachbarn.
    const visited = new Set([start]);
    const path = [start];
    const open = j => !stones.has(j) && !visited.has(j);
    for (;;) {
      const cand = neighbors(n, path[path.length - 1]).filter(open);
      if (!cand.length) break;
      let pick = -1, bestScore = Infinity;
      for (const j of cand) {
        const score = neighbors(n, j).filter(open).length + rng() * 0.9;
        if (score < bestScore) { bestScore = score; pick = j; }
      }
      visited.add(pick);
      path.push(pick);
    }

    const left = gravel.length - path.length;
    const attempt = { left, stones, gravel, visited, start, path };
    if (left <= 2 && k + left <= maxStones) return finish(n, attempt);
    if (!best || left < best.left) best = attempt;
  }
  return finish(n, best);
}

// Restfelder werden zu Steinen; der gelaufene Pfad ist die Lösung.
function finish(n, { stones, gravel, visited, start, path }) {
  for (const i of gravel) if (!visited.has(i)) stones.add(i);
  const list = [...stones].sort((a, b) => a - b);
  return { n, start, stones: list, solution: path };
}
