import { useEffect } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { CheckCircle, ArrowRight, Clock, User } from 'lucide-react';

interface OrderConfirmationState {
  orderId: string;
  totalAmount: number;
  childName: string;
  itemCount: number;
  isOffline?: boolean;
}

export default function OrderConfirmation() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as OrderConfirmationState | null;

  useEffect(() => {
    // Redirect if no order data
    if (!state) {
      navigate('/menu');
    }
  }, [state, navigate]);

  if (!state) return null;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4 pb-24">
      <div className="max-w-md w-full text-center">
        {/* Success Icon */}
        <div className="mb-6">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle className="w-12 h-12 text-green-500" />
          </div>
        </div>

        {/* Title */}
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          {state.isOffline ? 'Order Saved!' : 'Order Placed!'}
        </h1>
        
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          {state.isOffline 
            ? 'Your order has been saved and will be submitted when you\'re back online.'
            : 'Your order has been received and is being processed.'
          }
        </p>

        {/* Order Summary Card */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-6 text-left">
          <div className="flex items-center gap-3 pb-4 border-b mb-4">
            <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
              <User className="text-primary-600" size={20} />
            </div>
            <div>
              <p className="font-medium text-gray-900 dark:text-gray-100">Order for {state.childName}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">{state.itemCount} item(s)</p>
            </div>
          </div>

          <div className="flex justify-between items-center mb-4">
            <span className="text-gray-600 dark:text-gray-400">Order ID</span>
            <span className="font-mono text-sm text-gray-900 dark:text-gray-100">
              #{state.orderId.slice(0, 8).toUpperCase()}
            </span>
          </div>

          <div className="flex justify-between items-center mb-4">
            <span className="text-gray-600 dark:text-gray-400">Status</span>
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-100 text-amber-700 rounded-full text-sm font-medium">
              <Clock size={14} />
              Pending
            </span>
          </div>

          <div className="flex justify-between items-center pt-4 border-t border-gray-200 dark:border-gray-700">
            <span className="text-lg font-medium text-gray-900 dark:text-gray-100">Total</span>
            <span className="text-2xl font-bold text-primary-600">
              ₱{state.totalAmount.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Offline Notice */}
        {state.isOffline && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6 text-left">
            <p className="text-sm text-amber-800">
              <strong>Offline Mode:</strong> Your order is saved locally and will be 
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
