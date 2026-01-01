// OfflineIndicator Component Tests
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { OfflineIndicator } from '../../../src/components/OfflineIndicator';

describe('OfflineIndicator Component', () => {
  beforeEach(() => {
    // Default to online state
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      writable: true,
      configurable: true
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Online State', () => {
    it('does not render when online', () => {
      const { container } = render(<OfflineIndicator />);
      
      expect(container.firstChild).toBeNull();
    });

    it('returns null when online', () => {
      Object.defineProperty(navigator, 'onLine', { value: true });
      
      const { container } = render(<OfflineIndicator />);
      
      expect(container.firstChild).toBeNull();
    });
  });

  describe('Offline State', () => {
    it('renders when offline', () => {
      Object.defineProperty(navigator, 'onLine', { value: false });
      
      render(<OfflineIndicator />);
      
      expect(screen.getByText(/You're offline/i)).toBeInTheDocument();
    });

    it('shows offline message', () => {
      Object.defineProperty(navigator, 'onLine', { value: false });
      
      render(<OfflineIndicator />);
      
      expect(screen.getByText(/Orders will sync when connected/i)).toBeInTheDocument();
    });

    it('shows wifi-off icon', () => {
      Object.defineProperty(navigator, 'onLine', { value: false });
      
      const { container } = render(<OfflineIndicator />);
      
      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });
  });

  describe('State Transitions', () => {
    it('shows indicator when going offline', () => {
      render(<OfflineIndicator />);
      
      // Initially online - should not show
      expect(screen.queryByText(/You're offline/i)).not.toBeInTheDocument();
      
      // Simulate going offline
      Object.defineProperty(navigator, 'onLine', { value: false });
      act(() => {
        window.dispatchEvent(new Event('offline'));
      });
      
      expect(screen.getByText(/You're offline/i)).toBeInTheDocument();
    });

    it('hides indicator when going online', () => {
      Object.defineProperty(navigator, 'onLine', { value: false });
      
      render(<OfflineIndicator />);
      
      // Initially offline - should show
      expect(screen.getByText(/You're offline/i)).toBeInTheDocument();
      
      // Simulate going online
      Object.defineProperty(navigator, 'onLine', { value: true });
      act(() => {
        window.dispatchEvent(new Event('online'));
      });
      
      expect(screen.queryByText(/You're offline/i)).not.toBeInTheDocument();
    });

    it('handles multiple state changes', () => {
      render(<OfflineIndicator />);
      
      // Go offline
      Object.defineProperty(navigator, 'onLine', { value: false });
      act(() => {
        window.dispatchEvent(new Event('offline'));
      });
      expect(screen.getByText(/You're offline/i)).toBeInTheDocument();
      
      // Go online
      Object.defineProperty(navigator, 'onLine', { value: true });
      act(() => {
        window.dispatchEvent(new Event('online'));
      });
      expect(screen.queryByText(/You're offline/i)).not.toBeInTheDocument();
      
      // Go offline again
      Object.defineProperty(navigator, 'onLine', { value: false });
      act(() => {
        window.dispatchEvent(new Event('offline'));
      });
      expect(screen.getByText(/You're offline/i)).toBeInTheDocument();
    });
  });

  describe('Styling', () => {
    it('is positioned at top', () => {
      Object.defineProperty(navigator, 'onLine', { value: false });
      
      const { container } = render(<OfflineIndicator />);
      
      const indicator = container.firstChild;
      expect(indicator).toHaveClass('fixed', 'top-0', 'left-0', 'right-0');
    });

    it('has warning background color', () => {
      Object.defineProperty(navigator, 'onLine', { value: false });
      
      const { container } = render(<OfflineIndicator />);
      
      const indicator = container.firstChild;
      expect(indicator).toHaveClass('bg-amber-500');
    });

    it('has high z-index', () => {
      Object.defineProperty(navigator, 'onLine', { value: false });
      
      const { container } = render(<OfflineIndicator />);
      
      const indicator = container.firstChild;
      expect(indicator).toHaveClass('z-50');
    });

    it('has white text', () => {
      Object.defineProperty(navigator, 'onLine', { value: false });
      
      const { container } = render(<OfflineIndicator />);
      
      const indicator = container.firstChild;
      expect(indicator).toHaveClass('text-white');
    });

    it('centers content', () => {
      Object.defineProperty(navigator, 'onLine', { value: false });
      
      const { container } = render(<OfflineIndicator />);
      
      const indicator = container.firstChild;
      expect(indicator).toHaveClass('flex', 'items-center', 'justify-center');
    });
  });

  describe('Cleanup', () => {
    it('removes event listeners on unmount', () => {
      const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
      
      const { unmount } = render(<OfflineIndicator />);
      
      expect(addEventListenerSpy).toHaveBeenCalledWith('online', expect.any(Function));
      expect(addEventListenerSpy).toHaveBeenCalledWith('offline', expect.any(Function));
      
      unmount();
      
      expect(removeEventListenerSpy).toHaveBeenCalledWith('online', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('offline', expect.any(Function));
    });
  });
});
