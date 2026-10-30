// Vom lokalen Fuda-Server ausgeliefert: API relativ. Von woanders (GitHub Pages): API beim lokalen
// Fuda-Server aus <meta name="fuda-server">. Als lokale Datei (file://) geöffnet: In-Memory-Demo.
const servedByFuda = ['localhost', '127.0.0.1'].includes(location.hostname);
const FUDA_SERVER = document.querySelector('meta[name="fuda-server"]')?.content || 'http://localhost:3000';
const API_URL = (servedByFuda ? '' : FUDA_SERVER) + '/api/notes';
const useBackend = location.protocol !== 'file:';
const STATUS_BACKEND = '🟢 Lokale .md Dateien (Node.js)';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

// Fallback-Demodaten (inkl. definierter Begriffe & virtuellem Begriff "Geschäftsartenbezugszahl")
let notes = [
  {
    filename: '20261023-073743-849m.md',
    lastModified: new Date().toISOString(),
    raw: `# Altersprüfung Validator
Prüft Volljährigkeit (@IsAdult) direkt beim Eingang des Kreditantrags.

\`\`\`java
public boolean isValid(LocalDate birthDate, ConstraintValidatorContext ctx) {
    if (birthDate == null) return false;
    return Period.between(birthDate, LocalDate.now()).getYears() >= 18;
}
\`\`\`

implementiert:: [[Antragsteller]]
zu:: [[Immo-DV]]
#java #snippet`
  },
  {
    filename: '20261021-105907-u3b0.md',
    lastModified: new Date(Date.now() - 3600 * 1000).toISOString(),
    raw: `# Testuser
Name: \`Erika Mustermann\`
RZBK: \`1234\`
Personennummer: \`00000001\`
Umgebung: Test

zu:: [[Immo-DV]]
zu:: [[Antragsteller]]
#testdaten`
  },
  {
    filename: '20261021-083441-rctt.md',
    lastModified: '2026-10-23T14:20:00.000Z',
    raw: `# Mapping Sonderkredit
Bei Förderkrediten muss das Feld GABZ zwingend im Request übergeben werden.

zu:: [[Geschäftsartenbezugszahl]]
#immo-dv #frontend`
  },
  {
    filename: '20261021-080601-omis.md',
    lastModified: '2026-10-23T11:05:00.000Z',
    raw: `# Immo-DV Jobs
Jobs laufen an jedem Montag, Mittwoch und Freitag des Monats SOWIE zusätzlich am 16. Tag jedes Monats (unabhängig davon, welcher Wochentag der 16. ist), jeweils um 10:00 Uhr.

definition:: [[Immo-DV]]
#immo-dv #fachregel`
  },
  {
    filename: '20261020-082647-3asd.md',
    lastModified: '2026-10-21T09:15:00.000Z',
    raw: `# Antragsteller
Der Antragsteller ist eine natürliche Person, die einen Kreditantrag stellt.
Muss bei Antragstellung volljährig sein und einen Wohnsitz in Deutschland nachweisen.

definition:: [[Antragsteller]]
#domäne #kredit`
  },
  {
    filename: '20261018-182118-fvn7.md',
    lastModified: '2026-10-21T08:30:00.000Z',
    raw: `# Testuser
Name: \`Max Mustermann\`
RZBK: \`1234\`
Zugang: steht im Passwort-Tresor, nicht in Notizen

#testdaten`
  }
];

let editingFilename = null;
let editDraft = null; // Text im Inline-Editor, überlebt Neu-Rendern (Suche, Menüs, neue Blöcke)
let editError = null; // Meldung im Inline-Editor (Konflikt, Server weg, leerer Text)
let selectedFilename = null; // per ⋮, ↓ oder Tab gewählter Block: zeigt seine Aktionen, nimmt E C O Entf
let selectable = [];         // Dateinamen der angezeigten Blöcke in Bildschirm-Reihenfolge (für ↓ ↑)

const PAGE_SIZE = 50;
let visibleLimit = PAGE_SIZE;
let renderedViewKey = null; // Suche, für die der Stream zuletzt gerendert wurde

const omnibar = document.getElementById('omnibar');
const clearXBtn = document.getElementById('clear-omnibar-x');
const hint = document.getElementById('omnibar-hint');
const modeIndicator = document.getElementById('mode-indicator');
const keyHint = document.getElementById('key-hint');
const metaBar = document.getElementById('meta-bar');
const indexOverviewEl = document.getElementById('index-overview');
const streamEl = document.getElementById('stream');
const defSlotEl = document.getElementById('definition-slot');
const termHeaderEl = document.getElementById('term-header');
const counterEl = document.getElementById('block-counter');
const acBox = document.getElementById('autocomplete-box');
const storageBadge = document.getElementById('storage-badge');
const toastEl = document.getElementById('toast');
const toastText = document.getElementById('toast-text');
const toastUndoBtn = document.getElementById('toast-undo');
const helpPanel = document.getElementById('help-panel');

// ============================================================================
// 1. INITIALISIERUNG: VERSUCHE NODE.JS SERVER ZU ERREICHEN
// ============================================================================
async function initApp() {
  if (useBackend) {
    try {
      notes = sortNotes(await api(''));
    } catch (e) {
      notes = [];
      setStatus(`🔴 Laden ging nicht – ${e.message}`, true);
    }
  } else {
    sortNotes(notes);
    setStatus('🟠 Browser-Demo (In-Memory, wird nicht gespeichert)');
  }
  renderStream();
}

// Wirft bei HTTP-Fehlern, damit Aufrufer nie eine Fehlerantwort als Notiz übernehmen.
// Meldungen haben feste Orte: Die Statusanzeige zeigt nur die Verbindung und wird nur hier gesetzt
// (antwortet der Server, ist sie grün, sonst rot). Ergebnisse von Aktionen zeigt showToast(),
// Fehler beim Bearbeiten stehen im Editor (editError).
async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(API_URL + path, options);
  } catch {
    setStatus('🔴 Server nicht erreichbar – start.cmd ausführen', true);
    throw new Error('Server nicht erreichbar');
  }
  setStatus(STATUS_BACKEND);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { status: res.status, body });
  return body;
}

// Zurück im Fenster (z. B. nach VS Code): außerhalb geänderte Dateien nachladen.
// Während eines Inline-Edits nicht neu rendern, sonst verliert der Editor Fokus und Text.
window.addEventListener('focus', async () => {
  if (!useBackend || editingFilename) return;
  try {
    const fresh = sortNotes(mergeNotes(await api('')));
    const signature = list => list.map(n => n.filename + n.lastModified).join('|');
    if (signature(fresh) !== signature(notes)) {
      notes = fresh;
      renderStream();
    }
  } catch (e) {
    if (e.status) showToast(`Neu laden ging nicht – ${e.message}`); // Verbindung zeigt schon api()
  }
});

function notePath(filename) {
  return `/${encodeURIComponent(filename)}`;
}

function setStatus(text, isError = false) {
  storageBadge.textContent = text;
  storageBadge.classList.toggle('bg-red-100', isError);
  storageBadge.classList.toggle('text-red-800', isError);
}

function randomShortId(length = 4) {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  let res = '';
  for (let i = 0; i < length; i++) res += chars.charAt(Math.floor(Math.random() * chars.length));
  return res;
}

function formatDayLabel(isoString) {
  if (!isoString) return 'Heute';
  const d = new Date(isoString);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return 'Heute';
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Gestern';
  // Ab dem Vorjahr mit Jahreszahl, sonst wäre „Mi., 01. Jan.“ mehrdeutig
  const year = d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {};
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: 'short', ...year });
}

// Erstellungszeitpunkt aus dem Dateinamen (YYYYMMDD-HHmmss-xxxx.md): Bearbeiten, git pull oder ein
// neuer Rechner ändern ihn nicht. Dateien mit anderem Namen fallen auf die letzte Änderung zurück.
function createdAt(note) {
  const m = note.filename.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-/);
  const d = m && new Date(m[1], m[2] - 1, m[3], m[4], m[5], m[6]);
  return d && !isNaN(d) ? d.toISOString() : note.lastModified;
}

// Neueste zuerst. In derselben Sekunde angelegte Blöcke nach letzter Änderung (der gerade gespeicherte
// steht oben), dann nach Dateiname – so ist die Reihenfolge nach jedem Laden dieselbe.
// Der Zeitstempel wird je Block einmal berechnet, nicht bei jedem Vergleich (zählt bei 10.000 Blöcken).
function sortNotes(list) {
  const keyed = list.map(n => ({ n, created: createdAt(n) }));
  keyed.sort((a, b) => b.created.localeCompare(a.created)
    || b.n.lastModified.localeCompare(a.n.lastModified)
    || b.n.filename.localeCompare(a.n.filename));
  keyed.forEach((k, i) => { list[i] = k.n; });
  return list;
}

// Unveränderte Blöcke bleiben beim Nachladen dieselben Objekte: Ihre Muster (marksOf) müssen dann
// nicht neu berechnet werden. Neue und geänderte kommen aus `fresh`.
function mergeNotes(fresh) {
  const known = new Map(notes.map(n => [n.filename, n]));
  return fresh.map(n => {
    const old = known.get(n.filename);
    return old && old.lastModified === n.lastModified && old.raw === n.raw ? old : n;
  });
}

