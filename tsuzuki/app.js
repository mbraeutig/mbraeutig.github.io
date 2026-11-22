// ───────────────────────────────────────────────────────────────
// Tsuzuki 続き — Micro-Journaling (Vanilla JS, kein Build)
// localStorage · Reflect-First · Datums-Sprung · MD Import/Export
// ───────────────────────────────────────────────────────────────
'use strict';

// Kernlogik (Tokens, Datum, Markdown-Format) liegt in core.js — DOM-frei und getestet.
const {
  todayKey, addDays, dayHash, reflectPicks,
  isoWeekday, periodOf, shiftPeriod, keysInPeriod, periodPicks, kouOf,
  tokenize, extractTokens, entryHasToken, esc, buildMarkdown, parseMarkdown,
  backlinkIndex, threadKeys, appendRef,
} = TsuzukiCore;

const STORE = 'tsuzuki.entries.v1';
const DRAFTS = 'tsuzuki.drafts.v1';   // ungespeicherte Entwürfe — überleben App-Neustart

const GREETINGS = [
  'Was trägst du heute?', 'Ein Gedanke genügt.', 'Wie war dieser Tag wirklich?',
  'Halte fest, was bleibt.', 'Nichts muss perfekt sein.', 'Erzähl es deinem späteren Ich.',
];
// Sonntags ersetzt er den wechselnden Satz — der Sonntagseintrag ist der Wochenrückblick.
const SUNDAY_GREETING = 'Was bleibt von dieser Woche?';
// Beim Weiterschreiben an einem alten Eintrag — 続き heißt „Fortsetzung“.
const CONTINUE_GREETING = 'Wie ging es weiter?';
const REFLECT_GREETINGS = [
  'Bevor du schreibst — ein Blick zurück.', 'Wo du warst.', 'Was war.',
];
const EMPTY = [
  'Noch ist der Weg jung. Schreib, wann immer dir danach ist.',
  'Mit der Zeit füllt sich dieser Raum mit Vergangenem.',
];
const TOKEN_LIMIT = 8;      // Menschen/Themen im Rückblick: so viele, dann „+ N weitere“

// ── State ─────────────────────────────────────────────────────
let entries = loadEntries();
let drafts = loadDrafts();  // { 'JJJJ-MM-TT': text } — nur Tage, deren Text vom Eintrag abweicht
// Reflect-First: Start auf Rückblick, außer es gibt noch nichts.
let view = Object.keys(entries).length === 0 ? 'write' : 'reflect';
let filter = null;          // {kind:'@'|'#', name}
let activeDate = todayKey();// welcher Tag im Schreiben gerade offen ist
let greeting = '';          // Impuls-Satz — wird nur beim Öffnen eines Tages gewählt
let tokensExpanded = { '@': false, '#': false }; // „+ N weitere“ aufgeklappt?

// ── Persistence ───────────────────────────────────────────────
function load(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch (e) { return {}; }
}
// Robust gegen beschädigte/fremde Daten: ein Eintrag ohne Text würde sonst
// jede Ansicht zum Absturz bringen. Reiner Text wird repariert, Unbrauchbares
// übersprungen (es enthält ohnehin keinen Text).
function loadEntries() {
  const out = {};
  for (const [k, v] of Object.entries(load(STORE))) {
    if (typeof v === 'string') out[k] = { text: v, edited: 0 };
    else if (v && typeof v.text === 'string') out[k] = v;
  }
  return out;
}
function loadDrafts() {
  const out = {};
  for (const [k, v] of Object.entries(load(DRAFTS))) if (typeof v === 'string') out[k] = v;
  return out;
}
// true = gespeichert. Bei false hat der Aufrufer den alten Stand wiederherzustellen.
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(entries)); return true; }
  catch (e) { toast('Speichern fehlgeschlagen — Speicher voll? Nichts wurde verändert.'); return false; }
}
function saveDrafts() {
  try { localStorage.setItem(DRAFTS, JSON.stringify(drafts)); }
  catch (e) { /* Entwurf bleibt im Speicher — beim Festhalten kommt die eigentliche Meldung */ }
}
function currentText(day) {
  return drafts[day] ?? entries[day]?.text ?? '';
}
function setDraft(day, text) {
  // Entspricht der Text dem festgehaltenen Eintrag, ist es kein Entwurf mehr.
  if (text.trim() === (entries[day]?.text ?? '')) delete drafts[day];
  else drafts[day] = text;
  saveDrafts();
}
let persistAsked = false;
function requestPersist() {
  // Bittet den Browser, die Daten nicht bei Speicherknappheit zu räumen.
  // Erst beim ersten Festhalten — nicht schon beim Öffnen (Firefox fragt nach).
  if (persistAsked || !navigator.storage?.persist) return;
  persistAsked = true;
  navigator.storage.persisted().then(p => p || navigator.storage.persist()).catch(() => {});
}

