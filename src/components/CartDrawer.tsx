import { useState, useEffect } from 'react';
import { X, Plus, Minus, CreditCard, Wallet, Banknote, User, Calendar } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import type { CartItem } from '../hooks/useCart';

type PaymentMethod = 'cash' | 'gcash' | 'balance';

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  items: CartItem[];
  itemsByStudent: Record<string, { student_name: string; items: CartItem[] }>;
  onUpdateQuantity: (productId: string, studentId: string, scheduledFor: string, quantity: number) => void;
  onCheckout: (paymentMethod: PaymentMethod, notes: string) => Promise<void>;
  onError?: (error: Error) => void;
  parentBalance?: number;
}

export function CartDrawer({
  isOpen,
  onClose,
  items,
  itemsByStudent,
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
  const studentCount = Object.keys(itemsByStudent).length;

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

          {/* Items grouped by date, then by student */}
          <div className="flex-1 overflow-y-auto p-4">
            {items.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-400 text-center py-8">Cart is empty</p>
            ) : (
              <div className="space-y-6">
                {(() => {
                  // Group items by scheduled_for date, then by student
                  const itemsByDateAndStudent = items.reduce((acc, item) => {
                    if (!acc[item.scheduled_for]) {
                      acc[item.scheduled_for] = {};
                    }
                    if (!acc[item.scheduled_for][item.student_id]) {
                      acc[item.scheduled_for][item.student_id] = {
                        student_name: item.student_name,
                        items: []
                      };
                    }
                    acc[item.scheduled_for][item.student_id].items.push(item);
                    return acc;
                  }, {} as Record<string, Record<string, { student_name: string; items: CartItem[] }>>);

                  // Sort dates
                  const sortedDates = Object.keys(itemsByDateAndStudent).sort();

                  return sortedDates.map((dateStr) => {
                    const dateTotal = Object.values(itemsByDateAndStudent[dateStr])
                      .flatMap(s => s.items)
                      .reduce((sum, item) => sum + item.price * item.quantity, 0);

                    return (
                      <div key={dateStr} className="space-y-3">
                        {/* Date header */}
                        <div className="flex items-center justify-between bg-amber-50 dark:bg-amber-900/30 px-3 py-2 rounded-lg border border-amber-200 dark:border-amber-700">
                          <div className="flex items-center gap-2">
                            <Calendar size={16} className="text-amber-600 dark:text-amber-400" />
                            <span className="font-medium text-amber-700 dark:text-amber-300">
                              {format(parseISO(dateStr), 'EEE, MMM d, yyyy')}
                            </span>
                          </div>
                          <span className="text-sm font-medium text-amber-600 dark:text-amber-400">
                            ₱{dateTotal.toFixed(2)}
                          </span>
                        </div>

                        {/* Students for this date */}
                        {Object.entries(itemsByDateAndStudent[dateStr]).map(([studentId, { student_name, items: studentItems }]) => {
                          const studentTotal = studentItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
                          return (
                            <div key={`${dateStr}-${studentId}`} className="space-y-3 ml-2">
                              {/* Student header */}
                              <div className="flex items-center justify-between bg-primary-50 dark:bg-primary-900/30 px-3 py-2 rounded-lg">
                                <div className="flex items-center gap-2">
                                  <User size={16} className="text-primary-600 dark:text-primary-400" />
                                  <span className="font-medium text-primary-700 dark:text-primary-300">{student_name}</span>
                                </div>
                                <span className="text-sm font-medium text-primary-600 dark:text-primary-400">
                                  ₱{studentTotal.toFixed(2)}
                                </span>
                              </div>
                              
                              {/* Student's items */}
                              <div className="space-y-3 pl-2">
                                {studentItems.map((item) => (
                                  <div
                                    key={`${item.scheduled_for}-${item.student_id}-${item.product_id}`}
                                    className="flex items-center gap-4 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg"
                                  >
                                    <img
                                      src={item.image_url}
                                      alt={item.name}
                                      className="w-14 h-14 object-cover rounded"
                                      onError={(e) => {
                                        (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23ddd" width="100" height="100"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="40" fill="%23999">?</text></svg>';
                                      }}
                                    />
                                    <div className="flex-1 min-w-0">
                                      <h4 className="font-medium text-gray-900 dark:text-gray-100 truncate text-sm">{item.name}</h4>
                                      <p className="text-gray-600 dark:text-gray-400 text-sm">
                                        ₱{item.price.toFixed(2)}
                                      </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={() => onUpdateQuantity(item.product_id, item.student_id, item.scheduled_for, item.quantity - 1)}
                                        className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                                        aria-label="Decrease quantity"
                                      >
                                        <Minus size={16} className="text-gray-900 dark:text-gray-100" />
                                      </button>
                                      <span className="w-6 text-center font-medium text-gray-900 dark:text-gray-100 text-sm">
                                        {item.quantity}
                                      </span>
                                      <button
                                        onClick={() => onUpdateQuantity(item.product_id, item.student_id, item.scheduled_for, item.quantity + 1)}
                                        className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                                        aria-label="Increase quantity"
                                      >
                                        <Plus size={16} className="text-gray-900 dark:text-gray-100" />
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  });
                })()}
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
                          paymentMethod === option.id ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'
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
              <div>
                <span className="text-lg font-medium text-gray-900 dark:text-gray-100">Total:</span>
                {studentCount > 1 && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">{studentCount} students</p>
                )}
              </div>
              <span className="text-2xl font-bold text-primary-600 dark:text-primary-400">
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
              ) : studentCount > 1 ? (
                `Place ${studentCount} Orders`
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