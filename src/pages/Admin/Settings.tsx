import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Clock, 
  Calendar, 
  Package,
  Save,
  RefreshCw,
  AlertTriangle,
  Store,
  Mail,
  Wrench
} from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import { PageHeader } from '../../components/PageHeader';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../components/Toast';
import { friendlyError } from '../../utils/friendlyError';

interface SystemSetting {
  key: string;
  value: unknown;
  description: string;
  updated_at: string;
}

interface SettingsState {
  canteen_name: string;
  operating_hours: { open: string; close: string };
  order_cutoff_time: string;
  allow_future_orders: boolean;
  max_future_days: number;
  low_stock_threshold: number;
  auto_complete_orders: boolean;
  notification_email: string | null;
  maintenance_mode: boolean;
}

const defaultSettings: SettingsState = {
  canteen_name: 'School Canteen',
  operating_hours: { open: '07:00', close: '15:00' },
  order_cutoff_time: '10:00',
  allow_future_orders: true,
  max_future_days: 5,
  low_stock_threshold: 10,
  auto_complete_orders: false,
  notification_email: null,
  maintenance_mode: false
};

export default function AdminSettings() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [settings, setSettings] = useState<SettingsState>(defaultSettings);
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch settings
  const { data: savedSettings, isLoading } = useQuery<SystemSetting[]>({
    queryKey: ['system-settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('system_settings')
        .select('*');
      
      if (error) {
        // Table might not exist yet
        // Settings table not found, using defaults silently
        return [];
      }
      return data || [];
    }
  });

  // Parse saved settings into state with type validation
  useEffect(() => {
    if (savedSettings && savedSettings.length > 0) {
      const parsed: Partial<SettingsState> = {};
      savedSettings.forEach((setting) => {
        try {
          const key = setting.key as keyof SettingsState;
          if (!(key in defaultSettings)) return; // Skip unknown keys
          
          const defaultVal = defaultSettings[key];
          const val = setting.value;
          
          // Type-check: ensure DB value matches expected type
          if (typeof defaultVal === 'boolean' && typeof val === 'boolean') {
            (parsed as Record<string, unknown>)[key] = val;
          } else if (typeof defaultVal === 'number' && typeof val === 'number') {
            (parsed as Record<string, unknown>)[key] = val;
          } else if (typeof defaultVal === 'string' && typeof val === 'string') {
            (parsed as Record<string, unknown>)[key] = val;
          } else if (defaultVal === null && (typeof val === 'string' || val === null)) {
            (parsed as Record<string, unknown>)[key] = val;
          } else if (typeof defaultVal === 'object' && defaultVal !== null && typeof val === 'object' && val !== null) {
            // For objects like operating_hours, validate shape
            (parsed as Record<string, unknown>)[key] = { ...defaultVal, ...(val as Record<string, unknown>) };
          }
        } catch {
          // Skip invalid settings
        }
      });
      setSettings({ ...defaultSettings, ...parsed });
    }
  }, [savedSettings]);

  // Save settings mutation via Edge Function with validation
  const saveMutation = useMutation({
    mutationFn: async (newSettings: SettingsState) => {
      const { data, error } = await supabase.functions.invoke('manage-settings', {
        body: { action: 'update', settings: newSettings }
      });
      
      if (error) throw error;
      if (data?.error) {
        const errorMsg = data.errors?.join(', ') || data.message;
        throw new Error(errorMsg);
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-settings'] });
      setHasChanges(false);
      showToast('Settings saved successfully', 'success');
    },
    onError: (err: Error) => showToast(friendlyError(err.message, 'save settings'), 'error')
  });

  // Archive old orders mutation
  const archiveMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('manage-settings', {
        body: { action: 'archive-orders', days: 30 }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.message);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      showToast(`Archived ${data.archived || 0} old orders`, 'success');
    },
    onError: (err: Error) => showToast(friendlyError(err.message, 'archive orders'), 'error')
  });

  // Reset stock mutation
  const resetStockMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('manage-settings', {
        body: { action: 'reset-stock' }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.message);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['admin-products'] });
      showToast(`Reset stock for ${data.updated || 0} products`, 'success');
    },
    onError: (err: Error) => showToast(friendlyError(err.message, 'reset stock'), 'error')
  });

  const handleChange = <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleSave = () => {
    saveMutation.mutate(settings);
  };

  const handleReset = () => {
    setSettings(defaultSettings);
    setHasChanges(true);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-20">
      <div className="container mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <PageHeader
            title="System Settings"
            subtitle="Configure canteen operations"
          />
          <div className="flex gap-2">
            <button
              onClick={handleReset}
              className="flex items-center gap-2 px-4 py-2 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-600"
            >
              <RefreshCw size={18} />
              Reset
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges || saveMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
            >
              <Save size={18} />
              {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>

        {hasChanges && (
          <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 mb-6 flex items-center gap-2">
            <AlertTriangle size={18} className="text-amber-600 dark:text-amber-400" />
            <span className="text-amber-700 dark:text-amber-300">You have unsaved changes</span>
          </div>
        )}

        <div className="space-y-6">
          {/* General Settings */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
              <Store size={20} className="text-gray-400 dark:text-gray-500" />
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">General</h2>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Canteen Name
                </label>
                <input
                  type="text"
                  value={settings.canteen_name}
                  onChange={(e) => handleChange('canteen_name', e.target.value)}
                  className="w-full max-w-md px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Displayed in the app header and notifications</p>
              </div>

              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="maintenance"
                    checked={settings.maintenance_mode}
                    onChange={(e) => handleChange('maintenance_mode', e.target.checked)}
                    className="w-4 h-4 text-red-600 border-gray-300 dark:border-gray-600 rounded focus:ring-red-500 bg-white dark:bg-gray-700"
                  />
                  <label htmlFor="maintenance" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Maintenance Mode
                  </label>
                </div>
                {settings.maintenance_mode && (
                  <span className="px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-xs rounded-full">
                    App is currently offline to users
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Operating Hours */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
              <Clock size={20} className="text-gray-400 dark:text-gray-500" />
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">Operating Hours</h2>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Opening Time
                  </label>
                  <input
                    type="time"
                    value={settings.operating_hours.open}
                    onChange={(e) => handleChange('operating_hours', { 
                      ...settings.operating_hours, 
                      open: e.target.value 
                    })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Closing Time
                  </label>
                  <input
                    type="time"
                    value={settings.operating_hours.close}
                    onChange={(e) => handleChange('operating_hours', { 
                      ...settings.operating_hours, 
                      close: e.target.value 
                    })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Order Cutoff Time
                  </label>
                  <input
                    type="time"
                    value={settings.order_cutoff_time}
                    onChange={(e) => handleChange('order_cutoff_time', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Last time to place orders for the day</p>
                </div>
              </div>
            </div>
          </div>

          {/* Order Settings */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
              <Calendar size={20} className="text-gray-400 dark:text-gray-500" />
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">Order Settings</h2>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900 dark:text-gray-100">Allow Future Orders</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Let parents order for upcoming days</p>
                </div>
                <button
                  onClick={() => handleChange('allow_future_orders', !settings.allow_future_orders)}
                  className={`relative w-11 h-6 rounded-full transition-colors ${
                    settings.allow_future_orders ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                >
                  <span
                    className={`absolute top-1 left-1 w-4 h-4 bg-white dark:bg-gray-200 rounded-full transition-transform ${
                      settings.allow_future_orders ? 'translate-x-5' : ''
                    }`}
                  />
                </button>
              </div>

              {settings.allow_future_orders && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Maximum Days Ahead
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={settings.max_future_days}
                    onChange={(e) => handleChange('max_future_days', parseInt(e.target.value) || 5)}
                    className="w-32 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">How many days in advance can parents order</p>
                </div>
              )}

              <div className="flex items-center justify-between pt-4 border-t border-gray-100 dark:border-gray-700">
                <div>
                  <p className="font-medium text-gray-900 dark:text-gray-100">Auto-Complete Orders</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Automatically mark orders as completed after pickup</p>
                </div>
                <button
                  onClick={() => handleChange('auto_complete_orders', !settings.auto_complete_orders)}
                  className={`relative w-11 h-6 rounded-full transition-colors ${
                    settings.auto_complete_orders ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                >
                  <span
                    className={`absolute top-1 left-1 w-4 h-4 bg-white dark:bg-gray-200 rounded-full transition-transform ${
                      settings.auto_complete_orders ? 'translate-x-5' : ''
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* Inventory Settings */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
              <Package size={20} className="text-gray-400 dark:text-gray-500" />
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">Inventory</h2>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Low Stock Threshold
                </label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={settings.low_stock_threshold}
                  onChange={(e) => handleChange('low_stock_threshold', parseInt(e.target.value) || 10)}
                  className="w-32 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
                                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Show warning when product stock falls below this number</p>
              </div>
            </div>
          </div>

          {/* Notification Settings */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
              <Mail size={20} className="text-gray-400 dark:text-gray-500" />
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">Notifications</h2>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Admin Notification Email
                </label>
                <input
                  type="email"
                  value={settings.notification_email || ''}
                  onChange={(e) => handleChange('notification_email', e.target.value || null)}
                  placeholder="admin@school.edu"
                  className="w-full max-w-md px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
                                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Receive email alerts for important events</p>
              </div>
            </div>
          </div>

          {/* Danger Zone */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-red-200 dark:border-red-800 overflow-hidden">
            <div className="px-6 py-4 border-b border-red-200 dark:border-red-800 flex items-center gap-2 bg-red-50 dark:bg-red-900/20">
              <Wrench size={20} className="text-red-500 dark:text-red-400" />
              <h2 className="font-semibold text-red-700 dark:text-red-300">System Actions</h2>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900 dark:text-gray-100">Clear Completed Orders</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Archive orders older than 30 days</p>
                </div>
                <button 
                  onClick={() => {
                    if (confirm('Archive all completed orders older than 30 days? This cannot be undone.')) {
                      archiveMutation.mutate();
                    }
                  }}
                  disabled={archiveMutation.isPending}
                  className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
                >
                  {archiveMutation.isPending ? 'Archiving...' : 'Archive Now'}
                </button>
              </div>
              <div className="flex items-center justify-between pt-4 border-t border-gray-100 dark:border-gray-700">
                <div>
                  <p className="font-medium text-gray-900 dark:text-gray-100">Reset Daily Stock</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Restore all products to their default stock levels</p>
                </div>
                <button 
                  onClick={() => {
                    if (confirm('Reset stock for all products to their default levels?')) {
                      resetStockMutation.mutate();
                    }
                  }}
                  disabled={resetStockMutation.isPending}
                  className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
                >
                  {resetStockMutation.isPending ? 'Resetting...' : 'Reset Stock'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
