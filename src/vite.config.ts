import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// --surface-canvas in dark mode (oklch(0.19 0.02 260) in styles/brand.css), the
// page colour a member sees before and behind the app. Dark is the default
// display mode, and a manifest cannot switch with the theme, so this is the one
// colour it carries; index.html's per-theme <meta name="theme-color"> tags do
// the rest. Recompute from brand.css if that token ever changes.
const CANVAS_DARK = '#0f141d';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // EMERGENCY KILL SWITCH. If a bad service worker ever ships, set
      // PWA_KILL_SWITCH=1 in the Netlify build environment and redeploy: the
      // plugin then emits a worker that unregisters itself and clears its
      // caches, so installed copies go back to behaving like the website.
      // Not VITE_-prefixed on purpose: it is a build flag, not something the
      // bundle should read. See docs/OPERATIONS.md.
      selfDestroying: process.env.PWA_KILL_SWITCH === '1',

      // 'prompt', not 'autoUpdate': a new version waits until the member taps
      // Reload (PwaNotices), so an update never lands mid-pick and discards an
      // unsaved sheet.
      registerType: 'prompt',
      includeAssets: ['favicon-64.png', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'DegenNFL',
        short_name: 'DegenNFL',
        description: 'The NFL against-the-spread confidence pool.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: CANVAS_DARK,
        background_color: CANVAS_DARK,
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // The app shell only. @fontsource ships a file per script; keep the
        // Latin ones (team names carry accents, and `-latin-` also matches
        // `-latin-ext-`) and let Cyrillic, Greek, Vietnamese and Devanagari
        // load on demand rather than precaching files nobody needs. The .woff
        // twins are skipped too: every browser that can install this app reads
        // woff2.
        globPatterns: ['**/*.{js,css,html,png,svg,ico}', '**/*-latin-*.woff2'],
        cleanupOutdatedCaches: true,
        // A refresh or a deep link works offline: serve the shell for any page
        // navigation, except the Netlify functions, which are not pages.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/\.netlify\//],
        // Everything dynamic goes to the network, always. Standings, picks and
        // scores go stale in minutes, a cached copy could show a member a sheet
        // that is not what was saved, and auth responses must never be stored.
        // Anything not listed here is uncached anyway (workbox only handles
        // what is precached or routed), so this is explicit rather than
        // load-bearing.
        runtimeCaching: [
          { urlPattern: ({ url }) => url.hostname.endsWith('.supabase.co'), handler: 'NetworkOnly' },
          { urlPattern: ({ url }) => url.pathname.startsWith('/.netlify/'), handler: 'NetworkOnly' }
        ]
      }
    })
  ],
  server: {
    port: 3000
  }
});