// ── Date display ──────────────────────────────────────────────
function humanDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('de-DE',
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
function shortDate(key) {
  // „21. Nov.“ — mit Jahr, sobald es nicht das laufende ist („21. Nov. 2025“).
  const [y, m, d] = key.split('-').map(Number);
  const opts = { day: 'numeric', month: 'short' };
  if (y !== new Date().getFullYear()) opts.year = 'numeric';
  return new Date(y, m - 1, d).toLocaleDateString('de-DE', opts);
}
function relativeDay(key) {
  if (key === todayKey()) return 'heute';
  if (key === addDays(todayKey(), -1)) return 'gestern';
  return humanDate(key);
}
function fmtDay(key, opts) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('de-DE', opts);
}
function weekdayShort(key) { return fmtDay(key, { weekday: 'short' }).replace('.', ''); }
function monthName(key) { return fmtDay(key, { month: 'long' }); }
// „16.–22. Nov. 2026“ · „30. Nov. – 6. Dez. 2026“ · „November 2026“ · „2026“
function periodLabel(p) {
  if (p.unit === 'year') return p.from.slice(0, 4);
  if (p.unit === 'month') return fmtDay(p.from, { month: 'long', year: 'numeric' });
  const end = fmtDay(p.to, { day: 'numeric', month: 'short', year: 'numeric' });
  return p.from.slice(0, 7) === p.to.slice(0, 7)
    ? `${Number(p.from.slice(8))}.–${end}`
    : `${fmtDay(p.from, { day: 'numeric', month: 'short' })} – ${end}`;
}
function firstLine(text) { return (text.split('\n').find(l => l.trim()) || '').trim(); }
// Klartext für eine Zeile: Verweise lesbar („↩ 22. Nov. 2025“ statt ISO).
function plainLine(text) {
  return tokenize(text).map(p => p.type === '↩' ? `↩ ${shortDate(p.value)}` : p.type === 'text' ? p.value : p.type + p.value).join('');
}
// Leise Zeile mit der alten Jahreszeit (七十二候): Kanji + deutscher Name,
// die japanische Lesung als Tooltip.
function kouLine(key) {
  const k = kouOf(key);
  return `<div class="kou" title="${esc(k.reading)}"><span class="kou-kanji" lang="ja">${esc(k.kanji)}</span>${esc(k.de)}</div>`;
}
function texts() { return Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, v.text])); }
let backlinks = {};   // { Tag: [Tage, die darauf verweisen] } — bei jedem render() neu abgeleitet

// ── Tokens im Text ────────────────────────────────────────────
function richText(text) {
  return tokenize(text).map(p => {
    if (p.type === 'text') return esc(p.value);
    if (p.type === '↩') {
      return `<span class="tok ref" role="button" tabindex="0" data-thread="${esc(p.value)}" aria-label="Faden zum ${esc(humanDate(p.value))}"><span class="ref-arrow">↩</span> ${esc(shortDate(p.value))}</span>`;
    }
    const cls = p.type === '@' ? 'person' : 'tag';
    // role/tabindex: per Tastatur erreichbar (Enter/Leertaste → siehe keydown unten)
    return `<span class="tok ${cls}" role="button" tabindex="0" data-kind="${p.type}" data-name="${esc(p.value)}">${esc(p.type + p.value)}</span>`;
  }).join('');
}

