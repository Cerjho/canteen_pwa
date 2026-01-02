import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Wallet, ArrowUpCircle, ArrowDownCircle, RefreshCw, TrendingUp } from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import { useAuth } from '../../hooks/useAuth';
import { PageHeader } from '../../components/PageHeader';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { EmptyState } from '../../components/EmptyState';

interface Transaction {
  id: string;
  type: 'payment' | 'refund' | 'topup';
  amount: number;
  method: string;
  status: string;
  reference_id: string;
  created_at: string;
  order_id?: string;
}

export default function Balance() {
  const { user } = useAuth();

  const { data: walletData, isLoading: loadingParent, refetch } = useQuery({
    queryKey: ['parent-balance', user?.id],
    queryFn: async () => {
      if (!user) throw new Error('User not authenticated');
      const { data, error } = await supabase
        .from('wallets')
        .select('user_id, balance')
        .eq('user_id', user.id)
        .maybeSingle();
      
      if (error) throw error;
      // If no wallet exists, return default
      return data || { user_id: user.id, balance: 0 };
    },
    enabled: !!user
  });

  const { data: transactions, isLoading: loadingTx } = useQuery<Transaction[]>({
    queryKey: ['transactions', user?.id],
    queryFn: async () => {
      if (!user) throw new Error('User not authenticated');
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('parent_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);
      
      if (error) throw error;
      return data;
    },
    enabled: !!user
  });

  const getTransactionIcon = (type: string) => {
    switch (type) {
      case 'topup':
        return <ArrowUpCircle className="text-green-600 dark:text-green-400" size={24} />;
      case 'refund':
        return <ArrowUpCircle className="text-blue-600 dark:text-blue-400" size={24} />;
      case 'payment':
        return <ArrowDownCircle className="text-red-600 dark:text-red-400" size={24} />;
      default:
        return <Wallet className="text-gray-600 dark:text-gray-400" size={24} />;
    }
  };

  const getTransactionColor = (type: string) => {
    switch (type) {
      case 'topup':
      case 'refund':
        return 'text-green-600 dark:text-green-400';
      case 'payment':
        return 'text-red-600 dark:text-red-400';
      default:
        return 'text-gray-600 dark:text-gray-400';
    }
  };

  const formatAmount = (type: string, amount: number) => {
    const prefix = ['topup', 'refund'].includes(type) ? '+' : '-';
    return `${prefix}₱${Math.abs(amount).toFixed(2)}`;
  };

  const isLoading = loadingParent || loadingTx;

  return (
    <div className="min-h-screen pb-20 bg-gray-50 dark:bg-gray-900">
      <div className="container mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <PageHeader
            title="Balance"
            subtitle="Manage your wallet"
          />
          <button
            onClick={() => refetch()}
            className="p-2 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full"
          >
            <RefreshCw size={20} />
          </button>
        </div>

        {/* Balance Card */}
        <div className="bg-gradient-to-br from-primary-600 to-primary-700 rounded-2xl p-6 text-white shadow-lg mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 bg-white/20 rounded-full">
              <Wallet size={28} />
            </div>
            <span className="text-lg font-medium opacity-90">Available Balance</span>
          </div>
          <div className="text-4xl font-bold mb-2">
            {loadingParent ? (
              <div className="h-10 w-32 bg-white/20 rounded animate-pulse" />
            ) : (
              `₱${(walletData?.balance || 0).toFixed(2)}`
            )}
          </div>
          <p className="text-sm opacity-75">
            Use your balance for faster checkout
          </p>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <button className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
            <div className="p-3 bg-green-100 dark:bg-green-900/30 rounded-full">
              <TrendingUp size={20} className="text-green-600 dark:text-green-400" />
            </div>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Top Up</span>
          </button>
          <button className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
            <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-full">
              <RefreshCw size={20} className="text-blue-600 dark:text-blue-400" />
            </div>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Transfer</span>
          </button>
        </div>

        {/* Transaction History */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">Transaction History</h3>
          </div>

          {isLoading ? (
            <div className="p-8 flex justify-center">
              <LoadingSpinner size="md" />
            </div>
          ) : !transactions || transactions.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="No transactions yet"
              description="Your transaction history will appear here"
            />
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {transactions.map((tx) => (
                <div key={tx.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-shrink-0">
                    {getTransactionIcon(tx.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 dark:text-gray-100 capitalize">
                      {tx.type === 'topup' ? 'Top Up' : tx.type}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {format(new Date(tx.created_at), 'MMM d, yyyy • h:mm a')}
                    </p>
                    {tx.reference_id && (
                      <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
                        Ref: {tx.reference_id}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className={`font-semibold ${getTransactionColor(tx.type)}`}>
                      {formatAmount(tx.type, tx.amount)}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">{tx.method}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
