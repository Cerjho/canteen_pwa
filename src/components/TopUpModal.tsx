import { useState } from 'react';
import { X, Wallet, Smartphone, CreditCard, Loader2 } from 'lucide-react';
import { createTopupCheckout } from '../services/payments';
import { friendlyError } from '../utils/friendlyError';

interface TopUpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const TOPUP_PRESETS = [100, 200, 500, 1000, 2000, 5000];
const MIN_TOPUP = 50;
const MAX_TOPUP = 50000;

type OnlinePaymentMethod = 'gcash' | 'paymaya' | 'card';

export default function TopUpModal({ isOpen, onClose }: TopUpModalProps) {
  const [amount, setAmount] = useState<number>(0);
  const [customAmount, setCustomAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<OnlinePaymentMethod>('gcash');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const effectiveAmount = customAmount ? parseFloat(customAmount) : amount;
  const isValidAmount = effectiveAmount >= MIN_TOPUP && effectiveAmount <= MAX_TOPUP;

  const handlePresetSelect = (preset: number) => {
    setAmount(preset);
    setCustomAmount('');
    setError(null);
  };

  const handleCustomAmountChange = (value: string) => {
    // Only allow numeric input with optional decimal
    const cleaned = value.replace(/[^0-9.]/g, '');
    setCustomAmount(cleaned);
    setAmount(0);
    setError(null);
  };

  const handleProceed = async () => {
    if (!isValidAmount) {
      setError(`Amount must be between ₱${MIN_TOPUP} and ₱${MAX_TOPUP.toLocaleString()}`);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await createTopupCheckout({
        amount: effectiveAmount,
        payment_method: paymentMethod,
      });

      // Redirect to PayMongo checkout page
      window.location.href = result.checkout_url;
    } catch (err) {
      const message = friendlyError(err instanceof Error ? err.message : '', 'start your top-up');
      setError(message);
      setIsLoading(false);
    }
  };

  const paymentOptions: { value: OnlinePaymentMethod; label: string; icon: React.ReactNode }[] = [
    { value: 'gcash', label: 'GCash', icon: <Smartphone size={20} /> },
    { value: 'paymaya', label: 'PayMaya', icon: <Smartphone size={20} /> },
    { value: 'card', label: 'Credit/Debit Card', icon: <CreditCard size={20} /> },
  ];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 z-50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <Wallet size={20} className="text-primary-600 dark:text-primary-400" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Top Up Wallet
              </h2>
            </div>
            <button
              onClick={onClose}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full"
            >
              <X size={20} className="text-gray-500" />
            </button>
          </div>

          <div className="p-4 space-y-5">
            {/* Amount Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Amount
              </label>

              {/* Preset amounts */}
              <div className="grid grid-cols-3 gap-2 mb-3">
                {TOPUP_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    onClick={() => handlePresetSelect(preset)}
                    className={`py-2.5 px-3 rounded-lg border-2 text-sm font-medium transition-all ${
                      amount === preset && !customAmount
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400'
                        : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    ₱{preset.toLocaleString()}
                  </button>
                ))}
              </div>

              {/* Custom amount input */}
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 font-medium">
                  ₱
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="Enter custom amount"
                  value={customAmount}
                  onChange={(e) => handleCustomAmountChange(e.target.value)}
                  className="w-full pl-8 pr-3 py-2.5 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Min: ₱{MIN_TOPUP} • Max: ₱{MAX_TOPUP.toLocaleString()}
              </p>
            </div>

            {/* Payment Method */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Pay via
              </label>
              <div className="space-y-2">
                {paymentOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setPaymentMethod(opt.value)}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all ${
                      paymentMethod === opt.value
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <div className={`p-1.5 rounded-lg ${
                      paymentMethod === opt.value
                        ? 'bg-primary-100 dark:bg-primary-900/50 text-primary-600 dark:text-primary-400'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                    }`}>
                      {opt.icon}
                    </div>
                    <span className="font-medium text-gray-900 dark:text-gray-100 text-sm">
                      {opt.label}
                    </span>
                    <div className={`ml-auto w-4 h-4 rounded-full border-2 ${
                      paymentMethod === opt.value
                        ? 'border-primary-500 bg-primary-500'
                        : 'border-gray-300 dark:border-gray-600'
                    }`}>
                      {paymentMethod === opt.value && (
                        <div className="w-full h-full flex items-center justify-center">
                          <div className="w-1.5 h-1.5 bg-white rounded-full" />
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-lg">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            {/* Summary and CTA */}
            {isValidAmount && (
              <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Top-up amount</span>
                  <span className="text-lg font-bold text-primary-600 dark:text-primary-400">
                    ₱{effectiveAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            )}

            <button
              onClick={handleProceed}
              disabled={!isValidAmount || isLoading}
              className="w-full bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed text-white py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  Redirecting...
                </>
              ) : (
                `Proceed to Payment`
              )}
            </button>

            <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
              You'll be redirected to complete payment securely
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