// ── Derived ───────────────────────────────────────────────────
function allTokens() {
  const people = {}, tags = {};
  Object.values(entries).forEach(e => {
    const t = extractTokens(e.text);
    t.people.forEach(p => people[p] = (people[p] || 0) + 1);
    t.tags.forEach(g => tags[g] = (tags[g] || 0) + 1);
  });
  // Häufigste zuerst; bei Gleichstand alphabetisch — stabile Reihenfolge.
  const sort = o => Object.entries(o).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de'));
  return { people: sort(people), tags: sort(tags) };
}
function yearLabel({ yearsAgo, exact }) {
  const span = yearsAgo === 1 ? 'einem Jahr' : `${yearsAgo} Jahren`;
  return exact ? `Vor ${span}` : `Um diese Zeit vor ${span}`;
}
function filteredEntries() {
  if (!filter) return [];
  // Zeitraum: chronologisch, damit sich Woche/Monat/Jahr wie eine Erzählung liest.
  if (filter.kind === 'period') {
    return keysInPeriod(Object.keys(entries), filter).map(k => Object.assign({ key: k }, entries[k]));
  }
  // Faden: alles, was über ↩-Verweise zusammenhängt — chronologisch.
  if (filter.kind === 'thread') {
    return threadKeys(texts(), filter.key).map(k => Object.assign({ key: k }, entries[k]));
  }
  // Exakt wie in der Übersicht gezählt — @Franz trifft nicht @Franzi.
  return Object.keys(entries)
    .filter(k => entryHasToken(entries[k].text, filter.kind, filter.name))
    .sort().reverse()
    .map(k => Object.assign({ key: k }, entries[k]));
}

// ── Actions ───────────────────────────────────────────────────
function holdFast() {
  const day = activeDate;
  const text = currentText(day).trim();
  const prev = entries[day];
  if (!text && !prev) { toast('Noch leer — nichts festzuhalten'); return; }

  if (text) entries[day] = { text, edited: Date.now() };
  else delete entries[day];             // leeres Festhalten entfernt — mit Rückweg (unten)
  if (!save()) {
    // Nichts verloren: alter Stand zurück, der Entwurf bleibt gespeichert.
    if (prev) entries[day] = prev; else delete entries[day];
    return;
  }
  // Erst nach erfolgreichem Speichern ist der Entwurf überflüssig.
  delete drafts[day];
  saveDrafts();

  if (text) {
    requestPersist();
    toast('Festgehalten');
  } else {
    toast('Eintrag entfernt', 'Rückgängig', () => {
      // In den 5 s neu Festgehaltenes nicht überschreiben.
      if (entries[day]) { toast('Inzwischen neu festgehalten — nichts geändert'); return; }
      entries[day] = prev;
      if (!save()) { delete entries[day]; return; }
      renderQuiet();
      toast('Wiederhergestellt');
    });
  }
  renderQuiet();
}
// Neu zeichnen, ohne das Textfeld zu fokussieren — nach dem Festhalten soll
// am Handy nicht die Tastatur wieder aufspringen.
let focusOnRender = true;
function renderQuiet() { focusOnRender = false; try { render(); } finally { focusOnRender = true; } }
function writeGreeting(day) {
  if (day !== todayKey()) return 'Ein Tag, den du nachträgst.';
  return isoWeekday(day) === 7 ? SUNDAY_GREETING : pick(GREETINGS);
}
function openWrite(day, greet) {
  activeDate = day;
  greeting = greet || writeGreeting(day);
  view = 'write';
  render();
}
// „weiterschreiben“: heute öffnen, Verweis-Zeile ans Ende, Cursor dahinter.
// Der Text wird sofort Entwurf — geht also auch ohne Festhalten nicht verloren.
function continueFrom(key) {
  const tk = todayKey();
  setDraft(tk, appendRef(currentText(tk), key));
  openWrite(tk, CONTINUE_GREETING);
}
function openThread(key) { filter = { kind: 'thread', key }; view = 'filter'; render(); }
function openToken(kind, name) { filter = { kind, name }; view = 'filter'; render(); }
function openPeriod(p) { filter = { kind: 'period', unit: p.unit, from: p.from, to: p.to }; view = 'filter'; render(); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ── Export / Import ───────────────────────────────────────────
async function exportMarkdown() {
  if (!Object.keys(entries).length) { toast('Noch nichts zu exportieren'); return; }
  const md = buildMarkdown(entries, todayKey());
  const name = `tsuzuki-${todayKey()}.md`;
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });

  // Mobil: Teilen-Dialog (iOS: „In Dateien sichern“, Mail, Cloud …).
  // Downloads per <a download> sind in installierten iOS-PWAs unzuverlässig.
  // Android-Chrome lässt .md nicht teilen → canShare false → Download (klappt dort).
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare) {
    const file = new File([blob], name, { type: 'text/markdown' });
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Tsuzuki-Export' }); return; }
      catch (e) { if (e.name === 'AbortError') return; /* sonst: Download als Rückfall */ }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  // Nicht sofort freigeben — manche Browser brechen den Download sonst ab.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast('Export erstellt');
}
function importMarkdown(md) {
  const { entries: found, invalid, duplicate } = parseMarkdown(md);
  if (!found.length) { toast('Keine Einträge in der Datei gefunden'); return; }
  const addedKeys = [];
  let existing = 0, differing = 0;
  found.forEach(({ key, text }) => {
    if (entries[key]) {                                      // bestehende nie überschreiben
      existing++;
      if (entries[key].text !== text) differing++;           // … aber sagen, wenn sie abweichen
      return;
    }
    entries[key] = { text, edited: Date.now() };
    addedKeys.push(key);
  });
  if (addedKeys.length && !save()) {                         // alles oder nichts
    addedKeys.forEach(k => delete entries[k]);
    return;
  }
  const added = addedKeys.length;
  const parts = [`${added} importiert`];
  if (existing) parts.push(`${existing} schon vorhanden` +
    (differing ? ` (${differing} abweichend — deine Fassung bleibt)` : ''));
  if (duplicate) parts.push(`${duplicate} doppelt`);
  if (invalid) parts.push(`${invalid} mit ungültigem Datum`);
  toast(parts.join(' · '));
  view = 'reflect'; render();
}

