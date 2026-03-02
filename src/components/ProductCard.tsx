import { Heart, UtensilsCrossed } from 'lucide-react';
import { useState } from 'react';

interface ProductCardProps {
  id: string;
  name: string;
  description: string;
  price: number;
  image_url: string;
  available: boolean;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  onAddToCart: (productId: string) => void;
  /** When true, the Add button is greyed out with a "Select a student first" tooltip */
  addDisabled?: boolean;
}

export function ProductCard({
  id,
  name,
  description,
  price,
  image_url,
  available,
  isFavorite = false,
  onToggleFavorite,
  onAddToCart,
  addDisabled = false,
}: ProductCardProps) {
  const [imageError, setImageError] = useState(false);
  const hasImage = image_url && !imageError;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden hover:shadow-md transition-all duration-200 relative flex sm:flex-col">
      {/* Favorite button */}
      {onToggleFavorite && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          className="absolute top-1 right-1 sm:top-2 sm:right-2 p-1.5 sm:p-2 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-full shadow-sm hover:bg-white dark:hover:bg-gray-800 transition-colors z-10"
          aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Heart
            size={16}
            className={`sm:w-5 sm:h-5 ${isFavorite ? 'fill-red-500 text-red-500' : 'text-gray-400 dark:text-gray-500'}`}
          />
        </button>
      )}
      
      {/* Image: small square on mobile, full-width on sm+ */}
      {hasImage ? (
        <img
          src={image_url}
          alt={name}
          className="w-24 h-24 sm:w-full sm:h-36 object-cover flex-shrink-0"
          loading="lazy"
          onError={() => setImageError(true)}
        />
      ) : (
        <div className="w-24 h-24 sm:w-full sm:h-36 bg-gradient-to-br from-primary-50 to-primary-100 dark:from-gray-700 dark:to-gray-750 flex items-center justify-center flex-shrink-0">
          <UtensilsCrossed size={24} className="sm:w-10 sm:h-10 text-primary-300 dark:text-gray-500" />
        </div>
      )}

      {/* Details: compact row on mobile, padded block on sm+ */}
      <div className="flex-1 min-w-0 p-3 sm:p-4 flex flex-col justify-between">
        <div>
          <h3 className="text-sm sm:text-lg font-semibold text-gray-900 dark:text-gray-100 line-clamp-1">{name}</h3>
          <p className="text-gray-600 dark:text-gray-400 text-xs sm:text-sm line-clamp-2">{description}</p>
        </div>
        <div className="flex items-center justify-between mt-1 sm:mt-3">
          <span className="text-sm sm:text-2xl font-bold text-primary-600 dark:text-primary-400">
            ₱{price.toFixed(2)}
          </span>
          <button
            onClick={() => !addDisabled && onAddToCart(id)}
            disabled={!available || addDisabled}
            title={addDisabled ? 'Select a student first' : undefined}
            className={`px-3 py-1.5 sm:px-4 sm:py-2.5 rounded-lg text-sm sm:text-base font-medium transition-colors text-white ${
              !available
                ? 'bg-gray-300 dark:bg-gray-600 cursor-not-allowed'
                : addDisabled
                ? 'bg-primary-600 opacity-50 cursor-not-allowed'
                : 'bg-primary-600 hover:bg-primary-700'
            }`}
          >
            {!available ? 'Out of Stock' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}