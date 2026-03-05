import { useState, useEffect } from 'react';
import { Clock, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { getCutoffCountdown, isCutoffPassed } from '../utils/dateUtils';

interface CutoffCountdownProps {
  /** Monday date of the target week (YYYY-MM-DD) */
  targetWeekStart: string;
  /** Day-of-week for cutoff (0=Sun..6=Sat). Default 5 (Friday). */
  cutoffDay?: number;
  /** Time string in HH:mm format (24h). Default '17:00'. */
  cutoffTime?: string;
  /** Compact mode — single line, smaller text */
  compact?: boolean;
}

type Status = 'open' | 'closing-soon' | 'closed';

function getStatus(
  targetWeekStart: string,
  cutoffDay: number,
  cutoffTime: string,
): { status: Status; label: string; countdown: string } {
  if (isCutoffPassed(targetWeekStart, cutoffDay, cutoffTime)) {
    return { status: 'closed', label: 'Orders closed', countdown: '' };
  }

  const cd = getCutoffCountdown(targetWeekStart, cutoffDay, cutoffTime);
  // "closing-soon" if less than 24 hours remain
  const isClosingSoon = cd.days === 0;

  const countdown =
    cd.days > 0
      ? `${cd.days}d ${cd.hours}h`
      : cd.hours > 0
        ? `${cd.hours}h ${cd.minutes}m`
        : `${cd.minutes}m`;

  return {
    status: isClosingSoon ? 'closing-soon' : 'open',
    label: isClosingSoon ? 'Closing soon' : 'Open for ordering',
    countdown,
  };
}

const STATUS_CONFIG: Record<
  Status,
  {
    bg: string;
    text: string;
    icon: React.ReactNode;
    border: string;
  }
> = {
  open: {
    bg: 'bg-green-50 dark:bg-green-900/20',
    text: 'text-green-700 dark:text-green-300',
    icon: <CheckCircle size={18} />,
    border: 'border-green-200 dark:border-green-800',
  },
  'closing-soon': {
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    text: 'text-amber-700 dark:text-amber-300',
    icon: <AlertTriangle size={18} />,
    border: 'border-amber-200 dark:border-amber-800',
  },
  closed: {
    bg: 'bg-red-50 dark:bg-red-900/20',
    text: 'text-red-700 dark:text-red-300',
    icon: <XCircle size={18} />,
    border: 'border-red-200 dark:border-red-800',
  },
};

export function CutoffCountdown({
  targetWeekStart,
  cutoffDay = 5,
  cutoffTime = '17:00',
  compact = false,
}: CutoffCountdownProps) {
  const [tick, setTick] = useState(0);

  // Refresh every minute
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(interval);
  }, []);

  void tick; // force re-render dependency
  const { status, label, countdown } = getStatus(targetWeekStart, cutoffDay, cutoffTime);
  const config = STATUS_CONFIG[status];

  if (compact) {
    return (
      <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${config.bg} ${config.text} border ${config.border}`}>
        {config.icon}
        <span>{label}</span>
        {countdown && (
          <>
            <span className="opacity-50">·</span>
            <Clock size={12} />
            <span>{countdown}</span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-3 p-3 rounded-xl border ${config.bg} ${config.border}`}>
      <div className={config.text}>{config.icon}</div>
      <div className="flex-1">
        <p className={`text-sm font-semibold ${config.text}`}>{label}</p>
        {status !== 'closed' && countdown && (
          <p className={`text-xs flex items-center gap-1 mt-0.5 ${config.text} opacity-80`}>
            <Clock size={12} />
            Orders close in {countdown}
          </p>
        )}
        {status === 'closed' && (
          <p className={`text-xs mt-0.5 ${config.text} opacity-80`}>
            Check surplus items for today
          </p>
        )}
      </div>
    </div>
  );
}