// ── Rendering ─────────────────────────────────────────────────
const main = document.getElementById('main');
const nav = document.getElementById('nav');
const headMeta = document.getElementById('head-meta');
const toastEl = document.getElementById('toast');
const importInput = document.getElementById('import-input');

let toastTimer;
function hideToast() { toastEl.classList.remove('show', 'has-action'); }
function toast(msg, actionLabel, action) {
  toastEl.textContent = msg;
  if (actionLabel) {
    const b = document.createElement('button');
    b.className = 'toast-action';
    b.textContent = actionLabel;
    b.onclick = () => { clearTimeout(toastTimer); hideToast(); action(); };
    toastEl.appendChild(b);
  }
  toastEl.classList.toggle('has-action', !!actionLabel);
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  // Längere Meldungen (z. B. Import-Bilanz) bleiben etwas länger stehen.
  toastTimer = setTimeout(hideToast, actionLabel ? 5000 : Math.max(1600, msg.length * 70));
}

let renderedDay = todayKey();   // für welchen Tag die Ansicht zuletzt gebaut wurde
function render() {
  renderedDay = todayKey();
  backlinks = backlinkIndex(texts());
  const n = Object.keys(entries).length;
  headMeta.textContent = n ? `${n} ${n === 1 ? 'Eintrag' : 'Einträge'}` : '—';
  if (view === 'write') renderWrite();
  else if (view === 'reflect') renderReflect();
  else if (view === 'filter') renderFilter();
  renderNav();
}

