// Unit Tests for School Canteen PWA
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ProductCard } from '../../src/components/ProductCard';
import { ChildSelector } from '../../src/components/StudentSelector';

// Mock Supabase client
vi.mock('../../src/services/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } }))
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null })
    }))
  }
}));

// ============================================
// ProductCard Tests
// ============================================
describe('ProductCard', () => {
  const mockProduct = {
    id: 'test-product-1',
    name: 'Chicken Adobo',
    description: 'Classic Filipino dish with rice',
    price: 65.0,
    image_url: 'https://placehold.co/400x300?text=Adobo',
    available: true
  };

  const mockOnAddToCart = vi.fn();

  beforeEach(() => {
    mockOnAddToCart.mockClear();
  });

  it('renders product information correctly', () => {
    render(<ProductCard {...mockProduct} onAddToCart={mockOnAddToCart} />);

    expect(screen.getByText('Chicken Adobo')).toBeInTheDocument();
    expect(screen.getByText('Classic Filipino dish with rice')).toBeInTheDocument();
    expect(screen.getByText('₱65.00')).toBeInTheDocument();
  });

  it('renders product image with correct attributes', () => {
    render(<ProductCard {...mockProduct} onAddToCart={mockOnAddToCart} />);

    const image = screen.getByAltText('Chicken Adobo');
    expect(image).toHaveAttribute('src', 'https://placehold.co/400x300?text=Adobo');
    expect(image).toHaveAttribute('loading', 'lazy');
  });

  it('calls onAddToCart with product id when Add button clicked', () => {
    render(<ProductCard {...mockProduct} onAddToCart={mockOnAddToCart} />);

    const addButton = screen.getByRole('button', { name: 'Add' });
    fireEvent.click(addButton);

    expect(mockOnAddToCart).toHaveBeenCalledTimes(1);
    expect(mockOnAddToCart).toHaveBeenCalledWith('test-product-1');
  });

  it('shows "Out of Stock" when product is not available', () => {
    render(
      <ProductCard {...mockProduct} available={false} onAddToCart={mockOnAddToCart} />
    );

    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('Out of Stock');
    expect(button).toBeDisabled();
  });

  it('disables button when product is unavailable', () => {
    render(
      <ProductCard {...mockProduct} available={false} onAddToCart={mockOnAddToCart} />
    );

    const button = screen.getByRole('button');
    fireEvent.click(button);

    expect(mockOnAddToCart).not.toHaveBeenCalled();
  });

  it('formats price with peso sign and 2 decimal places', () => {
    render(
      <ProductCard {...mockProduct} price={45.5} onAddToCart={mockOnAddToCart} />
    );

    expect(screen.getByText('₱45.50')).toBeInTheDocument();
  });
});

// ============================================
// ChildSelector Tests
// ============================================
describe('ChildSelector', () => {
  const mockChildren = [
    {
      id: 'child-1',
      first_name: 'Maria',
      last_name: 'Santos',
      grade_level: 'Grade 3',
      section: 'A'
    },
    {
      id: 'child-2',
      first_name: 'Juan',
      last_name: 'Santos',
      grade_level: 'Grade 1',
      section: 'B'
    }
  ];

  const mockOnSelect = vi.fn();

  beforeEach(() => {
    mockOnSelect.mockClear();
  });

  it('renders select dropdown with label', () => {
    render(
      <ChildSelector
        children={mockChildren}
        selectedChildId={null}
        onSelect={mockOnSelect}
      />
    );

    expect(screen.getByText('Order for:')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('renders all children options', () => {
    render(
      <ChildSelector
        children={mockChildren}
        selectedChildId={null}
        onSelect={mockOnSelect}
      />
    );

    expect(screen.getByText('Select a student')).toBeInTheDocument();
    expect(screen.getByText('Maria Santos - Grade 3 A')).toBeInTheDocument();
    expect(screen.getByText('Juan Santos - Grade 1 B')).toBeInTheDocument();
  });

  it('calls onSelect when child is selected', () => {
    render(
      <ChildSelector
        children={mockChildren}
        selectedChildId={null}
        onSelect={mockOnSelect}
      />
    );

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'child-1' } });

    expect(mockOnSelect).toHaveBeenCalledWith('child-1');
  });

  it('shows selected child', () => {
    render(
      <ChildSelector
        children={mockChildren}
        selectedChildId="child-2"
        onSelect={mockOnSelect}
      />
    );

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('child-2');
  });

  it('shows message when no children exist', () => {
    render(
      <ChildSelector
        children={[]}
        selectedChildId={null}
        onSelect={mockOnSelect}
      />
    );

    expect(
      screen.getByText("You haven't linked any students yet. Please link a student profile first.")
    ).toBeInTheDocument();
  });

  it('handles child without section', () => {
    const childrenWithoutSection = [
      {
        id: 'child-3',
        first_name: 'Pedro',
        last_name: 'Cruz',
        grade_level: 'Grade 2'
      }
    ];

    render(
      <ChildSelector
        children={childrenWithoutSection}
        selectedChildId={null}
        onSelect={mockOnSelect}
      />
    );

    expect(screen.getByText('Pedro Cruz - Grade 2')).toBeInTheDocument();
  });
});

// ============================================
// Utility Function Tests
// ============================================
describe('Price Formatting', () => {
  it('formats whole numbers correctly', () => {
    const price = 100;
    expect(price.toFixed(2)).toBe('100.00');
  });

  it('formats decimal prices correctly', () => {
    const price = 45.5;
    expect(price.toFixed(2)).toBe('45.50');
  });

  it('handles small prices', () => {
    const price = 10;
    expect(price.toFixed(2)).toBe('10.00');
  });
});

// ============================================
// Cart Logic Tests
// ============================================
describe('Cart Calculations', () => {
  it('calculates total correctly', () => {
    const items = [
      { product_id: '1', price: 65, quantity: 2 },
      { product_id: '2', price: 25, quantity: 3 }
    ];

    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    expect(total).toBe(205); // (65*2) + (25*3)
  });

  it('handles empty cart', () => {
    const items: { product_id: string; price: number; quantity: number }[] = [];
    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    expect(total).toBe(0);
  });
});
