// SearchBar Component Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SearchBar } from '../../../src/components/SearchBar';

describe('SearchBar Component', () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders input field', () => {
      render(<SearchBar value="" onChange={mockOnChange} />);

      // type="search" input, query by placeholder
      expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
    });

    it('renders with default placeholder', () => {
      render(<SearchBar value="" onChange={mockOnChange} />);

      expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
    });

    it('renders with custom placeholder', () => {
      render(
        <SearchBar value="" onChange={mockOnChange} placeholder="Search menu..." />
      );

      expect(screen.getByPlaceholderText('Search menu...')).toBeInTheDocument();
    });

    it('renders search icon', () => {
      const { container } = render(<SearchBar value="" onChange={mockOnChange} />);

      // Lucide icons render as SVG
      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });
  });

  describe('Value', () => {
    it('displays current value', () => {
      render(<SearchBar value="chicken" onChange={mockOnChange} placeholder="Search..." />);

      const input = screen.getByPlaceholderText('Search...') as HTMLInputElement;
      expect(input.value).toBe('chicken');
    });

    it('calls onChange when typing', () => {
      render(<SearchBar value="" onChange={mockOnChange} />);

      const input = screen.getByPlaceholderText('Search...');
      fireEvent.change(input, { target: { value: 'adobo' } });

      expect(mockOnChange).toHaveBeenCalledWith('adobo');
    });

    it('handles empty value', () => {
      render(<SearchBar value="" onChange={mockOnChange} />);

      const input = screen.getByPlaceholderText('Search...') as HTMLInputElement;
      expect(input.value).toBe('');
    });
  });

  describe('Clear Button', () => {
    it('does not show clear button when value is empty', () => {
      render(<SearchBar value="" onChange={mockOnChange} />);

      // The clear button should not exist
      const buttons = screen.queryAllByRole('button');
      expect(buttons).toHaveLength(0);
    });

    it('shows clear button when value exists', () => {
      render(<SearchBar value="chicken" onChange={mockOnChange} />);

      const clearButton = screen.getByRole('button');
      expect(clearButton).toBeInTheDocument();
    });

    it('clears value when clear button is clicked', () => {
      render(<SearchBar value="chicken" onChange={mockOnChange} />);

      const clearButton = screen.getByRole('button');
      fireEvent.click(clearButton);

      expect(mockOnChange).toHaveBeenCalledWith('');
    });
  });

  describe('User Interaction', () => {
    it('can focus input', () => {
      render(<SearchBar value="" onChange={mockOnChange} />);

      const input = screen.getByRole('searchbox');
      input.focus();

      expect(document.activeElement).toBe(input);
    });

    it('handles rapid typing', () => {
      render(<SearchBar value="" onChange={mockOnChange} />);

      const input = screen.getByRole('searchbox');
      
      fireEvent.change(input, { target: { value: 'a' } });
      fireEvent.change(input, { target: { value: 'ad' } });
      fireEvent.change(input, { target: { value: 'ado' } });
      fireEvent.change(input, { target: { value: 'adob' } });
      fireEvent.change(input, { target: { value: 'adobo' } });

      expect(mockOnChange).toHaveBeenCalledTimes(5);
      expect(mockOnChange).toHaveBeenLastCalledWith('adobo');
    });
  });

  describe('Styling', () => {
    it('applies appropriate classes for padding', () => {
      render(<SearchBar value="" onChange={mockOnChange} />);

      const input = screen.getByRole('searchbox');
      expect(input).toHaveClass('pl-10'); // Left padding for search icon
    });

    it('applies focus styles', () => {
      render(<SearchBar value="" onChange={mockOnChange} />);

      const input = screen.getByRole('searchbox');
      expect(input).toHaveClass('focus:ring-2');
    });
  });

  describe('Accessibility', () => {
    it('input is accessible by role', () => {
      render(<SearchBar value="" onChange={mockOnChange} />);

      expect(screen.getByRole('searchbox')).toBeInTheDocument();
    });

    it('is keyboard navigable', () => {
      render(<SearchBar value="test" onChange={mockOnChange} />);

      const input = screen.getByRole('searchbox');
      input.focus();
      
      // Tab to clear button
      fireEvent.keyDown(input, { key: 'Tab' });
      
      // Input should still be focusable
      expect(input).toBeVisible();
    });
  });
});