// ============================================================================
// MUSTER: Code, Tags, Links, Relationen und Definitionen – die Regeln von Hitokoto (dort markup.ts),
// damit beide Werkzeuge auf denselben Notizen dasselbe erkennen und finden. Sie stehen nur hier;
// Index, Suche, Vorschläge und Darstellung nutzen dieselben.
// ============================================================================
// Code-Block: ``` oder ~~~ (mindestens drei, bis zu drei Leerzeichen eingerückt), geschlossen von
// derselben Zeichenart, mindestens so lang, allein auf der Zeile. Ein offener Block reicht bis zum Ende.
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const INLINE_CODE = /(`+)[^`][\s\S]*?\1/g;
// Tag: "#" am Zeilenanfang oder nach Leerraum, dann ein Buchstabe. "### Titel", "a#b" und "#4712" sind keine Tags.
const TAG_NAME = '\\p{L}[\\p{L}\\p{N}_-]*';
const TAG = new RegExp(`(^|\\s)#(${TAG_NAME})`, 'gu');
const LINK = /\[\[([^[\]\n]+)\]\]/g;
// Relation: Zeile, die mit "name:: [[Ziel]]" beginnt. Eine pro Zeile; im Satz, eingerückt oder nach
// einem Listenpunkt ist es keine Relation, sondern Text mit Link.
const RELATION_NAME = '[\\p{L}\\p{N}_-]+';
const RELATION = new RegExp(`^(${RELATION_NAME})::[ \\t]*\\[\\[([^[\\]\\n]+)\\]\\]`, 'u');
// Beide Schreibweisen machen einen Block zur Definition: definition:: (Fuda) und definiert:: (Hitokoto)
const DEFINITION_KEYS = ['definition', 'definiert'];

// Die eine Regel für Code-Blöcke: [{ from, to, closed, lang }] als Zeilennummern samt Fence-Zeilen,
// lang = das erste Wort nach dem Fence (```java); open = am Ende ist noch ein Block offen
function scanFences(text) {
  const lines = text.split('\n');
  const blocks = [];
  let fence = null;
  let from = 0;
  let lang = '';
  lines.forEach((line, i) => {
    const marker = FENCE.exec(line)?.[1];
    if (!fence) {
      if (marker) {
        fence = marker;
        from = i;
        lang = line.trim().slice(marker.length).trim().split(/\s+/)[0];
      }
    } else if (marker && marker[0] === fence[0] && marker.length >= fence.length && !line.trim().slice(marker.length)) {
      blocks.push({ from, to: i, closed: true, lang });
      fence = null;
    }
  });
  if (fence) blocks.push({ from, to: lines.length - 1, closed: false, lang });
  return { lines, blocks, open: fence !== null };
}

// Was ein Code-Block enthält: die Zeilen zwischen den Fences
function codeOf({ from, to, closed }, lines) {
  return lines.slice(from + 1, closed ? to : to + 1).join('\n').replace(/\r/g, '').replace(/\n+$/, '');
}

// Inline-Code und Links: Darin ist ein "#" kein Tag (die Darstellung spart sie beim Tag-Suchen aus)
const CODE_OR_LINK = new RegExp(`${INLINE_CODE.source}|${LINK.source}`, 'g');

// Text ohne Code (Blöcke und Inline-Code), Grundlage aller Muster; die Zeilen bleiben, wo sie waren
function stripCode(text) {
  const { lines, blocks } = scanFences(text);
  for (const { from, to } of blocks) for (let i = from; i <= to; i++) lines[i] = '';
  return lines.join('\n').replace(INLINE_CODE, ' ');
}

// Steht vor dem Cursor ein geöffneter, noch nicht geschlossener Code-Block?
function isInOpenFence(textBeforeCursor) {
  return scanFences(textBeforeCursor).open;
}

// Textsuche wie Hitokoto: Groß/klein und Umlaut-Schreibweise egal, "Geklärt" und "geklaert" sind gleich
const UMLAUTS = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };
function fold(text) {
  return text.toLowerCase().replace(/[äöüß]/g, c => UMLAUTS[c]);
}

// Obsidian-Links wie in Hitokoto: In [[Ziel|Text]], [[Ziel\|Text]] (so schreibt Obsidian in Tabellen)
// und [[Ziel#Abschnitt]] ist nur „Ziel“ der Begriff. [[#Abschnitt]] ohne Ziel ist kein Begriff.
function linkTarget(inner) {
  return inner.split(/\\?\|/)[0].split('#')[0].trim();
}

// Was im Text erscheint: bei [[Ziel|Text]] der Text, sonst alles in den Klammern
function linkLabel(inner) {
  return (inner.split(/\\?\|/)[1] ?? inner).trim();
}

function isDefinitionKey(key) {
  return DEFINITION_KEYS.includes(key.toLowerCase());
}

// Ohne Dubletten, Groß/klein egal; es bleibt die erste Schreibweise
function unique(list) {
  const seen = new Set();
  return list.filter(x => !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()));
}

// Tags, Links, Relationen und definierte Begriffe (klein geschrieben) eines Blocks, ohne Code.
// Pro Text nur einmal berechnet; ändert sich raw, wird neu gerechnet.
const marksCache = new WeakMap();
function marksOf(note) {
  let marks = marksCache.get(note);
  if (marks?.raw !== note.raw) {
    const plain = stripCode(note.raw);
    // Ein "#" in einem Link ([[C#]], [[A #b]]) gehört zum Link: Links vor der Tag-Suche ausblenden
    const withoutLinks = plain.replace(LINK, m => '\u0001'.repeat(m.length));
    const relations = plain.split('\n').map(line => RELATION.exec(line))
      .filter(m => m && linkTarget(m[2]))
      .map(m => ({ key: m[1], target: linkTarget(m[2]) }));
    marks = {
      raw: note.raw,
      folded: fold(note.raw),
      tags: unique([...withoutLinks.matchAll(TAG)].map(m => m[2])),
      links: unique([...plain.matchAll(LINK)].map(m => linkTarget(m[1])).filter(Boolean)),
      relations,
      definitions: unique(relations.filter(r => isDefinitionKey(r.key) && r.target).map(r => r.target.toLowerCase())),
    };
    marksCache.set(note, marks);
  }
  return marks;
}

// Begriff (klein) -> Dateiname der geltenden Definition. Gibt es mehrere, gilt die zuletzt angelegte
// (notes ist neueste zuerst sortiert); die älteren bleiben als Verlauf sichtbar („Frühere Definition“).
function currentDefinitions() {
  const current = new Map();
  for (const n of notes) {
    for (const term of marksOf(n).definitions) if (!current.has(term)) current.set(term, n.filename);
  }
  return current;
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Wert als JS-String-Literal für Inline-Handler: onclick="fn(${jsArg(x)})"
// JSON.stringify escaped Quotes, Backslashes und Zeilenumbrüche, escapeHtml schützt das Attribut.
function jsArg(value) {
  return escapeHtml(JSON.stringify(String(value)));
}

// ============================================================================
// SUCHE: genau die Suchformen von Hitokoto (dort search.ts). Was nach "?" steht, ist immer eine Form:
//   "Wortfolge"    -> ganze Wörter, Groß/klein exakt: ? "VN" findet nicht "VNR"
//   #tag           -> Blöcke mit diesem Tag
//   [[Begriff]]    -> Blöcke, die darauf verlinken, auch per Relation; reine Textnennungen nicht
//   name::         -> Blöcke mit dieser Relation;  name:: [[Ziel]] -> genau diese Verbindung
//   alles andere   -> Textsuche: Wortteile, alle müssen vorkommen, Groß/klein und ä/ae egal
// Einzige Fuda-Erweiterung: definition:: und definiert:: finden beide Schreibweisen.
// ============================================================================
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const QUERY_TAG = new RegExp(`^#(${TAG_NAME})$`, 'u');
const QUERY_LINK = /^\[\[([^[\]\n]+)\]\]$/;
const QUERY_RELATION = new RegExp(`^(${RELATION_NAME})::(?:\\s*\\[\\[([^[\\]\\n]+)\\]\\])?$`, 'u');

// rest: die Eingabe nach "?", getrimmt und nicht leer
function parseQuery(rest) {
  const exact = /^"([^"]+)"$/.exec(rest);
  if (exact) {
    const phrase = escapeRegExp(exact[1].trim()).replace(/\s+/g, '\\s+');
    return { form: 'exact', term: exact[1].trim(), pattern: new RegExp(`(?<![\\p{L}\\p{N}])${phrase}(?![\\p{L}\\p{N}])`, 'u') };
  }
  const tag = QUERY_TAG.exec(rest);
  if (tag) return { form: 'tag', key: tag[1].toLowerCase() };
  const link = QUERY_LINK.exec(rest);
  if (link && linkTarget(link[1])) return { form: 'link', key: linkTarget(link[1]).toLowerCase() };
  const relation = QUERY_RELATION.exec(rest);
  if (relation) {
    const key = relation[1].toLowerCase();
    const target = relation[2] && linkTarget(relation[2]).toLowerCase();
    return { form: 'relation', keys: isDefinitionKey(key) ? DEFINITION_KEYS : [key], target: target || null };
  }
  return { form: 'text', words: fold(rest).split(/\s+/) };
}

function matchesQuery(note, query) {
  const marks = marksOf(note);
  switch (query.form) {
    case 'text': return query.words.every(word => marks.folded.includes(word));
    case 'exact': return query.pattern.test(note.raw);
    case 'tag': return marks.tags.some(t => t.toLowerCase() === query.key);
    case 'link': return marks.links.some(l => l.toLowerCase() === query.key);
    case 'relation': return marks.relations.some(r => query.keys.includes(r.key.toLowerCase())
      && (!query.target || r.target.toLowerCase() === query.target));
  }
}

