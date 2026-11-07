// Gartenbuch und Spielstand in localStorage (KONZEPT.md §8). Ohne DOM: der Speicher
// wird hereingereicht, damit die Logik unter Node testbar bleibt.
// Jeder Zugriff steckt in try/catch. Ohne Speicher läuft das Spiel, das Buch bleibt leer.

import { GEN_VERSION } from './generator.js';
import { isValidLine, isValidSolution } from './rules.js';

const BOOK = 'samon.book.v1';
const PROGRESS = 'samon.progress.v1';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function defaultStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

// Ein Eintrag trägt den vollständigen Garten, damit er unabhängig vom Generator bleibt.
// Unbrauchbare Einträge (fremd, beschädigt) werden still übergangen.
function toEntry(key, e) {
  try {
    if (!DAY.test(key) || !Number.isInteger(e.n) || e.n < 2 || e.n > 12) return null;
    const inside = i => Number.isInteger(i) && i >= 0 && i < e.n * e.n;
    if (!Array.isArray(e.stones) || !e.stones.every(inside) || new Set(e.stones).size !== e.stones.length) return null;
    const garden = { n: e.n, start: e.start, stones: [...e.stones], key };
    if (!isValidSolution(garden, e.path)) return null;
    return { key, garden, path: [...e.path] };
  } catch {
    return null;
  }
}

export function openBook(storage = defaultStorage()) {
  // Gelesenes Objekt; null = nichts gespeichert; undefined = nicht lesbar (gesperrt, kaputt).
  function read(name) {
    try {
      const raw = storage.getItem(name);
      if (raw === null) return null;
      const v = JSON.parse(raw);
      return v && typeof v === 'object' && !Array.isArray(v) ? v : undefined;
    } catch {
      return undefined;
    }
  }
  const get = name => read(name) ?? null;
  // true = geschrieben, false bei gesperrtem oder vollem Speicher.
  function set(name, value) {
    try { storage.setItem(name, JSON.stringify(value)); return true; } catch { return false; }
  }
  function remove(name) {
    try { storage.removeItem(name); } catch { /* Speicher gesperrt */ }
  }

  return {
    // Alle gelösten Tage, neueste zuerst: [{ key, garden, path }]
    entries() {
      const book = get(BOOK) ?? {};
      return Object.keys(book).sort().reverse().map(k => toEntry(k, book[k])).filter(Boolean);
    },

    entry(key) {
      const book = get(BOOK);
      return book && Object.hasOwn(book, key) ? toEntry(key, book[key]) : null;
    },

    // Lösen schreibt den Eintrag (ersetzt einen alten) und löscht den Spielstand.
    // Ein unlesbares Buch wird nie überschrieben, und ohne geschriebenen Eintrag
    // bleibt der Spielstand stehen.
    save(garden, path) {
      const book = read(BOOK);
      if (book === undefined) return false;
      const entry = { v: GEN_VERSION, n: garden.n, start: garden.start, stones: [...garden.stones], path: [...path] };
      if (!set(BOOK, { ...book, [garden.key]: entry })) return false;
      remove(PROGRESS);
      return true;
    },

    // Angefangene Linie zum Garten. Ein Stand von einem anderen Tag wird verworfen.
    progress(garden) {
      const p = get(PROGRESS);
      if (!p) return [];
      if (p.key !== garden.key || !isValidLine(garden, p.path)) { remove(PROGRESS); return []; }
      return [...p.path];
    },

    saveProgress(garden, path) {
      if (path.length) set(PROGRESS, { key: garden.key, path });
      else remove(PROGRESS);
    },
  };
}
