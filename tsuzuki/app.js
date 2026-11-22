// ───────────────────────────────────────────────────────────────
// Tsuzuki 続き — Micro-Journaling (Vanilla JS, kein Build)
// localStorage · Reflect-First · Datums-Sprung · MD Import/Export
// ───────────────────────────────────────────────────────────────
'use strict';

// Kernlogik (Tokens, Datum, Markdown-Format) liegt in core.js — DOM-frei und getestet.
const {
  todayKey, addDays, tokenize, extractTokens, entryHasToken, esc, buildMarkdown, parseMarkdown,
} = TsuzukiCore;

const STORE = 'tsuzuki.entries.v1';
const DRAFTS = 'tsuzuki.drafts.v1';   // ungespeicherte Entwürfe — überleben App-Neustart
const AI = '#3a4a6b', TAG = '#8a6d3b';

const GREETINGS = [
  'Was trägst du heute?', 'Ein Gedanke genügt.', 'Wie war dieser Tag wirklich?',
  'Halte fest, was bleibt.', 'Nichts muss perfekt sein.', 'Erzähl es deinem späteren Ich.',
];
const REFLECT_GREETINGS = [
  'Bevor du schreibst — ein Blick zurück.', 'Wo du warst.', 'Was war.',
];
const EMPTY = [
  'Noch ist der Weg jung. Schreib, wann immer dir danach ist.',
  'Mit der Zeit füllt sich dieser Raum mit Vergangenem.',
];

// ── State ─────────────────────────────────────────────────────
let entries = load(STORE);
let drafts = load(DRAFTS);  // { 'JJJJ-MM-TT': text } — nur Tage, deren Text vom Eintrag abweicht
// Reflect-First: Start auf Rückblick, außer es gibt noch nichts.
let view = Object.keys(entries).length === 0 ? 'write' : 'reflect';
let filter = null;          // {kind:'@'|'#', name}
let activeDate = todayKey();// welcher Tag im Schreiben gerade offen ist
let greeting = '';          // Impuls-Satz — wird nur beim Öffnen eines Tages gewählt

// ── Persistence ───────────────────────────────────────────────
function load(key) {
  try { return JSON.parse(localStorage.getItem(key)) || {}; }
  catch (e) { return {}; }
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(entries)); }
  catch (e) { toast('Speichern fehlgeschlagen — Speicher voll?'); }
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
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
}
function relativeDay(key) {
  if (key === todayKey()) return 'heute';
  if (key === addDays(todayKey(), -1)) return 'gestern';
  return humanDate(key);
}

