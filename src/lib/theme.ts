/**
 * Display mode: Dark (the default), Light, or System (follow the device).
 *
 * Ported from FrozenDegenerates (its issue #33), minus the half of that change
 * this app never needed. The NHL app configured Tailwind inline from the CDN,
 * so every colour class had to be rewired through a CSS variable before a
 * theme could swap anything. Here every component already paints through the
 * semantic slots in `tokens.shared.css`, so a theme is nothing more than a
 * second set of raw values in `brand.css`, keyed on `<html data-theme>`. This
 * module only decides which set is active.
 *
 * PER BROWSER, NOT PER ACCOUNT. The choice lives in localStorage rather than
 * on `profiles`: it has to apply on the login screen, before anyone is signed
 * in, and it needs no migration — and a column members may write would have
 * meant widening the column-scoped grant in 0001_init.sql for a colour.
 *
 * index.html carries an inline copy of `resolveTheme` that runs before first
 * paint, so a light-mode member never sees a flash of dark while the bundle
 * loads. Keep the two in step.
 */

export type ThemePreference = 'dark' | 'light' | 'system';
export type Theme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'degennfl-theme';
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'dark';

const LIGHT_QUERY = '(prefers-color-scheme: light)';

/**
 * The browser-chrome colour for each theme: --surface-canvas from brand.css as
 * hex (a meta tag cannot read oklch). It paints the Android status bar and the
 * installed-app title bar, so it has to follow the member's choice, not the
 * device's — which is why this is one tag updated here rather than a pair of
 * `media="(prefers-color-scheme)"` tags in index.html that would ignore the
 * Settings choice. index.html repeats these by hand for first paint, and
 * theme.test.ts pins the copy. Recompute both if the canvas token changes.
 */
export const THEME_COLORS: Record<Theme, string> = {
  dark: '#0f141d',
  light: '#f8f3e9'
};

export function parseThemePreference(value: string | null | undefined): ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
    ? value
    : DEFAULT_THEME_PREFERENCE;
}

export function resolveTheme(preference: ThemePreference, systemPrefersLight: boolean): Theme {
  if (preference === 'system') return systemPrefersLight ? 'light' : 'dark';
  return preference;
}

export function getThemePreference(): ThemePreference {
  try {
    return parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    // Storage can be blocked (private mode, site data disabled); fall back to the default.
    return DEFAULT_THEME_PREFERENCE;
  }
}

function systemPrefersLight(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.(LIGHT_QUERY).matches;
}

export function applyTheme(preference: ThemePreference = getThemePreference()): void {
  const theme = resolveTheme(preference, systemPrefersLight());
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Not persisted, but still applied for this page load.
  }
  applyTheme(preference);
}

/**
 * Follow the device while the preference is "system". Installed once at
 * startup rather than by the Settings view, so the app tracks a device that
 * switches to dark at sunset whichever screen is open — the Sunday night game
 * included.
 */
export function watchSystemTheme(): void {
  const media = window.matchMedia?.(LIGHT_QUERY);
  media?.addEventListener('change', () => {
    if (getThemePreference() === 'system') applyTheme('system');
  });
}