// Fuda: Bei einem einzelnen Wort, "…" oder [[Begriff]] steht die geltende Definition dieses Begriffs
// oben. Verglichen wird gefaltet, also findet auch ? antragsteller die Definition von „Antragsteller“.
function definitionFor(query, definitions) {
  const term = query.form === 'text' && query.words.length === 1 ? query.words[0]
    : query.form === 'exact' ? fold(query.term)
    : query.form === 'link' ? fold(query.key) : null;
  if (!term) return null;
  for (const [key, filename] of definitions) if (fold(key) === term) return filename;
  return null;
}

// ============================================================================
// 2. ?-INDEX-ANSICHT BERECHNEN (ARTEN/TAGS, BEGRIFFE, VIRTUELLE BEGRIFFE, RELATIONEN)
// ============================================================================
function renderQuestionOverview() {
  // Wie Hitokoto: gezählt wird pro Block, angezeigt in der häufigsten Schreibweise; bei gleicher
  // Anzahl in der Reihenfolge des ersten Vorkommens (darum älteste Blöcke zuerst durchgehen).
  // Jeweils: kleingeschriebener Schlüssel -> { name, count (Anzahl Blöcke), spellings }
  const tagCounts = new Map();
  const linkCounts = new Map();        // alle [[Links]], auch die in Relationen
  const relationCounts = new Map();
  const definitionCounts = new Map();  // Begriffe mit definition:: bzw. definiert::
  const count = (map, spelling) => {
    const entry = map.get(spelling.toLowerCase()) || { name: spelling, count: 0, spellings: new Map() };
    entry.count++;
    entry.spellings.set(spelling, (entry.spellings.get(spelling) || 0) + 1);
    entry.name = [...entry.spellings].reduce((best, s) => (s[1] > best[1] ? s : best))[0];
    map.set(spelling.toLowerCase(), entry);
  };

  [...notes].reverse().forEach(n => {
    const marks = marksOf(n);
    marks.tags.forEach(t => count(tagCounts, t));
    marks.links.forEach(l => count(linkCounts, l));
    unique(marks.relations.map(r => r.key)).forEach(k => count(relationCounts, k));
    marks.definitions.forEach(d => count(definitionCounts, d));
  });

  // Aufteilen in "Definierte Begriffe" vs. "Virtuelle Begriffe (Konzepte ohne Definition)"
  const definedList = [];
  const virtualList = [];
  for (const [lower, link] of linkCounts) {
    if (definitionCounts.has(lower)) definedList.push({ ...link, definitions: definitionCounts.get(lower).count });
    else virtualList.push(link);
  }

  // Sortieren nach Häufigkeit absteigend
  const byCount = (a, b) => b.count - a.count;
  const sortedTags = [...tagCounts.values()].sort(byCount);
  definedList.sort(byCount);
  virtualList.sort(byCount);
  const sortedRels = [...relationCounts.values()].sort(byCount);

  return `
        <!-- Sektion 1: ARTEN (Tags) -->
        <section>
          <h3 class="text-xs tracking-widest uppercase text-ink-muted font-medium mb-3">Arten</h3>
          <div class="flex flex-wrap gap-x-5 gap-y-2.5">
            ${sortedTags.length ? sortedTags.map(({ name, count }) => `
              <button onclick="filterBy(${jsArg('? #' + name)})" class="text-base text-[#3D5A45] hover:underline flex items-baseline gap-1 transition-colors">
                <span>#${escapeHtml(name)}</span>
                <span class="text-xs text-ink-muted font-mono">${count}</span>
              </button>
            `).join('') : '<span class="text-xs text-ink-muted">Noch keine #Tags vorhanden</span>'}
          </div>
        </section>

        <!-- Sektion 2: BEGRIFFE (definiert via definition:: oder definiert:: [[...]]); mehrere Definitionen = Verlauf -->
        <section>
          <h3 class="text-xs tracking-widest uppercase text-ink-muted font-medium mb-3">Begriffe (Definiert)</h3>
          <div class="flex flex-wrap gap-x-6 gap-y-2.5">
            ${definedList.length ? definedList.map(item => `
              <button onclick="filterBy(${jsArg('? [[' + item.name + ']]')})" class="text-base text-[#5B2C41] font-medium hover:underline flex items-baseline gap-1.5 transition-colors">
                <span class="text-xs opacity-75">📖</span>
                <span>${escapeHtml(item.name)}</span>
                <span class="text-xs text-ink-muted font-mono">${item.count}</span>
                ${item.definitions > 1 ? `<span class="text-xs font-normal text-amber-900/80">· ${item.definitions} Definitionen</span>` : ''}
              </button>
            `).join('') : '<span class="text-xs text-ink-muted">Noch keine definierten Begriffe</span>'}
          </div>
        </section>

        <!-- Sektion 3: VIRTUELLE BEGRIFFE (Verlinkte Konzepte ohne eigene Definition) -->
        <section>
          <div class="flex items-center gap-2 mb-3">
            <h3 class="text-xs tracking-widest uppercase text-ink-muted font-medium">Virtuelle Begriffe (Konzepte ohne Definition)</h3>
          </div>
          <div class="flex flex-wrap gap-x-6 gap-y-2.5">
            ${virtualList.length ? virtualList.map(item => `
              <div class="inline-flex items-baseline gap-1.5 group">
                <button onclick="filterBy(${jsArg('? [[' + item.name + ']]')})" class="text-base text-[#6A3B52] hover:underline flex items-baseline gap-1 border-b border-dashed border-[#6A3B52]/40">
                  <span>${escapeHtml(item.name)}</span>
                  <span class="text-xs text-ink-muted font-mono">${item.count}</span>
                </button>
                <button
                  onclick="prefillDefinition(${jsArg(item.name)})"
                  title="Definition für „${escapeHtml(item.name)}“ jetzt anlegen"
                  class="text-[11px] font-mono text-ink-muted hover:text-ink-primary bg-paper-surface hover:bg-paper-code px-1.5 py-0.2 rounded opacity-70 group-hover:opacity-100 transition-opacity"
                >+ def</button>
              </div>
            `).join('') :'<span class="text-xs text-ink-muted">Alle verwendeten [[Begriffe]] besitzen bereits eine Definition.</span>'}
          </div>
        </section>

        <!-- Sektion 4: RELATIONEN (key::) -->
        <section>
          <h3 class="text-xs tracking-widest uppercase text-ink-muted font-medium mb-3">Relationen</h3>
          <div class="flex flex-wrap gap-x-5 gap-y-2.5">
            ${sortedRels.length ? sortedRels.map(({ name: rel, count }) => `
              <button onclick="filterBy(${jsArg('? ' + rel + '::')})" class="text-sm font-mono text-ink-secondary hover:text-ink-primary bg-paper-surface hover:bg-paper-code px-2.5 py-1 rounded-md border border-paper-border flex items-baseline gap-1.5 transition-colors">
                <span>${escapeHtml(rel)}::</span>
                <span class="text-xs text-ink-muted">${count}</span>
              </button>
            `).join('') : '<span class="text-xs text-ink-muted">Noch keine Relationen vorhanden</span>'}
          </div>
        </section>
      `;
}

// Erlaubt es dem BA, aus einem "Virtuellen Begriff" mit 1 Klick eine echte Definition zu machen
function prefillDefinition(termName) {
  omnibar.value = `# ${termName}\n\n\ndefinition:: [[${termName}]]\n#domäne`;
  omnibar.focus();
  omnibar.setSelectionRange(termName.length + 3, termName.length + 3);
  omnibar.dispatchEvent(new Event('input'));
}

// ============================================================================
// 3. BLOCK-RENDERING (Markdown -> HTML)
// ============================================================================
// [[inner]] als Knopf: zeigt linkLabel, sucht linkTarget. Ohne Ziel ([[#Abschnitt]]) bleibt es Text.
function linkButtonHTML(inner) {
  const target = linkTarget(inner);
  if (!target) return escapeHtml(`[[${inner}]]`);
  return `<button onclick="event.stopPropagation(); filterBy(${jsArg('? [[' + target + ']]')})" class="bg-[#EAE4D7] hover:bg-amber-200/70 text-ink-primary px-1.5 py-0.5 rounded text-xs font-medium inline-flex items-center gap-0.5"><span>↗</span>${escapeHtml(linkLabel(inner))}</button>`;
}

// `Inline-Code`: ein Klick kopiert ihn, außer man hat darin gerade Text markiert
function inlineCodeHTML(code) {
  return `<code onclick="event.stopPropagation(); if (getSelection().isCollapsed) copyText(${jsArg(code)})" title="Klicken zum Kopieren" class="font-mono text-[0.85em] bg-paper-code hover:bg-stone-300/80 px-1 py-0.5 rounded cursor-pointer">${escapeHtml(code)}</code>`;
}

