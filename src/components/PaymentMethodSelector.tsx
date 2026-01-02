import { CreditCard, Wallet, Banknote } from 'lucide-react';
import type { PaymentMethod } from '../types';

interface PaymentMethodSelectorProps {
  selected: PaymentMethod;
  onSelect: (method: PaymentMethod) => void;
  balance?: number;
}

const PAYMENT_METHODS: { value: PaymentMethod; label: string; icon: React.ReactNode; description: string }[] = [
  { 
    value: 'cash', 
    label: 'Cash', 
    icon: <Banknote size={24} />,
    description: 'Pay at the canteen'
  },
  { 
    value: 'balance', 
    label: 'Wallet Balance', 
    icon: <Wallet size={24} />,
    description: 'Use your prepaid balance'
  },
  { 
    value: 'gcash', 
    label: 'GCash', 
    icon: <CreditCard size={24} />,
    description: 'Pay via GCash'
  },
];

export function PaymentMethodSelector({ selected, onSelect, balance = 0 }: PaymentMethodSelectorProps) {
  return (
    <div className="space-y-3">
      <div id="payment-method-label" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        Payment Method
      </div>
      
      <div role="radiogroup" aria-labelledby="payment-method-label" className="space-y-3">
        {PAYMENT_METHODS.map((method) => {
          const isDisabled = method.value === 'balance' && balance <= 0;
          const isSelected = selected === method.value;
          
          return (
            <button
              key={method.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-disabled={isDisabled}
              onClick={() => !isDisabled && onSelect(method.value)}
              disabled={isDisabled}
              className={`w-full flex items-center gap-4 p-4 rounded-lg border-2 transition-all ${
                isSelected
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30'
                  : isDisabled
                  ? 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 opacity-50 cursor-not-allowed'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              <div className={`p-2 rounded-lg ${
                isSelected ? 'bg-primary-100 dark:bg-primary-900/50 text-primary-600 dark:text-primary-400' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
              }`} aria-hidden="true">
                {method.icon}
              </div>
              <div className="flex-1 text-left">
                <p className="font-medium text-gray-900 dark:text-gray-100">{method.label}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {method.value === 'balance' 
                    ? `Available: ₱${balance.toFixed(2)}`
                    : method.description
                  }
                </p>
              </div>
              <div className={`w-5 h-5 rounded-full border-2 ${
                isSelected 
                  ? 'border-primary-500 bg-primary-500' 
                  : 'border-gray-300 dark:border-gray-600'
              }`} aria-hidden="true">
                {isSelected && (
                  <div className="w-full h-full flex items-center justify-center">
                    <div className="w-2 h-2 bg-white dark:bg-gray-200 rounded-full" />
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
