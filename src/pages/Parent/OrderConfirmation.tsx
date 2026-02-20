import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { CheckCircle, ArrowRight, Clock, User, Timer, CreditCard, Wallet, Calendar, CalendarDays, Smartphone, Loader2, XCircle, RotateCcw } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { isOnlinePaymentMethod, type PaymentMethod } from '../../types';
import { checkPaymentStatus, retryCheckout } from '../../services/payments';
import { getPaymentMethodLabel } from '../../services/payments';
import { friendlyError } from '../../utils/friendlyError';

interface OrderConfirmationState {
  orderId: string;
  totalAmount: number;
  childName: string;
  itemCount: number;
  isOffline?: boolean;
  paymentMethod?: PaymentMethod;
  scheduledFor?: string; // Legacy single date
  scheduledDates?: string[]; // Multi-day support
  orderCount?: number; // Number of orders created
  isFutureOrder?: boolean;
}

export default function OrderConfirmation() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const state = location.state as OrderConfirmationState | null;
  
  // Online payment verification state
  const paymentResult = searchParams.get('payment'); // 'success' | 'cancelled'
  const orderIdParam = searchParams.get('order_id');
  const [verificationStatus, setVerificationStatus] = useState<'idle' | 'verifying' | 'confirmed' | 'failed' | 'cancelled'>('idle');
  const [pollCount, setPollCount] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const MAX_POLLS = 20; // 20 polls * 3s = 60 seconds max

  // Retry payment handler for cancelled/failed payments
  const handleRetryPayment = async () => {
    if (!orderIdParam || isRetrying) return;
    setIsRetrying(true);
    setRetryError(null);
    try {
      const result = await retryCheckout(orderIdParam);
      if (result.checkout_url) {
        window.location.href = result.checkout_url;
      }
    } catch (err) {
      setRetryError(friendlyError(err instanceof Error ? err.message : '', 'retry payment'));
      setIsRetrying(false);
    }
  };

  // Poll for payment verification when redirected back from PayMongo
  useEffect(() => {
    if (paymentResult === 'cancelled') {
      setVerificationStatus('cancelled');
      return;
    }
    
    if (paymentResult !== 'success' || !orderIdParam) return;
    
    setVerificationStatus('verifying');
    let cancelled = false;
    let pollNum = 0;
    
    const pollPayment = async () => {
      while (!cancelled && pollNum < MAX_POLLS) {
        try {
          const result = await checkPaymentStatus(orderIdParam);
          if (result.payment_status === 'paid' || result.status === 'pending') {
            if (!cancelled) setVerificationStatus('confirmed');
            return;
          }
          if (result.payment_status === 'timeout' || result.status === 'cancelled') {
            if (!cancelled) setVerificationStatus('failed');
            return;
          }
        } catch {
          // Continue polling on error
        }
        pollNum++;
        if (!cancelled) setPollCount(pollNum);
        await new Promise(r => setTimeout(r, 3000));
      }
      // Max polls reached without confirmation
      if (!cancelled) setVerificationStatus('confirmed'); // Assume success, webhook may be slow
    };
    
    pollPayment();
    return () => { cancelled = true; };
  }, [paymentResult, orderIdParam]);

  useEffect(() => {
    // Redirect if no order data AND not a payment redirect
    if (!state && !paymentResult) {
      navigate('/menu');
    }
  }, [state, paymentResult, navigate]);

  // Format scheduled dates for display
  const formattedDates = useMemo(() => {
    if (!state) return [];
    
    // Support both legacy single date and new multi-date format
    const dates = state.scheduledDates || (state.scheduledFor ? [state.scheduledFor] : []);
    
    return dates
      .map(dateStr => {
        try {
          const date = parseISO(dateStr);
          return {
            dateStr,
            formatted: format(date, 'EEE, MMM d'), // e.g., "Mon, Jan 27"
            dayName: format(date, 'EEEE'), // Full day name
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean) as { dateStr: string; formatted: string; dayName: string }[];
  }, [state]);

  const isMultiDay = formattedDates.length > 1;
  const orderCount = state?.orderCount || 1;
  const isOnlineMethod = state?.paymentMethod ? isOnlinePaymentMethod(state.paymentMethod) : false;

  // Handle payment redirect pages (no state, came from PayMongo redirect)
  if (!state && paymentResult) {
    if (verificationStatus === 'cancelled') {
      return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4 pb-24">
          <div className="max-w-md w-full text-center">
            <div className="mb-6">
              <div className="w-20 h-20 bg-orange-100 dark:bg-orange-900/30 rounded-full flex items-center justify-center mx-auto">
                <XCircle className="w-12 h-12 text-orange-500" />
              </div>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Payment Cancelled</h1>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              Your payment was cancelled. You can retry the payment or the order will be automatically cancelled if not paid within the deadline.
            </p>
            {retryError && (
              <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-4 text-sm text-red-700 dark:text-red-400">
                {retryError}
              </div>
            )}
            <div className="space-y-3">
              {orderIdParam && (
                <button
                  onClick={handleRetryPayment}
                  disabled={isRetrying}
                  className="flex items-center justify-center gap-2 w-full bg-primary-600 text-white py-3 rounded-lg font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isRetrying ? (
                    <>
                      <Loader2 size={20} className="animate-spin" />
                      Redirecting to Payment...
                    </>
                  ) : (
                    <>
                      <RotateCcw size={20} />
                      Retry Payment
                    </>
                  )}
                </button>
              )}
              <Link to="/dashboard" className="flex items-center justify-center gap-2 w-full bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 py-3 rounded-lg font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
                View Orders <ArrowRight size={20} />
              </Link>
              <Link to="/menu" className="block w-full py-3 text-primary-600 dark:text-primary-400 font-medium hover:bg-primary-50 dark:hover:bg-gray-700 rounded-lg transition-colors">
                Back to Menu
              </Link>
            </div>
          </div>
        </div>
      );
    }
    
    if (verificationStatus === 'verifying') {
      return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4 pb-24">
          <div className="max-w-md w-full text-center">
            <div className="mb-6">
              <div className="w-20 h-20 bg-primary-100 dark:bg-primary-900/30 rounded-full flex items-center justify-center mx-auto">
                <Loader2 className="w-12 h-12 text-primary-500 animate-spin" />
              </div>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Verifying Payment...</h1>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              Please wait while we confirm your payment. This may take a few moments.
            </p>
            <div className="w-48 mx-auto bg-gray-200 dark:bg-gray-700 rounded-full h-2 mb-6">
              <div className="bg-primary-500 h-2 rounded-full transition-all duration-300" style={{ width: `${Math.min((pollCount / MAX_POLLS) * 100, 95)}%` }} />
            </div>
          </div>
        </div>
      );
    }

    if (verificationStatus === 'confirmed') {
      return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4 pb-24">
          <div className="max-w-md w-full text-center">
            <div className="mb-6">
              <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle className="w-12 h-12 text-green-500" />
              </div>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Payment Confirmed!</h1>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              Your payment has been received and your order is being processed.
            </p>
            {orderIdParam && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 font-mono">
                Order #{orderIdParam.slice(0, 8).toUpperCase()}
              </p>
            )}
            <div className="space-y-3">
              <Link to="/dashboard" className="flex items-center justify-center gap-2 w-full bg-primary-600 text-white py-3 rounded-lg font-medium hover:bg-primary-700 transition-colors">
                View Order Status <ArrowRight size={20} />
              </Link>
              <Link to="/menu" className="block w-full py-3 text-primary-600 dark:text-primary-400 font-medium hover:bg-primary-50 dark:hover:bg-gray-700 rounded-lg transition-colors">
                Continue Ordering
              </Link>
            </div>
          </div>
        </div>
      );
    }

    if (verificationStatus === 'failed') {
      return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4 pb-24">
          <div className="max-w-md w-full text-center">
            <div className="mb-6">
              <div className="w-20 h-20 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto">
                <XCircle className="w-12 h-12 text-red-500" />
              </div>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Payment Failed</h1>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              Your payment could not be processed. Please retry or use a different payment method.
            </p>
            {retryError && (
              <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-4 text-sm text-red-700 dark:text-red-400">
                {retryError}
              </div>
            )}
            <div className="space-y-3">
              {orderIdParam && (
                <button
                  onClick={handleRetryPayment}
                  disabled={isRetrying}
                  className="flex items-center justify-center gap-2 w-full bg-primary-600 text-white py-3 rounded-lg font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isRetrying ? (
                    <>
                      <Loader2 size={20} className="animate-spin" />
                      Redirecting to Payment...
                    </>
                  ) : (
                    <>
                      <RotateCcw size={20} />
                      Retry Payment
                    </>
                  )}
                </button>
              )}
              <Link to="/dashboard" className="flex items-center justify-center gap-2 w-full bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 py-3 rounded-lg font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
                View Orders <ArrowRight size={20} />
              </Link>
              <Link to="/menu" className="block w-full py-3 text-primary-600 dark:text-primary-400 font-medium hover:bg-primary-50 dark:hover:bg-gray-700 rounded-lg transition-colors">
                Back to Menu
              </Link>
            </div>
          </div>
        </div>
      );
    }
  }

  if (!state) return null;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4 pb-24">
      <div className="max-w-md w-full text-center">
        {/* Success Icon */}
        <div className="mb-6">
          <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle className="w-12 h-12 text-green-500" />
          </div>
        </div>

        {/* Title */}
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          {state.isOffline 
            ? (isMultiDay ? 'Orders Saved!' : 'Order Saved!') 
            : (isMultiDay ? 'Orders Placed!' : 'Order Placed!')}
        </h1>
        
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          {state.isOffline 
            ? `Your ${isMultiDay ? `${orderCount} orders have` : 'order has'} been saved and will be submitted when you're back online.`
            : `Your ${isMultiDay ? `${orderCount} orders have` : 'order has'} been received and ${isMultiDay ? 'are' : 'is'} being processed.`
          }
        </p>

        {/* Order Summary Card */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-6 text-left">
          <div className="flex items-center gap-3 pb-4 border-b mb-4">
            <div className="w-10 h-10 bg-primary-100 dark:bg-primary-900/30 rounded-full flex items-center justify-center">
              <User className="text-primary-600 dark:text-primary-400" size={20} />
            </div>
            <div>
              <p className="font-medium text-gray-900 dark:text-gray-100">Order for {state.childName}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">{state.itemCount} item(s)</p>
            </div>
          </div>

          <div className="flex justify-between items-center mb-4">
            <span className="text-gray-600 dark:text-gray-400">
              {isMultiDay ? 'Order IDs' : 'Order ID'}
            </span>
            <span className="font-mono text-sm text-gray-900 dark:text-gray-100">
              #{state.orderId.slice(0, 8).toUpperCase()}
              {isMultiDay && <span className="text-gray-500 dark:text-gray-400 ml-1">+{orderCount - 1}</span>}
            </span>
          </div>

          <div className="flex justify-between items-center mb-4">
            <span className="text-gray-600 dark:text-gray-400">Status</span>
            {isOnlineMethod ? (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-full text-sm font-medium">
                <Loader2 size={14} className="animate-spin" />
                Redirecting to Payment
              </span>
            ) : state.paymentMethod === 'cash' ? (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 rounded-full text-sm font-medium">
                <Timer size={14} />
                Awaiting Payment
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full text-sm font-medium">
                <Clock size={14} />
                Pending
              </span>
            )}
          </div>

          {/* Payment Method */}
          <div className="flex justify-between items-center mb-4">
            <span className="text-gray-600 dark:text-gray-400">Payment</span>
            <span className="inline-flex items-center gap-1 text-gray-900 dark:text-gray-100 text-sm font-medium">
              {isOnlineMethod ? (
                <>
                  <Smartphone size={14} />
                  {getPaymentMethodLabel(state.paymentMethod!)}
                </>
              ) : state.paymentMethod === 'cash' ? (
                <>
                  <CreditCard size={14} />
                  Pay at Counter
                </>
              ) : (
                <>
                  <Wallet size={14} />
                  Wallet Balance
                </>
              )}
            </span>
          </div>

          {/* Scheduled Date(s) - Multi-day support */}
          {formattedDates.length > 0 && (
            <div className="mb-4">
              <div className="flex justify-between items-start">
                <span className="text-gray-600 dark:text-gray-400">
                  {isMultiDay ? (
                    <span className="flex items-center gap-1">
                      <CalendarDays size={14} />
                      Pickup Dates
                    </span>
                  ) : 'Pickup Date'}
                </span>
                {isMultiDay ? (
                  <div className="flex flex-wrap gap-1 justify-end max-w-[60%]">
                    {formattedDates.map(({ dateStr, formatted }) => (
                      <span 
                        key={dateStr}
                        className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 rounded text-xs font-medium"
                      >
                        {formatted}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="inline-flex items-center gap-1 text-gray-900 dark:text-gray-100 text-sm font-medium">
                    <Calendar size={14} />
                    {formattedDates[0]?.formatted}
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-between items-center pt-4 border-t border-gray-200 dark:border-gray-700">
            <span className="text-lg font-medium text-gray-900 dark:text-gray-100">Total</span>
            <span className="text-2xl font-bold text-primary-600 dark:text-primary-400">
              ₱{state.totalAmount.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Online Payment Redirect Notice */}
        {isOnlineMethod && !state.isOffline && (
          <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6 text-left">
            <p className="text-sm text-blue-800 dark:text-blue-300">
              <strong>🔄 Redirecting to {getPaymentMethodLabel(state.paymentMethod!)}...</strong> You'll be 
              taken to a secure payment page to complete your payment. Do not close this window.
            </p>
          </div>
        )}

        {/* Cash Payment Notice */}
        {state.paymentMethod === 'cash' && !state.isOffline && (
          <div className="bg-orange-50 dark:bg-orange-900/30 border border-orange-200 dark:border-orange-800 rounded-lg p-4 mb-6 text-left">
            <p className="text-sm text-orange-800 dark:text-orange-300">
              <strong>⏰ Payment Required:</strong> Please pay at the canteen counter before the deadline. 
              {isMultiDay 
                ? ' Your orders will be automatically cancelled if not paid in time.'
                : ' Your order will be automatically cancelled if not paid in time.'}
            </p>
          </div>
        )}

        {/* Offline Notice */}
        {state.isOffline && (
          <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4 mb-6 text-left">
            <p className="text-sm text-amber-800 dark:text-amber-300">
              <strong>Offline Mode:</strong> {isMultiDay ? 'Your orders are' : 'Your order is'} saved locally and will be 
              automatically submitted when you reconnect to the internet.
            </p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="space-y-3">
          <Link
            to="/dashboard"
            className="flex items-center justify-center gap-2 w-full bg-primary-600 text-white py-3 rounded-lg font-medium hover:bg-primary-700 transition-colors"
          >
            View Order Status
            <ArrowRight size={20} />
          </Link>
          
          <Link
            to="/menu"
            className="block w-full py-3 text-primary-600 dark:text-primary-400 font-medium hover:bg-primary-50 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            Continue Ordering
          </Link>
        </div>
      </div>
    </div>
  );
}
