import { useState, useEffect, useRef } from 'react';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { Wallet, ArrowUpCircle, ArrowDownCircle, RefreshCw, TrendingUp, Loader2 } from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import { useAuth } from '../../hooks/useAuth';
import { PageHeader } from '../../components/PageHeader';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { EmptyState } from '../../components/EmptyState';
import TopUpModal from '../../components/TopUpModal';
import { checkTopupStatus } from '../../services/payments';

interface PaymentRecord {
  id: string;
  type: 'payment' | 'refund' | 'topup';
  amount_total: number;
  method: string;
  status: string;
  reference_id: string;
  created_at: string;
}

export default function Balance() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showTopUp, setShowTopUp] = useState(false);
  const [topUpNotice, setTopUpNotice] = useState<string | null>(null);
  const [isVerifyingTopup, setIsVerifyingTopup] = useState(false);
  const pollingRef = useRef(false);

  // State to hold extracted URL params before cleaning the URL
  const [topupSession, setTopupSession] = useState<{ result: string; sessionId: string } | null>(null);

  // Effect 1: Extract search params and clean URL (runs once on redirect)
  useEffect(() => {
    const topupResult = searchParams.get('topup');
    const sessionId = searchParams.get('session');

    if (topupResult === 'success' && sessionId) {
      setTopupSession({ result: topupResult, sessionId });
      setSearchParams({}, { replace: true });
    } else if (topupResult === 'success') {
      // No session ID — legacy fallback, just show notice and refetch
      setSearchParams({}, { replace: true });
      setTopUpNotice('Your top-up payment is being processed. Your balance will update shortly.');
      const timer = setTimeout(() => refetch(), 5000);
      return () => clearTimeout(timer);
    } else if (topupResult === 'cancelled') {
      setTopUpNotice('Top-up was cancelled. No charges were made.');
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Effect 2: Poll for top-up confirmation (triggered by extracted session, not searchParams)
  useEffect(() => {
    if (!topupSession) return;

    setIsVerifyingTopup(true);
    setTopUpNotice('Verifying your top-up payment...');
    pollingRef.current = true;

    const pollTopup = async () => {
      const MAX_POLLS = 20;
      let pollNum = 0;

      while (pollingRef.current && pollNum < MAX_POLLS) {
        try {
          const result = await checkTopupStatus(topupSession.sessionId);
          if (result.status === 'paid') {
            setTopUpNotice('Top-up successful! Your balance has been updated.');
            setIsVerifyingTopup(false);
            refetch();
            return;
          }
          if (result.status === 'failed' || result.status === 'expired') {
            setTopUpNotice('Top-up payment failed or expired. Please try again.');
            setIsVerifyingTopup(false);
            return;
          }
        } catch {
          // Network error or auth refresh — keep polling
        }
        pollNum++;
        await new Promise(r => setTimeout(r, 3000));
      }

      // Max polls reached
      setTopUpNotice('Payment verification is taking longer than expected. Your balance will update once confirmed.');
      setIsVerifyingTopup(false);
      refetch();
    };

    pollTopup();
    return () => { pollingRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topupSession]);

  const { data: walletData, isLoading: loadingParent, isError: walletError, refetch } = useQuery({
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

  const PAYMENT_PAGE_SIZE = 30;

  const { data: txData, isLoading: loadingTx, isError: txError, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery<PaymentRecord[]>({
    queryKey: ['payments', user?.id],
    queryFn: async ({ pageParam }) => {
      if (!user) throw new Error('User not authenticated');
      const page = pageParam as number;
      const from = page * PAYMENT_PAGE_SIZE;
      const to = from + PAYMENT_PAGE_SIZE - 1;
      const { data, error } = await supabase
        .from('payments')
        .select('id, parent_id, type, method, amount_total, status, reference_id, created_at')
        .eq('parent_id', user.id)
        .order('created_at', { ascending: false })
        .range(from, to);
      
      if (error) throw error;
      return data;
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      return lastPage.length === PAYMENT_PAGE_SIZE ? allPages.length : undefined;
    },
    enabled: !!user
  });

  const transactions = txData?.pages.flat() ?? [];

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
  const isError = walletError || txError;

  return (
    <div className="min-h-screen pb-20 bg-gray-50 dark:bg-gray-900">
      <div className="container mx-auto px-4 py-6">
        {isError && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg mb-4 flex items-center justify-between">
            <span>Failed to load wallet data.</span>
            <button onClick={() => refetch()} className="underline font-medium ml-2">Retry</button>
          </div>
        )}
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
        <div className="bg-gradient-to-br from-primary-600 via-primary-600 to-primary-700 rounded-2xl p-6 text-white shadow-lg shadow-primary-200 dark:shadow-primary-900/30 mb-6">
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

        {/* Top-up success/cancel notice */}
        {topUpNotice && (
          <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400 px-4 py-3 rounded-lg mb-4 flex items-center justify-between">
            <span className="text-sm flex items-center gap-2">
              {isVerifyingTopup && <Loader2 size={16} className="animate-spin flex-shrink-0" />}
              {topUpNotice}
            </span>
            {!isVerifyingTopup && (
              <button onClick={() => setTopUpNotice(null)} className="text-blue-500 hover:text-blue-700 ml-2 font-bold">&times;</button>
            )}
          </div>
        )}

        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <button
            onClick={() => setShowTopUp(true)}
            className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col items-center gap-2 hover:border-green-300 dark:hover:border-green-700 hover:shadow-md transition-all active:scale-95"
          >
            <div className="p-3 bg-green-100 dark:bg-green-900/30 rounded-full">
              <TrendingUp size={20} className="text-green-600 dark:text-green-400" />
            </div>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Top Up</span>
          </button>
          <button
            disabled
            className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col items-center gap-2 opacity-60 cursor-not-allowed relative"
          >
            <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-full">
              <RefreshCw size={20} className="text-blue-600 dark:text-blue-400" />
            </div>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Transfer</span>
            <span className="absolute top-2 right-2 text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded-full">Soon</span>
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
                      {formatAmount(tx.type, tx.amount_total)}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">{tx.method}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Load more */}
          {hasNextPage && (
            <div className="p-4 text-center border-t border-gray-100 dark:border-gray-700">
              <button
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="px-4 py-2 text-sm font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-lg disabled:opacity-50"
              >
                {isFetchingNextPage ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Top Up Modal */}
      <TopUpModal isOpen={showTopUp} onClose={() => setShowTopUp(false)} />
    </div>
  );
}