function anchorHTML(url, label) {
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" class="text-[#3D5A45] underline decoration-[#3D5A45]/40 hover:decoration-[#3D5A45] break-all">${label}</a>`;
}

// Inline-Markdown: `code`, [[Begriff]], [Text](url), nackte URLs, **fett**, *kursiv*
// Unterstriche bleiben bewusst Text, damit snake_case-Bezeichner nicht kursiv werden.
// Code nach INLINE_CODE (Abschnitt MUSTER), damit als Code gezeigt wird, was als Code zählt
const INLINE_PATTERN = new RegExp(`${INLINE_CODE.source}|${/\[\[(.+?)\]\]|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"]*[^\s<>".,;:!?)\]])|\*\*(.+?)\*\*|(?<![\w*])\*(?![\s*])(.+?)(?<!\s)\*(?![\w*])/.source}`, 'g');

// Inhalt eines Inline-Codes ohne die Backticks. Wie in Markdown fällt innen je ein Leerzeichen weg,
// wenn auf beiden Seiten eines steht: `` `x` `` zeigt `x`.
function codeSpanText(span, ticks) {
  const inner = span.slice(ticks.length, -ticks.length);
  return inner.length > 1 && inner.startsWith(' ') && inner.endsWith(' ') && inner.trim() ? inner.slice(1, -1) : inner;
}

function renderInline(text) {
  let html = '';
  let last = 0;
  for (const m of text.matchAll(INLINE_PATTERN)) {
    html += escapeHtml(text.slice(last, m.index));
    if (m[1] !== undefined) html += inlineCodeHTML(codeSpanText(m[0], m[1]));
    else if (m[2] !== undefined) html += linkButtonHTML(m[2]);
    else if (m[3] !== undefined) html += anchorHTML(m[4], escapeHtml(m[3]));
    else if (m[5] !== undefined) html += anchorHTML(m[5], escapeHtml(m[5]));
    else if (m[6] !== undefined) html += `<strong class="font-semibold">${renderInline(m[6])}</strong>`;
    else html += `<em>${renderInline(m[7])}</em>`;
    last = m.index + m[0].length;
  }
  return html + escapeHtml(text.slice(last));
}

// Markdown-Tabelle: Eine Trennzeile |---| macht die erste Zeile zum Kopf
function renderTable(rows) {
  // \| trennt keine Zelle (Obsidian schreibt so [[Ziel\|Text]] in Tabellen) und erscheint als |
  const cells = row => row.replace(/^\||(?<!\\)\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
  const isSeparator = row => cells(row).every(c => /^:?-+:?$/.test(c)); // |---|, |--|, |:-:| …
  const hasHeader = rows.length > 1 && isSeparator(rows[1]);
  const head = hasHeader ? cells(rows[0]) : null;
  const body = rows.slice(hasHeader ? 2 : 0).filter(r => !isSeparator(r)).map(cells);
  return `
        <div class="my-2 overflow-x-auto">
          <table class="text-sm border-collapse">
            ${head ? `<thead><tr>${head.map(c => `<th class="text-left font-medium text-ink-secondary border-b border-stone-300 px-3 py-1">${renderInline(c)}</th>`).join('')}</tr></thead>` : ''}
            <tbody>${body.map(r => `<tr>${r.map(c => `<td class="border-b border-paper-border px-3 py-1 align-top">${renderInline(c)}</td>`).join('')}</tr>`).join('')}</tbody>
          </table>
        </div>
      `;
}

// pinned: steht als geltende Definition ganz oben. definitions: currentDefinitions() dieses Renderns,
// damit ein Block weiß, ob er eine frühere Definition ist.
function renderBlockHTML(note, { pinned = false, definitions = new Map() } = {}) {
  if (editingFilename === note.filename) {
    // Fehler beim Speichern (Konflikt, Server weg) stehen im Editor, wo man gerade hinschaut
    return `
          <article class="rounded-xl p-4 -mx-4 bg-[#FAF9F6] border-2 border-stone-400/70 shadow-sm">
            <div class="flex items-center justify-between mb-2 text-xs text-ink-muted font-mono">
              <span>✏️ Inline-Edit: ${escapeHtml(note.filename)}</span>
              <span><kbd class="px-1.5 py-0.5 bg-paper-code rounded text-ink-secondary">Ctrl+Enter</kbd> Speichern · <kbd class="px-1.5 py-0.5 bg-paper-code rounded text-ink-secondary">Esc</kbd> Abbrechen</span>
            </div>
            ${editError ? `<p role="alert" class="mb-2 text-xs font-medium text-red-800 bg-red-50 border border-red-200 rounded px-2 py-1">${escapeHtml(editError)}</p>` : ''}
            <textarea
              id="edit-area-${escapeHtml(note.filename)}"
              class="w-full bg-transparent outline-none font-mono text-xs sm:text-sm text-ink-primary leading-relaxed resize-y min-h-[140px]"
              onkeydown="handleInlineEditKey(event, ${jsArg(note.filename)})"
            >${escapeHtml(editDraft ?? note.raw)}</textarea>
            <div class="mt-2 flex justify-end gap-2">
              <button onclick="cancelInlineEdit()" class="text-xs px-3 py-1 rounded text-ink-secondary hover:bg-paper-code">Abbrechen</button>
              <button onclick="saveInlineEdit(${jsArg(note.filename)})" class="text-xs px-3 py-1 rounded bg-ink-primary text-[#F6F4F0] font-medium hover:opacity-90">Speichern</button>
            </div>
          </article>
        `;
  }

  // Code-Blöcke nach derselben Regel wie die Muster (scanFences); ein offener Block reicht bis zum Ende
  const { lines, blocks } = scanFences(note.raw);
  const blockAt = new Map(blocks.map(b => [b.from, b]));
  // Titel nur, wenn die Datei selbst einen hat (erste Zeile "# ...")
  let title = '';
  let start = 0;
  if (!blockAt.has(0) && lines[0]?.startsWith('# ')) {
    title = lines[0].slice(2).trim();
    start = 1;
  }
  const relations = [];
  const tags = [];
  const contentHtmlParts = [];

  for (let i = start; i < lines.length; i++) {
    const block = blockAt.get(i);
    if (block) {
      contentHtmlParts.push(`
            <div class="my-2.5 rounded-lg overflow-hidden bg-paper-darkcode shadow-inner">
              <div class="code-bar flex items-center justify-between px-3.5 pt-2 font-mono text-[11px] text-[#A8A29A]">
                <span>${escapeHtml(block.lang || 'code')}</span>
                <button onclick="event.stopPropagation(); copyText(${jsArg(codeOf(block, lines))})" title="Code ohne Fences kopieren" class="hover:text-[#F4F1EA] transition-colors">Kopieren</button>
              </div>
              <pre class="text-[#F4F1EA] font-mono text-xs leading-relaxed px-3.5 pb-3.5 pt-1.5 overflow-x-auto"><code>${escapeHtml(codeOf(block, lines))}</code></pre>
            </div>
          `);
      i = block.to;
      continue;
    }

    let trimmed = lines[i].trim();
    if (!trimmed) continue;

    // Tabelle: alle aufeinanderfolgenden Zeilen, die mit | beginnen
    if (trimmed.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++].trim());
      i--;
      contentHtmlParts.push(renderTable(rows));
      continue;
    }

    // Relation nur am Zeilenanfang (Regel RELATION); der Rest der Zeile ist normaler Text
    const relation = RELATION.exec(lines[i]);
    if (relation && linkTarget(relation[2])) {
      relations.push({ key: relation[1], target: linkTarget(relation[2]), label: linkLabel(relation[2]) });
      trimmed = lines[i].slice(relation[0].length).trim();
    }

    // Tags werden zu Pills; Inline-Code und Links bleiben dabei unangetastet
    const kept = [];
    trimmed = trimmed
      .replace(CODE_OR_LINK, m => `\u0001${kept.push(m) - 1}\u0001`)
      .replace(TAG, (_, before, name) => { tags.push(name); return ''; })
      .replace(/\u0001(\d+)\u0001/g, (_, n) => kept[n])
      .trim();
    if (!trimmed) continue;

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      contentHtmlParts.push(`<h4 class="font-serif ${heading[1].length <= 2 ? 'text-lg' : 'text-base'} font-semibold text-ink-primary pt-2">${renderInline(heading[2])}</h4>`);
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      contentHtmlParts.push('<hr class="border-paper-border my-2">');
      continue;
    }

    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) {
      contentHtmlParts.push(`<blockquote class="border-l-2 border-stone-300 pl-3 text-sm text-ink-secondary italic leading-relaxed">${renderInline(quote[1])}</blockquote>`);
      continue;
    }

    // Listen: -, *, + oder 1. / 1) – optional mit Checkbox [ ] / [x]; Einrückung je 2 Leerzeichen
    const listItem = trimmed.match(/^([-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/);
    if (listItem) {
      const [, bullet, box, text] = listItem;
      const indent = Math.min(Math.floor(lines[i].search(/\S/) / 2), 4);
      const done = box !== undefined && box !== ' ';
      const marker = box !== undefined ? (done ? '☑' : '☐') : (/\d/.test(bullet) ? bullet : '•');
      contentHtmlParts.push(`
            <div class="flex gap-2 text-sm leading-relaxed ${done ? 'text-ink-muted line-through' : 'text-ink-primary'}" style="padding-left: ${indent * 1.25}rem">
              <span class="shrink-0 min-w-[1rem] text-ink-muted">${marker}</span>
              <span>${renderInline(text)}</span>
            </div>
          `);
      continue;
    }

    contentHtmlParts.push(`<p class="text-sm text-ink-primary leading-relaxed">${renderInline(trimmed)}</p>`);
  }

  // Eine Definition ist „früher“, wenn für ihren Begriff ein später angelegter Block gilt
  const isOlderDefinition = r => isDefinitionKey(r.key) && definitions.has(r.target.toLowerCase())
    && definitions.get(r.target.toLowerCase()) !== note.filename;
  const olderTerms = unique(relations.filter(isOlderDefinition).map(r => r.target));

  const relationsHtml = relations.map(r => {
    const isDef = isDefinitionKey(r.key) && !isOlderDefinition(r);
    const label = escapeHtml(r.key) + '::';
    return `
          <div class="inline-flex items-center rounded-md overflow-hidden border ${isDef ? 'border-amber-400/90' : 'border-stone-300/80'} text-xs">
            <span onclick="event.stopPropagation(); filterBy(${jsArg('? ' + r.key + '::')})" class="${isDef ? 'bg-amber-100 text-amber-900' : 'bg-[#E6E2DA] text-ink-secondary'} px-2 py-0.5 cursor-pointer hover:brightness-95 font-mono text-[11px]">${isDef ? '📖 ' + label : isOlderDefinition(r) ? '📜 ' + label : label}</span>
            <button onclick="event.stopPropagation(); filterBy(${jsArg('? [[' + r.target + ']]')})" class="bg-paper-surface hover:bg-amber-100/60 text-ink-primary font-medium px-2 py-0.5 transition-colors flex items-center gap-1">
              <span class="text-ink-muted text-[10px]">↗</span> ${escapeHtml(r.label)}
            </button>
          </div>
        `;
  }).join('');

  const tagsHtml = tags.map(t => `
        <button onclick="event.stopPropagation(); filterBy(${jsArg('? #' + t)})" class="bg-tag-bg text-tag-text hover:brightness-95 text-xs font-medium px-2.5 py-0.5 rounded-md transition-all">
          #${escapeHtml(t)}
        </button>
      `).join('');

  const isSelected = selectedFilename === note.filename;
  const fileArg = jsArg(note.filename);
  const key = k => `<kbd class="ml-0.5 px-1 bg-paper-code rounded font-mono text-[10px] text-ink-muted">${k}</kbd>`;

  // tabindex="-1": nur per Skript fokussierbar, damit der gewählte Block die Tasten bekommt.
  // scroll-mt/-mb: beim Hineinscrollen frei von der Omnibar oben und der Meldung unten.
  return `
        <article
          id="note-${escapeHtml(note.filename)}"
          tabindex="-1"
          ondblclick="startInlineEdit(${fileArg})"
          class="note-block group relative flow-root rounded-xl p-4 -mx-4 outline-none scroll-mt-36 scroll-mb-20 hover:bg-paper-surface/60 transition-colors cursor-default ${pinned ? 'bg-paper-surface/90 border border-stone-300 shadow-sm mx-0' : ''} ${isSelected ? 'bg-paper-surface/80 ring-2 ring-stone-400/70' : ''}"
        >
          ${pinned ? '<div class="text-[11px] font-mono uppercase tracking-wider text-amber-900 mb-1.5 flex items-center gap-1.5"><span>📖 Definition</span></div>' : ''}
          ${olderTerms.length ? `<div class="text-[11px] font-mono uppercase tracking-wider text-ink-muted mb-1.5" title="Für diesen Begriff gilt ein später angelegter Block">📜 Frühere Definition · ${olderTerms.map(escapeHtml).join(', ')}</div>` : ''}

          <!-- Buttons floaten rechts oben: Titel bzw. erste Textzeile laufen daneben -->
          <div class="float-right flex items-center gap-1 ml-3">
            <button
              onclick="event.stopPropagation(); chooseBlock(${fileArg})"
              title="Auswählen · ${escapeHtml(note.filename)}"
              class="px-2 py-1 text-ink-muted hover:text-ink-primary rounded hover:bg-paper-code font-bold leading-none transition-colors ${isSelected ? 'bg-paper-code text-ink-primary' : ''}"
            >⋮</button>
          </div>

          ${title ? `<h3 class="font-serif text-xl font-semibold text-ink-primary mb-1.5">${renderInline(title)}</h3>` : ''}

          <div class="space-y-1">
            ${contentHtmlParts.join('')}
          </div>

          ${(relationsHtml || tagsHtml) ? `
            <div class="mt-3 flex flex-wrap items-center gap-2">
              ${relationsHtml}
              ${tagsHtml}
            </div>
          ` : ''}

          <!-- AKTIONEN DES GEWÄHLTEN BLOCKS, je mit Tastenkürzel -->
          ${isSelected ? `
            <div class="mt-3.5 pt-2.5 border-t border-paper-border flex flex-wrap items-center justify-between gap-2 text-xs text-ink-secondary bg-[#EAE6DF]/60 -mx-4 -mb-4 px-4 py-2.5 rounded-b-xl">
              <div class="flex flex-wrap items-center gap-3 sm:gap-4">
                <button onclick="event.stopPropagation(); startInlineEdit(${fileArg})" title="Bearbeiten (E)" class="hover:text-ink-primary flex items-center gap-1 font-medium transition-colors">
                  <span>✏️</span> Bearbeiten ${key('E')}
                </button>
                <button onclick="event.stopPropagation(); openExternalEditor(${fileArg})" title="Im Editor öffnen (O)" class="hover:text-ink-primary flex items-center gap-1 transition-colors">
                  <span>↗</span> Im Editor ${key('O')}
                </button>
                <button onclick="event.stopPropagation(); copyBlock(${fileArg})" title="Kopieren (C)" class="hover:text-ink-primary flex items-center gap-1 transition-colors">
                  <span>📋</span> Kopieren ${key('C')}
                </button>
                <button onclick="event.stopPropagation(); trashBlock(${fileArg})" title="In den Papierkorb (Entf)" class="text-red-700/80 hover:text-red-700 flex items-center gap-1 transition-colors">
                  <span>🗑️</span> Papierkorb ${key('Entf')}
                </button>
              </div>
              <button onclick="event.stopPropagation(); endSelection()" title="Auswahl beenden (Esc)" class="hover:text-ink-primary flex items-center gap-1 transition-colors">
                ✕ ${key('Esc')}
              </button>
            </div>
          ` : ''}
        </article>
      `;
}

