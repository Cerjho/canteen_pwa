import { useState, useEffect, useCallback } from 'react';
// Favorites are stored locally for now
import { useAuth } from './useAuth';

const FAVORITES_KEY = 'canteen_favorites';

// Type guard to validate favorites array
function isValidFavoritesArray(data: unknown): data is string[] {
  return Array.isArray(data) && data.every(item => typeof item === 'string');
}

export function useFavorites() {
  const { user } = useAuth();
  const [favorites, setFavorites] = useState<string[]>([]);

  // Load favorites from localStorage on mount or user change
  useEffect(() => {
    const userId = user?.id;
    if (userId) {
      try {
        const stored = localStorage.getItem(`${FAVORITES_KEY}_${userId}`);
        if (stored) {
          const parsed = JSON.parse(stored);
          // Validate the parsed data
          if (isValidFavoritesArray(parsed)) {
            setFavorites(parsed);
          } else {
            // eslint-disable-next-line no-console
            console.warn('Invalid favorites data in localStorage, resetting');
            setFavorites([]);
          }
        } else {
          setFavorites([]);
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Failed to parse favorites from localStorage:', error);
        setFavorites([]);
      }
    } else {
      // Clear favorites when user logs out
      setFavorites([]);
    }
  }, [user]);

  const addFavorite = useCallback((productId: string) => {
    const userId = user?.id;
    setFavorites(current => {
      if (!current.includes(productId)) {
        const newFavorites = [...current, productId];
        if (userId) {
          try {
            localStorage.setItem(`${FAVORITES_KEY}_${userId}`, JSON.stringify(newFavorites));
          } catch (e) {
            // eslint-disable-next-line no-console
            console.error('Failed to save favorites:', e);
          }
        }
        return newFavorites;
      }
      return current;
    });
  }, [user]);

  const removeFavorite = useCallback((productId: string) => {
    const userId = user?.id;
    setFavorites(current => {
      const newFavorites = current.filter(id => id !== productId);
      if (userId) {
        try {
          localStorage.setItem(`${FAVORITES_KEY}_${userId}`, JSON.stringify(newFavorites));
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('Failed to save favorites:', e);
        }
      }
      return newFavorites;
    });
  }, [user]);

  const toggleFavorite = useCallback((productId: string) => {
    const userId = user?.id;
    setFavorites(current => {
      const newFavorites = current.includes(productId)
        ? current.filter(id => id !== productId)
        : [...current, productId];
      
      if (userId) {
        try {
          localStorage.setItem(`${FAVORITES_KEY}_${userId}`, JSON.stringify(newFavorites));
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('Failed to save favorites:', e);
        }
      }
      return newFavorites;
    });
  }, [user]);

  const isFavorite = useCallback((productId: string) => favorites.includes(productId), [favorites]);

  return {
    favorites,
    addFavorite,
    removeFavorite,
    toggleFavorite,
    isFavorite
  };
}
