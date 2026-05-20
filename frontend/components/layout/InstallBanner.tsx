'use client';
import { useEffect, useState } from 'react';
import { Download, X, Share, PlusSquare } from 'lucide-react';

// Chrome fires this when the PWA is installable. It's not in the standard
// TS DOM lib, so we type it locally.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'karlfx_install_dismissed_v1';

// Compact, dismissible install banner shown at the top of the app content.
//   - Android/Chrome: captures beforeinstallprompt and shows a real
//     "Install" button that triggers the native install dialog.
//   - iOS Safari: no beforeinstallprompt exists, so we show the manual
//     "Share → Add to Home Screen" instructions instead.
// Hides itself once installed (appinstalled) or dismissed (persisted).
export default function InstallBanner() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Already installed → never show.
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) return;

    const dismissed = window.localStorage.getItem(DISMISS_KEY) === '1';
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    setIos(isIos);

    const onBeforeInstall = (e: Event) => {
      e.preventDefault(); // suppress Chrome's default mini-infobar
      setDeferred(e as BeforeInstallPromptEvent);
      if (!dismissed) setVisible(true);
    };
    const onInstalled = () => {
      setVisible(false);
      setDeferred(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    // iOS never fires beforeinstallprompt — show the manual hint instead.
    if (isIos && !dismissed) setVisible(true);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function handleInstall() {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === 'accepted') setVisible(false);
    setDeferred(null);
  }

  function dismiss() {
    setVisible(false);
    try { window.localStorage.setItem(DISMISS_KEY, '1'); } catch {}
  }

  if (!visible) return null;

  return (
    <div className="mb-4 bg-card border border-accent/40 rounded-xl p-3 flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0">
        <Download className="w-4 h-4 text-accent" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-white font-semibold text-sm">Install KarlFX</p>
        {ios && !deferred ? (
          <p className="text-text-secondary text-xs flex items-center gap-1 flex-wrap">
            Tap <Share className="w-3.5 h-3.5 inline" /> then <PlusSquare className="w-3.5 h-3.5 inline" />
            <span className="text-white">Add to Home Screen</span> — required for push alerts on iPhone.
          </p>
        ) : (
          <p className="text-text-secondary text-xs">Add to your home screen for instant access + background trade alerts.</p>
        )}
      </div>

      {/* Android shows a real install button; iOS only the instructions above */}
      {deferred && (
        <button
          onClick={handleInstall}
          className="flex-shrink-0 px-3 py-1.5 bg-accent text-black font-bold rounded-lg text-xs hover:bg-accent/90 transition-colors"
        >
          Install
        </button>
      )}
      <button onClick={dismiss} className="flex-shrink-0 text-text-secondary hover:text-white p-1" title="Dismiss">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
