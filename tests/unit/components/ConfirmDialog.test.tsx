// ConfirmDialog Component Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ConfirmDialog } from '../../../src/components/ConfirmDialog';

describe('ConfirmDialog Component', () => {
  const mockOnConfirm = vi.fn();
  const mockOnCancel = vi.fn();

  const defaultProps = {
    isOpen: true,
    title: 'Confirm Action',
    message: 'Are you sure you want to proceed?',
    onConfirm: mockOnConfirm,
    onCancel: mockOnCancel
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Visibility', () => {
    it('renders when isOpen is true', () => {
      render(<ConfirmDialog {...defaultProps} />);

      expect(screen.getByText('Confirm Action')).toBeInTheDocument();
    });

    it('does not render when isOpen is false', () => {
      render(<ConfirmDialog {...defaultProps} isOpen={false} />);

      expect(screen.queryByText('Confirm Action')).not.toBeInTheDocument();
    });
  });

  describe('Content', () => {
    it('renders title', () => {
      render(<ConfirmDialog {...defaultProps} />);

      expect(screen.getByText('Confirm Action')).toBeInTheDocument();
    });

    it('renders message', () => {
      render(<ConfirmDialog {...defaultProps} />);

      expect(screen.getByText('Are you sure you want to proceed?')).toBeInTheDocument();
    });

    it('renders confirm button with default label', () => {
      render(<ConfirmDialog {...defaultProps} />);

      expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    });

    it('renders cancel button with default label', () => {
      render(<ConfirmDialog {...defaultProps} />);

      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });

    it('renders custom confirm label', () => {
      render(<ConfirmDialog {...defaultProps} confirmLabel="Yes, delete it" />);

      expect(screen.getByRole('button', { name: 'Yes, delete it' })).toBeInTheDocument();
    });

    it('renders custom cancel label', () => {
      render(<ConfirmDialog {...defaultProps} cancelLabel="No, keep it" />);

      expect(screen.getByRole('button', { name: 'No, keep it' })).toBeInTheDocument();
    });
  });

  describe('Actions', () => {
    it('calls onConfirm when confirm button clicked', () => {
      render(<ConfirmDialog {...defaultProps} />);

      const confirmButton = screen.getByRole('button', { name: 'Confirm' });
      fireEvent.click(confirmButton);

      expect(mockOnConfirm).toHaveBeenCalledTimes(1);
    });

    it('calls onCancel when cancel button clicked', () => {
      render(<ConfirmDialog {...defaultProps} />);

      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      fireEvent.click(cancelButton);

      expect(mockOnCancel).toHaveBeenCalledTimes(1);
    });

    it('calls onCancel when backdrop clicked', () => {
      render(<ConfirmDialog {...defaultProps} />);

      // Portal renders to document.body — query there
      const wrapper = document.body.querySelector('.fixed.inset-0.flex');
      expect(wrapper).toBeTruthy();
      fireEvent.click(wrapper!);

      expect(mockOnCancel).toHaveBeenCalledTimes(1);
    });

    it('does not call onCancel when dialog content clicked', () => {
      render(<ConfirmDialog {...defaultProps} />);

      const dialogContent = screen.getByText('Are you sure you want to proceed?');
      fireEvent.click(dialogContent);

      expect(mockOnCancel).not.toHaveBeenCalled();
    });
  });

  describe('Type Variants', () => {
    it('renders warning type by default', () => {
      render(<ConfirmDialog {...defaultProps} />);

      // Warning uses yellow background for icon (portal renders to document.body)
      const iconBg = document.body.querySelector('.bg-yellow-100');
      expect(iconBg).toBeInTheDocument();
    });

    it('renders danger type', () => {
      render(<ConfirmDialog {...defaultProps} type="danger" />);

      const iconBg = document.body.querySelector('.bg-red-100');
      expect(iconBg).toBeInTheDocument();
    });

    it('renders success type', () => {
      render(<ConfirmDialog {...defaultProps} type="success" />);

      const iconBg = document.body.querySelector('.bg-green-100');
      expect(iconBg).toBeInTheDocument();
    });

    it('renders info type', () => {
      render(<ConfirmDialog {...defaultProps} type="info" />);

      const iconBg = document.body.querySelector('.bg-blue-100');
      expect(iconBg).toBeInTheDocument();
    });

    it('applies correct button color for danger type', () => {
      render(<ConfirmDialog {...defaultProps} type="danger" />);

      const confirmButton = screen.getByRole('button', { name: 'Confirm' });
      expect(confirmButton).toHaveClass('bg-red-600');
    });

    it('applies correct button color for success type', () => {
      render(<ConfirmDialog {...defaultProps} type="success" />);

      const confirmButton = screen.getByRole('button', { name: 'Confirm' });
      expect(confirmButton).toHaveClass('bg-green-600');
    });
  });

  describe('Layout', () => {
    it('renders icon', () => {
      render(<ConfirmDialog {...defaultProps} />);

      // Portal renders to document.body
      const svg = document.body.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    it('centers content', () => {
      render(<ConfirmDialog {...defaultProps} />);

      const dialogInner = document.body.querySelector('.text-center');
      expect(dialogInner).toBeInTheDocument();
    });

    it('renders buttons side by side', () => {
      render(<ConfirmDialog {...defaultProps} />);

      const buttonContainer = document.body.querySelector('.flex.gap-3');
      expect(buttonContainer).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('dialog has proper structure', () => {
      render(<ConfirmDialog {...defaultProps} />);

      const title = screen.getByRole('heading', { level: 3 });
      expect(title).toHaveTextContent('Confirm Action');
    });

    it('buttons are keyboard accessible', () => {
      render(<ConfirmDialog {...defaultProps} />);

      const confirmButton = screen.getByRole('button', { name: 'Confirm' });
      const cancelButton = screen.getByRole('button', { name: 'Cancel' });

      expect(confirmButton).toBeVisible();
      expect(cancelButton).toBeVisible();
    });
  });

  describe('Backdrop', () => {
    it('renders backdrop overlay', () => {
      render(<ConfirmDialog {...defaultProps} />);

      // Portal renders to document.body
      const backdrop = document.body.querySelector('.bg-black\\/50');
      expect(backdrop).toBeInTheDocument();
    });

    it('backdrop has z-index for stacking', () => {
      render(<ConfirmDialog {...defaultProps} />);

      const backdrop = document.body.querySelector('.z-\\[9999\\]');
      expect(backdrop).toBeInTheDocument();
    });
  });
});
