import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WeeklyCartSummary } from '../../../src/components/WeeklyCartSummary';
import type { CartItem } from '../../../src/hooks/useCart';
import { format, addDays } from 'date-fns';

// Helper to create cart items
function createCartItem(overrides: Partial<CartItem> = {}): CartItem {
  const baseItem: CartItem = {
    id: 'item-1',
    product_id: 'prod-1',
    student_id: 'student-1',
    student_name: 'John Doe',
    name: 'Burger',
    price: 50,
    image_url: 'https://example.com/burger.jpg',
    quantity: 1,
    scheduled_for: format(new Date(), 'yyyy-MM-dd')
  };
  return { ...baseItem, ...overrides };
}

describe('WeeklyCartSummary', () => {
  beforeEach(() => {
    // Mock to a Monday for consistent testing
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-27T10:00:00')); // Monday
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Rendering', () => {
    it('renders nothing when cart is empty', () => {
      const { container } = render(
        <WeeklyCartSummary items={[]} />
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders weekly cart header when items exist', () => {
      const items = [createCartItem()];
      render(<WeeklyCartSummary items={items} />);
      
      expect(screen.getByText('Weekly Cart')).toBeInTheDocument();
    });

    it('renders View Cart button when onViewCart provided', () => {
      const items = [createCartItem()];
      const onViewCart = vi.fn();
      
      render(<WeeklyCartSummary items={items} onViewCart={onViewCart} />);
      
      expect(screen.getByText('View Cart')).toBeInTheDocument();
    });

    it('renders day pills for specified number of days', () => {
      const items = [createCartItem()];
      render(<WeeklyCartSummary items={items} daysToShow={5} />);
      
      // Should show 5 day pills (Today, Tue, Wed, Thu, Fri for Monday start)
      expect(screen.getByText('Today')).toBeInTheDocument();
      expect(screen.getByText('Tue')).toBeInTheDocument();
      expect(screen.getByText('Wed')).toBeInTheDocument();
      expect(screen.getByText('Thu')).toBeInTheDocument();
      expect(screen.getByText('Fri')).toBeInTheDocument();
    });

    it('shows date numbers on day pills', () => {
      const items = [createCartItem()];
      render(<WeeklyCartSummary items={items} daysToShow={3} />);
      
      // Mon Jan 27 should show "27"
      expect(screen.getByText('27')).toBeInTheDocument();
      // Tue Jan 28 should show "28"
      expect(screen.getByText('28')).toBeInTheDocument();
      // Wed Jan 29 should show "29"
      expect(screen.getByText('29')).toBeInTheDocument();
    });
  });

  describe('Item Counts', () => {
    it('shows item count for day with items', () => {
      const items = [
        createCartItem({ id: '1', quantity: 2 }),
        createCartItem({ id: '2', quantity: 3 })
      ];
      render(<WeeklyCartSummary items={items} />);
      
      // 2 + 3 = 5 items for today
      expect(screen.getByText('5 items')).toBeInTheDocument();
    });

    it('shows singular "item" for single item', () => {
      const items = [createCartItem({ quantity: 1 })];
      render(<WeeklyCartSummary items={items} />);
      
      expect(screen.getByText('1 item')).toBeInTheDocument();
    });

    it('shows items distributed across multiple days', () => {
      const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');
      const items = [
        createCartItem({ id: '1', quantity: 2 }), // Today
        createCartItem({ id: '2', scheduled_for: tomorrow, quantity: 1 }) // Tomorrow
      ];
      render(<WeeklyCartSummary items={items} />);
      
      expect(screen.getByText('2 items')).toBeInTheDocument();
      expect(screen.getByText('1 item')).toBeInTheDocument();
    });
  });

  describe('Totals', () => {
    it('shows total amount for day', () => {
      const items = [
        createCartItem({ id: '1', price: 50, quantity: 2 }), // 100
        createCartItem({ id: '2', price: 30, quantity: 1 })  // 30
      ];
      render(<WeeklyCartSummary items={items} />);
      
      // Day total shown on day pill - today button contains ₱130
      const todayButton = screen.getByText('Today').closest('button');
      expect(todayButton?.textContent).toContain('₱');
      expect(todayButton?.textContent).toContain('130');
    });

    it('shows overall total in summary row', () => {
      const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');
      const items = [
        createCartItem({ id: '1', price: 50, quantity: 2 }), // 100 today
        createCartItem({ id: '2', price: 30, quantity: 1, scheduled_for: tomorrow })  // 30 tomorrow
      ];
      render(<WeeklyCartSummary items={items} />);
      
      // Overall total: ₱130.00
      expect(screen.getByText('₱130.00')).toBeInTheDocument();
    });

    it('shows total item count in summary', () => {
      const items = [
        createCartItem({ id: '1', quantity: 2 }),
        createCartItem({ id: '2', quantity: 3 })
      ];
      render(<WeeklyCartSummary items={items} />);
      
      // Should show summary total at the bottom (5 items * 50 = 250)
      expect(screen.getByText('₱250.00')).toBeInTheDocument();
    });

    it('shows day count when multiple days', () => {
      const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');
      const dayAfter = format(addDays(new Date(), 2), 'yyyy-MM-dd');
      const items = [
        createCartItem({ id: '1', scheduled_for: format(new Date(), 'yyyy-MM-dd') }),
        createCartItem({ id: '2', scheduled_for: tomorrow }),
        createCartItem({ id: '3', scheduled_for: dayAfter })
      ];
      const { container } = render(<WeeklyCartSummary items={items} />);
      
      // Should mention days in summary - check the summary row div
      const summaryDiv = container.querySelector('.border-t');
      expect(summaryDiv?.textContent).toContain('days');
    });

    it('shows student count when multiple students', () => {
      const items = [
        createCartItem({ id: '1', student_id: 'student-1', student_name: 'John' }),
        createCartItem({ id: '2', student_id: 'student-2', student_name: 'Jane' })
      ];
      const { container } = render(<WeeklyCartSummary items={items} />);
      
      // Should mention students in summary - check the summary row div
      const summaryDiv = container.querySelector('.border-t');
      expect(summaryDiv?.textContent).toContain('students');
    });
  });

  describe('Interactions', () => {
    it('calls onDateClick when day pill clicked', () => {
      const onDateClick = vi.fn();
      const items = [createCartItem()];
      
      render(
        <WeeklyCartSummary 
          items={items} 
          onDateClick={onDateClick} 
        />
      );
      
      // Click on Tuesday
      fireEvent.click(screen.getByText('Tue'));
      
      expect(onDateClick).toHaveBeenCalledWith('2025-01-28');
    });

    it('calls onViewCart when View Cart clicked', () => {
      const onViewCart = vi.fn();
      const items = [createCartItem()];
      
      render(
        <WeeklyCartSummary 
          items={items} 
          onViewCart={onViewCart} 
        />
      );
      
      fireEvent.click(screen.getByText('View Cart'));
      
      expect(onViewCart).toHaveBeenCalled();
    });

    it('clicking day with items highlights that date', () => {
      const onDateClick = vi.fn();
      const today = format(new Date(), 'yyyy-MM-dd');
      const items = [createCartItem({ scheduled_for: today })];
      
      render(
        <WeeklyCartSummary 
          items={items} 
          onDateClick={onDateClick} 
        />
      );
      
      // Today button should be clickable
      const todayButton = screen.getByText('Today').closest('button');
      expect(todayButton).toBeInTheDocument();
      
      if (todayButton) {
        fireEvent.click(todayButton);
      }
      expect(onDateClick).toHaveBeenCalledWith(today);
    });
  });

  describe('Visual States', () => {
    it('applies different styles for today with items', () => {
      const today = format(new Date(), 'yyyy-MM-dd');
      const items = [createCartItem({ scheduled_for: today })];
      
      render(<WeeklyCartSummary items={items} />);
      
      const todayButton = screen.getByText('Today').closest('button');
      expect(todayButton).toHaveClass('bg-green-100');
    });

    it('applies different styles for other days with items', () => {
      const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');
      const items = [createCartItem({ scheduled_for: tomorrow })];
      
      render(<WeeklyCartSummary items={items} />);
      
      const tomorrowButton = screen.getByText('Tue').closest('button');
      expect(tomorrowButton).toHaveClass('bg-primary-100');
    });

    it('applies muted styles for days without items', () => {
      const items = [createCartItem()]; // Only today has items
      
      render(<WeeklyCartSummary items={items} />);
      
      // Wednesday should have muted styling (no items)
      const wedButton = screen.getByText('Wed').closest('button');
      expect(wedButton).toHaveClass('bg-gray-50');
    });
  });

  describe('Edge Cases', () => {
    it('handles Saturday (potential makeup day)', () => {
      // Set to Friday
      vi.setSystemTime(new Date('2025-01-31T10:00:00')); // Friday
      
      const saturday = '2025-02-01';
      const items = [createCartItem({ scheduled_for: saturday })];
      
      render(<WeeklyCartSummary items={items} daysToShow={2} />);
      
      // Should show Sat as it's a potential makeup day
      expect(screen.getByText('Sat')).toBeInTheDocument();
    });

    it('skips Sundays in day display', () => {
      // Set to Saturday
      vi.setSystemTime(new Date('2025-02-01T10:00:00')); // Saturday
      
      const items = [createCartItem()];
      
      render(<WeeklyCartSummary items={items} daysToShow={3} />);
      
      // Should skip Sunday and show Mon
      expect(screen.queryByText('Sun')).not.toBeInTheDocument();
      expect(screen.getByText('Mon')).toBeInTheDocument();
    });

    it('handles items for dates beyond display range', () => {
      const farFuture = format(addDays(new Date(), 10), 'yyyy-MM-dd');
      const items = [
        createCartItem({ id: '1' }), // Today
        createCartItem({ id: '2', scheduled_for: farFuture }) // Beyond 5 days
      ];
      
      render(<WeeklyCartSummary items={items} daysToShow={5} />);
      
      // Summary should still show all items
      expect(screen.getByText('₱100.00')).toBeInTheDocument(); // Total for both
    });

    it('handles large quantities', () => {
      const items = [createCartItem({ quantity: 99 })];
      
      render(<WeeklyCartSummary items={items} />);
      
      expect(screen.getByText('99 items')).toBeInTheDocument();
    });

    it('handles decimal prices correctly', () => {
      const items = [createCartItem({ price: 49.99, quantity: 2 })];
      
      render(<WeeklyCartSummary items={items} />);
      
      // Should show formatted total
      expect(screen.getByText('₱99.98')).toBeInTheDocument();
    });
  });
});
