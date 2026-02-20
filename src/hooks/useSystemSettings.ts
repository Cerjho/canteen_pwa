import { useQuery } from '@tanstack/react-query';
import { supabase } from '../services/supabaseClient';

interface SystemSettings {
  maintenance_mode: boolean;
  canteen_name: string;
  operating_hours: { open: string; close: string };
  order_cutoff_time: string;
  allow_future_orders: boolean;
  max_future_days: number;
  low_stock_threshold: number;
}

const defaultSettings: SystemSettings = {
  maintenance_mode: false,
  canteen_name: 'School Canteen',
  operating_hours: { open: '07:00', close: '15:00' },
  order_cutoff_time: '10:00',
  allow_future_orders: true,
  max_future_days: 5,
  low_stock_threshold: 10,
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
          'order_cutoff_time', 'allow_future_orders', 'max_future_days',
          'low_stock_threshold', 'auto_complete_orders', 'notification_email'
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
  };
}