function renderWrite() {
  const isToday = activeDate === todayKey();
  if (!greeting) greeting = writeGreeting(activeDate);

  // Das Gerüst wird einmal pro Tag/Ansicht gebaut — beim Tippen nie neu
  // (sonst springt der Cursor, die Tastatur-Komposition bricht ab, Undo geht verloren).
  main.className = 'fade-in';
  main.innerHTML = `
    <div class="date-line">
      <button class="date-nav" id="day-prev" aria-label="Tag davor">‹</button>
      <span>${relativeDay(activeDate)}</span>
      <button class="date-nav" id="day-next" aria-label="Tag danach" ${isToday ? 'disabled' : ''}>›</button>
    </div>
    ${kouLine(activeDate)}
    <div class="prompt">${esc(greeting)}</div>
    <textarea id="ta" aria-label="Eintrag" placeholder="Kaffee mit @Franzi #chillen …" spellcheck="true"></textarea>
    <div class="chip-row" id="chips"></div>
    <div class="write-foot">
      <span class="word-count" id="word-count"></span>
      <button class="save-btn" id="save">Festhalten</button>
    </div>
    <p class="wabi">Schreib einfach. <span class="c-person">@Namen</span> und <span class="c-tag">#Themen</span> erkennt Tsuzuki von selbst.</p>
  `;
  const ta = document.getElementById('ta');
  ta.value = currentText(activeDate);   // per value, nicht per HTML — führende Zeilenumbrüche bleiben erhalten
  updateWriteMeta(ta.value);
  ta.addEventListener('input', () => { setDraft(activeDate, ta.value); updateWriteMeta(ta.value); });
  // Cursor ans Ende — nur beim Öffnen, nicht beim Tippen (und nicht nach dem Festhalten)
  if (focusOnRender) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  document.getElementById('save').onclick = holdFast;
  document.getElementById('day-prev').onclick = () => openWrite(addDays(activeDate, -1));
  const next = document.getElementById('day-next');
  if (!next.disabled) next.onclick = () => openWrite(addDays(activeDate, 1));
}
function updateWriteMeta(text) {
  // Nur Chips und Wortzähler aktualisieren — das Textfeld bleibt unberührt.
  const tokens = extractTokens(text);
  document.getElementById('chips').innerHTML =
    tokens.people.map(p => `<span class="chip person">@${esc(p)}</span>`).join('') +
    tokens.tags.map(t => `<span class="chip tag">#${esc(t)}</span>`).join('') +
    tokens.refs.map(r => `<span class="chip ref">↩ ${esc(shortDate(r))}</span>`).join('');
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const count = words === 0 ? 'noch leer' : words + (words === 1 ? ' Wort' : ' Wörter');
  document.getElementById('word-count').textContent = count + (activeDate in drafts ? ' · Entwurf' : '');
}

function renderReflect() {
  const tk = todayKey();
  const r = reflectPicks(Object.keys(entries), tk);
  const tok = allTokens();
  const anyMemory = r.last || r.years.length || r.memory;
  const hasTokens = tok.people.length || tok.tags.length;
  const openDrafts = Object.keys(drafts).filter(k => k !== tk).sort().reverse();

  let html = '<div class="stack fade-in">';
  // Tagesstabil statt zufällig je Render — sonst wechselt der Satz beim Aufklappen.
  html += `<div><div class="reflect-greeting">${REFLECT_GREETINGS[dayHash(tk) % REFLECT_GREETINGS.length]}</div>` +
    `${kouLine(tk)}</div>`;

  // Zeitraum-Karten an ihren Tagen: Woche (So/Mo), Vormonat (1.–3.), Vorjahr (1.–7.1.).
  periodPicks(Object.keys(entries), tk).forEach(pp => { html += periodCard(pp); });

  // Erst die Erinnerungen — das Wiederlesen ist der Kern.
  // Kein „vor N Tagen“ bei „Zuletzt“: Abstände klingen nach Streak-Vorwurf.
  // „weiterschreiben ›“ nur unter Zuletzt und den Jahres-Karten.
  if (r.last) html += card(r.last === addDays(tk, -1) ? 'Gestern' : 'Zuletzt', r.last, shortDate(r.last), false, true);
  r.years.forEach(y => { html += card(yearLabel(y), y.key, shortDate(y.key), true, true); });
  if (r.memory) html += card('Erinnerungsweg', r.memory, humanDate(r.memory));

  // Dann Menschen & Themen — gekürzt, damit sie die Erinnerungen nie verdrängen.
  html += tokenGroup('Menschen', '@', tok.people) + tokenGroup('Themen', '#', tok.tags);

  if (!anyMemory && !hasTokens) {
    html += `<div class="empty"><div class="empty-mark">空</div><p class="empty-text">${Object.keys(entries).length === 0 ? EMPTY[0] : EMPTY[1]}</p></div>`;
  }

  // Nichts geht verloren: angefangene, nicht festgehaltene Tage bleiben sichtbar.
  if (openDrafts.length) {
    html += `<div><div class="token-group-label">Offene Entwürfe</div><div class="token-wrap">` +
      openDrafts.map(k => `<button class="tok-btn draft" data-draft="${esc(k)}">${esc(shortDate(k))}</button>`).join('') +
      `</div></div>`;
  }

  // Reflect-First: sanfte Einladung zum Schreiben, kein Zwang
  const cta = tk in drafts ? 'Entwurf von heute fortsetzen'
    : entries[tk] ? 'Heutigen Eintrag öffnen' : 'Heute etwas festhalten';
  html += `<button class="cta-write" id="go-write">${cta}</button>`;
  html += '</div>';
  main.className = '';
  main.innerHTML = html;

  main.querySelectorAll('[data-kind]').forEach(el =>
    el.onclick = () => openToken(el.dataset.kind, el.dataset.name));
  main.querySelectorAll('[data-draft]').forEach(el =>
    el.onclick = () => openWrite(el.dataset.draft));
  main.querySelectorAll('[data-more]').forEach(el =>
    el.onclick = () => { tokensExpanded[el.dataset.more] = !tokensExpanded[el.dataset.more]; renderReflect(); });
  bindPeriodLinks();
  document.getElementById('go-write').onclick = () => openWrite(todayKey());
}

