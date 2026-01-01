// ProductCard Component Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ProductCard } from '../../../src/components/ProductCard';

describe('ProductCard Component', () => {
  const mockProduct = {
    id: 'test-product-1',
    name: 'Chicken Adobo',
    description: 'Classic Filipino dish with rice',
    price: 65.0,
    image_url: 'https://example.com/adobo.jpg',
    available: true
  };

  const mockOnAddToCart = vi.fn();
  const mockOnToggleFavorite = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders product name', () => {
      render(<ProductCard {...mockProduct} onAddToCart={mockOnAddToCart} />);
      expect(screen.getByText('Chicken Adobo')).toBeInTheDocument();
    });

    it('renders product description', () => {
      render(<ProductCard {...mockProduct} onAddToCart={mockOnAddToCart} />);
      expect(screen.getByText('Classic Filipino dish with rice')).toBeInTheDocument();
    });

    it('renders product price with peso sign and 2 decimal places', () => {
      render(<ProductCard {...mockProduct} onAddToCart={mockOnAddToCart} />);
      expect(screen.getByText('₱65.00')).toBeInTheDocument();
    });

    it('renders product image with correct src', () => {
      render(<ProductCard {...mockProduct} onAddToCart={mockOnAddToCart} />);
      const image = screen.getByAltText('Chicken Adobo');
      expect(image).toHaveAttribute('src', 'https://example.com/adobo.jpg');
    });

    it('renders image with lazy loading', () => {
      render(<ProductCard {...mockProduct} onAddToCart={mockOnAddToCart} />);
      const image = screen.getByAltText('Chicken Adobo');
      expect(image).toHaveAttribute('loading', 'lazy');
    });

    it('renders Add button when available', () => {
      render(<ProductCard {...mockProduct} onAddToCart={mockOnAddToCart} />);
      expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    });
  });

  describe('Price Formatting', () => {
    it('formats whole number prices correctly', () => {
      render(<ProductCard {...mockProduct} price={100} onAddToCart={mockOnAddToCart} />);
      expect(screen.getByText('₱100.00')).toBeInTheDocument();
    });

    it('formats decimal prices correctly', () => {
      render(<ProductCard {...mockProduct} price={45.5} onAddToCart={mockOnAddToCart} />);
      expect(screen.getByText('₱45.50')).toBeInTheDocument();
    });

    it('formats small prices correctly', () => {
      render(<ProductCard {...mockProduct} price={5.99} onAddToCart={mockOnAddToCart} />);
      expect(screen.getByText('₱5.99')).toBeInTheDocument();
    });
  });

  describe('Add to Cart', () => {
    it('calls onAddToCart with product id when Add button clicked', () => {
      render(<ProductCard {...mockProduct} onAddToCart={mockOnAddToCart} />);

      const addButton = screen.getByRole('button', { name: 'Add' });
      fireEvent.click(addButton);

      expect(mockOnAddToCart).toHaveBeenCalledTimes(1);
      expect(mockOnAddToCart).toHaveBeenCalledWith('test-product-1');
    });

    it('does not call onAddToCart when product is unavailable', () => {
      render(
        <ProductCard {...mockProduct} available={false} onAddToCart={mockOnAddToCart} />
      );

      const button = screen.getByRole('button');
      fireEvent.click(button);

      expect(mockOnAddToCart).not.toHaveBeenCalled();
    });
  });

  describe('Unavailable Products', () => {
    it('shows "Out of Stock" text when unavailable', () => {
      render(
        <ProductCard {...mockProduct} available={false} onAddToCart={mockOnAddToCart} />
      );

      expect(screen.getByText('Out of Stock')).toBeInTheDocument();
    });

    it('disables button when unavailable', () => {
      render(
        <ProductCard {...mockProduct} available={false} onAddToCart={mockOnAddToCart} />
      );

      const button = screen.getByRole('button');
      expect(button).toBeDisabled();
    });

    it('applies disabled styles when unavailable', () => {
      render(
        <ProductCard {...mockProduct} available={false} onAddToCart={mockOnAddToCart} />
      );

      const button = screen.getByRole('button');
      expect(button).toHaveClass('disabled:bg-gray-300');
    });
  });

  describe('Favorites', () => {
    it('renders favorite button when onToggleFavorite is provided', () => {
      render(
        <ProductCard
          {...mockProduct}
          onAddToCart={mockOnAddToCart}
          onToggleFavorite={mockOnToggleFavorite}
          isFavorite={false}
        />
      );

      expect(screen.getByLabelText('Add to favorites')).toBeInTheDocument();
    });

    it('does not render favorite button when onToggleFavorite is not provided', () => {
      render(<ProductCard {...mockProduct} onAddToCart={mockOnAddToCart} />);

      expect(screen.queryByLabelText('Add to favorites')).not.toBeInTheDocument();
    });

    it('shows filled heart when isFavorite is true', () => {
      render(
        <ProductCard
          {...mockProduct}
          onAddToCart={mockOnAddToCart}
          onToggleFavorite={mockOnToggleFavorite}
          isFavorite={true}
        />
      );

      expect(screen.getByLabelText('Remove from favorites')).toBeInTheDocument();
    });

    it('calls onToggleFavorite when favorite button clicked', () => {
      render(
        <ProductCard
          {...mockProduct}
          onAddToCart={mockOnAddToCart}
          onToggleFavorite={mockOnToggleFavorite}
          isFavorite={false}
        />
      );

      const favoriteButton = screen.getByLabelText('Add to favorites');
      fireEvent.click(favoriteButton);

      expect(mockOnToggleFavorite).toHaveBeenCalledTimes(1);
    });

    it('does not trigger add to cart when clicking favorite button', () => {
      render(
        <ProductCard
          {...mockProduct}
          onAddToCart={mockOnAddToCart}
          onToggleFavorite={mockOnToggleFavorite}
          isFavorite={false}
        />
      );

      const favoriteButton = screen.getByLabelText('Add to favorites');
      fireEvent.click(favoriteButton);

      expect(mockOnAddToCart).not.toHaveBeenCalled();
    });
  });

  describe('Accessibility', () => {
    it('has accessible button labels', () => {
      render(<ProductCard {...mockProduct} onAddToCart={mockOnAddToCart} />);

      const addButton = screen.getByRole('button', { name: 'Add' });
      expect(addButton).toBeInTheDocument();
    });

    it('has accessible image alt text', () => {
      render(<ProductCard {...mockProduct} onAddToCart={mockOnAddToCart} />);

      const image = screen.getByRole('img');
      expect(image).toHaveAttribute('alt', 'Chicken Adobo');
    });
  });
});
