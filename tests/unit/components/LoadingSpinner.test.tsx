// LoadingSpinner Component Tests
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { LoadingSpinner } from '../../../src/components/LoadingSpinner';

describe('LoadingSpinner Component', () => {
  describe('Rendering', () => {
    it('renders spinner element', () => {
      render(<LoadingSpinner />);

      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('has loading aria-label', () => {
      render(<LoadingSpinner />);

      expect(screen.getByLabelText('Loading')).toBeInTheDocument();
    });
  });

  describe('Size Variants', () => {
    it('renders small size', () => {
      const { container } = render(<LoadingSpinner size="sm" />);

      const spinner = container.querySelector('[role="status"]');
      expect(spinner).toHaveClass('w-4', 'h-4', 'border-2');
    });

    it('renders medium size by default', () => {
      const { container } = render(<LoadingSpinner />);

      const spinner = container.querySelector('[role="status"]');
      expect(spinner).toHaveClass('w-8', 'h-8', 'border-4');
    });

    it('renders large size', () => {
      const { container } = render(<LoadingSpinner size="lg" />);

      const spinner = container.querySelector('[role="status"]');
      expect(spinner).toHaveClass('w-12', 'h-12', 'border-4');
    });
  });

  describe('Styling', () => {
    it('has animation class', () => {
      const { container } = render(<LoadingSpinner />);

      const spinner = container.querySelector('[role="status"]');
      expect(spinner).toHaveClass('animate-spin');
    });

    it('has rounded class', () => {
      const { container } = render(<LoadingSpinner />);

      const spinner = container.querySelector('[role="status"]');
      expect(spinner).toHaveClass('rounded-full');
    });

    it('has proper border colors', () => {
      const { container } = render(<LoadingSpinner />);

      const spinner = container.querySelector('[role="status"]');
      expect(spinner).toHaveClass('border-gray-200', 'border-t-primary-600');
    });
  });

  describe('Container', () => {
    it('is centered in container', () => {
      const { container } = render(<LoadingSpinner />);

      const wrapper = container.firstChild;
      expect(wrapper).toHaveClass('flex', 'items-center', 'justify-center');
    });

    it('has padding', () => {
      const { container } = render(<LoadingSpinner />);

      const wrapper = container.firstChild;
      expect(wrapper).toHaveClass('p-4');
    });
  });

  describe('Accessibility', () => {
    it('has status role for screen readers', () => {
      render(<LoadingSpinner />);

      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('is announced to screen readers', () => {
      render(<LoadingSpinner />);

      const spinner = screen.getByRole('status');
      expect(spinner).toHaveAttribute('aria-label', 'Loading');
    });
  });
});
