// EmptyState Component Tests
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { EmptyState } from '../../../src/components/EmptyState';
import { Package, ShoppingCart } from 'lucide-react';

describe('EmptyState Component', () => {
  describe('Rendering', () => {
    it('renders title', () => {
      render(
        <EmptyState
          icon={Package}
          title="No items found"
          description="Your cart is empty"
        />
      );

      expect(screen.getByText('No items found')).toBeInTheDocument();
    });

    it('renders description', () => {
      render(
        <EmptyState
          icon={Package}
          title="No items found"
          description="Your cart is empty. Add some items to get started."
        />
      );

      expect(screen.getByText('Your cart is empty. Add some items to get started.')).toBeInTheDocument();
    });
  });

  describe('Icon Handling', () => {
    it('renders Lucide icon component', () => {
      const { container } = render(
        <EmptyState
          icon={Package}
          title="No items"
          description="Description"
        />
      );

      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    it('renders React element icon', () => {
      render(
        <EmptyState
          icon={<ShoppingCart size={48} data-testid="cart-icon" />}
          title="Empty cart"
          description="Description"
        />
      );

      expect(screen.getByTestId('cart-icon')).toBeInTheDocument();
    });

    it('renders icon with correct size for component icons', () => {
      const { container } = render(
        <EmptyState
          icon={Package}
          title="No items"
          description="Description"
        />
      );

      const svg = container.querySelector('svg');
      // Lucide icons use width/height attributes
      expect(svg).toHaveAttribute('width', '48');
      expect(svg).toHaveAttribute('height', '48');
    });
  });

  describe('Action', () => {
    it('renders action button when provided', () => {
      render(
        <EmptyState
          icon={Package}
          title="No items"
          description="Description"
          action={<button>Add Item</button>}
        />
      );

      expect(screen.getByRole('button', { name: 'Add Item' })).toBeInTheDocument();
    });

    it('does not render action when not provided', () => {
      render(
        <EmptyState
          icon={Package}
          title="No items"
          description="Description"
        />
      );

      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('renders complex action elements', () => {
      render(
        <EmptyState
          icon={Package}
          title="No items"
          description="Description"
          action={
            <div>
              <button>Primary Action</button>
              <button>Secondary Action</button>
            </div>
          }
        />
      );

      expect(screen.getByRole('button', { name: 'Primary Action' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Secondary Action' })).toBeInTheDocument();
    });
  });

  describe('Styling', () => {
    it('is centered', () => {
      const { container } = render(
        <EmptyState
          icon={Package}
          title="No items"
          description="Description"
        />
      );

      const wrapper = container.firstChild;
      expect(wrapper).toHaveClass('text-center');
    });

    it('has vertical padding', () => {
      const { container } = render(
        <EmptyState
          icon={Package}
          title="No items"
          description="Description"
        />
      );

      const wrapper = container.firstChild;
      expect(wrapper).toHaveClass('py-12');
    });

    it('title has proper styling', () => {
      render(
        <EmptyState
          icon={Package}
          title="No items"
          description="Description"
        />
      );

      const title = screen.getByText('No items');
      expect(title).toHaveClass('text-lg', 'font-medium');
    });

    it('description has proper styling', () => {
      render(
        <EmptyState
          icon={Package}
          title="No items"
          description="Description"
        />
      );

      const description = screen.getByText('Description');
      expect(description).toHaveClass('text-gray-600');
    });

    it('icon container has gray color', () => {
      const { container } = render(
        <EmptyState
          icon={Package}
          title="No items"
          description="Description"
        />
      );

      const iconContainer = container.querySelector('.text-gray-400');
      expect(iconContainer).toBeInTheDocument();
    });
  });

  describe('Content Layout', () => {
    it('renders elements in correct order', () => {
      const { container } = render(
        <EmptyState
          icon={Package}
          title="No items"
          description="Description"
          action={<button>Action</button>}
        />
      );

      const children = container.firstChild?.childNodes;
      
      // Icon should come first
      expect(children?.[0]).toHaveClass('text-gray-400');
      
      // Then title (h3)
      expect(children?.[1].textContent).toBe('No items');
      
      // Then description (p)
      expect(children?.[2].textContent).toBe('Description');
      
      // Then action container (div)
      expect(children?.[3]).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('title uses h3 heading', () => {
      render(
        <EmptyState
          icon={Package}
          title="No items"
          description="Description"
        />
      );

      const title = screen.getByRole('heading', { level: 3 });
      expect(title).toHaveTextContent('No items');
    });
  });
});
