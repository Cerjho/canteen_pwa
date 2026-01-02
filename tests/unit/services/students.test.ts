// Children Service Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase client
const mockInvoke = vi.fn();
const _mockSelect = vi.fn();
const mockFrom = vi.fn();

vi.mock('../../../src/services/supabaseClient', () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => mockInvoke(...args)
    },
    from: (...args: unknown[]) => mockFrom(...args)
  }
}));

import { 
  getChildren, 
  findStudentById, 
  linkStudent, 
  unlinkStudent, 
  updateChildDietary,
  addChild,
  deleteChild
} from '../../../src/services/students';

describe('Children Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getChildren', () => {
    const mockQueryBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [], error: null })
    };

    beforeEach(() => {
      mockFrom.mockReturnValue(mockQueryBuilder);
    });

    it('queries parent_students table', async () => {
      mockQueryBuilder.eq.mockResolvedValue({ data: [], error: null });

      await getChildren('parent-123');

      expect(mockFrom).toHaveBeenCalledWith('parent_students');
    });

    it('selects with join to students table', async () => {
      mockQueryBuilder.eq.mockResolvedValue({ data: [], error: null });

      await getChildren('parent-123');

      expect(mockQueryBuilder.select).toHaveBeenCalledWith(expect.stringContaining('students:student_id'));
    });

    it('filters by parent_id', async () => {
      mockQueryBuilder.eq.mockResolvedValue({ data: [], error: null });

      await getChildren('parent-123');

      expect(mockQueryBuilder.eq).toHaveBeenCalledWith('parent_id', 'parent-123');
    });

    it('returns children data flattened from join', async () => {
      const mockJoinData = [
        { student_id: 'stu-1', students: { id: 'child-1', student_id: 'STU-001', first_name: 'Maria', last_name: 'Santos', grade_level: '5', section: 'A' } },
        { student_id: 'stu-2', students: { id: 'child-2', student_id: 'STU-002', first_name: 'Juan', last_name: 'Santos', grade_level: '3', section: 'B' } }
      ];
      mockQueryBuilder.eq.mockResolvedValue({ data: mockJoinData, error: null });

      const result = await getChildren('parent-123');

      expect(result).toHaveLength(2);
      expect(result[0].first_name).toBe('Maria');
      expect(result[1].first_name).toBe('Juan');
      expect(result[0].parent_id).toBe('parent-123');
    });

    it('returns empty array when no children', async () => {
      mockQueryBuilder.eq.mockResolvedValue({ data: null, error: null });

      const result = await getChildren('parent-123');

      expect(result).toEqual([]);
    });

    it('throws error on failure', async () => {
      mockQueryBuilder.eq.mockResolvedValue({ data: null, error: { message: 'Database error' } });

      await expect(getChildren('parent-123')).rejects.toEqual({ message: 'Database error' });
    });
  });

  describe('findStudentById', () => {
    const mockQueryBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null })
    };

    beforeEach(() => {
      mockFrom.mockReturnValue(mockQueryBuilder);
    });

    it('queries students table', async () => {
      await findStudentById('STU-001');

      expect(mockFrom).toHaveBeenCalledWith('students');
    });

    it('selects specific fields', async () => {
      await findStudentById('STU-001');

      expect(mockQueryBuilder.select).toHaveBeenCalledWith(
        'id, student_id, first_name, last_name, grade_level, section, dietary_restrictions, is_active, created_at, updated_at'
      );
    });

    it('filters by student_id (uppercase trimmed) and is_active', async () => {
      await findStudentById('  stu-001  ');

      expect(mockQueryBuilder.eq).toHaveBeenCalledWith('student_id', 'STU-001');
      expect(mockQueryBuilder.eq).toHaveBeenCalledWith('is_active', true);
    });

    it('returns student data', async () => {
      const mockStudent = {
        id: 'child-1',
        student_id: 'STU-001',
        first_name: 'Maria',
        last_name: 'Santos'
      };
      mockQueryBuilder.single.mockResolvedValue({ data: mockStudent, error: null });

      const result = await findStudentById('STU-001');

      expect(result).toEqual(mockStudent);
    });

    it('returns null when not found (PGRST116)', async () => {
      mockQueryBuilder.single.mockResolvedValue({ 
        data: null, 
        error: { code: 'PGRST116', message: 'Not found' } 
      });

      const result = await findStudentById('NONEXISTENT');

      expect(result).toBeNull();
    });

    it('throws error for other errors', async () => {
      mockQueryBuilder.single.mockResolvedValue({ 
        data: null, 
        error: { code: 'OTHER', message: 'Database error' } 
      });

      await expect(findStudentById('STU-001')).rejects.toEqual({ 
        code: 'OTHER', 
        message: 'Database error' 
      });
    });
  });

  describe('linkStudent', () => {
    it('calls link-student function with link action', async () => {
      mockInvoke.mockResolvedValue({ data: { student: { id: 'child-1' } }, error: null });

      await linkStudent('STU-001');

      expect(mockInvoke).toHaveBeenCalledWith('link-student', {
        body: { action: 'link', student_id: 'STU-001' }
      });
    });

    it('returns linked student data', async () => {
      const mockStudent = { id: 'child-1', first_name: 'Maria' };
      mockInvoke.mockResolvedValue({ data: { student: mockStudent }, error: null });

      const result = await linkStudent('STU-001');

      expect(result).toEqual(mockStudent);
    });

    it('throws error on function error', async () => {
      mockInvoke.mockResolvedValue({ data: null, error: { message: 'Student not found' } });

      await expect(linkStudent('STU-001')).rejects.toThrow('Student not found');
    });

    it('throws error on data error', async () => {
      mockInvoke.mockResolvedValue({ 
        data: { error: true, message: 'Student already linked' }, 
        error: null 
      });

      await expect(linkStudent('STU-001')).rejects.toThrow('Student already linked');
    });
  });

  describe('unlinkStudent', () => {
    it('calls link-student function with unlink action', async () => {
      mockInvoke.mockResolvedValue({ data: {}, error: null });

      await unlinkStudent('child-1');

      expect(mockInvoke).toHaveBeenCalledWith('link-student', {
        body: { action: 'unlink', student_id: 'child-1' }
      });
    });

    it('throws error on function error', async () => {
      mockInvoke.mockResolvedValue({ data: null, error: { message: 'Unauthorized' } });

      await expect(unlinkStudent('child-1')).rejects.toThrow('Unauthorized');
    });

    it('throws error on data error', async () => {
      mockInvoke.mockResolvedValue({ 
        data: { error: true, message: 'Cannot unlink' }, 
        error: null 
      });

      await expect(unlinkStudent('child-1')).rejects.toThrow('Cannot unlink');
    });
  });

  describe('updateChildDietary', () => {
    it('calls update-dietary function', async () => {
      mockInvoke.mockResolvedValue({ data: { student: { id: 'child-1', student_id: 'STU-001', first_name: 'Test', last_name: 'Child', grade_level: 'Grade 1', is_active: true, created_at: '', updated_at: '' } }, error: null });

      await updateChildDietary('child-1', 'No peanuts');

      expect(mockInvoke).toHaveBeenCalledWith('update-dietary', {
        body: { student_id: 'child-1', dietary_restrictions: 'No peanuts' }
      });
    });

    it('returns updated child data', async () => {
      const mockStudent = { id: 'child-1', student_id: 'STU-001', first_name: 'Test', last_name: 'Child', grade_level: 'Grade 1', dietary_restrictions: 'No peanuts', is_active: true, created_at: '2024-01-01', updated_at: '2024-01-01' };
      mockInvoke.mockResolvedValue({ data: { student: mockStudent }, error: null });

      const result = await updateChildDietary('child-1', 'No peanuts');

      // Returns Child type for backward compatibility
      expect(result.id).toEqual('child-1');
      expect(result.dietary_restrictions).toEqual('No peanuts');
    });

    it('throws error on function error', async () => {
      mockInvoke.mockResolvedValue({ data: null, error: { message: 'Unauthorized' } });

      await expect(updateChildDietary('child-1', 'No peanuts')).rejects.toThrow('Unauthorized');
    });
  });

  describe('Legacy Functions', () => {
    it('addChild throws error', async () => {
      await expect(addChild({
        parent_id: 'parent-1',
        first_name: 'Test',
        last_name: 'Child',
        grade_level: 'Grade 1'
      })).rejects.toThrow('Adding students is no longer supported');
    });

    it('deleteChild throws error', async () => {
      await expect(deleteChild('child-1')).rejects.toThrow('Removing students is no longer supported');
    });
  });
});
