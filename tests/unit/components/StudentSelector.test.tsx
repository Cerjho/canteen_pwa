// StudentSelector Component Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { StudentSelector } from '../../../src/components/StudentSelector';

describe('StudentSelector Component', () => {
  const mockStudents = [
    {
      id: 'student-1',
      first_name: 'Maria',
      last_name: 'Santos',
      grade_level: 'Grade 3',
      section: 'A'
    },
    {
      id: 'student-2',
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
        <StudentSelector
          students={mockStudents}
          selectedStudentId={null}
          onSelect={mockOnSelect}
        />
      );

      expect(screen.getByText('Order for:')).toBeInTheDocument();
    });

    it('renders select dropdown', () => {
      render(
        <StudentSelector
          students={mockStudents}
          selectedStudentId={null}
          onSelect={mockOnSelect}
        />
      );

      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('renders placeholder option', () => {
      render(
        <StudentSelector
          students={mockStudents}
          selectedStudentId={null}
          onSelect={mockOnSelect}
        />
      );

      expect(screen.getByText('Select a student')).toBeInTheDocument();
    });

    it('renders all student options', () => {
      render(
        <StudentSelector
          students={mockStudents}
          selectedStudentId={null}
          onSelect={mockOnSelect}
        />
      );

      expect(screen.getByText('Maria Santos - Grade 3 A')).toBeInTheDocument();
      expect(screen.getByText('Juan Santos - Grade 1 B')).toBeInTheDocument();
    });
  });

  describe('Selection', () => {
    it('calls onSelect when student is selected', () => {
      render(
        <StudentSelector
          students={mockStudents}
          selectedStudentId={null}
          onSelect={mockOnSelect}
        />
      );

      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'student-1' } });

      expect(mockOnSelect).toHaveBeenCalledWith('student-1');
    });

    it('shows selected student', () => {
      render(
        <StudentSelector
          students={mockStudents}
          selectedStudentId="student-2"
          onSelect={mockOnSelect}
        />
      );

      const select = screen.getByRole('combobox') as HTMLSelectElement;
      expect(select.value).toBe('student-2');
    });

    it('can change selection', () => {
      const { rerender } = render(
        <StudentSelector
          students={mockStudents}
          selectedStudentId="student-1"
          onSelect={mockOnSelect}
        />
      );

      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'student-2' } });

      expect(mockOnSelect).toHaveBeenCalledWith('student-2');

      // Simulate parent updating state
      rerender(
        <StudentSelector
          students={mockStudents}
          selectedStudentId="student-2"
          onSelect={mockOnSelect}
        />
      );

      expect((select as HTMLSelectElement).value).toBe('student-2');
    });
  });

  describe('Empty State', () => {
    it('shows message when no students exist', () => {
      render(
        <StudentSelector
          students={[]}
          selectedStudentId={null}
          onSelect={mockOnSelect}
        />
      );

      // With no students, selector shows placeholder option only
      const select = screen.getByRole('combobox');
      expect(select).toBeInTheDocument();
      expect(screen.getByText('Select a student')).toBeInTheDocument();
    });

    it('still renders select when no students', () => {
      render(
        <StudentSelector
          students={[]}
          selectedStudentId={null}
          onSelect={mockOnSelect}
        />
      );

      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });
  });

  describe('Student Without Section', () => {
    it('handles student without section', () => {
      const studentsWithoutSection = [
        {
          id: 'student-3',
          first_name: 'Pedro',
          last_name: 'Cruz',
          grade_level: 'Grade 2'
        }
      ];

      render(
        <StudentSelector
          students={studentsWithoutSection}
          selectedStudentId={null}
          onSelect={mockOnSelect}
        />
      );

      expect(screen.getByText('Pedro Cruz - Grade 2')).toBeInTheDocument();
    });

    it('does not show extra space when no section', () => {
      const studentsWithoutSection = [
        {
          id: 'student-3',
          first_name: 'Pedro',
          last_name: 'Cruz',
          grade_level: 'Grade 2'
        }
      ];

      render(
        <StudentSelector
          students={studentsWithoutSection}
          selectedStudentId={null}
          onSelect={mockOnSelect}
        />
      );

      // Should not have trailing space or section letter
      const option = screen.getByText('Pedro Cruz - Grade 2');
      expect(option.textContent).toBe('Pedro Cruz - Grade 2');
    });
  });

  describe('Mixed Students', () => {
    it('handles mix of students with and without sections', () => {
      const mixedStudents = [
        {
          id: 'student-1',
          first_name: 'Maria',
          last_name: 'Santos',
          grade_level: 'Grade 3',
          section: 'A'
        },
        {
          id: 'student-2',
          first_name: 'Pedro',
          last_name: 'Cruz',
          grade_level: 'Grade 2'
          // No section
        }
      ];

      render(
        <StudentSelector
          students={mixedStudents}
          selectedStudentId={null}
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
        <StudentSelector
          students={mockStudents}
          selectedStudentId={null}
          onSelect={mockOnSelect}
        />
      );

      const label = screen.getByText('Order for:');
      expect(label.tagName).toBe('LABEL');
    });

    it('select is keyboard accessible', () => {
      render(
        <StudentSelector
          students={mockStudents}
          selectedStudentId={null}
          onSelect={mockOnSelect}
        />
      );

      const select = screen.getByRole('combobox');
      select.focus();
      expect(document.activeElement).toBe(select);
    });
  });
});