// Kartendatum → Monat, „… wiederlesen“ → Zeitraum („unit|from“),
// ↩-Verweis / „fortgesetzt am …“ → Faden, „weiterschreiben“ → heute.
function bindPeriodLinks() {
  main.querySelectorAll('[data-thread]').forEach(el =>
    el.onclick = () => openThread(el.dataset.thread));
  main.querySelectorAll('[data-continue]').forEach(el =>
    el.onclick = () => continueFrom(el.dataset.continue));
  main.querySelectorAll('[data-month]').forEach(el =>
    el.onclick = () => openPeriod(periodOf('month', el.dataset.month)));
  main.querySelectorAll('[data-open-period]').forEach(el => {
    const [unit, from] = el.dataset.openPeriod.split('|');
    el.onclick = () => openPeriod(periodOf(unit, from));
  });
}

// Menschen & Themen eines Zeitraums — als Namen, ohne Zahlen.
function periodTokens(keys) {
  const count = { '@': {}, '#': {} };
  keys.forEach(k => {
    const t = extractTokens(entries[k].text);
    t.people.forEach(n => { count['@'][n] = (count['@'][n] || 0) + 1; });
    t.tags.forEach(n => { count['#'][n] = (count['#'][n] || 0) + 1; });
  });
  const sorted = kind => Object.entries(count[kind])
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de')).slice(0, TOKEN_LIMIT)
    .map(([name]) => `<button class="tok-btn ${kind === '@' ? 'person' : 'tag'}" data-kind="${kind}" data-name="${esc(name)}">${kind}${esc(name)}</button>`);
  return [...sorted('@'), ...sorted('#')].join('');
}

function periodCard(pp) {
  const link = `data-open-period="${pp.unit}|${pp.from}"`;
  if (pp.unit === 'week') {
    // Nur beschriebene Tage, je eine Zeile — kein „4 von 7“, keine leeren Kästchen.
    const lines = pp.keys.map(k =>
      `<li><span class="wk-day">${weekdayShort(k)}</span><span class="wk-line">${esc(plainLine(firstLine(entries[k].text)))}</span></li>`).join('');
    const chips = periodTokens(pp.keys);
    return `<div class="card period" data-week="${pp.from}">
      <div class="card-head">
        <span class="card-label">${pp.which === 'thisWeek' ? 'Diese Woche' : 'Letzte Woche'}</span>
        <span class="card-sub">${esc(periodLabel(pp))}</span>
      </div>
      <ul class="wk-lines">${lines}</ul>
      ${chips ? `<div class="token-wrap wk-tokens">${chips}</div>` : ''}
      <button class="period-open" ${link}>Die ganze Woche lesen ›</button>
    </div>`;
  }
  const isMonth = pp.unit === 'month';
  const name = isMonth ? monthName(pp.from) : pp.from.slice(0, 4);
  return `<div class="card period">
    <div class="card-head">
      <span class="card-label">${isMonth ? `Der ${esc(name)}` : `Dein ${name}`}</span>
      <span class="card-sub">${esc(periodLabel(pp))}</span>
    </div>
    <button class="period-open" ${link}>${isMonth ? `Den ${esc(name)} wiederlesen ›` : 'Das Jahr wiederlesen ›'}</button>
  </div>`;
}

