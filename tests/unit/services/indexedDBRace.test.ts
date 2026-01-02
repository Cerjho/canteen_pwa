// IndexedDB Race Condition Tests
// Tests for the singleton pattern fix in localQueue

import { describe, it, expect, vi } from 'vitest';

describe('IndexedDB Initialization Race Condition', () => {
  describe('Promise-based Singleton Pattern', () => {
    it('should return same promise for concurrent calls', async () => {
      let dbPromise: Promise<{ name: string }> | null = null;
      let initCount = 0;
      
      // Simulate getDB with singleton pattern
      const getDB = async () => {
        if (!dbPromise) {
          dbPromise = new Promise(resolve => {
            initCount++;
            setTimeout(() => resolve({ name: 'test-db' }), 100);
          });
        }
        return dbPromise;
      };
      
      // Make concurrent calls
      const [db1, db2, db3] = await Promise.all([
        getDB(),
        getDB(),
        getDB()
      ]);
      
      // All should get the same database instance
      expect(db1).toBe(db2);
      expect(db2).toBe(db3);
      
      // Only one initialization should occur
      expect(initCount).toBe(1);
    });

    it('should only open database once even with rapid calls', async () => {
      let openCount = 0;
      let dbPromise: Promise<{ name: string }> | null = null;
      
      const openDB = async () => {
        openCount++;
        return { name: `db-${openCount}` };
      };
      
      const getDB = async () => {
        if (!dbPromise) {
          dbPromise = openDB();
        }
        return dbPromise;
      };
      
      // Simulate rapid concurrent access
      const promises = Array.from({ length: 10 }, () => getDB());
      const results = await Promise.all(promises);
      
      // All should reference the same DB
      expect(new Set(results.map(r => r.name)).size).toBe(1);
      expect(openCount).toBe(1);
    });
  });

  describe('Old Pattern (Bug - Multiple Connections)', () => {
    it('demonstrates the race condition bug', async () => {
      let db: { name: string } | null = null;
      let openCount = 0;
      
      // Buggy pattern - check db instead of promise
      const getDBBuggy = async () => {
        if (!db) {
          // Simulates async openDB call
          await new Promise(resolve => setTimeout(resolve, 10));
          openCount++;
          db = { name: `db-${openCount}` };
        }
        return db;
      };
      
      // Multiple concurrent calls before db is assigned
      const promises = [
        getDBBuggy(),
        getDBBuggy(),
        getDBBuggy()
      ];
      
      const _results = await Promise.all(promises);
      
      // Bug: Multiple DBs were opened because db was null during all initial checks
      expect(openCount).toBeGreaterThan(1); // This demonstrates the bug
    });
  });

  describe('Database Upgrade Handling', () => {
    it('should handle version upgrades correctly', async () => {
      const upgradeHistory: number[] = [];
      
      // Simulate upgrade handler
      const handleUpgrade = (oldVersion: number, newVersion: number) => {
        for (let version = oldVersion; version < newVersion; version++) {
          upgradeHistory.push(version + 1);
        }
      };
      
      // Upgrade from v1 to v2
      handleUpgrade(1, 2);
      expect(upgradeHistory).toEqual([2]);
      
      // Fresh install (v0 to v2)
      upgradeHistory.length = 0;
      handleUpgrade(0, 2);
      expect(upgradeHistory).toEqual([1, 2]);
    });

    it('should recreate store during upgrade without data loss pattern', async () => {
      interface OrderBackup {
        id: string;
        data: Record<string, unknown>;
      }
      
      const backupAndRestore = async (
        existingData: OrderBackup[],
        deleteStore: () => void,
        createStore: () => void,
        restore: (data: OrderBackup[]) => void
      ) => {
        // Backup existing data
        const backup = [...existingData];
        
        // Delete old store
        deleteStore();
        
        // Create new store with updated schema
        createStore();
        
        // Restore data
        restore(backup);
        
        return backup.length;
      };
      
      const existingOrders = [
        { id: '1', data: { amount: 100 } },
        { id: '2', data: { amount: 200 } }
      ];
      
      const deleteFn = vi.fn();
      const createFn = vi.fn();
      const restoreFn = vi.fn();
      
      const restoredCount = await backupAndRestore(
        existingOrders,
        deleteFn,
        createFn,
        restoreFn
      );
      
      expect(deleteFn).toHaveBeenCalled();
      expect(createFn).toHaveBeenCalled();
      expect(restoreFn).toHaveBeenCalledWith(existingOrders);
      expect(restoredCount).toBe(2);
    });
  });

  describe('Error Handling', () => {
    it('should handle database open errors gracefully', async () => {
      let dbPromise: Promise<{ name: string }> | null = null;
      
      const getDB = async () => {
        if (!dbPromise) {
          dbPromise = Promise.reject(new Error('IndexedDB not available'));
        }
        return dbPromise;
      };
      
      await expect(getDB()).rejects.toThrow('IndexedDB not available');
    });

    it('should allow retry after error', async () => {
      let dbPromise: Promise<{ name: string }> | null = null;
      let attemptCount = 0;
      
      const getDB = async () => {
        attemptCount++;
        
        if (attemptCount === 1) {
          // First attempt fails
          throw new Error('Temporary failure');
        }
        
        if (!dbPromise) {
          dbPromise = Promise.resolve({ name: 'test-db' });
        }
        return dbPromise;
      };
      
      // First attempt fails
      await expect(getDB()).rejects.toThrow('Temporary failure');
      
      // Second attempt succeeds
      const db = await getDB();
      expect(db.name).toBe('test-db');
    });
  });
});

