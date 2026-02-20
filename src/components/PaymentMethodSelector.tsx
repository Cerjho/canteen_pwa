import { CreditCard, Wallet, Banknote, Smartphone, Globe } from 'lucide-react';
import type { PaymentMethod } from '../types';

interface PaymentMethodSelectorProps {
  selected: PaymentMethod;
  onSelect: (method: PaymentMethod) => void;
  balance?: number;
  orderTotal?: number;
  isOffline?: boolean;
}

interface PaymentMethodOption {
  value: PaymentMethod;
  label: string;
  icon: React.ReactNode;
  description: string;
  group: 'school' | 'online';
}

const PAYMENT_METHODS: PaymentMethodOption[] = [
  { 
    value: 'cash', 
    label: 'Cash', 
    icon: <Banknote size={24} />,
    description: 'Pay at the canteen',
    group: 'school',
  },
  { 
    value: 'balance', 
    label: 'Wallet Balance', 
    icon: <Wallet size={24} />,
    description: 'Use your prepaid balance',
    group: 'school',
  },
  { 
    value: 'gcash', 
    label: 'GCash', 
    icon: <Smartphone size={24} />,
    description: 'Pay via GCash',
    group: 'online',
  },
  { 
    value: 'paymaya', 
    label: 'PayMaya', 
    icon: <Smartphone size={24} />,
    description: 'Pay via PayMaya',
    group: 'online',
  },
  { 
    value: 'card', 
    label: 'Credit/Debit Card', 
    icon: <CreditCard size={24} />,
    description: 'Visa, Mastercard',
    group: 'online',
  },
];

function PaymentOption({
  method,
  isSelected,
  isDisabled,
  balance,
  onSelect,
  disabledReason,
}: {
  method: PaymentMethodOption;
  isSelected: boolean;
  isDisabled: boolean;
  balance: number;
  onSelect: () => void;
  disabledReason?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={isSelected}
      aria-disabled={isDisabled}
      onClick={() => !isDisabled && onSelect()}
      disabled={isDisabled}
      className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all ${
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
            : disabledReason || method.description
          }
        </p>
      </div>
      <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 ${
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
}

export function PaymentMethodSelector({ selected, onSelect, balance = 0, orderTotal = 0, isOffline = false }: PaymentMethodSelectorProps) {
  const schoolMethods = PAYMENT_METHODS.filter(m => m.group === 'school');
  const onlineMethods = PAYMENT_METHODS.filter(m => m.group === 'online');

  const getDisabledState = (method: PaymentMethodOption): { disabled: boolean; reason?: string } => {
    if (method.value === 'balance' && balance < orderTotal && orderTotal > 0) {
      return { disabled: true, reason: `Need ₱${(orderTotal - balance).toFixed(2)} more` };
    }
    if (method.value === 'balance' && balance <= 0) {
      return { disabled: true, reason: 'No balance available' };
    }
    if (method.group === 'online' && isOffline) {
      return { disabled: true, reason: 'Requires internet connection' };
    }
    return { disabled: false };
  };

  return (
    <div className="space-y-3">
      <div id="payment-method-label" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        Payment Method
      </div>
      
      <div role="radiogroup" aria-labelledby="payment-method-label" className="space-y-3">
        {/* School Payment Methods */}
        {schoolMethods.map((method) => {
          const { disabled, reason } = getDisabledState(method);
          return (
            <PaymentOption
              key={method.value}
              method={method}
              isSelected={selected === method.value}
              isDisabled={disabled}
              balance={balance}
              onSelect={() => onSelect(method.value)}
              disabledReason={reason}
            />
          );
        })}

        {/* Online Payment Divider */}
        <div className="flex items-center gap-3 py-1">
          <div className="flex-1 border-t border-gray-200 dark:border-gray-700" />
          <span className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            <Globe size={12} />
            Pay Online
          </span>
          <div className="flex-1 border-t border-gray-200 dark:border-gray-700" />
        </div>

        {isOffline && (
          <p className="text-xs text-amber-600 dark:text-amber-400 text-center">
            Online payments require an internet connection
          </p>
        )}

        {/* Online Payment Methods */}
        {onlineMethods.map((method) => {
          const { disabled, reason } = getDisabledState(method);
          return (
            <PaymentOption
              key={method.value}
              method={method}
              isSelected={selected === method.value}
              isDisabled={disabled}
              balance={balance}
              onSelect={() => onSelect(method.value)}
              disabledReason={reason}
            />
          );
        })}

        {/* Online payment note */}
        {['gcash', 'paymaya', 'card'].includes(selected) && (
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center italic">
            You'll be redirected to complete payment securely
          </p>
        )}
      </div>
    </div>
  );

}
