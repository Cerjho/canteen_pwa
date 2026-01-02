// ChildSelector Component Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ChildSelector } from '../../../src/components/StudentSelector';

describe('ChildSelector Component', () => {
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
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders label', () => {
      render(
        <ChildSelector
          children={mockChildren}
          selectedChildId={null}
          onSelect={mockOnSelect}
        />
      );

      expect(screen.getByText('Order for:')).toBeInTheDocument();
    });

    it('renders select dropdown', () => {
      render(
        <ChildSelector
          children={mockChildren}
          selectedChildId={null}
          onSelect={mockOnSelect}
        />
      );

      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('renders placeholder option', () => {
      render(
        <ChildSelector
          children={mockChildren}
          selectedChildId={null}
          onSelect={mockOnSelect}
        />
      );

      expect(screen.getByText('Select a student')).toBeInTheDocument();
    });

    it('renders all children options', () => {
      render(
        <ChildSelector
          children={mockChildren}
          selectedChildId={null}
          onSelect={mockOnSelect}
        />
      );

      expect(screen.getByText('Maria Santos - Grade 3 A')).toBeInTheDocument();
      expect(screen.getByText('Juan Santos - Grade 1 B')).toBeInTheDocument();
    });
  });

  describe('Selection', () => {
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

    it('can change selection', () => {
      const { rerender } = render(
        <ChildSelector
          children={mockChildren}
          selectedChildId="child-1"
          onSelect={mockOnSelect}
        />
      );

      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'child-2' } });

      expect(mockOnSelect).toHaveBeenCalledWith('child-2');

      // Simulate parent updating state
      rerender(
        <ChildSelector
          children={mockChildren}
          selectedChildId="child-2"
          onSelect={mockOnSelect}
        />
      );

      expect((select as HTMLSelectElement).value).toBe('child-2');
    });
  });

  describe('Empty State', () => {
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

    it('still renders select when no children', () => {
      render(
        <ChildSelector
          children={[]}
          selectedChildId={null}
          onSelect={mockOnSelect}
        />
      );

      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });
  });

  describe('Child Without Section', () => {
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

    it('does not show extra space when no section', () => {
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

      // Should not have trailing space or section letter
      const option = screen.getByText('Pedro Cruz - Grade 2');
      expect(option.textContent).toBe('Pedro Cruz - Grade 2');
    });
  });

  describe('Mixed Children', () => {
    it('handles mix of children with and without sections', () => {
      const mixedChildren = [
        {
          id: 'child-1',
          first_name: 'Maria',
          last_name: 'Santos',
          grade_level: 'Grade 3',
          section: 'A'
        },
        {
          id: 'child-2',
          first_name: 'Pedro',
          last_name: 'Cruz',
          grade_level: 'Grade 2'
          // No section
        }
      ];

      render(
        <ChildSelector
          children={mixedChildren}
          selectedChildId={null}
          onSelect={mockOnSelect}
        />
      );

      expect(screen.getByText('Maria Santos - Grade 3 A')).toBeInTheDocument();
      expect(screen.getByText('Pedro Cruz - Grade 2')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('has associated label', () => {
      render(
        <ChildSelector
          children={mockChildren}
          selectedChildId={null}
          onSelect={mockOnSelect}
        />
      );

      const label = screen.getByText('Order for:');
      expect(label.tagName).toBe('LABEL');
    });

    it('select is keyboard accessible', () => {
      render(
        <ChildSelector
          children={mockChildren}
          selectedChildId={null}
          onSelect={mockOnSelect}
        />
      );

      const select = screen.getByRole('combobox');
      select.focus();
      expect(document.activeElement).toBe(select);
    });
  });
});
