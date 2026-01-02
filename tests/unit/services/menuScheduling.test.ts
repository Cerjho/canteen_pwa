// Menu Scheduling Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch for edge function calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock supabase
const mockGetSession = vi.fn();
vi.mock('../../../src/services/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession()
    }
  },
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'test-anon-key'
}));

describe('Menu Scheduling Edge Function', () => {
  const mockSession = {
    data: {
      session: {
        access_token: 'test-token'
      }
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(mockSession);
  });

  describe('add action', () => {
    it('should add product to menu for specific date', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          schedule: {
            id: 'schedule-1',
            product_id: 'product-1',
            scheduled_date: '2026-01-05',
            day_of_week: 1,
            is_active: true
          }
        })
      });

      const response = await fetch('https://test.supabase.co/functions/v1/manage-menu', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'add',
          product_id: 'product-1',
          scheduled_date: '2026-01-05',
          day_of_week: 1
        })
      });

      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.schedule.scheduled_date).toBe('2026-01-05');
    });

    it('should reject duplicate schedule for same date', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 409,
        json: () => Promise.resolve({
          error: 'ALREADY_EXISTS',
          message: 'Product already scheduled for this date'
        })
      });

      const response = await fetch('https://test.supabase.co/functions/v1/manage-menu', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'add',
          product_id: 'product-1',
          scheduled_date: '2026-01-05'
        })
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(409);
    });

    it('should require scheduled_date parameter', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({
          error: 'VALIDATION_ERROR',
          message: 'product_id and scheduled_date are required'
        })
      });

      const response = await fetch('https://test.supabase.co/functions/v1/manage-menu', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'add',
          product_id: 'product-1'
          // Missing scheduled_date
        })
      });

      expect(response.ok).toBe(false);
      const result = await response.json();
      expect(result.error).toBe('VALIDATION_ERROR');
    });
  });

  describe('add-bulk action', () => {
    it('should add multiple products to menu', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          added: 3
        })
      });

      const response = await fetch('https://test.supabase.co/functions/v1/manage-menu', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'add-bulk',
          product_ids: ['product-1', 'product-2', 'product-3'],
          scheduled_date: '2026-01-05'
        })
      });

      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.added).toBe(3);
    });

    it('should skip already scheduled products', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          added: 0,
          message: 'All products already scheduled'
        })
      });

      const response = await fetch('https://test.supabase.co/functions/v1/manage-menu', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'add-bulk',
          product_ids: ['product-1'],
          scheduled_date: '2026-01-05'
        })
      });

      const result = await response.json();
      expect(result.added).toBe(0);
    });
  });

  describe('copy-day action', () => {
    it('should copy menu from one date to another', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          copied: 5,
          from_date: '2026-01-05',
          to_date: '2026-01-06'
        })
      });

      const response = await fetch('https://test.supabase.co/functions/v1/manage-menu', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'copy-day',
          from_date: '2026-01-05',
          to_date: '2026-01-06'
        })
      });

      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.copied).toBe(5);
    });

    it('should fail when source date has no menu', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({
          error: 'NO_SOURCE_MENU',
          message: 'No menu items on source date'
        })
      });

      const response = await fetch('https://test.supabase.co/functions/v1/manage-menu', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'copy-day',
          from_date: '2026-01-10',
          to_date: '2026-01-11'
        })
      });

      expect(response.ok).toBe(false);
    });
  });

  describe('copy-week action', () => {
    it('should copy menu to all weekdays', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          copied_to_dates: ['2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09'],
          items_per_day: 5
        })
      });

      const response = await fetch('https://test.supabase.co/functions/v1/manage-menu', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'copy-week',
          from_date: '2026-01-05',
          week_start: '2026-01-05'
        })
      });

      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.copied_to_dates.length).toBe(4);
    });
  });

  describe('clear-day action', () => {
    it('should clear menu for specific date', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          scheduled_date: '2026-01-05',
          cleared: 5
        })
      });

      const response = await fetch('https://test.supabase.co/functions/v1/manage-menu', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'clear-day',
          scheduled_date: '2026-01-05'
        })
      });

      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.cleared).toBe(5);
    });
  });

  describe('clear-week action', () => {
    it('should clear menu for entire week', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          week_start: '2026-01-05',
          week_end: '2026-01-09',
          cleared: 25
        })
      });

      const response = await fetch('https://test.supabase.co/functions/v1/manage-menu', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'clear-week',
          week_start: '2026-01-05'
        })
      });

      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.cleared).toBe(25);
    });
  });

  describe('authorization', () => {
    it('should reject non-admin users', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        json: () => Promise.resolve({
          error: 'FORBIDDEN',
          message: 'Admin access required'
        })
      });

      const response = await fetch('https://test.supabase.co/functions/v1/manage-menu', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer parent-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'add',
          product_id: 'product-1',
          scheduled_date: '2026-01-05'
        })
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(403);
    });

    it('should reject missing authorization', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({
          error: 'UNAUTHORIZED',
          message: 'Missing authorization header'
        })
      });

      const response = await fetch('https://test.supabase.co/functions/v1/manage-menu', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'add',
          product_id: 'product-1',
          scheduled_date: '2026-01-05'
        })
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(401);
    });
  });
});
