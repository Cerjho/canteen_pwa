import { useState, useEffect } from 'react';
import { Download, X, Share } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Check if already installed as PWA
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as any).standalone === true;
    setIsStandalone(standalone);

    // Detect iOS
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(ios);

    // Check if user dismissed the prompt recently (24h cooldown)
    const dismissed = localStorage.getItem('pwa_install_dismissed');
    if (dismissed) {
      const dismissedAt = parseInt(dismissed, 10);
      if (Date.now() - dismissedAt < 24 * 60 * 60 * 1000) {
        return; // Don't show for 24 hours after dismissal
      }
    }

    // Listen for the install prompt event
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowBanner(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    // Show iOS instructions after a delay if not installed
    if (ios && !standalone) {
      const timer = setTimeout(() => setShowBanner(true), 3000);
      return () => {
        clearTimeout(timer);
        window.removeEventListener('beforeinstallprompt', handler);
      };
    }

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
      setShowBanner(false);
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setShowBanner(false);
    localStorage.setItem('pwa_install_dismissed', Date.now().toString());
  };

  // Don't show if already installed or banner not ready
  if (isStandalone || !showBanner) return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 z-50 animate-slide-up">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-4">
        <button
          onClick={handleDismiss}
          className="absolute top-2 right-2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          aria-label="Dismiss"
        >
          <X size={18} />
        </button>

        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-12 h-12 bg-primary-100 dark:bg-primary-900/30 rounded-xl flex items-center justify-center">
            <Download className="w-6 h-6 text-primary-600 dark:text-primary-400" />
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">
              Install LOHECA Canteen
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {isIOS 
                ? 'Add to your home screen for quick access'
                : 'Install for faster access and offline support'
              }
            </p>

            {isIOS ? (
              <div className="mt-3 flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                <span>Tap</span>
                <Share size={16} className="text-primary-600" />
                <span>then "Add to Home Screen"</span>
              </div>
            ) : (
              <button
                onClick={handleInstall}
                className="mt-3 px-4 py-1.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Install App
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
