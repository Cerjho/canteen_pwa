// EditProfileModal Component Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { EditProfileModal } from '../../../src/components/EditProfileModal';

const defaultProfile = {
  first_name: 'John',
  last_name: 'Doe',
  phone_number: '09171234567',
};

describe('EditProfileModal', () => {
  let onClose: ReturnType<typeof vi.fn>;
  let onSave: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onClose = vi.fn();
    onSave = vi.fn();
  });

  const renderModal = (overrides: Partial<Parameters<typeof EditProfileModal>[0]> = {}) => {
    return render(
      <EditProfileModal
        isOpen={true}
        profile={defaultProfile}
        onClose={onClose}
        onSave={onSave}
        isLoading={false}
        {...overrides}
      />,
    );
  };

  describe('Rendering', () => {
    it('renders when isOpen is true', () => {
      renderModal();
      expect(screen.getByText('Edit Profile')).toBeInTheDocument();
    });

    it('does not render when isOpen is false', () => {
      renderModal({ isOpen: false });
      expect(screen.queryByText('Edit Profile')).not.toBeInTheDocument();
    });

    it('renders first name input with initial value', () => {
      renderModal();
      const input = screen.getByDisplayValue('John');
      expect(input).toBeInTheDocument();
    });

    it('renders last name input with initial value', () => {
      renderModal();
      const input = screen.getByDisplayValue('Doe');
      expect(input).toBeInTheDocument();
    });

    it('renders phone input with initial value', () => {
      renderModal();
      const input = screen.getByDisplayValue('09171234567');
      expect(input).toBeInTheDocument();
    });

    it('renders Cancel and Save buttons', () => {
      renderModal();
      expect(screen.getByText('Cancel')).toBeInTheDocument();
      expect(screen.getByText('Save Changes')).toBeInTheDocument();
    });

    it('shows "Saving..." when isLoading is true', () => {
      renderModal({ isLoading: true });
      expect(screen.getByText('Saving...')).toBeInTheDocument();
    });
  });

  describe('Close', () => {
    it('calls onClose when Cancel is clicked', async () => {
      const user = userEvent.setup();
      renderModal();
      await user.click(screen.getByText('Cancel'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('Validation', () => {
    it('shows error when first name is empty', async () => {
      const user = userEvent.setup();
      renderModal();
      const firstNameInput = screen.getByDisplayValue('John');
      await user.clear(firstNameInput);
      await user.click(screen.getByText('Save Changes'));
      expect(screen.getByText('First name is required')).toBeInTheDocument();
      expect(onSave).not.toHaveBeenCalled();
    });

    it('shows error when last name is empty', async () => {
      const user = userEvent.setup();
      renderModal();
      const lastNameInput = screen.getByDisplayValue('Doe');
      await user.clear(lastNameInput);
      await user.click(screen.getByText('Save Changes'));
      expect(screen.getByText('Last name is required')).toBeInTheDocument();
      expect(onSave).not.toHaveBeenCalled();
    });

    it('shows error for invalid phone number format', async () => {
      const user = userEvent.setup();
      renderModal();
      const phoneInput = screen.getByDisplayValue('09171234567');
      await user.clear(phoneInput);
      await user.type(phoneInput, '1234');
      await user.click(screen.getByText('Save Changes'));
      expect(screen.getByText(/valid PH mobile/i)).toBeInTheDocument();
      expect(onSave).not.toHaveBeenCalled();
    });

    it('allows empty phone number (optional field)', async () => {
      const user = userEvent.setup();
      renderModal();
      const phoneInput = screen.getByDisplayValue('09171234567');
      await user.clear(phoneInput);
      await user.click(screen.getByText('Save Changes'));
      expect(onSave).toHaveBeenCalledWith({
        first_name: 'John',
        last_name: 'Doe',
        phone_number: '',
      });
    });

    it('accepts valid PH phone starting with 09', async () => {
      const user = userEvent.setup();
      renderModal({ profile: { ...defaultProfile, phone_number: '' } });
      const phoneInput = screen.getByPlaceholderText(/09XX/);
      await user.type(phoneInput, '09181234567');
      await user.click(screen.getByText('Save Changes'));
      expect(onSave).toHaveBeenCalled();
    });

    it('accepts valid PH phone starting with +63', async () => {
      const user = userEvent.setup();
      renderModal({ profile: { ...defaultProfile, phone_number: '' } });
      const phoneInput = screen.getByPlaceholderText(/09XX/);
      await user.type(phoneInput, '+639181234567');
      await user.click(screen.getByText('Save Changes'));
      expect(onSave).toHaveBeenCalled();
    });
  });

  describe('Submission', () => {
    it('calls onSave with trimmed data on valid submission', async () => {
      const user = userEvent.setup();
      renderModal();
      await user.click(screen.getByText('Save Changes'));
      expect(onSave).toHaveBeenCalledWith({
        first_name: 'John',
        last_name: 'Doe',
        phone_number: '09171234567',
      });
    });

    it('trims whitespace from input values', async () => {
      const user = userEvent.setup();
      renderModal({
        profile: {
          first_name: '  John  ',
          last_name: '  Doe  ',
          phone_number: ' 09171234567 ',
        },
      });
      await user.click(screen.getByText('Save Changes'));
      expect(onSave).toHaveBeenCalledWith({
        first_name: 'John',
        last_name: 'Doe',
        phone_number: '09171234567',
      });
    });

    it('disables submit button when isLoading', () => {
      renderModal({ isLoading: true });
      const saveButton = screen.getByText('Saving...');
      expect(saveButton).toBeDisabled();
    });
  });
});