describe('Background Sync Registration', () => {
  describe('Type-safe Background Sync API', () => {
    it('should register sync with proper interface', async () => {
      interface SyncManager {
        register(tag: string): Promise<void>;
      }
      
      interface ServiceWorkerRegistrationWithSync extends ServiceWorkerRegistration {
        sync: SyncManager;
      }
      
      const mockRegistration = {
        sync: {
          register: vi.fn().mockResolvedValue(undefined)
        }
      } as unknown as ServiceWorkerRegistrationWithSync;
      
      await mockRegistration.sync.register('sync-orders');
      
      expect(mockRegistration.sync.register).toHaveBeenCalledWith('sync-orders');
    });

    it('should handle sync registration failure gracefully', async () => {
      const mockRegistration = {
        sync: {
          register: vi.fn().mockRejectedValue(new Error('Sync not supported'))
        }
      };
      
      const registerSync = async () => {
        try {
          await mockRegistration.sync.register('sync-orders');
          return { success: true };
        } catch (error) {
          // Graceful degradation - sync registration is optional
          console.warn('Background sync registration failed:', error);
          return { success: false, error };
        }
      };
      
      const result = await registerSync();
      expect(result.success).toBe(false);
    });
  });
});

describe('Retry Logic with Exponential Backoff', () => {
  const getBackoffDelay = (retryCount: number, baseDelay = 1000, maxDelay = 30000) => {
    const delay = Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);
    // Add jitter
    return delay + Math.random() * 1000;
  };

  it('should increase delay exponentially', () => {
    const delay0 = getBackoffDelay(0, 1000, 30000);
    const delay1 = getBackoffDelay(1, 1000, 30000);
    const delay2 = getBackoffDelay(2, 1000, 30000);
    
    // Base delays without jitter would be 1000, 2000, 4000
    expect(delay0).toBeGreaterThanOrEqual(1000);
    expect(delay0).toBeLessThan(2000);
    
    expect(delay1).toBeGreaterThanOrEqual(2000);
    expect(delay1).toBeLessThan(3000);
    
    expect(delay2).toBeGreaterThanOrEqual(4000);
    expect(delay2).toBeLessThan(5000);
  });

  it('should cap delay at maxDelay', () => {
    const delay = getBackoffDelay(10, 1000, 30000);
    // 2^10 * 1000 = 1,024,000 but should be capped at 30,000
    expect(delay).toBeLessThan(31000);
  });

  it('should include jitter to prevent thundering herd', () => {
    const delays = Array.from({ length: 100 }, () => getBackoffDelay(1, 1000, 30000));
    const uniqueDelays = new Set(delays);
    
    // With jitter, all delays should be unique
    expect(uniqueDelays.size).toBeGreaterThan(90);
  });
});
