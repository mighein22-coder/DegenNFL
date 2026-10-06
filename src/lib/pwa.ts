/**
 * Small pure helpers behind the installable-app notices.
 *
 * Kept out of the component so the one bit of real logic — "should we show an
 * Add to Home Screen hint on this device?" — can be tested without a DOM.
 * Ported from FrozenDegenerates' lib/pwa.ts.
 */

export const IOS_HINT_DISMISSED_KEY = 'degennfl-ios-install-hint-dismissed';

export interface HintContext {
  userAgent: string;
  /** navigator.maxTouchPoints — iPadOS reports itself as a Mac, touch is the tell. */
  maxTouchPoints: number;
  /** navigator.standalone (iOS) or the display-mode: standalone media query. */
  standalone: boolean;
  dismissed: boolean;
}

/**
 * iOS never offers an install prompt (`beforeinstallprompt` is Chrome/Edge
 * only), so on an iPhone or iPad the only way to learn the app can be
 * installed is to be told where the Share menu's "Add to Home Screen" is.
 *
 * Only Safari can install a web app on iOS — Chrome and Firefox on iOS are
 * Safari underneath but have no Add to Home Screen — so the hint is limited to
 * Safari itself. (Since iOS 16.4 Chrome/Edge can too, but each buries it
 * differently; a hint we cannot word accurately is worse than none.)
 */
export function shouldShowIosInstallHint(ctx: HintContext): boolean {
  if (ctx.standalone || ctx.dismissed) return false;

  const ua = ctx.userAgent;
  const iPhoneOrPod = /iPhone|iPod/.test(ua);
  const iPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && ctx.maxTouchPoints > 1);
  if (!iPhoneOrPod && !iPad) return false;

  const otherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua);
  return /Safari/.test(ua) && !otherBrowser;
}

/** Reads the real environment. Guarded because storage can throw (private mode). */
export function readIosInstallHintContext(): HintContext {
  let dismissed = false;
  try {
    dismissed = localStorage.getItem(IOS_HINT_DISMISSED_KEY) === '1';
  } catch {
    // Private mode: treat as not dismissed; the hint just returns next visit.
  }
  return {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone:
      (navigator as Navigator & { standalone?: boolean }).standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches,
    dismissed
  };
}

export function dismissIosInstallHint(): void {
  try {
    localStorage.setItem(IOS_HINT_DISMISSED_KEY, '1');
  } catch {
    // Nothing to do; the hint will come back next visit.
  }
}
