import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, startOfWeek, subDays, eachDayOfInterval } from 'date-fns';
import { 
  DollarSign, 
  TrendingDown,
  Download,
  ArrowUpRight,
  ArrowDownRight,
  CreditCard,
  Banknote,
  Wallet
} from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import { PageHeader } from '../../components/PageHeader';
import { LoadingSpinner } from '../../components/LoadingSpinner';

// ===========================================
// TIMEZONE & DATE HELPERS
// Revenue reports use COMPLETED_AT (when order was paid/fulfilled)
// This is the correct financial accounting date, NOT scheduled_for
// ===========================================

/**
 * Convert a UTC timestamp to Philippine local date string (YYYY-MM-DD)
 * This ensures orders near midnight are grouped correctly
 */
const toPhilippineDate = (utcTimestamp: string): string => {
  return new Date(utcTimestamp).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
};

/**
 * Get today's date in Philippine timezone as YYYY-MM-DD
 */
const getTodayPH = (): string => {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
};

interface RevenueData {
  date: string;
  revenue: number;
  orders: number;
}

interface PaymentBreakdown {
  method: string;
  amount: number;
  count: number;
}

interface TransactionRecord {
  id: string;
  type: 'payment' | 'refund' | 'topup';
  amount: number;
  method: string;
  status: string;
  created_at: string;
  parent: { first_name: string; last_name: string };
}

