// Children Service Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase client
const mockInvoke = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();

vi.mock('../../src/services/supabaseClient', () => ({
  supabase: {
    functions: {
      invoke: (...args: any[]) => mockInvoke(...args)
    },
    from: (...args: any[]) => mockFrom(...args)
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
} from '../../src/services/children';

describe('Children Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getChildren', () => {
    const mockQueryBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null })
    };

    beforeEach(() => {
      mockFrom.mockReturnValue(mockQueryBuilder);
    });

    it('queries children table', async () => {
      mockQueryBuilder.order.mockResolvedValue({ data: [], error: null });

      await getChildren('parent-123');

      expect(mockFrom).toHaveBeenCalledWith('children');
    });

    it('selects all fields', async () => {
      mockQueryBuilder.order.mockResolvedValue({ data: [], error: null });

      await getChildren('parent-123');

      expect(mockQueryBuilder.select).toHaveBeenCalledWith('*');
    });

    it('filters by parent_id', async () => {
      mockQueryBuilder.order.mockResolvedValue({ data: [], error: null });

      await getChildren('parent-123');

      expect(mockQueryBuilder.eq).toHaveBeenCalledWith('parent_id', 'parent-123');
    });

    it('orders by first_name ascending', async () => {
      mockQueryBuilder.order.mockResolvedValue({ data: [], error: null });

      await getChildren('parent-123');

      expect(mockQueryBuilder.order).toHaveBeenCalledWith('first_name', { ascending: true });
    });

    it('returns children data', async () => {
      const mockChildren = [
        { id: 'child-1', first_name: 'Maria', last_name: 'Santos' },
        { id: 'child-2', first_name: 'Juan', last_name: 'Santos' }
      ];
      mockQueryBuilder.order.mockResolvedValue({ data: mockChildren, error: null });

      const result = await getChildren('parent-123');

      expect(result).toEqual(mockChildren);
    });

    it('returns empty array when no children', async () => {
      mockQueryBuilder.order.mockResolvedValue({ data: null, error: null });

      const result = await getChildren('parent-123');

      expect(result).toEqual([]);
    });

    it('throws error on failure', async () => {
      mockQueryBuilder.order.mockResolvedValue({ data: null, error: { message: 'Database error' } });

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

    it('queries children table', async () => {
      await findStudentById('STU-001');

      expect(mockFrom).toHaveBeenCalledWith('children');
    });

    it('selects specific fields', async () => {
      await findStudentById('STU-001');

      expect(mockQueryBuilder.select).toHaveBeenCalledWith(
        'id, student_id, first_name, last_name, grade_level, section, parent_id'
      );
    });

    it('filters by student_id (uppercase trimmed)', async () => {
      await findStudentById('  stu-001  ');

      expect(mockQueryBuilder.eq).toHaveBeenCalledWith('student_id', 'STU-001');
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
      mockInvoke.mockResolvedValue({ data: { child: { id: 'child-1' } }, error: null });

      await updateChildDietary('child-1', 'No peanuts');

      expect(mockInvoke).toHaveBeenCalledWith('update-dietary', {
        body: { child_id: 'child-1', dietary_restrictions: 'No peanuts' }
      });
    });

    it('returns updated child data', async () => {
      const mockChild = { id: 'child-1', dietary_restrictions: 'No peanuts' };
      mockInvoke.mockResolvedValue({ data: { child: mockChild }, error: null });

      const result = await updateChildDietary('child-1', 'No peanuts');

      expect(result).toEqual(mockChild);
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
      })).rejects.toThrow('Adding children is no longer supported');
    });

    it('deleteChild throws error', async () => {
      await expect(deleteChild('child-1')).rejects.toThrow('Removing children is no longer supported');
    });
  });
});
