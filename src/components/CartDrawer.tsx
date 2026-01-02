import { useState, useEffect } from 'react';
import { X, Plus, Minus, CreditCard, Wallet, Banknote } from 'lucide-react';

interface CartItem {
  id: string;
  product_id: string;
  name: string;
  price: number;
  quantity: number;
  image_url: string;
}

type PaymentMethod = 'cash' | 'gcash' | 'balance';

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  items: CartItem[];
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onCheckout: (paymentMethod: PaymentMethod, notes: string) => Promise<void>;
  onError?: (error: Error) => void;
  parentBalance?: number;
}

export function CartDrawer({
  isOpen,
  onClose,
  items,
  onUpdateQuantity,
  onCheckout,
  onError,
  parentBalance = 0
}: CartDrawerProps) {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [notes, setNotes] = useState('');
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const canUseBalance = parentBalance >= total;

  // Handle escape key to close drawer
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isCheckingOut) {
        onClose();
      }
    };
    
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, isCheckingOut, onClose]);

  // Clear error when drawer closes
  useEffect(() => {
    if (!isOpen) {
      setCheckoutError(null);
    }
  }, [isOpen]);

  const handleCheckout = async () => {
    if (isCheckingOut) return; // Prevent double submission
    
    setIsCheckingOut(true);
    setCheckoutError(null);
    
    try {
      await onCheckout(paymentMethod, notes);
      setNotes('');
      setPaymentMethod('cash');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Checkout failed. Please try again.';
      setCheckoutError(errorMessage);
      onError?.(error instanceof Error ? error : new Error(errorMessage));
      console.error('Checkout error:', error);
    } finally {
      setIsCheckingOut(false);
    }
  };

  const paymentOptions = [
    { 
      id: 'cash' as PaymentMethod, 
      label: 'Cash', 
      icon: Banknote, 
      disabled: false,
      description: 'Pay at pickup'
    },
    { 
      id: 'gcash' as PaymentMethod, 
      label: 'GCash', 
      icon: CreditCard, 
      disabled: false,
      description: 'Mobile payment'
    },
    { 
      id: 'balance' as PaymentMethod, 
      label: 'Balance', 
      icon: Wallet, 
      disabled: !canUseBalance,
      description: canUseBalance 
        ? `Available: ₱${parentBalance.toFixed(2)}`
        : `Need ₱${(total - parentBalance).toFixed(2)} more`
    }
  ];

  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40 transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div
        className={`fixed right-0 top-0 h-full w-full max-w-md bg-white dark:bg-gray-800 shadow-xl z-50 transform transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Your Cart</h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              aria-label="Close cart"
            >
              <X size={24} className="text-gray-900 dark:text-gray-100" />
            </button>
          </div>

          {/* Items */}
          <div className="flex-1 overflow-y-auto p-4">
            {items.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-400 text-center py-8">Cart is empty</p>
            ) : (
              <div className="space-y-4">
                {items.map((item) => (
                  <div
                    key={item.product_id}
                    className="flex items-center gap-4 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg"
                  >
                    <img
                      src={item.image_url}
                      alt={item.name}
                      className="w-16 h-16 object-cover rounded"
                    />
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-gray-900 dark:text-gray-100 truncate">{item.name}</h4>
                      <p className="text-gray-600 dark:text-gray-400 text-sm">
                        ₱{item.price.toFixed(2)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() =>
                          onUpdateQuantity(item.product_id, item.quantity - 1)
                        }
                        className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                        aria-label="Decrease quantity"
                      >
                        <Minus size={16} className="text-gray-900 dark:text-gray-100" />
                      </button>
                      <span className="w-8 text-center font-medium text-gray-900 dark:text-gray-100">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() =>
                          onUpdateQuantity(item.product_id, item.quantity + 1)
                        }
                        className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                        aria-label="Increase quantity"
                      >
                        <Plus size={16} className="text-gray-900 dark:text-gray-100" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-gray-200 dark:border-gray-700 p-4 space-y-4">
            {/* Payment Method Selection */}
            {items.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Payment Method</label>
                <div className="grid grid-cols-3 gap-2">
                  {paymentOptions.map((option) => (
                    <button
                      key={option.id}
                      onClick={() => !option.disabled && setPaymentMethod(option.id)}
                      disabled={option.disabled}
                      className={`p-3 rounded-lg border-2 transition-all ${
                        paymentMethod === option.id
                          ? 'border-primary-600 bg-primary-50 dark:bg-primary-900/30'
                          : option.disabled
                            ? 'border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-900 opacity-50 cursor-not-allowed'
                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                      }`}
                    >
                      <option.icon 
                        size={20} 
                        className={`mx-auto mb-1 ${
                          paymentMethod === option.id ? 'text-primary-600' : 'text-gray-500'
                        }`} 
                      />
                      <div className={`text-xs font-medium ${
                        paymentMethod === option.id ? 'text-primary-600 dark:text-primary-400' : 'text-gray-700 dark:text-gray-300'
                      }`}>
                        {option.label}
                      </div>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
                  {paymentOptions.find(o => o.id === paymentMethod)?.description}
                </p>
              </div>
            )}

            {/* Order Notes */}
            {items.length > 0 && (
              <div className="space-y-2">
                <label htmlFor="order-notes" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Special Instructions (optional)
                </label>
                <textarea
                  id="order-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any allergies or special requests?"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm resize-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                  rows={2}
                  maxLength={200}
                  aria-label="Special instructions for your order"
                />
              </div>
            )}

            {/* Checkout Error Message */}
            {checkoutError && (
              <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-lg" role="alert">
                <p className="text-sm text-red-600 dark:text-red-400">{checkoutError}</p>
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
              <span className="text-lg font-medium text-gray-900 dark:text-gray-100">Total:</span>
              <span className="text-2xl font-bold text-primary-600">
                ₱{total.toFixed(2)}
              </span>
            </div>
            <button
              onClick={handleCheckout}
              disabled={items.length === 0 || isCheckingOut}
              className="w-full bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
            >
              {isCheckingOut ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Processing...
                </>
              ) : (
                'Place Order'
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}