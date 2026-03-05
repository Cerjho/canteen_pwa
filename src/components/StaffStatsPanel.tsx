import { TrendingUp, X } from 'lucide-react';

interface OrderStats {
  totalOrders: number;
  completedOrders: number;
  completionRate: number;
  avgPrepTime: number;
  pendingTooLong: number;
  totalRevenue: number;
}

interface PeakHourStatus {
  isPeak: boolean;
  isRush: boolean;
  ordersPerHour: number;
  trend: 'increasing' | 'decreasing' | 'stable';
}

interface StaffStatsPanelProps {
  orderStats: OrderStats;
  peakHourStatus: PeakHourStatus;
  onClose: () => void;
}

export function StaffStatsPanel({ orderStats, peakHourStatus, onClose }: StaffStatsPanelProps) {
  return (
    <div className="mb-4 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl border border-blue-200 dark:border-blue-800 p-4 animate-slide-up">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-blue-800 dark:text-blue-300 flex items-center gap-2">
          <TrendingUp size={18} /> Today&apos;s Performance
        </h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X size={18} />
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-3 text-center shadow-sm">
          <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{orderStats.totalOrders}</div>
          <div className="text-xs text-gray-500">Total Orders</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-3 text-center shadow-sm">
          <div className="text-2xl font-bold text-green-600">{orderStats.completedOrders}</div>
          <div className="text-xs text-gray-500">Completed</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-3 text-center shadow-sm">
          <div className="text-2xl font-bold text-blue-600">{orderStats.completionRate}%</div>
          <div className="text-xs text-gray-500">Completion Rate</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-3 text-center shadow-sm">
          <div className="text-2xl font-bold text-purple-600">{orderStats.avgPrepTime}m</div>
          <div className="text-xs text-gray-500">Avg Prep Time</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-3 text-center shadow-sm">
          <div className={`text-2xl font-bold ${orderStats.pendingTooLong > 0 ? 'text-red-600' : 'text-gray-400'}`}>
            {orderStats.pendingTooLong}
          </div>
          <div className="text-xs text-gray-500">Delayed ({'>'}15m)</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-3 text-center shadow-sm">
          <div className="text-2xl font-bold text-primary-600">₱{orderStats.totalRevenue.toFixed(0)}</div>
          <div className="text-xs text-gray-500">Revenue</div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
        <span>Order rate: {peakHourStatus.ordersPerHour}/hr</span>
        <span>•</span>
        <span className={`flex items-center gap-1 ${
          peakHourStatus.trend === 'increasing' ? 'text-green-600' : 
          peakHourStatus.trend === 'decreasing' ? 'text-red-600' : 'text-gray-500'
        }`}>
          {peakHourStatus.trend === 'increasing' ? '↑' : peakHourStatus.trend === 'decreasing' ? '↓' : '→'}
          {peakHourStatus.trend}
        </span>
      </div>
    </div>
  );
}