function tokenGroup(label, kind, list) {
  if (!list.length) return '';
  const cls = kind === '@' ? 'person' : 'tag';
  const open = tokensExpanded[kind];
  const visible = open ? list : list.slice(0, TOKEN_LIMIT);
  const hidden = list.length - visible.length;
  const toggle = list.length > TOKEN_LIMIT
    ? `<button class="tok-more" data-more="${kind}">${open ? 'weniger' : `+ ${hidden} weitere`}</button>` : '';
  return `<div class="token-group"><div class="token-group-label">${label}</div><div class="token-wrap">` +
    visible.map(([name, c]) => `<button class="tok-btn ${cls}" data-kind="${kind}" data-name="${esc(name)}">${kind}${esc(name)}<span class="tok-count">${c}</span></button>`).join('') +
    toggle + `</div></div>`;
}

// Das Datum einer Karte öffnet ihren Monat (Zeitraum-Liste).
function dateLink(key, text) {
  return `<button class="card-sub card-date" data-month="${esc(key)}" aria-label="${esc(monthName(key))} wiederlesen">${esc(text)}</button>`;
}

// Fuß einer früheren Karte: „fortgesetzt am …“ (abgeleitet) und — nur wo
// gewünscht (Zuletzt, Jahres-Karten) — „weiterschreiben ›“. Unter jeder Karte
// wiederholt, wirkte es gleichförmig.
function cardFoot(key, { showContinued = true, offerWrite = false } = {}) {
  const conts = showContinued ? (backlinks[key] || []) : [];
  const recent = conts.slice(-2).map(shortDate).join(' und ');
  const cont = conts.length
    ? `<button class="card-link cont" data-thread="${esc(key)}">fortgesetzt am ${esc(recent)}${conts.length > 2 ? ' u. a.' : ''}</button>`
    : '';
  const write = offerWrite && key < todayKey()
    ? `<button class="card-link write-on" data-continue="${esc(key)}">weiterschreiben ›</button>` : '';
  return cont || write ? `<div class="card-foot">${cont}${write}</div>` : '';
}

function card(label, key, sub, accent, offerWrite) {
  return `<div class="card${accent ? ' accent' : ''}" data-day="${esc(key)}">
    <div class="card-head">
      <span class="card-label${accent ? ' accent' : ''}">${label}</span>
      ${dateLink(key, sub)}
    </div>
    <p class="card-body">${richText(entries[key].text)}</p>
    ${cardFoot(key, { offerWrite })}
  </div>`;
}

function renderFilter() {
  const list = filteredEntries();
  const isPeriod = filter.kind === 'period', isThread = filter.kind === 'thread';
  let html = '<div class="stack fade-in">';
  html += `<button class="back-btn" id="back">‹ zurück</button>`;
  if (isThread) {
    // Ein Faden: wie ein Gespräch mit dem eigenen früheren Ich.
    const span = list.length > 1 ? `${shortDate(list[0].key)} – ${shortDate(list[list.length - 1].key)}` : '';
    html += `<div class="filter-head"><span class="filter-period">↩ Faden</span>` +
      `<span class="card-sub">${esc(span)}</span></div>`;
    if (!list.length) html += `<p class="empty-text">Hier ist es still.</p>`;
  } else if (isPeriod) {
    // Blättern statt Kalender-Raster; nicht über heute hinaus. Ohne Zählung —
    // eine Woche ist kein „3 von 7“.
    const next = shiftPeriod(filter, 1);
    html += `<div class="filter-head"><div class="period-nav">` +
      `<button class="date-nav" data-shift="-1" aria-label="Zeitraum davor">‹</button>` +
      `<span class="filter-period">${esc(periodLabel(filter))}</span>` +
      `<button class="date-nav" data-shift="1" aria-label="Zeitraum danach" ${next.from > todayKey() ? 'disabled' : ''}>›</button>` +
      `</div></div>`;
    if (!list.length) html += `<p class="empty-text">Hier ist es still.</p>`;
  } else {
    const cls = filter.kind === '@' ? 'c-person' : 'c-tag';
    html += `<div class="filter-head"><span class="filter-token ${cls}">${esc(filter.kind + filter.name)}</span>` +
      `<span class="card-sub">${list.length} ${list.length === 1 ? 'Eintrag' : 'Einträge'}</span></div>`;
  }
  // Im Monat selbst führt das Datum nirgendwohin Neues — dort bleibt es Text.
  const linkDates = !(isPeriod && filter.unit === 'month');
  list.forEach(e => {
    const date = linkDates ? dateLink(e.key, humanDate(e.key)) : `<span class="card-sub">${humanDate(e.key)}</span>`;
    // Im Faden führt „fortgesetzt am …“ nur in denselben Faden — dort weglassen.
    html += `<div class="card" data-day="${esc(e.key)}"><div class="card-head">${date}</div>` +
      `<p class="card-body">${richText(e.text)}</p>${cardFoot(e.key, { showContinued: !isThread })}</div>`;
  });
  html += '</div>';
  main.className = '';
  main.innerHTML = html;
  document.getElementById('back').onclick = () => { view = 'reflect'; render(); };
  main.querySelectorAll('[data-kind]').forEach(el =>
    el.onclick = () => openToken(el.dataset.kind, el.dataset.name));
  main.querySelectorAll('[data-shift]').forEach(el => {
    if (!el.disabled) el.onclick = () => openPeriod(shiftPeriod(filter, Number(el.dataset.shift)));
  });
  bindPeriodLinks();
}

