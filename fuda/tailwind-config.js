// Fudas Farben und Schriften für Tailwind (vendor/tailwindcss-*.js erzeugt die Klassen im Browser).
// Eigene Datei statt <script> im HTML: Die CSP erlaubt Skripte nur als Dateien von Fuda selbst.
tailwind.config = {
  theme: {
    extend: {
      colors: {
        paper: {
          bg: '#F6F4F0',       // Warmer Papier-Hintergrund
          surface: '#EFECE6',  // Omnibar & Hover-Flächen
          border: '#E2DDD5',   // Dezente Trennlinien
          code: '#EAE6DF',     // Inline-Code (Klick kopiert)
          darkcode: '#282725', // Warmer Espresso-Ton für Java-Code
        },
        ink: {
          primary: '#1F1E1C',
          secondary: '#6E6A63',
          muted: '#9C968E',
        },
        tag: {
          bg: '#DFECE2',       // Salbeigrün für #tags
          text: '#2D5A3C',
        }
      },
      fontFamily: {
        serif: ['Lora', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      }
    }
  }
};