export default function AdminReports() {
  const [dateRange, setDateRange] = useState<'week' | 'month' | '3months'>('month');

  // Calculate date range
  const getDateRange = () => {
    const end = new Date();
    let start: Date;
    
    switch (dateRange) {
      case 'week':
        start = subDays(end, 7);
        break;
      case 'month':
        start = subDays(end, 30);
        break;
      case '3months':
        start = subDays(end, 90);
        break;
    }
    
    return { start, end };
  };

  // Fetch revenue data
  // CRITICAL: Revenue is based on COMPLETED orders, grouped by COMPLETED_AT date
  // This is the financially correct approach - revenue is recognized when transaction completes
  const { data: revenueData, isLoading } = useQuery({
    queryKey: ['admin-revenue', dateRange],
    queryFn: async () => {
      const { start, end } = getDateRange();
      // Use ISO timestamps for completed_at range queries
      const startISO = format(start, "yyyy-MM-dd'T'00:00:00");
      const endISO = format(end, "yyyy-MM-dd'T'23:59:59");

      // REVENUE = COMPLETED ORDERS ONLY, grouped by completion date
      // This is the only financially correct way to calculate revenue
      const { data: orders, error } = await supabase
        .from('orders')
        .select('total_amount, completed_at, payment_method')
        .eq('status', 'completed')
        .not('completed_at', 'is', null)
        .gte('completed_at', startISO)
        .lte('completed_at', endISO);

      if (error) {
        console.error('Revenue query error:', error);
        return { daily: [], total: 0, orderCount: 0, paymentBreakdown: [] };
      }
      if (!orders) return { daily: [], total: 0, orderCount: 0, paymentBreakdown: [] };

      // Group by COMPLETION day (Philippine timezone)
      const dailyMap = new Map<string, { revenue: number; orders: number }>();
      const paymentMap = new Map<string, { amount: number; count: number }>();

      orders.forEach(order => {
        // Use Philippine timezone for correct day grouping
        if (!order.completed_at) return;
        const day = toPhilippineDate(order.completed_at);
        const existing = dailyMap.get(day) || { revenue: 0, orders: 0 };
        dailyMap.set(day, {
          revenue: existing.revenue + (order.total_amount ?? 0),
          orders: existing.orders + 1
        });

        // Payment breakdown (only from completed orders)
        const method = order.payment_method || 'unknown';
        const paymentExisting = paymentMap.get(method) || { amount: 0, count: 0 };
        paymentMap.set(method, {
          amount: paymentExisting.amount + (order.total_amount ?? 0),
          count: paymentExisting.count + 1
        });
      });

      // Fill in missing days
      const allDays = eachDayOfInterval({ start, end });
      const daily: RevenueData[] = allDays.map(day => {
        const dayStr = format(day, 'yyyy-MM-dd');
        const data = dailyMap.get(dayStr) || { revenue: 0, orders: 0 };
        return {
          date: dayStr,
          revenue: data.revenue,
          orders: data.orders
        };
      });

      const paymentBreakdown: PaymentBreakdown[] = Array.from(paymentMap.entries()).map(
        ([method, data]) => ({ method, ...data })
      );

      return {
        daily,
        total: orders.reduce((sum, o) => sum + o.total_amount, 0),
        orderCount: orders.length,
        paymentBreakdown
      };
    }
  });

  // Fetch recent transactions
  const { data: transactions } = useQuery<TransactionRecord[]>({
    queryKey: ['admin-transactions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select(`
          *,
          parent:user_profiles(first_name, last_name)
        `)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      return data;
    }
  });

  // Calculate comparison stats
  // CRITICAL: All revenue comparisons use COMPLETED_AT, not scheduled_for
  // Revenue is recognized when the transaction is completed (status='completed')
  const { data: comparisonStats } = useQuery({
    queryKey: ['admin-comparison'],
    queryFn: async () => {
      // Use Philippine timezone for date boundaries
      const todayStr = getTodayPH();
      const yesterday = subDays(new Date(), 1);
      const yesterdayStr = format(yesterday, 'yyyy-MM-dd');
      
      // Week starts on MONDAY for Philippine business logic
      const thisWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
      const thisWeekStartStr = format(thisWeekStart, 'yyyy-MM-dd');
      const lastWeekStart = subDays(thisWeekStart, 7);
      const lastWeekStartStr = format(lastWeekStart, 'yyyy-MM-dd');
      const lastWeekEnd = subDays(thisWeekStart, 1);
      const lastWeekEndStr = format(lastWeekEnd, 'yyyy-MM-dd');

      // Today's revenue: orders COMPLETED today (by completed_at)
      const { data: todayOrders } = await supabase
        .from('orders')
        .select('total_amount, completed_at')
        .eq('status', 'completed')
        .not('completed_at', 'is', null)
        .gte('completed_at', `${todayStr}T00:00:00`)
        .lte('completed_at', `${todayStr}T23:59:59`);

      // Yesterday's revenue: orders COMPLETED yesterday
      const { data: yesterdayOrders } = await supabase
        .from('orders')
        .select('total_amount, completed_at')
        .eq('status', 'completed')
        .not('completed_at', 'is', null)
        .gte('completed_at', `${yesterdayStr}T00:00:00`)
        .lte('completed_at', `${yesterdayStr}T23:59:59`);

      // This week's revenue: orders COMPLETED this week
      const { data: thisWeekOrders } = await supabase
        .from('orders')
        .select('total_amount, completed_at')
        .eq('status', 'completed')
        .not('completed_at', 'is', null)
        .gte('completed_at', `${thisWeekStartStr}T00:00:00`)
        .lte('completed_at', `${todayStr}T23:59:59`);

      // Last week's revenue: orders COMPLETED last week
      const { data: lastWeekOrders } = await supabase
        .from('orders')
        .select('total_amount, completed_at')
        .eq('status', 'completed')
        .not('completed_at', 'is', null)
        .gte('completed_at', `${lastWeekStartStr}T00:00:00`)
        .lte('completed_at', `${lastWeekEndStr}T23:59:59`);

      const todayRevenue = todayOrders?.reduce((sum, o) => sum + (o.total_amount ?? 0), 0) ?? 0;
      const yesterdayRevenue = yesterdayOrders?.reduce((sum, o) => sum + (o.total_amount ?? 0), 0) ?? 0;
      const thisWeekRevenue = thisWeekOrders?.reduce((sum, o) => sum + (o.total_amount ?? 0), 0) ?? 0;
      const lastWeekRevenue = lastWeekOrders?.reduce((sum, o) => sum + (o.total_amount ?? 0), 0) ?? 0;

      return {
        todayRevenue,
        yesterdayRevenue,
        todayChange: yesterdayRevenue > 0 ? ((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100 : 0,
        thisWeekRevenue,
        lastWeekRevenue,
        weekChange: lastWeekRevenue > 0 ? ((thisWeekRevenue - lastWeekRevenue) / lastWeekRevenue) * 100 : 0
      };
    }
  });

  const exportReport = () => {
    if (!revenueData?.daily) return;
    
    const csv = [
      ['Date', 'Revenue', 'Orders'].join(','),
      ...revenueData.daily.map(d => [
        d.date,
        d.revenue.toFixed(2),
        d.orders
      ].join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `revenue-report-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getPaymentIcon = (method: string) => {
    switch (method) {
      case 'cash': return <Banknote size={20} className="text-green-600 dark:text-green-400" />;
      case 'gcash': return <CreditCard size={20} className="text-blue-600 dark:text-blue-400" />;
      case 'balance': return <Wallet size={20} className="text-purple-600 dark:text-purple-400" />;
      default: return <DollarSign size={20} className="text-gray-600 dark:text-gray-400" />;
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  const maxRevenue = Math.max(...(revenueData?.daily.map(d => d.revenue) || [1]));

  return (
    <div className="min-h-screen pb-20 bg-gray-50 dark:bg-gray-900">
      <div className="container mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <PageHeader
            title="Financial Reports"
            subtitle="Revenue and transaction analytics"
          />
          <button
            onClick={exportReport}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-600"
          >
            <Download size={18} />
            Export
          </button>
        </div>

        {/* Comparison Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-500 dark:text-gray-400">Today's Revenue</span>
              {comparisonStats && comparisonStats.todayChange !== 0 && (
                <span className={`flex items-center gap-1 text-sm font-medium ${
                  comparisonStats.todayChange > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                }`}>
                  {comparisonStats.todayChange > 0 ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
                  {Math.abs(comparisonStats.todayChange).toFixed(1)}%
                </span>
              )}
            </div>
            <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              ₱{(comparisonStats?.todayRevenue || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              vs yesterday: ₱{(comparisonStats?.yesterdayRevenue || 0).toFixed(2)}
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-500 dark:text-gray-400">This Week</span>
              {comparisonStats && comparisonStats.weekChange !== 0 && (
                <span className={`flex items-center gap-1 text-sm font-medium ${
                  comparisonStats.weekChange > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                }`}>
                  {comparisonStats.weekChange > 0 ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
                  {Math.abs(comparisonStats.weekChange).toFixed(1)}%
                </span>
              )}
            </div>
            <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              ₱{(comparisonStats?.thisWeekRevenue || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              vs last week: ₱{(comparisonStats?.lastWeekRevenue || 0).toFixed(2)}
            </p>
          </div>
        </div>

        {/* Date Range Selector */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">Revenue Trend</h3>
          <div className="flex gap-2">
            {(['week', 'month', '3months'] as const).map(range => (
              <button
                key={range}
                onClick={() => setDateRange(range)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                  dateRange === range
                    ? 'bg-primary-600 text-white'
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-600'
                }`}
              >
                {range === 'week' ? '7 Days' : range === 'month' ? '30 Days' : '90 Days'}
              </button>
            ))}
          </div>
        </div>

        {/* Revenue Chart (Simple Bar Chart) */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 mb-6">
          <div className="flex items-end gap-1 h-48 overflow-x-auto pb-2">
            {revenueData?.daily.map((day) => (
              <div
                key={day.date}
                className="flex-1 min-w-[8px] group relative"
              >
                <div
                  className="bg-primary-500 hover:bg-primary-600 rounded-t transition-all cursor-pointer"
                  style={{ 
                    height: `${maxRevenue > 0 ? (day.revenue / maxRevenue) * 100 : 0}%`,
                    minHeight: day.revenue > 0 ? '4px' : '0'
                  }}
                />
                {/* Tooltip */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10">
                  <div className="bg-gray-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                    <p className="font-medium">₱{day.revenue.toFixed(2)}</p>
                    <p className="text-gray-400">{format(new Date(day.date), 'MMM d')}</p>
                    <p className="text-gray-400">{day.orders} orders</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-2">
            <span>{revenueData?.daily[0] && format(new Date(revenueData.daily[0].date), 'MMM d')}</span>
            <span>{revenueData?.daily[revenueData.daily.length - 1] && format(new Date(revenueData.daily[revenueData.daily.length - 1].date), 'MMM d')}</span>
          </div>
          <div className="flex items-center justify-center gap-6 mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                ₱{(revenueData?.total || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Total Revenue</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{revenueData?.orderCount || 0}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Total Orders</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                ₱{revenueData?.orderCount ? ((revenueData.total || 0) / revenueData.orderCount).toFixed(2) : '0.00'}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Avg Order Value</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Payment Breakdown */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">Payment Methods</h3>
            </div>
            <div className="p-4">
              {revenueData?.paymentBreakdown.length === 0 ? (
                <p className="text-center text-gray-500 dark:text-gray-400 py-4">No data available</p>
              ) : (
                <div className="space-y-4">
                  {revenueData?.paymentBreakdown.map((payment) => {
                    const percentage = revenueData.total > 0 
                      ? (payment.amount / revenueData.total) * 100 
                      : 0;
                    
                    return (
                      <div key={payment.method} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {getPaymentIcon(payment.method)}
                            <span className="font-medium capitalize text-gray-900 dark:text-gray-100">{payment.method}</span>
                          </div>
                          <span className="font-semibold text-gray-900 dark:text-gray-100">₱{payment.amount.toFixed(2)}</span>
                        </div>
                        <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-primary-500 rounded-full"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {payment.count} transactions • {percentage.toFixed(1)}%
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Recent Transactions */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">Recent Transactions</h3>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-700 max-h-80 overflow-y-auto">
              {transactions?.map((tx) => (
                <div key={tx.id} className="px-4 py-3 flex items-center gap-3">
                  <div className={`p-2 rounded-full ${
                    tx.type === 'payment' ? 'bg-red-100 dark:bg-red-900/30' :
                    tx.type === 'refund' ? 'bg-blue-100 dark:bg-blue-900/30' :
                    'bg-green-100 dark:bg-green-900/30'
                  }`}>
                    {tx.type === 'payment' ? <ArrowDownRight size={16} className="text-red-600 dark:text-red-400" /> :
                     tx.type === 'refund' ? <TrendingDown size={16} className="text-blue-600 dark:text-blue-400" /> :
                     <ArrowUpRight size={16} className="text-green-600 dark:text-green-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 dark:text-gray-100 capitalize">{tx.type}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {tx.parent.first_name} {tx.parent.last_name} • {format(new Date(tx.created_at), 'MMM d, h:mm a')}
                    </p>
                  </div>
                  <p className={`font-semibold ${
                    tx.type === 'payment' ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'
                  }`}>
                    {tx.type === 'payment' ? '-' : '+'}₱{tx.amount.toFixed(2)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
