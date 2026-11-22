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
  // Pro Tag:  ## JJJJ-MM-TT · Frontmatter · Text · Trennlinie ---
  // Eine Textzeile, die selbst wie eine Tages-Überschrift aussieht, wird mit
  // „\“ maskiert (und beim Import wieder demaskiert) — sonst würde sie den
  // Eintrag beim Import zerteilen.
  const HEADING_RE = /^##[ \t]+(\d{4}-\d{2}-\d{2})[ \t]*$/gm;
  const ESCAPE_RE = /^(\\*##[ \t]+\d{4}-\d{2}-\d{2}[ \t]*)$/gm;
  const UNESCAPE_RE = /^\\(\\*##[ \t]+\d{4}-\d{2}-\d{2}[ \t]*)$/gm;
  // Frontmatter direkt nach der Überschrift; erste Zeile muss „schlüssel:“ sein.
  const FRONTMATTER_RE = /^\s*---\n[\w-]+:[^\n]*\n(?:[^\n]*\n)*?---[ \t]*(?:\n|$)/;
  // Genau eine Trennlinie am Abschnittsende (eine eigene --- im Text bleibt).
  const TRAILING_SEP_RE = /\n[ \t]*---[ \t]*\n*$/;

  function buildMarkdown(entries, today) {
    const keys = Object.keys(entries).sort();
    const blocks = keys.map(k => {
      const text = entries[k].text, t = extractTokens(text);
      const people = t.people.length ? `people: [${t.people.join(', ')}]\n` : '';
      const tags = t.tags.length ? `tags: [${t.tags.join(', ')}]\n` : '';
      return `## ${k}\n\n---\ndate: ${k}\nsource: tsuzuki\n${people}${tags}---\n\n` +
        `${text.replace(ESCAPE_RE, '\\$1')}\n\n---\n`;
    });
    const count = `${keys.length} ${keys.length === 1 ? 'Eintrag' : 'Einträge'}`;
    return `# Tsuzuki 続き — Journal-Export\n\n> ${count} · exportiert ${today}\n\n---\n\n` + blocks.join('\n');
  }

  // Liest Tsuzuki-Exporte (alt und neu) und schlichtes „## JJJJ-MM-TT“-Markdown.
  // Liefert die Einträge in Dateireihenfolge; doppelte Tage: der erste gilt.
  function parseMarkdown(md) {
    const text = md.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const heads = [...text.matchAll(HEADING_RE)];
    const found = [], seen = new Set();
    let invalid = 0, duplicate = 0;
    heads.forEach((h, i) => {
      const key = h[1];
      const end = i + 1 < heads.length ? heads[i + 1].index : text.length;
      const body = text.slice(h.index + h[0].length, end)
        .replace(FRONTMATTER_RE, '')
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
    todayKey, addDays, isValidDay,
    tokenize, extractTokens, entryHasToken, esc,
    buildMarkdown, parseMarkdown,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else root.TsuzukiCore = Core;
})(typeof globalThis !== 'undefined' ? globalThis : this);
