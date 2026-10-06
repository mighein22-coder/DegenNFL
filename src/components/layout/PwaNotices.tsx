import React, { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw, Share, WifiOff, X } from 'lucide-react';
import { Button } from '../Button';
import {
  dismissIosInstallHint,
  readIosInstallHintContext,
  shouldShowIosInstallHint
} from '../../lib/pwa';

/**
 * The three things an installed app has to say that a website never did: a new
 * version is ready, the network is gone, and (iOS only) how to install.
 *
 * Rendered once, at the app root. They stack in one fixed column above the
 * mobile bottom nav (the nav is 3.75rem plus the home-bar inset) and drop to the
 * corner on desktop. Never printed.
 *
 * Ported from FrozenDegenerates, repainted in this app's semantic tokens.
 */
export const PwaNotices: React.FC = () => {
  const online = useOnline();
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    setShowIosHint(shouldShowIosInstallHint(readIosInstallHintContext()));
  }, []);

  // registerType is 'prompt': a new service worker waits until the member says
  // so. Swapping the app under someone mid-pick would throw away an unsaved
  // sheet, so the reload is theirs to choose.
  const {
    needRefresh: [needRefresh],
    updateServiceWorker
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // A phone keeps the app alive in the background for days, so the
      // once-per-navigation update check never fires. Ask again hourly.
      if (registration) setInterval(() => void registration.update(), 60 * 60 * 1000);
    }
  });

  if (online && !needRefresh && !showIosHint) return null;

  const card =
    'flex items-center gap-3 rounded-card border border-line bg-surface-raised px-4 py-3 text-sm text-ink shadow-card';

  return (
    <div className="fixed left-[max(0.75rem,env(safe-area-inset-left))] right-[max(0.75rem,env(safe-area-inset-right))] bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 flex flex-col gap-2 md:left-auto md:right-4 md:bottom-4 md:w-96 print:hidden">
      {!online && (
        <div role="status" className={card}>
          <WifiOff size={18} className="shrink-0 text-muted" aria-hidden />
          <span>You&apos;re offline. Standings and picks can&apos;t update until you reconnect.</span>
        </div>
      )}

      {needRefresh && (
        <div role="status" className={card}>
          <RefreshCw size={18} className="shrink-0 text-brand-400" aria-hidden />
          <span className="flex-1">A new version of DegenNFL is ready.</span>
          <Button size="sm" onClick={() => void updateServiceWorker(true)}>
            Reload
          </Button>
        </div>
      )}

      {showIosHint && (
        <div role="note" className={`${card} items-start`}>
          <Share size={18} className="mt-0.5 shrink-0 text-brand-400" aria-hidden />
          <span className="flex-1">
            Install DegenNFL: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.
          </span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => {
              dismissIosInstallHint();
              setShowIosHint(false);
            }}
            className="shrink-0 text-muted hover:text-ink"
          >
            <X size={18} aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
};

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}
