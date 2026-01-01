// useFavorites Hook Tests
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFavorites } from '../../src/hooks/useFavorites';

// Mock useAuth
vi.mock('../../src/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'test-user-123' }
  })
}));

describe('useFavorites Hook', () => {
  const STORAGE_KEY = 'canteen_favorites_test-user-123';

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('Initial State', () => {
    it('should start with empty favorites', () => {
      const { result } = renderHook(() => useFavorites());

      expect(result.current.favorites).toEqual([]);
    });

    it('should load favorites from localStorage', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(['product-1', 'product-2']));

      const { result } = renderHook(() => useFavorites());

      expect(result.current.favorites).toEqual(['product-1', 'product-2']);
    });
  });

  describe('addFavorite', () => {
    it('should add product to favorites', () => {
      const { result } = renderHook(() => useFavorites());

      act(() => {
        result.current.addFavorite('product-1');
      });

      expect(result.current.favorites).toContain('product-1');
    });

    it('should not add duplicate favorites', () => {
      const { result } = renderHook(() => useFavorites());

      act(() => {
        result.current.addFavorite('product-1');
      });

      act(() => {
        result.current.addFavorite('product-1');
      });

      expect(result.current.favorites).toHaveLength(1);
    });

    it('should save to localStorage', () => {
      const { result } = renderHook(() => useFavorites());

      act(() => {
        result.current.addFavorite('product-1');
      });

      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      expect(stored).toContain('product-1');
    });
  });

  describe('removeFavorite', () => {
    it('should remove product from favorites', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(['product-1', 'product-2']));

      const { result } = renderHook(() => useFavorites());

      act(() => {
        result.current.removeFavorite('product-1');
      });

      expect(result.current.favorites).not.toContain('product-1');
      expect(result.current.favorites).toContain('product-2');
    });

    it('should handle removing non-existent favorite', () => {
      const { result } = renderHook(() => useFavorites());

      act(() => {
        result.current.removeFavorite('non-existent');
      });

      expect(result.current.favorites).toEqual([]);
    });

    it('should update localStorage', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(['product-1', 'product-2']));

      const { result } = renderHook(() => useFavorites());

      act(() => {
        result.current.removeFavorite('product-1');
      });

      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      expect(stored).not.toContain('product-1');
    });
  });

  describe('toggleFavorite', () => {
    it('should add favorite if not present', () => {
      const { result } = renderHook(() => useFavorites());

      act(() => {
        result.current.toggleFavorite('product-1');
      });

      expect(result.current.favorites).toContain('product-1');
    });

    it('should remove favorite if present', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(['product-1']));

      const { result } = renderHook(() => useFavorites());

      act(() => {
        result.current.toggleFavorite('product-1');
      });

      expect(result.current.favorites).not.toContain('product-1');
    });
  });

  describe('isFavorite', () => {
    it('should return true for favorited product', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(['product-1']));

      const { result } = renderHook(() => useFavorites());

      expect(result.current.isFavorite('product-1')).toBe(true);
    });

    it('should return false for non-favorited product', () => {
      const { result } = renderHook(() => useFavorites());

      expect(result.current.isFavorite('product-1')).toBe(false);
    });
  });

  describe('Multiple Operations', () => {
    it('should handle multiple add/remove operations', () => {
      const { result } = renderHook(() => useFavorites());

      act(() => {
        result.current.addFavorite('product-1');
        result.current.addFavorite('product-2');
        result.current.addFavorite('product-3');
      });

      expect(result.current.favorites).toHaveLength(3);

      act(() => {
        result.current.removeFavorite('product-2');
      });

      expect(result.current.favorites).toEqual(['product-1', 'product-3']);
    });
  });
});

// Test without authenticated user
describe('useFavorites Hook - Unauthenticated', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('should not save favorites without user', async () => {
    // Re-mock useAuth to return null user
    vi.doMock('../../src/hooks/useAuth', () => ({
      useAuth: () => ({
        user: null
      })
    }));

    // Dynamically import to get fresh module with new mock
    const { useFavorites: useFavoritesNoAuth } = await import('../../src/hooks/useFavorites');
    
    const { result } = renderHook(() => useFavoritesNoAuth());

    act(() => {
      result.current.addFavorite('product-1');
    });

    // Favorites should be empty since no user
    expect(result.current.favorites).toEqual([]);
  });
});