// ============================================================================
// 4. STREAM RENDERN ODER ?-INDEX-VIEW ANZEIGEN
// ============================================================================
// Suche nur mit "?" ganz am Anfang: " ?…" mit Leerzeichen davor schreibt einen Block, der mit "?" beginnt
function isSearchInput() {
  return omnibar.value.startsWith('?');
}

// Der Stream hängt nur von der Suche ab, nicht vom gerade erfassten Text
function currentViewKey() {
  return isSearchInput() ? omnibar.value.trim() : '';
}

function showMore() {
  visibleLimit += PAGE_SIZE;
  renderStream();
}

function renderStream() {
  // Ungespeicherten Text im Inline-Editor sichern, bevor der Stream neu gebaut wird
  const editArea = editingFilename && document.getElementById(`edit-area-${editingFilename}`);
  if (editArea) editDraft = editArea.value;

  const isSearch = isSearchInput();
  const rawQuery = isSearch ? omnibar.value.slice(1).trim() : '';

  // Eine neue Suche beginnt oben und beendet die Auswahl
  const viewKey = currentViewKey();
  if (viewKey !== renderedViewKey) {
    renderedViewKey = viewKey;
    visibleLimit = PAGE_SIZE;
    selectedFilename = null;
    mentionsOpen = false;
  }

  // FALL A: Nur "?" eingegeben -> Zeige die Index-View (Arten, Begriffe, Virtuelle Begriffe, Relationen)
  if (isSearch && rawQuery.length === 0) {
    selectable = [];
    metaBar.classList.add('hidden');
    termHeaderEl.classList.add('hidden');
    defSlotEl.classList.add('hidden');
    streamEl.classList.add('hidden');
    indexOverviewEl.innerHTML = renderQuestionOverview();
    indexOverviewEl.classList.remove('hidden');
    return;
  }

  // FALL B: Normale Ansicht oder aktive ?-Filterung
  indexOverviewEl.classList.add('hidden');
  metaBar.classList.remove('hidden');
  streamEl.classList.remove('hidden');

  const query = isSearch ? parseQuery(rawQuery) : null;
  let filtered = query ? notes.filter(n => matchesQuery(n, query)) : notes;

  counterEl.textContent = `${filtered.length} ${filtered.length === 1 ? 'BLOCK' : 'BLÖCKE'}`;

  // Stufe 1: Sucht man genau einen Begriff, steht seine geltende Definition ganz oben
  const definitions = currentDefinitions();
  const current = query && definitionFor(query, definitions);
  const primaryDefNote = (current && filtered.find(n => n.filename === current)) || null;

  if (primaryDefNote) filtered = filtered.filter(n => n.filename !== primaryDefNote.filename);

  // Nur die ersten Treffer rendern: hält Tippen und Suchen auch bei tausenden Blöcken flüssig
  const visible = filtered.slice(0, visibleLimit);
  const hiddenCount = filtered.length - visible.length;

  // Bei ? [[Begriff]]: Kopfzeile und die Blöcke, die den Begriff nur im Text nennen (eingeklappt)
  const linked = primaryDefNote ? [primaryDefNote, ...filtered] : filtered;
  const mentions = query?.form === 'link' ? unlinkedMentions(query, linked) : [];

  // ↓ ↑ laufen in Bildschirm-Reihenfolge: Definition oben, dann der Stream, dann aufgeklappte Erwähnungen.
  // Ein Block in zwei Zielgruppen (? zu::) zählt einmal. Ist der gewählte Block nicht mehr zu sehen
  // (z. B. außerhalb gelöscht), endet die Auswahl.
  selectable = [...new Set([
    ...(primaryDefNote ? [primaryDefNote.filename] : []),
    ...visible.map(n => n.filename),
    ...(mentionsOpen ? mentions.map(n => n.filename) : []),
  ])];
  if (!selectable.includes(selectedFilename)) selectedFilename = null;

  if (query?.form === 'link') {
    termHeaderEl.innerHTML = renderTermHeader(query, linked, mentions, definitions);
    termHeaderEl.classList.remove('hidden');
  } else {
    termHeaderEl.classList.add('hidden');
    termHeaderEl.innerHTML = '';
  }

  if (primaryDefNote) {
    defSlotEl.innerHTML = renderBlockHTML(primaryDefNote, { pinned: true, definitions });
    defSlotEl.classList.remove('hidden');
  } else {
    defSlotEl.classList.add('hidden');
    defSlotEl.innerHTML = '';
  }

  // Bei "? name::" eine Gruppe je Ziel (wie Hitokoto), sonst eine je Tag
  let html = query?.form === 'relation' && !query.target
    ? renderTargetGroups(visible, query, definitions)
    : renderDayGroups(visible, definitions);

  if (hiddenCount > 0) {
    html += `
          <div class="text-center">
            <button onclick="showMore()" class="text-xs text-ink-secondary hover:text-ink-primary bg-paper-surface hover:bg-paper-code px-3 py-1.5 rounded-md border border-paper-border transition-colors">
              Weitere ${Math.min(PAGE_SIZE, hiddenCount)} anzeigen · noch ${hiddenCount} ältere
            </button>
          </div>
        `;
  }

  if (mentions.length) html += renderMentions(mentions, definitions);

  streamEl.innerHTML = html || `<p class="text-sm text-ink-muted py-8 text-center">Keine passenden Blöcke für „${escapeHtml(rawQuery)}“ gefunden.</p>`;
  if (query) {
    highlightHits(defSlotEl, query);
    highlightHits(streamEl, query);
  }
}

