// Toast Component Tests
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ToastProvider, useToast } from '../../../src/components/Toast';

// Test component to access useToast
function TestComponent() {
  const { showToast } = useToast();
  
  return (
    <div>
      <button onClick={() => showToast('Success message', 'success')}>Show Success</button>
      <button onClick={() => showToast('Error message', 'error')}>Show Error</button>
      <button onClick={() => showToast('Info message', 'info')}>Show Info</button>
      <button onClick={() => showToast('Default message')}>Show Default</button>
    </div>
  );
}

describe('Toast Component', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('ToastProvider', () => {
    it('renders children', () => {
      render(
        <ToastProvider>
          <div>Child content</div>
        </ToastProvider>
      );

      expect(screen.getByText('Child content')).toBeInTheDocument();
    });
  });

  describe('useToast Hook', () => {
    it('throws error when used outside provider', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      expect(() => {
        render(<TestComponent />);
      }).toThrow('useToast must be used within ToastProvider');
      
      consoleError.mockRestore();
    });

    it('provides showToast function', () => {
      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      expect(screen.getByRole('button', { name: 'Show Success' })).toBeInTheDocument();
    });
  });

  describe('Showing Toasts', () => {
    it('shows success toast', () => {
      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Show Success' }));

      expect(screen.getByText('Success message')).toBeInTheDocument();
    });

    it('shows error toast', () => {
      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Show Error' }));

      expect(screen.getByText('Error message')).toBeInTheDocument();
    });

    it('shows info toast', () => {
      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Show Info' }));

      expect(screen.getByText('Info message')).toBeInTheDocument();
    });

    it('shows default (info) toast', () => {
      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Show Default' }));

      expect(screen.getByText('Default message')).toBeInTheDocument();
    });
  });

  describe('Toast Styling', () => {
    it('applies success styling', () => {
      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Show Success' }));

      const toast = screen.getByText('Success message').closest('div');
      expect(toast).toHaveClass('bg-green-50', 'border-green-200');
    });

    it('applies error styling', () => {
      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Show Error' }));

      const toast = screen.getByText('Error message').closest('div');
      expect(toast).toHaveClass('bg-red-50', 'border-red-200');
    });

    it('applies info styling', () => {
      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Show Info' }));

      const toast = screen.getByText('Info message').closest('div');
      expect(toast).toHaveClass('bg-blue-50', 'border-blue-200');
    });
  });

  describe('Toast Icons', () => {
    it('shows success icon (checkmark)', () => {
      const { container } = render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Show Success' }));

      // Lucide CheckCircle icon should render
      const svg = container.querySelector('.text-green-500');
      expect(svg).toBeInTheDocument();
    });

    it('shows error icon', () => {
      const { container } = render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Show Error' }));

      const svg = container.querySelector('.text-red-500');
      expect(svg).toBeInTheDocument();
    });

    it('shows info icon', () => {
      const { container } = render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Show Info' }));

      const svg = container.querySelector('.text-blue-500');
      expect(svg).toBeInTheDocument();
    });
  });

  describe('Dismissing Toasts', () => {
    it('can dismiss toast by clicking X button', async () => {
      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Show Success' }));
      expect(screen.getByText('Success message')).toBeInTheDocument();

      // Find the toast container and the dismiss button inside it
      // The dismiss button has an X icon inside, it's a button without text
      const toastElement = screen.getByText('Success message').closest('div');
      const dismissButton = toastElement?.querySelector('button');
      
      if (dismissButton) {
        fireEvent.click(dismissButton);
      }

      // Toast should be removed immediately after clicking dismiss
      expect(screen.queryByText('Success message')).not.toBeInTheDocument();
    });

    it('auto-dismisses after 4 seconds', async () => {
      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Show Success' }));
      expect(screen.getByText('Success message')).toBeInTheDocument();

      // Fast-forward time by 4 seconds
      act(() => {
        vi.advanceTimersByTime(4000);
      });

      expect(screen.queryByText('Success message')).not.toBeInTheDocument();
    });

    it('does not dismiss before 4 seconds', () => {
      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Show Success' }));

      // Fast-forward time by 3 seconds
      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(screen.getByText('Success message')).toBeInTheDocument();
    });
  });

  describe('Multiple Toasts', () => {
    it('can show multiple toasts', () => {
      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Show Success' }));
      fireEvent.click(screen.getByRole('button', { name: 'Show Error' }));

      expect(screen.getByText('Success message')).toBeInTheDocument();
      expect(screen.getByText('Error message')).toBeInTheDocument();
    });

    it('dismisses toasts independently', () => {
      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Show Success' }));
      
      act(() => {
        vi.advanceTimersByTime(2000);
      });

      fireEvent.click(screen.getByRole('button', { name: 'Show Error' }));

      act(() => {
        vi.advanceTimersByTime(2000);
      });

      // Success toast should be gone (4 seconds passed)
      expect(screen.queryByText('Success message')).not.toBeInTheDocument();
      // Error toast should still be visible (only 2 seconds passed)
      expect(screen.getByText('Error message')).toBeInTheDocument();
    });
  });

  describe('Toast Container', () => {
    it('renders in fixed position', () => {
      const { container } = render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Show Success' }));

      const toastContainer = container.querySelector('.fixed.top-4.right-4');
      expect(toastContainer).toBeInTheDocument();
    });

    it('has high z-index', () => {
      const { container } = render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Show Success' }));

      const toastContainer = container.querySelector('.z-50');
      expect(toastContainer).toBeInTheDocument();
    });
  });
});
