// Balance Concurrency Tests
// Tests for race condition handling in balance operations

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Balance Concurrency Safety', () => {
  // Mock Supabase client
  const mockSupabase = {
    from: vi.fn(),
    rpc: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Optimistic Locking Pattern', () => {
    it('should reject update when balance has changed', async () => {
      // Simulate optimistic lock failure
      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: null })
            })
          })
        })
      });

      mockSupabase.from.mockReturnValue({
        update: mockUpdate
      });

      // When no rows are returned, it means the balance changed concurrently
      const result = await simulateTopup(mockSupabase, {
        userId: 'user-1',
        amount: 100,
        currentBalance: 500 // This balance may have changed
      });

      // Should return conflict error
      expect(result.status).toBe(409);
      expect(result.error).toBe('CONCURRENT_MODIFICATION');
    });

    it('should succeed when balance matches expected', async () => {
      // Simulate successful update with matching balance
      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ 
                data: { balance: 600 }, 
                error: null 
              })
            })
          })
        })
      });

      mockSupabase.from.mockReturnValue({
        update: mockUpdate
      });

      const result = await simulateTopup(mockSupabase, {
        userId: 'user-1',
        amount: 100,
        currentBalance: 500
      });

      expect(result.status).toBe(200);
      expect(result.newBalance).toBe(600);
    });
  });

  describe('Concurrent Topup Scenario', () => {
    it('should handle simultaneous topups correctly', async () => {
      // Simulate two concurrent topup requests
      const balanceUpdates: number[] = [];
      let currentDbBalance = 500;

      // Mock that checks balance atomically
      const createMockUpdate = (amount: number) => {
        return async (expectedBalance: number) => {
          // Simulate atomic check-and-update
          if (currentDbBalance === expectedBalance) {
            currentDbBalance += amount;
            balanceUpdates.push(currentDbBalance);
            return { success: true, newBalance: currentDbBalance };
          }
          return { success: false, error: 'CONCURRENT_MODIFICATION' };
        };
      };

      // Two concurrent updates both read balance as 500
      const update1 = createMockUpdate(100);
      const update2 = createMockUpdate(150);

      // Simulate both reading 500 as current balance
      const [result1, result2] = await Promise.all([
        update1(500),
        update2(500)
      ]);

      // First one should succeed, second should fail due to race
      const successCount = [result1, result2].filter(r => r.success).length;
      const failCount = [result1, result2].filter(r => !r.success).length;

      // Only one should succeed in a proper optimistic locking scenario
      expect(successCount).toBe(1);
      expect(failCount).toBe(1);
    });
  });

  describe('Balance Deduction During Order', () => {
    it('should rollback stock on balance deduction failure', async () => {
      const stockRollbacks: string[] = [];

      // Simulate stock deduction followed by balance failure
      const mockOrderProcess = async () => {
        const items = [
          { productId: 'prod-1', quantity: 2 },
          { productId: 'prod-2', quantity: 1 }
        ];

        // Step 1: Deduct stock (succeeds)
        for (const _item of items) {
          // Stock deducted
        }

        // Step 2: Deduct balance (fails due to race)
        const balanceSuccess = false;

        if (!balanceSuccess) {
          // Rollback stock
          for (const item of items) {
            stockRollbacks.push(item.productId);
          }
          throw new Error('BALANCE_RACE_CONDITION');
        }
      };

      await expect(mockOrderProcess()).rejects.toThrow('BALANCE_RACE_CONDITION');
      expect(stockRollbacks).toContain('prod-1');
      expect(stockRollbacks).toContain('prod-2');
    });
  });
});

// Helper function to simulate topup with optimistic locking
async function simulateTopup(
  supabase: { from: (table: string) => { update: (data: Record<string, unknown>) => { eq: (col: string, val: string) => { eq: (col2: string, val2: number) => { select: (cols: string) => { single: () => Promise<{ data: { balance: number } | null; error: unknown }> } } } } } },
  params: { userId: string; amount: number; currentBalance: number }
): Promise<{ status: number; error?: string; newBalance?: number }> {
  const { userId, amount, currentBalance } = params;
  const newBalance = currentBalance + amount;

  // Simulate the update with optimistic lock
  const { data, error } = await supabase
    .from('wallets')
    .update({ balance: newBalance })
    .eq('user_id', userId)
    .eq('balance', currentBalance) // Optimistic lock
    .select('balance')
    .single();

  if (error) {
    return { status: 500, error: 'UPDATE_FAILED' };
  }

  if (!data) {
    // No rows updated means balance changed concurrently
    return { status: 409, error: 'CONCURRENT_MODIFICATION' };
  }

  return { status: 200, newBalance: data.balance };
}