// Die Blöcke als Tagesgruppen: „Heute“, „Gestern“, Datum
function renderDayGroups(list, definitions) {
  const days = new Map();
  list.forEach(n => {
    const day = formatDayLabel(createdAt(n));
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(n);
  });
  return [...days].map(([day, dayNotes]) => `
        <section class="day-group">
          <div class="flex items-center gap-4 mb-4">
            <h2 class="font-serif text-lg font-medium text-ink-secondary shrink-0">${escapeHtml(day)}</h2>
            <div class="h-px bg-paper-border w-full"></div>
          </div>
          <div class="divide-y divide-paper-border/60">
            ${dayNotes.map(n => `<div class="py-2 first:pt-0 last:pb-0">${renderBlockHTML(n, { definitions })}</div>`).join('')}
          </div>
        </section>
      `).join('');
}

// "? zu::" wie Hitokoto: eine Gruppe je Ziel, die Gruppe mit dem neuesten Block oben, der Tag als
// kleines Label am Block. Ein Block mit zwei Zielen steht in beiden Gruppen. Ein Klick auf das Ziel
// sucht ? [[Ziel]].
function renderTargetGroups(list, query, definitions) {
  const groups = new Map();
  for (const n of list) {
    const targets = marksOf(n).relations.filter(r => query.keys.includes(r.key.toLowerCase())).map(r => r.target);
    for (const target of unique(targets)) {
      const key = target.toLowerCase();
      if (!groups.has(key)) groups.set(key, { target, notes: [] });
      groups.get(key).notes.push(n);
    }
  }
  return [...groups.values()].map(({ target, notes: groupNotes }) => `
        <section class="target-group">
          <div class="flex items-center gap-4 mb-3">
            <h2 class="font-serif text-lg font-medium shrink-0">
              <button onclick="filterBy(${jsArg('? [[' + target + ']]')})" class="text-[#5B2C41] hover:underline">${escapeHtml(target)}</button>
              <span class="ml-1 text-xs font-sans text-ink-muted">${groupNotes.length}</span>
            </h2>
            <div class="h-px bg-paper-border w-full"></div>
          </div>
          <div class="divide-y divide-paper-border/60">
            ${groupNotes.map(n => `
              <div class="py-2 first:pt-0 last:pb-0">
                <div class="text-[11px] uppercase tracking-wider text-ink-muted mb-0.5">${escapeHtml(formatDayLabel(createdAt(n)))}</div>
                ${renderBlockHTML(n, { definitions })}
              </div>`).join('')}
          </div>
        </section>
      `).join('');
}

// ============================================================================
// BEGRIFF: Kopfzeile und Erwähnungen ohne Link (bei ? [[Begriff]])
// ============================================================================
let mentionsOpen = false;

