import { Heart } from 'lucide-react';
import { useState } from 'react';

// Default placeholder image for products
const DEFAULT_PRODUCT_IMAGE = '/icons/icon-192.png';

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
  const imageSrc = imageError || !image_url ? DEFAULT_PRODUCT_IMAGE : image_url;

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow relative">
      {/* Favorite button */}
      {onToggleFavorite && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          className="absolute top-2 right-2 p-2 bg-white/80 backdrop-blur-sm rounded-full shadow-sm hover:bg-white transition-colors z-10"
          aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Heart
            size={20}
            className={isFavorite ? 'fill-red-500 text-red-500' : 'text-gray-400'}
          />
        </button>
      )}
      
      <img
        src={imageSrc}
        alt={name}
        className="w-full h-48 object-cover"
        loading="lazy"
        onError={() => setImageError(true)}
      />
      <div className="p-4">
        <h3 className="text-lg font-semibold mb-1 line-clamp-1">{name}</h3>
        <p className="text-gray-600 text-sm mb-3 line-clamp-2">{description}</p>
        <div className="flex items-center justify-between">
          <span className="text-2xl font-bold text-primary-600">
            ₱{price.toFixed(2)}
          </span>
          <button
            onClick={() => onAddToCart(id)}
            disabled={!available}
            className="bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            {available ? 'Add' : 'Out of Stock'}
          </button>
        </div>
      </div>
    </div>
  );
}