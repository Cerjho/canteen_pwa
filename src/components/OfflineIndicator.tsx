import { WifiOff, AlertTriangle } from 'lucide-react';
import { useState, useEffect } from 'react';

// Extended Navigator type for Network Information API
interface NetworkInformation {
  effectiveType: 'slow-2g' | '2g' | '3g' | '4g';
  downlink: number;
  rtt: number;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

interface NavigatorWithConnection extends Navigator {
  connection?: NetworkInformation;
}

type ConnectionQuality = 'good' | 'slow' | 'offline';

function getConnectionQuality(): ConnectionQuality {
  if (!navigator.onLine) return 'offline';

  const nav = navigator as NavigatorWithConnection;
  if (nav.connection) {
    const { effectiveType, downlink } = nav.connection;
    // slow-2g, 2g, or very low bandwidth
    if (effectiveType === 'slow-2g' || effectiveType === '2g' || downlink < 0.5) {
      return 'slow';
    }
  }

  return 'good';
}

/** Tracks how long the user has been offline to show stale-data warnings */
function useOfflineDuration(isOnline: boolean): number {
  const [offlineSince, setOfflineSince] = useState<number | null>(null);
  const [durationMinutes, setDurationMinutes] = useState(0);

  useEffect(() => {
    if (!isOnline && offlineSince === null) {
      setOfflineSince(Date.now());
    } else if (isOnline) {
      setOfflineSince(null);
      setDurationMinutes(0);
    }
  }, [isOnline, offlineSince]);

  useEffect(() => {
    if (offlineSince === null) return;
    const interval = setInterval(() => {
      setDurationMinutes(Math.floor((Date.now() - offlineSince) / 60_000));
    }, 30_000); // update every 30s
    return () => clearInterval(interval);
  }, [offlineSince]);

  return durationMinutes;
}

export function OfflineIndicator() {
  const [quality, setQuality] = useState<ConnectionQuality>(getConnectionQuality);
  const isOnline = quality !== 'offline';
  const offlineMinutes = useOfflineDuration(isOnline);

  useEffect(() => {
    const handleOnline = () => setQuality(getConnectionQuality());
    const handleOffline = () => setQuality('offline');

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Listen for network quality changes via Network Information API
    const nav = navigator as NavigatorWithConnection;
    const handleConnectionChange = () => setQuality(getConnectionQuality());
    nav.connection?.addEventListener('change', handleConnectionChange);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      nav.connection?.removeEventListener('change', handleConnectionChange);
    };
  }, []);

  // Stale data warning after 10+ minutes offline
  const STALE_THRESHOLD_MINUTES = 10;
  const showStaleWarning = !isOnline && offlineMinutes >= STALE_THRESHOLD_MINUTES;

  if (quality === 'good') return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex flex-col">
      {quality === 'offline' && (
        <div className="bg-amber-500 text-white px-4 py-2 flex items-center justify-center gap-2">
          <WifiOff size={18} />
          <span className="text-sm font-medium">
            You&apos;re offline. Orders will sync when connected.
          </span>
        </div>
      )}
      {quality === 'slow' && (
        <div className="bg-orange-400 text-white px-4 py-2 flex items-center justify-center gap-2">
          <AlertTriangle size={18} />
          <span className="text-sm font-medium">
            Slow connection detected. Some features may be delayed.
          </span>
        </div>
      )}
      {showStaleWarning && (
        <div className="bg-red-500 text-white px-4 py-1.5 flex items-center justify-center gap-2">
          <AlertTriangle size={16} />
          <span className="text-xs">
            Offline for {offlineMinutes}+ min — menu prices may be outdated.
          </span>
        </div>
      )}
    </div>
  );
}
