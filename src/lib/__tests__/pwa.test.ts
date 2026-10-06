import { describe, expect, it } from 'vitest';
import { shouldShowIosInstallHint } from '../pwa';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.6312.52 Mobile/15E148 Safari/604.1';
const IPAD_SAFARI_AS_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const MAC_SAFARI = IPAD_SAFARI_AS_MAC;
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36';

const base = { maxTouchPoints: 5, standalone: false, dismissed: false };

describe('shouldShowIosInstallHint', () => {
  it('shows in iPhone Safari', () => {
    expect(shouldShowIosInstallHint({ ...base, userAgent: IPHONE_SAFARI })).toBe(true);
  });

  it('shows on an iPad, which reports itself as a Mac but has a touch screen', () => {
    expect(shouldShowIosInstallHint({ ...base, userAgent: IPAD_SAFARI_AS_MAC })).toBe(true);
  });

  it('does not show on a real Mac, which has no touch points', () => {
    expect(shouldShowIosInstallHint({ ...base, maxTouchPoints: 0, userAgent: MAC_SAFARI })).toBe(false);
  });

  it('does not show on Android, which has its own install prompt', () => {
    expect(shouldShowIosInstallHint({ ...base, userAgent: ANDROID_CHROME })).toBe(false);
  });

  it('does not show in Chrome on iOS', () => {
    expect(shouldShowIosInstallHint({ ...base, userAgent: IPHONE_CHROME })).toBe(false);
  });

  it('does not show once the app is installed', () => {
    expect(shouldShowIosInstallHint({ ...base, standalone: true, userAgent: IPHONE_SAFARI })).toBe(false);
  });

  it('does not show after it has been dismissed', () => {
    expect(shouldShowIosInstallHint({ ...base, dismissed: true, userAgent: IPHONE_SAFARI })).toBe(false);
  });
});
