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
      <label className="block text-sm font-medium text-gray-700 mb-2">
        Payment Method
      </label>
      
      {PAYMENT_METHODS.map((method) => {
        const isDisabled = method.value === 'balance' && balance <= 0;
        
        return (
          <button
            key={method.value}
            type="button"
            onClick={() => !isDisabled && onSelect(method.value)}
            disabled={isDisabled}
            className={`w-full flex items-center gap-4 p-4 rounded-lg border-2 transition-all ${
              selected === method.value
                ? 'border-primary-500 bg-primary-50'
                : isDisabled
                ? 'border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className={`p-2 rounded-lg ${
              selected === method.value ? 'bg-primary-100 text-primary-600' : 'bg-gray-100 text-gray-600'
            }`}>
              {method.icon}
            </div>
            <div className="flex-1 text-left">
              <p className="font-medium text-gray-900">{method.label}</p>
              <p className="text-sm text-gray-500">
                {method.value === 'balance' 
                  ? `Available: ₱${balance.toFixed(2)}`
                  : method.description
                }
              </p>
            </div>
            <div className={`w-5 h-5 rounded-full border-2 ${
              selected === method.value 
                ? 'border-primary-500 bg-primary-500' 
                : 'border-gray-300'
            }`}>
              {selected === method.value && (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="w-2 h-2 bg-white rounded-full" />
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
