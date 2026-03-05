import { useQuery } from '@tanstack/react-query';
import { supabase } from '../services/supabaseClient';
import { isCutoffPassed, getCutoffCountdown, isSurplusCutoffPassed } from '../utils/dateUtils';

export interface SystemSettings {
  maintenance_mode: boolean;
  canteen_name: string;
  operating_hours: { open: string; close: string };
  /** Day of week for weekly cutoff (0=Sun, 5=Fri). Default 5 (Friday). */
  weekly_cutoff_day: number;
  /** Time of day for weekly cutoff in HH:mm format. Default '17:00'. */
  weekly_cutoff_time: string;
  /** Daily surplus ordering closes at this time (HH:mm). Default '08:00'. */
  surplus_cutoff_time: string;
  /** Daily cancellation cutoff for individual days (HH:mm). Default '08:00'. */
  daily_cancel_cutoff_time: string;
  auto_complete_orders: boolean;
  notification_email: string;
}

const defaultSettings: SystemSettings = {
  maintenance_mode: false,
  canteen_name: 'LOHECA Canteen',
  operating_hours: { open: '07:00', close: '15:00' },
  weekly_cutoff_day: 5,
  weekly_cutoff_time: '17:00',
  surplus_cutoff_time: '08:00',
  daily_cancel_cutoff_time: '08:00',
  auto_complete_orders: false,
  notification_email: '',
};

export function useSystemSettings() {
  const { data: settings, isLoading, error, refetch } = useQuery<SystemSettings>({
    queryKey: ['system-settings-global'],
    queryFn: async () => {
      // Race the Supabase call against a 4s timeout.
      // Why: supabase.from().select() internally calls auth.getSession()
      // which blocks on token refresh when the JWT is expired (e.g. after
      // returning from an external payment redirect). The auth hook has its
      // own 5s timeout, but this query would stay pending indefinitely
      // because the Supabase client serialises all getSession() callers
      // behind a lock. Returning defaults here is safe — system_settings
      // is public (RLS: USING TRUE) and React Query will refetch once the
      // token refresh eventually completes.
      const fetchSettings = async (): Promise<SystemSettings> => {
        const { data, error } = await supabase
          .from('system_settings')
          .select('key, value');

        if (error) {
          console.error('Failed to fetch system settings:', error);
          return defaultSettings;
        }

        const VALID_SETTINGS_KEYS = new Set([
          'maintenance_mode', 'canteen_name', 'operating_hours',
          'weekly_cutoff_day', 'weekly_cutoff_time', 'surplus_cutoff_time',
          'daily_cancel_cutoff_time', 'auto_complete_orders', 'notification_email'
        ]);
        const parsed = { ...defaultSettings };
        data?.forEach(setting => {
          try {
            if (VALID_SETTINGS_KEYS.has(setting.key)) {
              (parsed as Record<string, unknown>)[setting.key] = setting.value;
            }
          } catch {
            // Skip invalid settings
          }
        });

        // The DB stores weekly_cutoff_day as a day-name string (e.g. "friday")
        // but the frontend expects a number (0=Sun .. 6=Sat). Normalise here.
        if (typeof parsed.weekly_cutoff_day === 'string') {
          const DAY_MAP: Record<string, number> = {
            sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
            thursday: 4, friday: 5, saturday: 6,
          };
          parsed.weekly_cutoff_day =
            DAY_MAP[(parsed.weekly_cutoff_day as unknown as string).toLowerCase()] ?? defaultSettings.weekly_cutoff_day;
        } else if (typeof parsed.weekly_cutoff_day !== 'number') {
          parsed.weekly_cutoff_day = defaultSettings.weekly_cutoff_day;
        }

        return parsed;
      };

      const timeout = new Promise<SystemSettings>((resolve) =>
        setTimeout(() => resolve(defaultSettings), 4000)
      );

      return Promise.race([fetchSettings(), timeout]);
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnWindowFocus: true,
  });

  return {
    settings: settings || defaultSettings,
    isLoading,
    error,
    refetch,
    isMaintenanceMode: settings?.maintenance_mode ?? false,
    /** Check if weekly ordering cutoff has passed for a given target week start date. */
    isWeeklyCutoffPassed: (targetWeekStart: string) =>
      isCutoffPassed(
        targetWeekStart,
        settings?.weekly_cutoff_day ?? defaultSettings.weekly_cutoff_day,
        settings?.weekly_cutoff_time ?? defaultSettings.weekly_cutoff_time
      ),
    /** Get countdown string to cutoff deadline (e.g. "2d 3h 15m"). */
    getWeeklyCutoffCountdown: (targetWeekStart: string) =>
      getCutoffCountdown(
        targetWeekStart,
        settings?.weekly_cutoff_day ?? defaultSettings.weekly_cutoff_day,
        settings?.weekly_cutoff_time ?? defaultSettings.weekly_cutoff_time
      ),
    /** Check if today's surplus ordering window has closed. */
    isSurplusClosed: () => {
      const [h, m] = (settings?.surplus_cutoff_time ?? defaultSettings.surplus_cutoff_time)
        .split(':')
        .map(Number);
      return isSurplusCutoffPassed(h, m);
    },
  };
}
