# vendor/ – fremde Dateien, lokal

Fuda lädt nichts von fremden Servern. Was sonst von einem CDN käme, liegt hier, in fester Version. Der Server liefert aus diesem Ordner nur `.js` und `.woff2` aus.

| Datei | Herkunft (Stand 30.10.2026) | Lizenz | SHA-256 |
| --- | --- | --- | --- |
| `tailwindcss-3.4.17.js` | `https://cdn.tailwindcss.com/3.4.17` (Play-Skript: erzeugt die Klassen im Browser, kein Build-Schritt) | MIT, `LICENSE-tailwindcss.txt` | `176e894661aa9cdc9a5cba6c720044cbbf7b8bd80d1c9a142a7c24b1b6c50d15` |
| `fonts/inter.woff2` | Google Fonts, Inter v20, latin, variabel (400–600) | OFL 1.1, `fonts/OFL-Inter.txt` | `3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62` |
| `fonts/jetbrains-mono.woff2` | Google Fonts, JetBrains Mono v24, latin, variabel (400–500) | OFL 1.1, `fonts/OFL-JetBrainsMono.txt` | `83c005d49d8a6a50474c73a5a36ac0468076e9c4a29da7bdb14995d80560a5be` |
| `fonts/lora.woff2` | Google Fonts, Lora v37, latin, variabel (500–600) | OFL 1.1, `fonts/OFL-Lora.txt` | `ddb8c66035104e233fc024669183aad3738b6daa16deee2ebb1241bd0f98ace1` |

Die Schriften enthalten nur den Zeichensatz „latin“ (mit Umlauten, €, Pfeilen ↑ ↓). Andere Zeichen zeigt der Browser in einer Systemschrift.

**Aktualisieren:** neue Datei mit Versionsnummer im Namen ablegen, Verweis in `index.html` anpassen, Prüfsumme hier eintragen, `node --test` und die App im Browser prüfen.
