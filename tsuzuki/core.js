// ───────────────────────────────────────────────────────────────
// Tsuzuki 続き — Kernlogik ohne DOM
// Tokens · Datum · Markdown-Format. Läuft im Browser (window.TsuzukiCore)
// und in Node (require) — damit sie ohne Browser testbar ist.
// ───────────────────────────────────────────────────────────────
(function (root) {
  'use strict';

  // ── Datum (lokale Zeit, Schlüssel JJJJ-MM-TT) ─────────────────
  function todayKey(d = new Date()) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }
  function addDays(key, n) {
    const [y, m, d] = key.split('-').map(Number);
    return todayKey(new Date(y, m - 1, d + n));
  }
  function isValidDay(key) {
    // 2026-02-30 würde von Date still zu 2026-03-02 — das gilt nicht.
    return /^\d{4}-\d{2}-\d{2}$/.test(key) && addDays(key, 0) === key;
  }
  // Fortlaufende Tagesnummer (UTC, ohne Sommerzeit-Sprünge) — für Abstände.
  function dayNumber(key) {
    const [y, m, d] = key.split('-').map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / 86400000);
  }
  // Derselbe Kalendertag n Jahre früher; 29.02. → 28.02. in Nicht-Schaltjahren.
  function sameDayYearsAgo(key, n) {
    const [y, m, d] = key.split('-').map(Number);
    const lastDay = new Date(y - n, m, 0).getDate();
    return todayKey(new Date(y - n, m - 1, Math.min(d, lastDay)));
  }

  // ── Zeiträume: Woche (Mo–So) · Monat · Jahr ───────────────────
  // Ein Zeitraum ist { unit: 'week'|'month'|'year', from, to } (beide inklusive).
  const pad2 = n => String(n).padStart(2, '0');
  // Wochentag nach ISO: Mo = 1 … So = 7.
  function isoWeekday(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).getDay() || 7;
  }
  function periodOf(unit, key) {
    const [y, m] = key.split('-').map(Number);
    if (unit === 'week') {
      const from = addDays(key, 1 - isoWeekday(key));       // Woche beginnt Montag
      return { unit, from, to: addDays(from, 6) };
    }
    if (unit === 'month') {
      const last = new Date(y, m, 0).getDate();
      return { unit, from: `${y}-${pad2(m)}-01`, to: `${y}-${pad2(m)}-${pad2(last)}` };
    }
    return { unit: 'year', from: `${y}-01-01`, to: `${y}-12-31` };
  }
  // Nachbarzeitraum: n = -1 davor, +1 danach.
  function shiftPeriod(p, n) {
    const [y, m] = p.from.split('-').map(Number);
    if (p.unit === 'week') return periodOf('week', addDays(p.from, 7 * n));
    if (p.unit === 'month') return periodOf('month', todayKey(new Date(y, m - 1 + n, 1)));
    return periodOf('year', `${y + n}-01-01`);
  }
  function keysInPeriod(keys, p) {
    return keys.filter(k => isValidDay(k) && k >= p.from && k <= p.to).sort();
  }

  // Zeitraum-Karten im Rückblick — nur an ihren Tagen und nur mit Einträgen:
  //  · Sonntag:          „Diese Woche“ (Mo–Sa, heute nicht — darüber schreibt man gerade)
  //  · Montag:           „Letzte Woche“ (Mo–So)
  //  · 1.–3. des Monats: der Vormonat
  //  · 1.–7. Januar:     das Vorjahr
  // → [{ which, unit, from, to, keys }]
  function periodPicks(keys, today) {
    const out = [];
    const add = (which, p) => {
      const ks = keysInPeriod(keys, p).filter(k => k < today);
      if (ks.length) out.push({ which, ...p, keys: ks });
    };
    const wd = isoWeekday(today), day = Number(today.slice(8)), month = Number(today.slice(5, 7));
    if (wd === 7) add('thisWeek', periodOf('week', today));
    if (wd === 1) add('lastWeek', periodOf('week', addDays(today, -1)));
    if (day <= 3) add('lastMonth', periodOf('month', addDays(`${today.slice(0, 8)}01`, -1)));
    if (month === 1 && day <= 7) add('lastYear', periodOf('year', `${Number(today.slice(0, 4)) - 1}-01-01`));
    return out;
  }

  // ── Rückblick: welche Einträge heute zurückkommen ─────────────
  const YEAR_WINDOW = 3;   // „Um diese Zeit“: ± Tage um den Jahrestag
  const MEMORY_MIN = 3;    // Erinnerungsweg erst ab so vielen früheren Einträgen

  // FNV-1a — gleichmäßig verteilter, aber stabiler Zufall pro Tag.
  function dayHash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }

  // keys: alle Eintragstage · today: JJJJ-MM-TT
  // → { last, years: [{key, yearsAgo, exact}], memory } — nie ein Tag doppelt.
  function reflectPicks(keys, today) {
    // Nur gültige Tage — ein kaputter Schlüssel ergäbe NaN und die Jahres-Schleife liefe endlos.
    const past = keys.filter(k => k < today && isValidDay(k)).sort();
    const out = { last: null, years: [], memory: null };
    if (!past.length) return out;
    const shown = new Set();

    // 1 · Jahrestage: pro früherem Jahr der nächstgelegene Eintrag im Fenster.
    const oldest = dayNumber(past[0]);
    for (let n = 1; ; n++) {
      const target = dayNumber(sameDayYearsAgo(today, n));
      if (target + YEAR_WINDOW < oldest) break;
      let best = null, bestDist = Infinity;
      for (const k of past) {
        const dist = Math.abs(dayNumber(k) - target);
        if (dist <= YEAR_WINDOW && dist < bestDist && !shown.has(k)) { best = k; bestDist = dist; }
      }
      if (best) { out.years.push({ key: best, yearsAgo: n, exact: bestDist === 0 }); shown.add(best); }
    }

    // 2 · Zuletzt: der jüngste frühere Eintrag — außer er ist schon ein Jahrestag.
    const latest = past[past.length - 1];
    if (!shown.has(latest)) { out.last = latest; shown.add(latest); }

    // 3 · Erinnerungsweg: tagesstabil zufällig aus dem Rest.
    const rest = past.filter(k => !shown.has(k));
    if (past.length >= MEMORY_MIN && rest.length) out.memory = rest[dayHash(today) % rest.length];
    return out;
  }

  // ── @Personen / #Themen ───────────────────────────────────────
  // · Unicode-Buchstaben aller Schriften (@Łukasz, @田中, #café, auch NFD-Umlaute)
  // · Bindestrich im Namen (@Anna-Lena, #self-care), nicht am Ende
  // · Nicht direkt nach Buchstabe/Ziffer, „/“ oder „&“ → keine E-Mails,
  //   keine URL-Anker (…/#top, …seite#abschnitt), kein C#, keine &#123;
  // · Mindestens ein Buchstabe → #1, #2024 sind keine Themen (wie in Obsidian)
  const TOKEN_RE = /(?<![\p{L}\p{M}\p{N}_\/&])([@#])([\p{L}\p{M}\p{N}_]+(?:-[\p{L}\p{M}\p{N}_]+)*)/gu;
  const HAS_LETTER = /\p{L}/u;

  // Zerlegt Text in [{type:'text'|'@'|'#', value}] — einzige Stelle der Token-Regel.
  function tokenize(text) {
    const parts = [];
    let last = 0;
    for (const m of text.matchAll(TOKEN_RE)) {
      if (!HAS_LETTER.test(m[2])) continue;
      if (m.index > last) parts.push({ type: 'text', value: text.slice(last, m.index) });
      parts.push({ type: m[1], value: m[2] });
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
    return parts;
  }
  function extractTokens(text) {
    const people = new Set(), tags = new Set();
    for (const p of tokenize(text)) {
      if (p.type === '@') people.add(p.value);
      else if (p.type === '#') tags.add(p.value);
    }
    return { people: [...people], tags: [...tags] };
  }
  // Exakter Treffer (inkl. Groß/Klein) — passt so zur Zählung in der Übersicht.
  function entryHasToken(text, kind, name) {
    return tokenize(text).some(p => p.type === kind && p.value === name);
  }

  function esc(s) {
    return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // ── Markdown-Format (Export/Import) ───────────────────────────
  // Format v2 (seit 2026-11-22):  ## JJJJ-MM-TT · Text · Trennlinie ---
  // Bewusst ohne Metadaten je Tag: Obsidian liest Frontmatter nur am
  // Dateianfang, mitten in der Datei wurde der Block zur Überschrift. Personen
  // und Themen stehen ohnehin im Text.
  // Eine Textzeile, die selbst wie eine Tages-Überschrift aussieht, wird mit
  // „\“ maskiert (und beim Import wieder demaskiert) — sonst würde sie den
  // Eintrag beim Import zerteilen.
  // Formatkennung in der Kopfzeile — lesbar in jedem Viewer (ein HTML-Kommentar
  // erschiene dort, wo HTML abgeschaltet ist, als sichtbarer Text).
  const V2_MARK_RE = /^>.*·\s*Format 2[ \t]*$/m;
  const HEADING_RE = /^##[ \t]+(\d{4}-\d{2}-\d{2})[ \t]*$/gm;
  const ESCAPE_RE = /^(\\*##[ \t]+\d{4}-\d{2}-\d{2}[ \t]*)$/gm;
  const UNESCAPE_RE = /^\\(\\*##[ \t]+\d{4}-\d{2}-\d{2}[ \t]*)$/gm;
  // Format v1: Tsuzuki schrieb direkt nach der Überschrift einen Block, dessen
  // erste Zeile „date: <derselbe Tag>“ ist. Nur genau so ein Block wird entfernt —
  // ein eigener Text, der bloß ähnlich beginnt („---\nort: Berlin\n---“), bleibt.
  const v1FrontmatterRe = key =>
    new RegExp(`^\\s*---\\ndate:[ \\t]*${key}[ \\t]*\\n(?:[^\\n]*\\n)*?---[ \\t]*(?:\\n|$)`);
  // Genau eine Trennlinie am Abschnittsende (eine eigene --- im Text bleibt).
  const TRAILING_SEP_RE = /\n[ \t]*---[ \t]*\n*$/;

  function buildMarkdown(entries, today) {
    const keys = Object.keys(entries).sort();
    const blocks = keys.map(k => `## ${k}\n\n${entries[k].text.replace(ESCAPE_RE, '\\$1')}\n\n---\n`);
    const count = `${keys.length} ${keys.length === 1 ? 'Eintrag' : 'Einträge'}`;
    // „Format 2“ sagt dem Import: hier gibt es kein Frontmatter — auch ein Text,
    // der mit „---\ndate: <Tag>“ beginnt, bleibt Text.
    return `# Tsuzuki 続き — Journal-Export\n\n> ${count} · exportiert ${today} · Format 2\n\n---\n\n` +
      blocks.join('\n');
  }

  // Liest Tsuzuki-Exporte (v2 und v1) und schlichtes „## JJJJ-MM-TT“-Markdown.
  // Liefert die Einträge in Dateireihenfolge; doppelte Tage: der erste gilt.
  function parseMarkdown(md) {
    const text = md.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const heads = [...text.matchAll(HEADING_RE)];
    // Nur im Kopf (vor dem ersten Tag) suchen — ein Eintrag könnte den Text enthalten.
    const v2 = V2_MARK_RE.test(text.slice(0, heads.length ? heads[0].index : text.length));
    const found = [], seen = new Set();
    let invalid = 0, duplicate = 0;
    heads.forEach((h, i) => {
      const key = h[1];
      const end = i + 1 < heads.length ? heads[i + 1].index : text.length;
      let body = text.slice(h.index + h[0].length, end);
      if (!v2) body = body.replace(v1FrontmatterRe(key), '');
      body = body
        .replace(TRAILING_SEP_RE, '')
        .replace(UNESCAPE_RE, '$1')
        .trim();
      if (!body) return;
      if (!isValidDay(key)) { invalid++; return; }
      if (seen.has(key)) { duplicate++; return; }
      seen.add(key);
      found.push({ key, text: body });
    });
    return { entries: found, invalid, duplicate };
  }

  const Core = {
    todayKey, addDays, isValidDay, dayNumber, sameDayYearsAgo, dayHash, reflectPicks,
    isoWeekday, periodOf, shiftPeriod, keysInPeriod, periodPicks,
    tokenize, extractTokens, entryHasToken, esc,
    buildMarkdown, parseMarkdown,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else root.TsuzukiCore = Core;
})(typeof globalThis !== 'undefined' ? globalThis : this);
