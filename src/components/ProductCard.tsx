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
  onAddToCart
}: ProductCardProps) {
  const [imageError, setImageError] = useState(false);
  const hasImage = image_url && !imageError;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden hover:shadow-md hover:scale-[1.02] transition-all duration-200 relative">
      {/* Favorite button */}
      {onToggleFavorite && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          className="absolute top-2 right-2 p-2 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-full shadow-sm hover:bg-white dark:hover:bg-gray-800 transition-colors z-10"
          aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Heart
            size={20}
            className={isFavorite ? 'fill-red-500 text-red-500' : 'text-gray-400 dark:text-gray-500'}
          />
        </button>
      )}
      
      {hasImage ? (
        <img
          src={image_url}
          alt={name}
          className="w-full h-40 object-cover"
          loading="lazy"
          onError={() => setImageError(true)}
        />
      ) : (
        <div className="w-full h-40 bg-gradient-to-br from-primary-50 to-primary-100 dark:from-gray-700 dark:to-gray-750 flex items-center justify-center">
          <UtensilsCrossed size={48} className="text-primary-300 dark:text-gray-500" />
        </div>
      )}
      <div className="p-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1 line-clamp-1">{name}</h3>
        <p className="text-gray-600 dark:text-gray-400 text-sm mb-3 line-clamp-2">{description}</p>
        <div className="flex items-center justify-between">
          <span className="text-2xl font-bold text-primary-600 dark:text-primary-400">
            ₱{price.toFixed(2)}
          </span>
          <button
            onClick={() => onAddToCart(id)}
            disabled={!available}
            className="bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-lg font-medium transition-colors"
          >
            {available ? 'Add' : 'Out of Stock'}
          </button>
        </div>
      </div>
    </div>
  );
}