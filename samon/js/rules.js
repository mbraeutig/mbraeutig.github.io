// Nachbarschaft, Schritt-Logik, Lösungsprüfung. Rein, ohne DOM.
// Eine Linie ist ein Array von Feld-Indizes; jede Funktion gibt eine neue Linie
// zurück oder die alte, wenn sich nichts ändert.

// Reihenfolge oben, unten, links, rechts – der Generator hängt davon ab.
export function neighbors(n, i) {
  const r = Math.floor(i / n), c = i % n, out = [];
  if (r > 0) out.push(i - n);
  if (r < n - 1) out.push(i + n);
  if (c > 0) out.push(i - 1);
  if (c < n - 1) out.push(i + 1);
  return out;
}

function neighborAt(n, i, dr, dc) {
  const r = Math.floor(i / n) + dr, c = (i % n) + dc;
  if (r < 0 || c < 0 || r >= n || c >= n) return -1;
  return r * n + c;
}

export function isAdjacent(n, a, b) {
  return neighbors(n, a).includes(b);
}

function isFree(garden, path, i) {
  return !garden.stones.includes(i) && !path.includes(i);
}

// Ein Schritt auf das Nachbarfeld i: vorletztes Feld nimmt zurück, freies Feld verlängert.
export function step(garden, path, i) {
  if (!path.length) return path;
  if (path.length > 1 && i === path[path.length - 2]) return path.slice(0, -1);
  if (isAdjacent(garden.n, path[path.length - 1], i) && isFree(garden, path, i)) return [...path, i];
  return path;
}

// Antippen: am Start beginnen, auf der Linie kürzen, am Kopf verlängern. null = keine Aktion.
export function press(garden, path, i) {
  if (!path.length) return i === garden.start ? [i] : null;
  const k = path.indexOf(i);
  if (k >= 0) return path.slice(0, k + 1);
  const next = step(garden, path, i);
  return next !== path ? next : null;
}

// Ziehen: vom Kopf Feld für Feld Richtung Ziel, Hauptachse zuerst, bei Blockade Nebenachse.
export function stepToward(garden, path, target) {
  const n = garden.n;
  for (let guard = 0; guard < 4 * n; guard++) {
    const head = path[path.length - 1];
    if (head === undefined || head === target) break;
    const dr = Math.floor(target / n) - Math.floor(head / n);
    const dc = (target % n) - (head % n);
    const opts = [];
    if (dr) opts.push(neighborAt(n, head, Math.sign(dr), 0));
    if (dc) opts.push(neighborAt(n, head, 0, Math.sign(dc)));
    if (Math.abs(dc) > Math.abs(dr)) opts.reverse();
    let next = path;
    for (const o of opts) {
      next = step(garden, path, o);
      if (next !== path) break;
    }
    if (next === path) break;
    path = next;
  }
  return path;
}

// Ein Schritt zurück; bei leerer Linie bleibt sie leer.
export function back(path) {
  return path.length ? path.slice(0, -1) : path;
}

// Pfeiltaste: bei leerer Linie am Start ansetzen, sonst ein Schritt in Richtung (dr, dc).
export function move(garden, path, dr, dc) {
  if (!path.length) return [garden.start];
  const t = neighborAt(garden.n, path[path.length - 1], dr, dc);
  return t < 0 ? path : step(garden, path, t);
}

export function freeCount(garden) {
  return garden.n * garden.n - garden.stones.length;
}

// Eine angefangene Linie: beginnt am Start, nur Nachbarschritte, kein Stein, keine Wiederholung.
export function isValidLine(garden, path) {
  if (!Array.isArray(path) || !path.length) return Array.isArray(path);
  if (path[0] !== garden.start) return false;
  const seen = new Set();
  for (let k = 0; k < path.length; k++) {
    const i = path[k];
    if (!Number.isInteger(i) || i < 0 || i >= garden.n * garden.n) return false;
    if (seen.has(i) || garden.stones.includes(i)) return false;
    if (k > 0 && !isAdjacent(garden.n, path[k - 1], i)) return false;
    seen.add(i);
  }
  return true;
}

export function isValidSolution(garden, path) {
  return Array.isArray(path) && path.length === freeCount(garden) && path.length > 0 && isValidLine(garden, path);
}
