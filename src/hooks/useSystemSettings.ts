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
      const { data, error } = await supabase
        .from('system_settings')
        .select('key, value');
      
      if (error) {
        console.error('Failed to fetch system settings:', error);
        return defaultSettings;
      }
      
      const parsed = { ...defaultSettings };
      data?.forEach(setting => {
        try {
          (parsed as Record<string, unknown>)[setting.key] = setting.value;
        } catch {
          // Skip invalid settings
        }
      });
      
      return parsed;
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
