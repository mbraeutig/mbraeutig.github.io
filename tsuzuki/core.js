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

  // ── Mikro-Jahreszeiten 七十二候 (Kō) ────────────────────────────
  // Quelle: ja.wikipedia.org — „七十二候“ (Namen, Lesungen, Bedeutungen der
  // 略本暦-Fassung) und „二十四節気“ (Anfangsdaten, japanisch 2026). Jeder der
  // 24 Sonnenstände wird in drei Kō von „約5日“ geteilt: Beginn nach 0, 5, 10
  // Tagen. Feste Näherung — die echten Grenzen schwanken je Jahr um ±1 Tag.
  // Deutsche Namen: aus den japanischen Bedeutungen übersetzt.
  const SEKKI = [
    ['02-04', '立春', [['東風解凍', 'はるかぜこおりをとく', 'Der Ostwind löst das Eis'],
      ['黄鶯睍睆', 'うぐいすなく', 'Die Buschsänger beginnen zu singen'],
      ['魚上氷', 'うおこおりをいずる', 'Fische springen aus dem brechenden Eis']]],
    ['02-19', '雨水', [['土脉潤起', 'つちのしょううるおいおこる', 'Regen macht die Erde feucht'],
      ['霞始靆', 'かすみはじめてたなびく', 'Erste Dunstschleier ziehen auf'],
      ['草木萌動', 'そうもくめばえいずる', 'Gräser und Bäume treiben aus']]],
    ['03-05', '啓蟄', [['蟄虫啓戸', 'すごもりむしとをひらく', 'Die Insekten verlassen ihr Winterquartier'],
      ['桃始笑', 'ももはじめてさく', 'Die Pfirsiche beginnen zu blühen'],
      ['菜虫化蝶', 'なむしちょうとなる', 'Raupen werden zu Schmetterlingen']]],
    ['03-20', '春分', [['雀始巣', 'すずめはじめてすくう', 'Die Spatzen beginnen zu nisten'],
      ['桜始開', 'さくらはじめてひらく', 'Die Kirschen beginnen zu blühen'],
      ['雷乃発声', 'かみなりすなわちこえをはっす', 'In der Ferne grollt Donner']]],
    ['04-05', '清明', [['玄鳥至', 'つばめきたる', 'Die Schwalben kehren zurück'],
      ['鴻雁北', 'こうがんきたへかえる', 'Die Wildgänse ziehen nach Norden'],
      ['虹始見', 'にじはじめてあらわる', 'Nach dem Regen zeigen sich Regenbögen']]],
    ['04-20', '穀雨', [['葭始生', 'あしはじめてしょうず', 'Das Schilf beginnt zu sprießen'],
      ['霜止出苗', 'しもやんでなえいづる', 'Der Frost endet, die Reissetzlinge wachsen'],
      ['牡丹華', 'ぼたんはなさく', 'Die Päonien blühen']]],
    ['05-05', '立夏', [['蛙始鳴', 'かわずはじめてなく', 'Die Frösche beginnen zu quaken'],
      ['蚯蚓出', 'みみずいづる', 'Die Regenwürmer kommen hervor'],
      ['竹笋生', 'たけのこしょうず', 'Bambussprossen schießen hervor']]],
    ['05-21', '小満', [['蚕起食桑', 'かいこおきてくわをはむ', 'Die Seidenraupen fressen Maulbeerblätter'],
      ['紅花栄', 'べにばなさかう', 'Der Saflor blüht üppig'],
      ['麦秋至', 'むぎのときいたる', 'Das Korn reift']]],
    ['06-06', '芒種', [['螳螂生', 'かまきりしょうず', 'Die Gottesanbeterinnen schlüpfen'],
      ['腐草為蛍', 'くされたるくさほたるとなる', 'Aus welkem Gras werden Glühwürmchen'],
      ['梅子黄', 'うめのみきばむ', 'Die Ume-Früchte reifen gelb']]],
    ['06-21', '夏至', [['乃東枯', 'なつかれくさかるる', 'Die Braunelle verwelkt'],
      ['菖蒲華', 'あやめはなさく', 'Die Schwertlilien blühen'],
      ['半夏生', 'はんげしょうず', 'Die Pinellie sprießt']]],
    ['07-07', '小暑', [['温風至', 'あつかぜいたる', 'Warme Winde wehen'],
      ['蓮始開', 'はすはじめてひらく', 'Die Lotosblüten öffnen sich'],
      ['鷹乃学習', 'たかすなわちわざをなす', 'Junge Habichte lernen fliegen']]],
    ['07-23', '大暑', [['桐始結花', 'きりはじめてはなをむすぶ', 'Der Blauglockenbaum setzt Knospen an'],
      ['土潤溽暑', 'つちうるおうてむしあつし', 'Feuchte Erde, schwüle Hitze'],
      ['大雨時行', 'たいうときどきにふる', 'Zuweilen fällt heftiger Regen']]],
    ['08-07', '立秋', [['涼風至', 'すづかぜいたる', 'Kühle Winde kommen auf'],
      ['寒蝉鳴', 'ひぐらしなく', 'Die Abendzikaden singen'],
      ['蒙霧升降', 'ふかききりまとう', 'Dichter Nebel hüllt alles ein']]],
    ['08-23', '処暑', [['綿柎開', 'わたのはなしべひらく', 'Die Baumwollkapseln öffnen sich'],
      ['天地始粛', 'てんちはじめてさむし', 'Die Hitze lässt endlich nach'],
      ['禾乃登', 'こくものすなわちみのる', 'Der Reis reift']]],
    ['09-07', '白露', [['草露白', 'くさのつゆしろし', 'Weiß glänzt der Tau auf den Gräsern'],
      ['鶺鴒鳴', 'せきれいなく', 'Die Bachstelzen rufen'],
      ['玄鳥去', 'つばめさる', 'Die Schwalben ziehen fort']]],
    ['09-23', '秋分', [['雷乃収声', 'かみなりすなわちこえをおさむ', 'Der Donner verstummt'],
      ['蟄虫坏戸', 'むしかくれてとをふさぐ', 'Die Insekten verschließen ihre Erdlöcher'],
      ['水始涸', 'みずはじめてかる', 'Die Felder werden trockengelegt']]],
    ['10-08', '寒露', [['鴻雁来', 'こうがんきたる', 'Die Wildgänse kehren zurück'],
      ['菊花開', 'きくのはなひらく', 'Die Chrysanthemen blühen'],
      ['蟋蟀在戸', 'きりぎりすとにあり', 'Grillen zirpen an der Tür']]],
    ['10-23', '霜降', [['霜始降', 'しもはじめてふる', 'Der erste Reif fällt'],
      ['霎時施', 'こさめときどきふる', 'Leiser Nieselregen fällt'],
      ['楓蔦黄', 'もみじつたきばむ', 'Ahorn und Efeu färben sich']]],
    ['11-07', '立冬', [['山茶始開', 'つばきはじめてひらく', 'Die Kamelien beginnen zu blühen'],
      ['地始凍', 'ちはじめてこおる', 'Die Erde beginnt zu frieren'],
      ['金盞香', 'きんせんかさく', 'Die Narzissen blühen']]],
    ['11-22', '小雪', [['虹蔵不見', 'にじかくれてみえず', 'Die Regenbögen verbergen sich'],
      ['朔風払葉', 'きたかぜこのはをはらう', 'Der Nordwind fegt die Blätter fort'],
      ['橘始黄', 'たちばなはじめてきばむ', 'Die Tachibana-Früchte werden gelb']]],
    ['12-07', '大雪', [['閉塞成冬', 'そらさむくふゆとなる', 'Himmel und Erde verschließen sich, es wird Winter'],
      ['熊蟄穴', 'くまあなにこもる', 'Die Bären ziehen sich in ihre Höhlen zurück'],
      ['鱖魚群', 'さけのうおむらがる', 'Die Lachse ziehen in Schwärmen flussauf']]],
    ['12-22', '冬至', [['乃東生', 'なつかれくさしょうず', 'Die Braunelle keimt'],
      ['麋角解', 'おおしかのつのおつる', 'Die Hirsche werfen ihr Geweih ab'],
      ['雪下出麦', 'ゆきわたりてむぎいづる', 'Unter dem Schnee keimt der Weizen']]],
    ['01-05', '小寒', [['芹乃栄', 'せりすなわちさかう', 'Der Wasserfenchel gedeiht'],
      ['水泉動', 'しみずあたたかをふくむ', 'Die gefrorenen Quellen regen sich'],
      ['雉始雊', 'きじはじめてなく', 'Die Fasanen beginnen zu rufen']]],
    ['01-20', '大寒', [['款冬華', 'ふきのはなさく', 'Die Pestwurz treibt Knospen'],
      ['水沢腹堅', 'さわみずこおりつめる', 'Dickes Eis bedeckt die Bäche'],
      ['鶏始乳', 'にわとりはじめてとやにつく', 'Die Hühner beginnen zu legen']]],
  ];
  // → [{ start: 'MM-TT', n: 1–72, sekki, kanji, reading, de }] nach Datum sortiert.
  // Rechenjahr 2026 (kein Schaltjahr); der 29.02. fällt per Textvergleich richtig.
  const KOU = SEKKI.flatMap(([md, sekki, kous], s) => kous.map(([kanji, reading, de], i) => ({
    start: todayKey(new Date(2026, Number(md.slice(0, 2)) - 1, Number(md.slice(3)) + 5 * i)).slice(5),
    n: s * 3 + i + 1, sekki, kanji, reading, de,
  }))).sort((a, b) => a.start.localeCompare(b.start));
  // Das Kō, in dem ein Tag liegt.
  function kouOf(key) {
    const md = key.slice(5);
    let hit = KOU[KOU.length - 1];
    for (const k of KOU) if (k.start <= md) hit = k;
    return hit;
  }
  // Japanische Jahreszeit nach dem alten Kalender: sie beginnt mit 立春 (Kō 1),
  // 立夏 (19), 立秋 (37), 立冬 (55).
  function seasonOf(key) {
    const n = kouOf(key).n;
    return n <= 18 ? 'spring' : n <= 36 ? 'summer' : n <= 54 ? 'autumn' : 'winter';
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
  // ↩ JJJJ-MM-TT — Verweis auf einen früheren Tag („Weiterschreiben“, 続き).
  // Leerzeichen nach dem Pfeil optional; nur gültige Tage zählen. ️: die
  // Emoji-Tastatur (iOS) hängt an ↩ oft ein unsichtbares Variations-Zeichen an.
  const TOKEN_RE = new RegExp(
    '(↩)\\uFE0F?[ \\t]?(\\d{4}-\\d{2}-\\d{2})(?!\\d)' + '|' +
    '(?<![\\p{L}\\p{M}\\p{N}_\\/&])([@#])([\\p{L}\\p{M}\\p{N}_]+(?:-[\\p{L}\\p{M}\\p{N}_]+)*)', 'gu');
  const HAS_LETTER = /\p{L}/u;
  const REF = '↩';

  // Zerlegt Text in [{type:'text'|'@'|'#'|'↩', value}] — einzige Stelle der Token-Regel.
  function tokenize(text) {
    const parts = [];
    let last = 0;
    for (const m of text.matchAll(TOKEN_RE)) {
      const tok = m[1] ? { type: REF, value: m[2] } : { type: m[3], value: m[4] };
      if (tok.type === REF ? !isValidDay(tok.value) : !HAS_LETTER.test(tok.value)) continue;
      if (m.index > last) parts.push({ type: 'text', value: text.slice(last, m.index) });
      parts.push(tok);
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
    return parts;
  }
  function extractTokens(text) {
    const people = new Set(), tags = new Set(), refs = new Set();
    for (const p of tokenize(text)) {
      if (p.type === '@') people.add(p.value);
      else if (p.type === '#') tags.add(p.value);
      else if (p.type === REF) refs.add(p.value);
    }
    return { people: [...people], tags: [...tags], refs: [...refs] };
  }

  // ── Fäden: Einträge, die über ↩-Verweise zusammenhängen ───────
  // texts: { key: text }. → { key: [Tage, die auf key verweisen] } (aufsteigend)
  function backlinkIndex(texts) {
    const idx = {};
    for (const k of Object.keys(texts).sort()) {
      for (const r of extractTokens(texts[k]).refs) {
        if (r !== k) (idx[r] = idx[r] || []).push(k);
      }
    }
    return idx;
  }
  // Der Faden um key: woher es kommt (nur Verweise, nach oben) und wie es
  // weiterging (nur Rückverweise, nach unten) — getrennt gesucht, damit ein Tag,
  // der zwei Fäden fortsetzt, sie nicht verschmilzt (Job ↩ und Oma ↩ am selben
  // Tag bleiben zwei Fäden). Nur vorhandene Einträge, chronologisch.
  function threadKeys(texts, key) {
    const back = backlinkIndex(texts);
    const up = k => (texts[k] !== undefined ? extractTokens(texts[k]).refs : []);
    const down = k => back[k] || [];
    const seen = new Set([key]);
    for (const step of [up, down]) {
      const queue = [key];
      while (queue.length) {
        for (const n of step(queue.shift())) if (!seen.has(n)) { seen.add(n); queue.push(n); }
      }
    }
    return [...seen].filter(k => texts[k] !== undefined).sort();
  }
  // Text für „weiterschreiben“: Verweis-Zeile ans Ende — nie doppelt.
  function appendRef(text, key) {
    if (extractTokens(text).refs.includes(key)) return text;
    const sep = !text.trim() ? '' : text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
    return `${text.trim() ? text : ''}${sep}${REF} ${key} `;
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
    isoWeekday, periodOf, shiftPeriod, keysInPeriod, periodPicks, KOU, kouOf, seasonOf,
    tokenize, extractTokens, entryHasToken, esc, backlinkIndex, threadKeys, appendRef,
    buildMarkdown, parseMarkdown,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else root.TsuzukiCore = Core;
})(typeof globalThis !== 'undefined' ? globalThis : this);
