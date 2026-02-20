import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth';
import { supabase } from '../services/supabaseClient';

export function useFavorites() {
  const { user } = useAuth();
  const [favorites, setFavorites] = useState<string[]>([]);
  const [isLoadingFavorites, setIsLoadingFavorites] = useState(true);

  // Load favorites from database on mount or user change
  useEffect(() => {
    async function loadFavorites() {
      if (!user) {
        setFavorites([]);
        setIsLoadingFavorites(false);
        return;
      }

      setIsLoadingFavorites(true);
      try {
        const { data, error } = await supabase
          .from('favorites')
          .select('product_id')
          .eq('user_id', user.id);

        if (error) {
          console.error('Failed to load favorites:', error);
          setFavorites([]);
        } else if (data) {
          setFavorites(data.map(item => item.product_id));
        }
      } catch (err) {
        console.error('Failed to load favorites:', err);
        setFavorites([]);
      } finally {
        setIsLoadingFavorites(false);
      }
    }

    loadFavorites();
  }, [user]);

  const addFavorite = useCallback(async (productId: string) => {
    if (!user) return;

    // Optimistic update
    setFavorites(current => {
      if (!current.includes(productId)) {
        return [...current, productId];
      }
      return current;
    });

    // Persist to database
    try {
      const { error } = await supabase
        .from('favorites')
        .insert({ user_id: user.id, product_id: productId });
      if (error) throw error;
    } catch (err) {
      console.error('Failed to save favorite:', err);
      // Revert on error
      setFavorites(current => current.filter(id => id !== productId));
    }
  }, [user]);

  const removeFavorite = useCallback(async (productId: string) => {
    if (!user) return;

    // Optimistic update
    setFavorites(current => current.filter(id => id !== productId));

    // Delete from database
    try {
      const { error } = await supabase
        .from('favorites')
        .delete()
        .eq('user_id', user.id)
        .eq('product_id', productId);
      if (error) throw error;
    } catch (err) {
      console.error('Failed to remove favorite:', err);
      // Revert on error
      setFavorites(current => [...current, productId]);
    }
  }, [user]);

  const toggleFavorite = useCallback(async (productId: string) => {
    if (!user) return;

    const isCurrentlyFavorite = favorites.includes(productId);
    
    if (isCurrentlyFavorite) {
      await removeFavorite(productId);
    } else {
      await addFavorite(productId);
    }
  }, [user, favorites, addFavorite, removeFavorite]);

  const isFavorite = useCallback((productId: string) => favorites.includes(productId), [favorites]);

  return {
    favorites,
    addFavorite,
    removeFavorite,
    toggleFavorite,
    isFavorite,
    isLoadingFavorites
  };
}
