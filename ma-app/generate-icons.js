/**
 * 間 Ma - Icon Generator
 * Generiert PNG Icons aus SVG für PWA
 *
 * Nutzung: node generate-icons.js
 * Benötigt: npm install sharp
 */

const fs = require('fs');
const path = require('path');

// Versuche sharp zu laden, falls installiert
let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  console.log('Sharp nicht installiert. Installiere mit: npm install sharp');
  console.log('');
  console.log('Alternative: Nutze einen Online-Konverter wie:');
  console.log('  - https://realfavicongenerator.net');
  console.log('  - https://www.pwabuilder.com/imageGenerator');
  console.log('');
  console.log('Oder installiere sharp und führe dieses Script erneut aus:');
  console.log('  cd Ma-App && npm install sharp && node generate-icons.js');
  process.exit(1);
}

const ICONS_DIR = path.join(__dirname, 'icons');
const SIZES = [32, 72, 96, 128, 144, 152, 192, 384, 512];

// SVG Template für das 間 Icon
const createSvg = (size) => {
  const radius = Math.round(size * 0.125);
  const fontSize = Math.round(size * 0.55);
  const yPos = Math.round(size * 0.62);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="#FAFAF9"/>
  <text x="${size/2}" y="${yPos}" text-anchor="middle" font-family="Noto Sans JP, Yu Gothic, Hiragino Sans, serif" font-size="${fontSize}" font-weight="300" fill="#2D2D2D" opacity="0.7">間</text>
</svg>`;
};

async function generateIcons() {
  console.log('Generiere PNG Icons...\n');

  for (const size of SIZES) {
    const svg = createSvg(size);
    const outputPath = path.join(ICONS_DIR, `icon-${size}.png`);

    try {
      await sharp(Buffer.from(svg))
        .png()
        .toFile(outputPath);

      console.log(`✓ icon-${size}.png erstellt`);
    } catch (error) {
      console.error(`✗ Fehler bei icon-${size}.png:`, error.message);
    }
  }

  console.log('\nFertig! Icons wurden im icons/ Ordner erstellt.');
}

generateIcons();