// ── Tokens im Text ────────────────────────────────────────────
function richText(text) {
  return tokenize(text).map(p => {
    if (p.type === 'text') return esc(p.value);
    const cls = p.type === '@' ? 'person' : 'tag';
    return `<span class="tok ${cls}" data-kind="${p.type}" data-name="${esc(p.value)}">${esc(p.type + p.value)}</span>`;
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
  const sort = o => Object.entries(o).sort((a, b) => b[1] - a[1]);
  return { people: sort(people), tags: sort(tags) };
}
function reflectSections() {
  const tk = todayKey();
  const keys = Object.keys(entries).filter(k => k !== tk).sort().reverse();
  const out = { yesterday: null, yearAgo: null, memory: null };
  const yk = addDays(tk, -1);
  if (entries[yk]) out.yesterday = Object.assign({ key: yk }, entries[yk]);
  const [yy, mm, dd] = tk.split('-').map(Number);
  const yak = todayKey(new Date(yy - 1, mm - 1, dd));
  if (entries[yak]) out.yearAgo = Object.assign({ key: yak }, entries[yak]);
  if (keys.length >= 3) {
    const seed = Number(tk.replace(/-/g, ''));
    const pick = keys[seed % keys.length];
    out.memory = Object.assign({ key: pick }, entries[pick]);
  }
  return out;
}
function filteredEntries() {
  if (!filter) return [];
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
  delete drafts[day];
  saveDrafts();
  if (text) {
    entries[day] = { text, edited: Date.now() };
    save();
    requestPersist();
    toast('Festgehalten');
  } else if (prev) {
    // Leeres Festhalten entfernt den Eintrag — aber mit Rückweg.
    delete entries[day];
    save();
    toast('Eintrag entfernt', 'Rückgängig', () => {
      entries[day] = prev;
      save();
      render();
      toast('Wiederhergestellt');
    });
  } else {
    toast('Noch leer — nichts festzuhalten');
  }
  render();
}
function openWrite(day) {
  activeDate = day;
  greeting = day === todayKey() ? pick(GREETINGS) : 'Ein Tag, den du nachträgst.';
  view = 'write';
  render();
}
function openToken(kind, name) { filter = { kind, name }; view = 'filter'; render(); }
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
  let added = 0, existing = 0;
  found.forEach(({ key, text }) => {
    if (entries[key]) { existing++; return; }               // bestehende nie überschreiben
    entries[key] = { text, edited: Date.now() };
    added++;
  });
  if (added) save();
  const parts = [`${added} importiert`];
  if (existing) parts.push(`${existing} schon vorhanden`);
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

function render() {
  const n = Object.keys(entries).length;
  headMeta.textContent = n ? `${n} ${n === 1 ? 'Eintrag' : 'Einträge'}` : '—';
  if (view === 'write') renderWrite();
  else if (view === 'reflect') renderReflect();
  else if (view === 'filter') renderFilter();
  renderNav();
}

function renderWrite() {
  const isToday = activeDate === todayKey();
  if (!greeting) greeting = isToday ? pick(GREETINGS) : 'Ein Tag, den du nachträgst.';

  // Das Gerüst wird einmal pro Tag/Ansicht gebaut — beim Tippen nie neu
  // (sonst springt der Cursor, die Tastatur-Komposition bricht ab, Undo geht verloren).
  main.className = 'fade-in';
  main.innerHTML = `
    <div class="date-line">
      <button class="date-nav" id="day-prev" aria-label="Tag davor">‹</button>
      <span>${relativeDay(activeDate)}</span>
      <button class="date-nav" id="day-next" aria-label="Tag danach" ${isToday ? 'disabled' : ''}>›</button>
    </div>
    <div class="prompt">${esc(greeting)}</div>
    <textarea id="ta" aria-label="Eintrag" placeholder="Kaffee mit @Franzi #chillen …" spellcheck="true"></textarea>
    <div class="chip-row" id="chips"></div>
    <div class="write-foot">
      <span class="word-count" id="word-count"></span>
      <button class="save-btn" id="save">Festhalten</button>
    </div>
    <p class="wabi">Schreib einfach. <span style="color:${AI}">@Namen</span> und <span style="color:${TAG}">#Themen</span> erkennt Tsuzuki von selbst.</p>
  `;
  const ta = document.getElementById('ta');
  ta.value = currentText(activeDate);   // per value, nicht per HTML — führende Zeilenumbrüche bleiben erhalten
  updateWriteMeta(ta.value);
  ta.addEventListener('input', () => { setDraft(activeDate, ta.value); updateWriteMeta(ta.value); });
  // Cursor ans Ende — nur beim Öffnen, nicht beim Tippen
  ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
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
    tokens.tags.map(t => `<span class="chip tag">#${esc(t)}</span>`).join('');
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const count = words === 0 ? 'noch leer' : words + (words === 1 ? ' Wort' : ' Wörter');
  document.getElementById('word-count').textContent = count + (activeDate in drafts ? ' · Entwurf' : '');
}

function renderReflect() {
  const r = reflectSections();
  const tok = allTokens();
  const anyMemory = r.yesterday || r.yearAgo || r.memory;
  const hasTokens = tok.people.length || tok.tags.length;
  const tk = todayKey();
  const openDrafts = Object.keys(drafts).filter(k => k !== tk).sort().reverse();

  let html = '<div class="stack fade-in">';
  html += `<div class="reflect-greeting">${pick(REFLECT_GREETINGS)}</div>`;

  if (hasTokens) {
    if (tok.people.length) {
      html += `<div><div class="token-group-label">Menschen</div><div class="token-wrap">` +
        tok.people.map(([name, c]) => `<button class="tok-btn person" data-kind="@" data-name="${esc(name)}">@${esc(name)}<span class="tok-count">${c}</span></button>`).join('') +
        `</div></div>`;
    }
    if (tok.tags.length) {
      html += `<div><div class="token-group-label">Themen</div><div class="token-wrap">` +
        tok.tags.map(([name, c]) => `<button class="tok-btn tag" data-kind="#" data-name="${esc(name)}">#${esc(name)}<span class="tok-count">${c}</span></button>`).join('') +
        `</div></div>`;
    }
  }

  if (r.yesterday) html += card('Gestern', shortDate(r.yesterday.key), r.yesterday.text, true);
  if (r.yearAgo) html += card('Vor einem Jahr', shortDate(r.yearAgo.key), r.yearAgo.text, true, true);
  if (r.memory) html += card('Erinnerungsweg', humanDate(r.memory.key), r.memory.text, true);

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
  document.getElementById('go-write').onclick = () => openWrite(todayKey());
}

function card(label, sub, text, withAccentLabel, accentBorder) {
  return `<div class="card${accentBorder ? ' accent' : ''}">
    <div class="card-head">
      <span class="card-label${accentBorder ? ' accent' : ''}">${label}</span>
      <span class="card-sub">${sub}</span>
    </div>
    <p class="card-body">${richText(text)}</p>
  </div>`;
}

function renderFilter() {
  const list = filteredEntries();
  const color = filter.kind === '@' ? AI : TAG;
  let html = '<div class="stack fade-in">';
  html += `<button class="back-btn" id="back">‹ zurück</button>`;
  html += `<div class="filter-head"><span class="filter-token" style="color:${color}">${esc(filter.kind + filter.name)}</span>` +
    `<span class="card-sub">${list.length} ${list.length === 1 ? 'Eintrag' : 'Einträge'}</span></div>`;
  list.forEach(e => {
    html += `<div class="card"><div class="card-head"><span class="card-sub">${humanDate(e.key)}</span></div>` +
      `<p class="card-body">${richText(e.text)}</p></div>`;
  });
  html += '</div>';
  main.className = '';
  main.innerHTML = html;
  document.getElementById('back').onclick = () => { view = 'reflect'; render(); };
  main.querySelectorAll('[data-kind]').forEach(el =>
    el.onclick = () => openToken(el.dataset.kind, el.dataset.name));
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

importInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => importMarkdown(String(reader.result));
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
