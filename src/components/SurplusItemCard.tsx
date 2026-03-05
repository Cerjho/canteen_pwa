import { useState } from 'react';
import { Clock, UtensilsCrossed, Plus, Minus } from 'lucide-react';
import type { SurplusItem } from '../types';

interface SurplusItemCardProps {
  item: SurplusItem;
  /** Quantity already in cart (for this product). 0 if none. */
  cartQuantity?: number;
  onAdd: (surplusItem: SurplusItem, quantity: number) => void;
  /** When surplus ordering is closed (past 8 AM) */
  isClosed?: boolean;
  index?: number;
}

export function SurplusItemCard({
  item,
  cartQuantity = 0,
  onAdd,
  isClosed = false,
  index = 0,
}: SurplusItemCardProps) {
  const [quantity, setQuantity] = useState(1);
  const [imageError, setImageError] = useState(false);

  const product = item.product;
  const hasImage = product?.image_url && !imageError;
  const remaining = item.quantity_available - cartQuantity;
  const soldOut = remaining <= 0;

  const handleAdd = () => {
    if (isClosed || soldOut) return;
    const qty = Math.min(quantity, remaining);
    onAdd(item, qty);
    setQuantity(1);
  };

  return (
    <div
      className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden flex animate-fade-in opacity-0 [animation-fill-mode:forwards]"
      style={{ animationDelay: `${Math.min(index, 11) * 50}ms` }}
    >
      {/* Image */}
      {hasImage ? (
        <img
          src={product?.image_url ?? ''}
          alt={product?.name ?? 'Surplus item'}
          className="w-24 min-h-24 object-cover flex-shrink-0 rounded-l-xl"
          loading="lazy"
          onError={() => setImageError(true)}
        />
      ) : (
        <div className="w-24 min-h-24 bg-gradient-to-br from-amber-50 to-amber-100 dark:from-gray-700 dark:to-gray-750 flex items-center justify-center flex-shrink-0 rounded-l-xl">
          <UtensilsCrossed size={24} className="text-amber-300 dark:text-gray-500" />
        </div>
      )}

      {/* Details */}
      <div className="flex-1 min-w-0 p-3 flex flex-col justify-between">
        <div>
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 line-clamp-1">
              {product?.name ?? 'Unknown Item'}
            </h3>
            {/* Surplus badge */}
            <span className="flex-shrink-0 inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 rounded-full">
              <Clock size={10} />
              Surplus
            </span>
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {remaining > 0 ? `${remaining} available` : 'Sold out'}
          </p>
        </div>

        <div className="flex items-center justify-between mt-2">
          <span className="text-sm font-bold text-primary-600 dark:text-primary-400">
            <span className="text-xs font-normal text-primary-400 dark:text-primary-500">₱</span>
            {item.surplus_price.toFixed(2)}
          </span>

          {isClosed ? (
            <span className="text-xs font-medium text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded-full">
              Past 8 AM
            </span>
          ) : soldOut ? (
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/20 px-2 py-1 rounded-full">
              Sold Out
            </span>
          ) : (
            <div className="flex items-center gap-1">
              {/* Quantity selector */}
              <div className="flex items-center border border-gray-200 dark:border-gray-700 rounded-lg">
                <button
                  type="button"
                  onClick={() => setQuantity(q => Math.max(1, q - 1))}
                  disabled={quantity <= 1}
                  className="p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-30"
                >
                  <Minus size={14} />
                </button>
                <span className="w-6 text-center text-xs font-medium text-gray-900 dark:text-gray-100">
                  {quantity}
                </span>
                <button
                  type="button"
                  onClick={() => setQuantity(q => Math.min(remaining, q + 1))}
                  disabled={quantity >= remaining}
                  className="p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-30"
                >
                  <Plus size={14} />
                </button>
              </div>

              <button
                type="button"
                onClick={handleAdd}
                className="px-3 py-1 rounded-lg text-sm font-medium bg-amber-500 hover:bg-amber-600 active:scale-95 text-white transition-all"
              >
                Add
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
