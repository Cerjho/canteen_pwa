import { useState, useEffect } from 'react';
// Favorites are stored locally for now
import { useAuth } from './useAuth';

const FAVORITES_KEY = 'canteen_favorites';

export function useFavorites() {
  const { user } = useAuth();
  const [favorites, setFavorites] = useState<string[]>([]);

  // Load favorites from localStorage on mount
  useEffect(() => {
    if (user) {
      const stored = localStorage.getItem(`${FAVORITES_KEY}_${user.id}`);
      if (stored) {
        setFavorites(JSON.parse(stored));
      }
    }
  }, [user]);

  // Save to localStorage whenever favorites change
  const saveFavorites = (newFavorites: string[]) => {
    if (user) {
      localStorage.setItem(`${FAVORITES_KEY}_${user.id}`, JSON.stringify(newFavorites));
      setFavorites(newFavorites);
    }
  };

  const addFavorite = (productId: string) => {
    if (!favorites.includes(productId)) {
      saveFavorites([...favorites, productId]);
    }
  };

  const removeFavorite = (productId: string) => {
    saveFavorites(favorites.filter(id => id !== productId));
  };

  const toggleFavorite = (productId: string) => {
    if (favorites.includes(productId)) {
      removeFavorite(productId);
    } else {
      addFavorite(productId);
    }
  };

  const isFavorite = (productId: string) => favorites.includes(productId);

  return {
    favorites,
    addFavorite,
    removeFavorite,
    toggleFavorite,
    isFavorite
  };
}