// Blöcke, die den Begriff als ganzes Wort im Text nennen, aber nicht verlinken
function unlinkedMentions(query, linked) {
  const linkedFiles = new Set(linked.map(n => n.filename));
  const word = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(query.key)}(?![\\p{L}\\p{N}])`, 'iu');
  return notes.filter(n => !linkedFiles.has(n.filename) && word.test(n.raw));
}

function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// „Antragsteller · Definition seit 14.10.2026 · 2 frühere · 12 verlinkt · zuletzt 29.10.2026 · 4 Erwähnungen ohne Link“
function renderTermHeader(query, linked, mentions, definitions) {
  const name = linked.flatMap(n => marksOf(n).links).find(l => l.toLowerCase() === query.key)
    || linkTarget(QUERY_LINK.exec(omnibar.value.slice(1).trim())?.[1] || query.key);
  const definers = notes.filter(n => marksOf(n).definitions.includes(query.key));
  const currentFile = definitions.get(query.key);
  const current = definers.find(n => n.filename === currentFile);
  const sep = '<span class="text-ink-muted/60">·</span>';
  const parts = [];
  if (current) {
    parts.push(`<span class="text-amber-900">📖 Definition seit ${formatDate(createdAt(current))}</span>`);
    if (definers.length > 1) parts.push(`<span>📜 ${definers.length - 1} frühere</span>`);
  } else {
    parts.push(`<span>Noch ohne Definition</span>
          <button onclick="prefillDefinition(${jsArg(name)})" class="text-[11px] font-mono text-ink-muted hover:text-ink-primary bg-paper-surface hover:bg-paper-code px-1.5 py-0.5 rounded">+ def</button>`);
  }
  parts.push(`<span>${linked.length} verlinkt</span>`);
  if (linked.length) parts.push(`<span>zuletzt ${formatDate(createdAt(linked.reduce((a, b) => (createdAt(a) > createdAt(b) ? a : b))))}</span>`);
  if (mentions.length) parts.push(`<button onclick="toggleMentions(true)" class="underline decoration-dotted hover:text-ink-primary">${mentions.length} ${mentions.length === 1 ? 'Erwähnung' : 'Erwähnungen'} ohne Link</button>`);
  return `
        <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 class="font-serif text-2xl font-semibold text-ink-primary">${escapeHtml(name)}</h2>
          <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-ink-secondary">${parts.join(sep)}</div>
        </div>
      `;
}

// Unter den Treffern, eingeklappt: Wo fehlt vielleicht ein [[Link]]?
function renderMentions(mentions, definitions) {
  return `
        <section id="mentions" class="border-t border-dashed border-paper-border pt-4">
          <button onclick="toggleMentions()" class="text-xs uppercase tracking-wider text-ink-muted hover:text-ink-primary">
            ${mentionsOpen ? '▾' : '▸'} Auch im Text erwähnt, ohne Link: ${mentions.length} ${mentions.length === 1 ? 'Block' : 'Blöcke'}
          </button>
          ${mentionsOpen ? `
            <div class="mt-3 divide-y divide-paper-border/60 opacity-90">
              ${mentions.slice(0, PAGE_SIZE).map(n => `
                <div class="py-2 first:pt-0 last:pb-0">
                  <div class="text-[11px] uppercase tracking-wider text-ink-muted mb-0.5">${escapeHtml(formatDayLabel(createdAt(n)))}</div>
                  ${renderBlockHTML(n, { definitions })}
                </div>`).join('')}
            </div>` : ''}
        </section>
      `;
}

function toggleMentions(open = !mentionsOpen) {
  mentionsOpen = open;
  renderStream();
  if (open) document.getElementById('mentions')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

// ============================================================================
// TREFFER MARKIEREN (wie Hitokoto): die Wörter der Textsuche (Umlaut-tolerant, „geklaert“ markiert
// „geklärt“) und die Wortfolge von "…". Bei #tag, [[Begriff]] und name:: nichts – die Knöpfe sind farbig.
// ============================================================================
function highlightHits(root, query) {
  if (query.form !== 'text' && query.form !== 'exact') return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (node.parentElement.closest('textarea, mark, .code-bar')) continue;
    const ranges = hitRanges(node.nodeValue, query);
    if (!ranges.length) continue;
    const parts = document.createDocumentFragment();
    let last = 0;
    for (const [start, end] of ranges) {
      parts.append(node.nodeValue.slice(last, start));
      const mark = document.createElement('mark');
      mark.className = 'hit';
      mark.textContent = node.nodeValue.slice(start, end);
      parts.append(mark);
      last = end;
    }
    parts.append(node.nodeValue.slice(last));
    node.replaceWith(parts);
  }
}

// Wo die Treffer in `text` stehen, als sortierte, nicht überlappende [start, end)-Bereiche. Wörter werden
// im gefalteten Text gesucht und auf die Originalstellen zurückgerechnet (ä → ae ist ein Zeichen mehr).
function hitRanges(text, query) {
  const ranges = [];
  if (query.form === 'exact') {
    for (const m of text.matchAll(new RegExp(query.pattern.source, 'gu'))) if (m[0]) ranges.push([m.index, m.index + m[0].length]);
  } else {
    let folded = '';
    const origin = [];
    for (let i = 0; i < text.length; i++) {
      const f = fold(text[i]);
      folded += f;
      for (let k = 0; k < f.length; k++) origin.push(i);
    }
    for (const word of query.words) {
      if (!word) continue;
      for (let at = folded.indexOf(word); at >= 0; at = folded.indexOf(word, at + 1)) {
        ranges.push([origin[at], origin[at + word.length - 1] + 1]);
      }
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [start, end] of ranges) {
    const lastRange = merged.at(-1);
    if (lastRange && start <= lastRange[1]) lastRange[1] = Math.max(lastRange[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

// ============================================================================
// 5. OMNIBAR EVENTS & CRUD-AKTIONEN
// ============================================================================
omnibar.addEventListener('input', () => {
  omnibar.style.height = 'auto';
  omnibar.style.height = omnibar.scrollHeight + 'px';

  const val = omnibar.value;
  const isSearch = isSearchInput();
  const isOnlyQuestion = isSearch && val.trim() === '?';
  const isMultiline = val.includes('\n');

  hint.classList.toggle('hidden', val.trim().length === 0 || isOnlyQuestion);
  clearXBtn.classList.toggle('hidden', val.trim().length === 0);

  if (isSearch) {
    modeIndicator.innerHTML = '🔍 <strong>Suche</strong> · Wörter · <code class="bg-paper-code px-1 rounded">"ganzes Wort"</code> · <code class="bg-paper-code px-1 rounded">#tag</code> · <code class="bg-paper-code px-1 rounded">[[Begriff]]</code> · <code class="bg-paper-code px-1 rounded">name::</code>';
    keyHint.innerHTML = '<kbd class="px-1.5 py-0.5 bg-paper-code rounded font-mono">Esc</kbd> Zurück zur Übersicht';
  } else if (isMultiline) {
    modeIndicator.innerHTML = '📝 <strong>Mehrzeilen-Modus</strong> (Neue .md Datei)';
    keyHint.innerHTML = '<kbd class="px-1.5 py-0.5 bg-paper-code rounded font-mono">Ctrl+Enter</kbd> speichern · <kbd class="px-1.5 py-0.5 bg-paper-code rounded font-mono">Enter</kbd> neue Zeile';
  } else {
    modeIndicator.innerHTML = '⚡ <strong>Schnell-Erfassung</strong> (Neue .md Datei)';
    keyHint.innerHTML = '<kbd class="px-1.5 py-0.5 bg-paper-code rounded font-mono">Enter</kbd> speichern · <kbd class="px-1.5 py-0.5 bg-paper-code rounded font-mono">Shift+Enter</kbd> neue Zeile';
  }

  updateAutocomplete();
  // Browser-Verlauf (wie Hitokoto): Der aktuelle Eintrag hält immer die aktuelle Suche, Tippen ersetzt
  // ihn nur. Ein Klick auf Tag, Begriff oder Index legt mit filterBy() einen neuen an, Zurück holt ihn.
  if (currentViewKey() !== (history.state?.search ?? '')) history.replaceState({ search: currentViewKey() }, '');
  if (currentViewKey() !== renderedViewKey) renderStream();
});

window.addEventListener('popstate', (e) => {
  omnibar.value = e.state?.search ?? '';
  omnibar.dispatchEvent(new Event('input'));
});

// Tastatur wie in Hitokoto: F1 öffnet und schließt die Hilfe (solange sie offen ist, wirkt sonst nur Esc),
// Strg+K springt von überall ins Feld. Am gewählten Block: ↓ ↑ E C O Entf Esc – nur ohne Strg/Alt/Meta
// (Strg+C bleibt das Kopieren des Browsers) und nie, während ein Textfeld den Fokus hat.
window.addEventListener('keydown', (e) => {
  if (e.key === 'F1') {
    e.preventDefault();
    helpPanel.classList.contains('hidden') ? openHelp() : closeHelp();
    return;
  }
  if (!helpPanel.classList.contains('hidden')) {
    if (e.key === 'Escape') closeHelp();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    endSelection();
    omnibar.select();
    return;
  }
  if (!selectedFilename || e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.target.closest?.('textarea, input')) return;
  const at = selectable.indexOf(selectedFilename);
  const file = selectedFilename;
  const actions = {
    ArrowDown: () => selectAt(at + 1),
    ArrowUp: () => (at <= 0 ? endSelection() : selectAt(at - 1)),
    Escape: () => endSelection(),
    Delete: () => trashBlock(file),
    c: () => copyBlock(file),
    o: () => openExternalEditor(file),
    e: () => startInlineEdit(file),
  };
  const action = actions[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (!action) return;
  e.preventDefault();
  action();
});

omnibar.addEventListener('keydown', (e) => {
  // Offene Vorschläge: Pfeile wählen, Tab übernimmt, Esc schließt nur die Liste.
  // Enter übernimmt nur nach Auswahl mit den Pfeilen; sonst speichert Enter wie immer, mit dem getippten Text.
  if (acState) {
    const count = acState.suggestions.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      acState.selected = (acState.selected + (e.key === 'ArrowDown' ? 1 : count - 1)) % count;
      acState.navigated = true;
      renderAutocomplete();
      return;
    }
    if (e.key === 'Tab' || (e.key === 'Enter' && acState.navigated && !e.shiftKey && !e.ctrlKey && !e.metaKey)) {
      e.preventDefault();
      applyAutocomplete(acState.selected);
      return;
    }
    if (e.key === 'Escape') {
      hideAutocomplete();
      return;
    }
  }

  if (e.key === 'Escape') {
    clearOmnibar();
    return;
  }

  // ↓ mit dem Cursor ganz am Ende oder Tab im leeren Feld: in die Blöcke, der oberste wird gewählt.
  // Gleich nach dem Speichern also Tab, dann E oder O. Mit Text oder Shift bleibt Tab die normale Fokus-Navigation.
  const atEnd = omnibar.selectionStart === omnibar.value.length && omnibar.selectionEnd === omnibar.value.length;
  if ((e.key === 'ArrowDown' && atEnd) || (e.key === 'Tab' && !e.shiftKey && !omnibar.value)) {
    if (selectable.length) {
      e.preventDefault();
      selectAt(0);
    }
    return;
  }

  const val = omnibar.value.trim();
  const isSearch = isSearchInput();
  const isMultiline = omnibar.value.includes('\n');

  // Die Suche ist einzeilig: Enter fügt dort keinen Zeilenumbruch ein
  if (isSearch && e.key === 'Enter') {
    e.preventDefault();
    return;
  }

  // In einem offenen Code-Block (``` ohne schließende Zeile) macht Enter eine neue Zeile,
  // sonst würde nach "```java" + Enter ein halber Block gespeichert
  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && isInOpenFence(omnibar.value.slice(0, omnibar.selectionStart))) {
    return;
  }

  if (!isSearch && e.key === 'Enter') {
    const shouldSave = isMultiline ? (e.ctrlKey || e.metaKey) : !e.shiftKey;
    if (shouldSave) {
      e.preventDefault();
      if (!val) return;
      createNewBlock(val);
    }
  }
});

// Läuft gerade ein Speichern, wird ein weiteres Enter (Doppeldruck, gehaltene Taste) ignoriert
let isCreating = false;

