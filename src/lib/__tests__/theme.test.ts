import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseThemePreference, resolveTheme, THEME_COLORS, THEME_STORAGE_KEY } from '../theme';

describe('parseThemePreference', () => {
  it('accepts the three stored values', () => {
    expect(parseThemePreference('dark')).toBe('dark');
    expect(parseThemePreference('light')).toBe('light');
    expect(parseThemePreference('system')).toBe('system');
  });

  it('defaults to dark when nothing, or something unexpected, is stored', () => {
    expect(parseThemePreference(null)).toBe('dark');
    expect(parseThemePreference(undefined)).toBe('dark');
    expect(parseThemePreference('')).toBe('dark');
    expect(parseThemePreference('Light')).toBe('dark');
  });
});

describe('resolveTheme', () => {
  it('ignores the device for an explicit choice', () => {
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('light', false)).toBe('light');
  });

  it('follows the device for system', () => {
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
  });
});

describe('the pre-paint script in index.html', () => {
  // It cannot import this module — it runs before the bundle exists — so it
  // repeats the storage key and the default by hand. This pins the copy.
  it('reads the same storage key and defaults to dark', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    expect(html).toContain(`localStorage.getItem('${THEME_STORAGE_KEY}')`);
    expect(html).toContain("|| 'dark'");
  });

  it('carries the same browser-chrome colours as THEME_COLORS', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    expect(html).toContain(`dark: '${THEME_COLORS.dark}'`);
    expect(html).toContain(`light: '${THEME_COLORS.light}'`);
    // The static tag a browser reads before any script runs is the dark one,
    // matching the manifest.
    expect(html).toContain(`<meta name="theme-color" content="${THEME_COLORS.dark}" />`);
  });
});

describe('watchSystemTheme', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('re-applies on a device change only while the preference is system', async () => {
    let onChange: () => void = () => {};
    let prefersLight = true;
    const store: Record<string, string> = {};
    const html = { dataset: {} as Record<string, string> };
    const meta = { content: '', setAttribute(_: string, v: string) { this.content = v; } };

    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; }
    });
    vi.stubGlobal('document', { documentElement: html, querySelector: () => meta });
    vi.stubGlobal('window', {
      matchMedia: () => ({
        get matches() { return prefersLight; },
        addEventListener: (_: string, cb: () => void) => { onChange = cb; }
      })
    });

    const { watchSystemTheme, setThemePreference } = await import('../theme');
    watchSystemTheme();

    setThemePreference('system');
    expect(html.dataset.theme).toBe('light');
    expect(meta.content).toBe(THEME_COLORS.light);

    prefersLight = false;
    onChange();
    expect(html.dataset.theme).toBe('dark');
    expect(meta.content).toBe(THEME_COLORS.dark);

    // An explicit choice is not overridden by the device.
    setThemePreference('light');
    prefersLight = true;
    onChange();
    prefersLight = false;
    onChange();
    expect(html.dataset.theme).toBe('light');
  });

  it('still applies a choice when storage is blocked', async () => {
    const html = { dataset: {} as Record<string, string> };
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); }
    });
    vi.stubGlobal('document', { documentElement: html, querySelector: () => null });
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });

    const { setThemePreference, getThemePreference } = await import('../theme');
    setThemePreference('light');
    expect(html.dataset.theme).toBe('light');
    expect(getThemePreference()).toBe('dark');
  });
});
