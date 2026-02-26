// Shared Profile Components Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SettingsGroup } from '../../../src/components/profile/SettingsGroup';
import { SettingsRow } from '../../../src/components/profile/SettingsRow';
import { ProfileHeader } from '../../../src/components/profile/ProfileHeader';
import { ProfileSkeleton } from '../../../src/components/profile/ProfileSkeleton';
import { ToggleSwitch } from '../../../src/components/profile/ToggleSwitch';
import { Mail, Shield, Key } from 'lucide-react';

// ─── SettingsGroup ─────────────────────────────────────────

describe('SettingsGroup', () => {
  it('renders children', () => {
    render(
      <SettingsGroup>
        <div data-testid="child">Hello</div>
      </SettingsGroup>,
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('renders optional title', () => {
    render(
      <SettingsGroup title="Account">
        <div>Content</div>
      </SettingsGroup>,
    );
    expect(screen.getByText('Account')).toBeInTheDocument();
  });

  it('omits title heading when not provided', () => {
    const { container } = render(
      <SettingsGroup>
        <div>Content</div>
      </SettingsGroup>,
    );
    expect(container.querySelector('h3')).toBeNull();
  });
});

// ─── SettingsRow ───────────────────────────────────────────

describe('SettingsRow', () => {
  it('renders label', () => {
    render(<SettingsRow label="Email" />);
    expect(screen.getByText('Email')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(<SettingsRow label="Email" description="Your email address" />);
    expect(screen.getByText('Your email address')).toBeInTheDocument();
  });

  it('renders value on the right side', () => {
    render(<SettingsRow label="Email" value="john@test.com" />);
    expect(screen.getByText('john@test.com')).toBeInTheDocument();
  });

  it('renders icon when provided', () => {
    render(<SettingsRow label="Email" icon={Mail} />);
    // Lucide renders an SVG
    const svg = document.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('renders as a button when onClick is provided', () => {
    const handleClick = vi.fn();
    render(<SettingsRow label="Change Password" onClick={handleClick} />);
    const button = screen.getByRole('button');
    expect(button).toBeInTheDocument();
  });

  it('renders as a div when onClick is not provided', () => {
    render(<SettingsRow label="Email" value="test@test.com" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('calls onClick when clicked', () => {
    const handleClick = vi.fn();
    render(<SettingsRow label="Change Password" onClick={handleClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('shows chevron when onClick is present', () => {
    render(<SettingsRow label="Settings" onClick={() => {}} />);
    // ChevronRight SVG should be rendered
    const svgs = document.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThan(0);
  });

  it('renders rightElement instead of value when provided', () => {
    render(
      <SettingsRow
        label="Dark Mode"
        value="should not appear"
        rightElement={<span data-testid="toggle">Toggle</span>}
      />,
    );
    expect(screen.getByTestId('toggle')).toBeInTheDocument();
    expect(screen.queryByText('should not appear')).toBeNull();
  });

  it('applies danger variant styles', () => {
    render(<SettingsRow label="Sign Out" variant="danger" onClick={() => {}} />);
    const label = screen.getByText('Sign Out');
    expect(label.className).toContain('text-red');
  });
});

// ─── ProfileHeader ─────────────────────────────────────────

describe('ProfileHeader', () => {
  const defaultProps = {
    name: 'John Doe',
    email: 'john@test.com',
    onEdit: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders name', () => {
    render(<ProfileHeader {...defaultProps} />);
    expect(screen.getByText('John Doe')).toBeInTheDocument();
  });

  it('renders email', () => {
    render(<ProfileHeader {...defaultProps} />);
    expect(screen.getByText('john@test.com')).toBeInTheDocument();
  });

  it('derives initials from name', () => {
    render(<ProfileHeader {...defaultProps} />);
    expect(screen.getByText('JD')).toBeInTheDocument();
  });

  it('derives single initial when only first name', () => {
    render(<ProfileHeader {...defaultProps} name="John" />);
    expect(screen.getByText('J')).toBeInTheDocument();
  });

  it('renders role badge when provided', () => {
    render(<ProfileHeader {...defaultProps} role="Admin" />);
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('does not render role badge when not provided', () => {
    render(<ProfileHeader {...defaultProps} />);
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  it('renders phone when provided', () => {
    render(<ProfileHeader {...defaultProps} phone="09171234567" />);
    expect(screen.getByText('09171234567')).toBeInTheDocument();
  });

  it('calls onEdit when edit button clicked', () => {
    const onEdit = vi.fn();
    render(<ProfileHeader {...defaultProps} onEdit={onEdit} />);
    fireEvent.click(screen.getByLabelText('Edit profile'));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});

// ─── ProfileSkeleton ───────────────────────────────────────

describe('ProfileSkeleton', () => {
  it('renders without crashing', () => {
    const { container } = render(<ProfileSkeleton />);
    // Skeleton uses animate-pulse divs
    const pulses = container.querySelectorAll('.animate-pulse');
    expect(pulses.length).toBeGreaterThan(0);
  });
});

// ─── ToggleSwitch ──────────────────────────────────────────

describe('ToggleSwitch', () => {
  it('renders a switch role', () => {
    render(<ToggleSwitch checked={false} onChange={() => {}} />);
    expect(screen.getByRole('switch')).toBeInTheDocument();
  });

  it('sets aria-checked to true when checked', () => {
    render(<ToggleSwitch checked={true} onChange={() => {}} />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('sets aria-checked to false when unchecked', () => {
    render(<ToggleSwitch checked={false} onChange={() => {}} />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('calls onChange when clicked', () => {
    const onChange = vi.fn();
    render(<ToggleSwitch checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('sets aria-label when label is provided', () => {
    render(<ToggleSwitch checked={false} onChange={() => {}} label="Toggle dark mode" />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-label', 'Toggle dark mode');
  });

  it('stops event propagation on click', () => {
    const parentClick = vi.fn();
    const onChange = vi.fn();
    render(
      <div onClick={parentClick}>
        <ToggleSwitch checked={false} onChange={onChange} />
      </div>,
    );
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(parentClick).not.toHaveBeenCalled();
  });
});