// Gespeichert wird genau der getippte Text; einen Titel gibt es nur mit "# Titel" in der ersten Zeile.
// "Gespeichert · Rückgängig" legt den Block in den Papierkorb und den Text zurück ins Feld, falls es leer ist.
async function createNewBlock(rawText) {
  if (isCreating) return;
  let created;
  if (useBackend) {
    isCreating = true;
    try {
      created = await api('', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ raw: rawText }) });
    } catch (e) {
      // Eingabe bleibt in der Omnibar stehen, nichts geht verloren
      showToast(`Nicht gespeichert – ${e.message}. Der Text bleibt im Feld.`);
      return;
    } finally {
      isCreating = false;
    }
  } else {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const tsFilename = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${randomShortId(4)}.md`;
    created = { filename: tsFilename, lastModified: now.toISOString(), raw: rawText };
  }
  // Über dieselbe Sortierung wie beim Laden, damit ein Neuladen nichts umstellt
  notes = sortNotes([created, ...notes]);

  omnibar.value = '';
  hideAutocomplete();
  omnibar.dispatchEvent(new Event('input'));
  renderStream();
  showToast('Gespeichert', async () => {
    await moveNoteToTrash(created.filename);
    renderStream();
    if (!omnibar.value) setOmnibar(created.raw);
    omnibar.focus();
  });
}

// Offene Vorschlagsliste: { start, end, suggestions, selected, navigated } – start/end markieren den zu ersetzenden Text,
// navigated = mit Pfeiltasten gewählt (erst dann übernimmt auch Enter)
let acState = null;

// Gerade getippter Tag bzw. Link direkt vor dem Cursor (gleiche Zeichen wie TAG im Abschnitt MUSTER)
const TYPING_TAG = /(?:^|\s)#([\p{L}\p{N}_-]*)$/u;
const TYPING_LINK = /\[\[([^\]]*)$/;

function updateAutocomplete() {
  const val = omnibar.value;
  if (val.trim() === '?') { hideAutocomplete(); return; }
  const cursor = omnibar.selectionStart;
  const beforeCursor = val.slice(0, cursor);

  const tagMatch = beforeCursor.match(TYPING_TAG);
  const linkMatch = beforeCursor.match(TYPING_LINK);

  if (!tagMatch && !linkMatch) {
    hideAutocomplete();
    return;
  }

  const allTags = new Set();
  const allTargets = new Set();
  notes.forEach(n => {
    const marks = marksOf(n);
    marks.tags.forEach(t => allTags.add('#' + t));
    marks.links.forEach(l => allTargets.add('[[' + l + ']]'));
  });

  let suggestions = [];
  let replacePrefix = '';

  if (tagMatch) {
    const q = '#' + tagMatch[1].toLowerCase();
    replacePrefix = '#' + tagMatch[1];
    suggestions = [...allTags].filter(t => t.toLowerCase().startsWith(q));
  } else if (linkMatch) {
    const q = linkMatch[1].toLowerCase();
    replacePrefix = '[[' + linkMatch[1];
    suggestions = [...allTargets].filter(t => t.toLowerCase().includes(q));
  }

  if (suggestions.length === 0) {
    hideAutocomplete();
    return;
  }

  // Exakter Treffer zuerst (#kfw vor #kfw-förderung), dann Anfangstreffer, dann der Rest
  const typed = replacePrefix.toLowerCase();
  const rank = s => {
    const full = s.toLowerCase();
    return full === typed || full === typed + ']]' ? 0 : full.startsWith(typed) ? 1 : 2;
  };
  suggestions.sort((a, b) => rank(a) - rank(b));

  acState = { start: cursor - replacePrefix.length, end: cursor, suggestions: suggestions.slice(0, 5), selected: 0, navigated: false };
  renderAutocomplete();
}

function renderAutocomplete() {
  // mousedown.preventDefault: Fokus bleibt in der Omnibar, damit blur die Liste nicht vor dem Klick schließt
  acBox.innerHTML = acState.suggestions.map((s, i) => `
        <button type="button" onmousedown="event.preventDefault()" onclick="applyAutocomplete(${i})" class="w-full text-left px-3 py-1.5 hover:bg-paper-code ${i === acState.selected ? 'bg-paper-code' : ''} text-ink-primary flex items-center justify-between">
          <span>${escapeHtml(s)}</span>
          <span class="text-[10px] text-ink-muted">${i === acState.selected ? (acState.navigated ? 'Enter / Tab' : 'Tab') : 'Einfügen'}</span>
        </button>
      `).join('');
  acBox.classList.remove('hidden');
}

function hideAutocomplete() {
  acState = null;
  acBox.classList.add('hidden');
}

function applyAutocomplete(index) {
  if (!acState) return;
  const { start, end, suggestions } = acState;
  const insert = suggestions[index] + ' ';
  omnibar.value = omnibar.value.slice(0, start) + insert + omnibar.value.slice(end);
  omnibar.focus();
  omnibar.setSelectionRange(start + insert.length, start + insert.length);
  hideAutocomplete();
  omnibar.dispatchEvent(new Event('input'));
}

omnibar.addEventListener('blur', hideAutocomplete);

// ============================================================================
// 6. AUSWAHL & TASTATUR (Verhalten wie Hitokoto)
// ============================================================================
// Der gewählte Block zeigt seine Aktionen, holt sich den Fokus und scrollt in Sicht
function selectBlock(filename) {
  selectedFilename = filename;
  renderStream();
  const el = document.getElementById(`note-${filename}`);
  if (el) {
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest' });
  }
}

// Der n-te angezeigte Block; hinter dem letzten passiert nichts
function selectAt(index) {
  const filename = selectable[index];
  if (filename) selectBlock(filename);
}

// ⋮ wählt aus, ein zweiter Klick auf ⋮ beendet die Auswahl
function chooseBlock(filename) {
  if (selectedFilename === filename) endSelection();
  else selectBlock(filename);
}

// Esc, ✕ oder ↑ auf dem obersten Block: Auswahl weg, Fokus zurück ins Feld
function endSelection() {
  if (selectedFilename) {
    selectedFilename = null;
    renderStream();
  }
  omnibar.focus();
}

function startInlineEdit(filename) {
  selectedFilename = null;
  editingFilename = filename;
  editDraft = null;
  editError = null;
  renderStream();
  focusEditor(filename);
}

// Cursor ans Ende des Textes, Höhe passend zum Inhalt
function focusEditor(filename) {
  const el = document.getElementById(`edit-area-${filename}`);
  if (!el) return;
  el.focus();
  el.setSelectionRange(el.value.length, el.value.length);
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

// Gespeichert oder verworfen: Editor zu, Fokus zurück ins Feld
function closeEditor() {
  editingFilename = null;
  editDraft = null;
  editError = null;
  renderStream();
  omnibar.focus();
}

function cancelInlineEdit() {
  closeEditor();
}

// Der Editor bleibt mit dem eigenen Text offen und zeigt die Meldung
function showEditError(filename, message) {
  editError = message;
  renderStream();
  focusEditor(filename);
}

// Unveränderter Text schreibt nichts, leerer Text wird nicht gespeichert
async function saveInlineEdit(filename) {
  const el = document.getElementById(`edit-area-${filename}`);
  const note = notes.find(n => n.filename === filename);
  if (!el || !note) return;
  const newRaw = el.value.trim();
  if (!newRaw) {
    showEditError(filename, 'Leerer Text wird nicht gespeichert. Zum Entfernen: Esc, Block wählen, Entf.');
    return;
  }
  if (newRaw === note.raw.trim()) {
    closeEditor();
    return;
  }

  if (useBackend) {
    try {
      const updated = await api(notePath(filename), { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ raw: newRaw, baseModified: note.lastModified }) });
      // Bleibt an seinem Platz: Die Reihenfolge folgt dem Erstellungszeitpunkt
      notes = notes.map(n => n.filename === filename ? updated : n);
    } catch (e) {
      if (e.status === 409) {
        // Neue Fassung merken: Erneutes Speichern überschreibt dann bewusst, Abbrechen zeigt sie an
        notes = notes.map(n => n.filename === filename ? e.body.current : n);
        showEditError(filename, 'Die Datei wurde außerhalb geändert (z. B. in VS Code). Strg+Enter überschreibt sie mit deinem Text, Abbrechen zeigt die neue Fassung.');
      } else {
        showEditError(filename, `Nicht gespeichert – ${e.message}. Dein Text bleibt im Editor.`);
      }
      return;
    }
  } else {
    note.raw = newRaw;
    note.lastModified = new Date().toISOString();
  }
  closeEditor();
}

function handleInlineEditKey(e, filename) {
  if (e.key === 'Escape') { e.preventDefault(); cancelInlineEdit(); }
  else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveInlineEdit(filename); }
}

// O: Datei im Standardprogramm öffnen. Zurück im Fenster lädt die App Änderungen von selbst nach.
async function openExternalEditor(filename) {
  if (!useBackend) {
    showToast('Nur mit Server: start.cmd starten und http://localhost:3000 öffnen');
    return;
  }
  try {
    await api(`${notePath(filename)}/open`, { method: 'POST' });
    showToast('Im Editor geöffnet – Änderungen erscheinen, sobald du zurückkommst');
  } catch (e) {
    showToast(`Öffnen ging nicht – ${e.message}`);
  }
}

// C: der ganze Block als rohes Markdown
function copyBlock(filename) {
  const note = notes.find(n => n.filename === filename);
  if (note) copyText(note.raw);
}

// Ein Weg für alles Kopieren: Block (C), Inline-Code, „Kopieren“ am Code-Block
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('Kopiert');
  } catch {
    showToast('Kopieren ging nicht');
  }
}

// In den Papierkorb (Server: blocks/.papierkorb/); im Demo-Modus nur aus der Liste
async function moveNoteToTrash(filename) {
  if (useBackend) await api(notePath(filename), { method: 'DELETE' });
  notes = notes.filter(n => n.filename !== filename);
}

async function restoreNote(note) {
  const restored = useBackend ? await api(`${notePath(note.filename)}/restore`, { method: 'POST' }) : note;
  notes = sortNotes([...notes.filter(n => n.filename !== note.filename), restored]);
  renderStream();
}

// Entf: ohne Rückfrage in den Papierkorb, danach 5 s „Entfernt · Rückgängig“
async function trashBlock(filename) {
  const note = notes.find(n => n.filename === filename);
  if (!note) return;
  try {
    await moveNoteToTrash(filename);
  } catch (e) {
    showToast(`Nicht entfernt – ${e.message}`);
    return;
  }
  selectedFilename = null;
  renderStream();
  omnibar.focus();
  showToast('Entfernt', () => restoreNote(note));
}

// Suche aus einem Klick (Tag, Begriff, Relation, Index): eigener Eintrag im Browser-Verlauf
function filterBy(searchStr) {
  history.pushState({ search: searchStr.trim() }, '');
  omnibar.value = searchStr;
  omnibar.dispatchEvent(new Event('input'));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setOmnibar(text) {
  omnibar.value = text;
  omnibar.dispatchEvent(new Event('input'));
  omnibar.focus();
}

// Esc oder ×: Feld leeren. Ein Entwurf kommt mit „Rückgängig“ zurück, eine Suche nicht.
function clearOmnibar() {
  const previous = omnibar.value;
  setOmnibar('');
  if (previous.trim() && !previous.startsWith('?')) showToast('Feld geleert', () => setOmnibar(previous));
}

// ============================================================================
// 7. MELDUNG (TOAST) & HILFE
// ============================================================================
const TOAST_MS = 5000;
let toastTimer = null;
let toastUndo = null;

function showToast(text, undo = null) {
  clearTimeout(toastTimer);
  toastText.textContent = text;
  toastUndo = undo;
  toastUndoBtn.classList.toggle('hidden', !undo);
  toastEl.classList.remove('hidden');
  toastTimer = setTimeout(hideToast, TOAST_MS);
}

function hideToast() {
  clearTimeout(toastTimer);
  toastUndo = null;
  toastEl.classList.add('hidden');
}

async function undoToast() {
  const undo = toastUndo;
  hideToast();
  try {
    await undo?.();
  } catch (e) {
    showToast(`Rückgängig ging nicht – ${e.message}`);
  }
}

// Die Hilfe holt sich den Fokus, damit Esc sie schließt und nicht das Feld leert
function openHelp() {
  helpPanel.classList.remove('hidden');
  document.getElementById('help-close').focus({ preventScroll: true });
}

function closeHelp() {
  helpPanel.classList.add('hidden');
  omnibar.focus();
}

initApp();