function renderNav() {
  const w = view === 'write', r = view === 'reflect' || view === 'filter';
  nav.innerHTML = `
    <button class="nav-btn ${w ? 'active' : ''}" id="nav-write"><span class="nav-glyph">筆</span><span class="nav-label">Schreiben</span></button>
    <button class="nav-btn ${r ? 'active' : ''}" id="nav-reflect"><span class="nav-glyph">省</span><span class="nav-label">Zurückblicken</span></button>
    <button class="nav-btn" id="nav-import"><span class="nav-glyph">入</span><span class="nav-label">Import</span></button>
    <button class="nav-btn" id="nav-export"><span class="nav-glyph">出</span><span class="nav-label">Export</span></button>
  `;
  document.getElementById('nav-write').onclick = () => openWrite(todayKey());
  document.getElementById('nav-reflect').onclick = () => { view = 'reflect'; render(); };
  document.getElementById('nav-export').onclick = exportMarkdown;
  document.getElementById('nav-import').onclick = () => importInput.click();
}

// Tokens im Text sind <span role="button"> — Enter/Leertaste wie ein Klick.
main.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('span[role="button"]')) {
    e.preventDefault();
    e.target.click();
  }
});

// ── Neuer Tag beim Zurückkehren ───────────────────────────────
// Eine installierte App bleibt oft tagelang im Hintergrund offen. Kommt sie
// nach Mitternacht zurück, soll „heute“ auch heute sein — sonst landet der
// Morgen-Eintrag auf dem Vortag. Beim aktiven Schreiben über Mitternacht
// passiert nichts (es gibt kein Ereignis): man schreibt für den Tag, den man begann.
function onResume() {
  if (document.visibilityState === 'hidden') return;
  const prevDay = renderedDay;
  if (todayKey() === prevDay) return;
  if (view === 'write' && activeDate === prevDay) {
    const hadDraft = prevDay in drafts;     // bleibt gespeichert → „Offene Entwürfe“
    openWrite(todayKey());
    if (hadDraft) toast('Ein neuer Tag · dein Entwurf wartet unter „Offene Entwürfe“');
  } else {
    render();                               // Rückblick, Datums-Beschriftungen auffrischen
  }
}
document.addEventListener('visibilitychange', onResume);
window.addEventListener('pageshow', onResume);

importInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => importMarkdown(String(reader.result));
  reader.onerror = () => toast('Datei konnte nicht gelesen werden');
  reader.readAsText(file);
  importInput.value = '';
});

// ── Service Worker ────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  // Neue Version aktiv → sanft anbieten. Neu laden ist sicher, Entwürfe sind gespeichert.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) toast('Neue Version bereit', 'Neu laden', () => location.reload());
  });
}

if (view === 'write') openWrite(todayKey()); else render();
