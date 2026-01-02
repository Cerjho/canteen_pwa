// Supabase Mock for Testing
import { vi } from 'vitest';
import type { User, Session } from '@supabase/supabase-js';

// Mock user data
export const mockUser: User = {
  id: 'test-user-123',
  email: 'parent@test.com',
  app_metadata: {},
  user_metadata: {
    role: 'parent',
    first_name: 'Test',
    last_name: 'Parent'
  },
  aud: 'authenticated',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  phone: '',
  confirmed_at: '2024-01-01T00:00:00Z',
  email_confirmed_at: '2024-01-01T00:00:00Z',
  last_sign_in_at: '2024-01-01T00:00:00Z',
  role: '',
  identities: [],
  factors: []
};

export const mockSession: Session = {
  access_token: 'mock-access-token',
  refresh_token: 'mock-refresh-token',
  expires_in: 3600,
  expires_at: Date.now() / 1000 + 3600,
  token_type: 'bearer',
  user: mockUser
};

export const mockStaffUser: User = {
  ...mockUser,
  id: 'test-staff-123',
  email: 'staff@test.com',
  user_metadata: {
    role: 'staff',
    first_name: 'Test',
    last_name: 'Staff'
  }
};

export const mockAdminUser: User = {
  ...mockUser,
  id: 'test-admin-123',
  email: 'admin@test.com',
  user_metadata: {
    role: 'admin',
    first_name: 'Test',
    last_name: 'Admin'
  }
};

// Create mock Supabase client
export function createMockSupabase(options: {
  session?: Session | null;
  user?: User | null;
} = {}) {
  const { session = mockSession, user = mockUser } = options;

  let authChangeCallback: ((event: string, session: Session | null) => void) | null = null;

  const mockSupabase = {
    auth: {
      getSession: vi.fn().mockResolvedValue({ 
        data: { session }, 
        error: null 
      }),
      getUser: vi.fn().mockResolvedValue({ 
        data: { user }, 
        error: null 
      }),
      signInWithPassword: vi.fn().mockResolvedValue({
        data: { session, user },
        error: null
      }),
      signUp: vi.fn().mockResolvedValue({
        data: { session, user },
        error: null
      }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      onAuthStateChange: vi.fn((callback) => {
        authChangeCallback = callback;
        return {
          data: {
            subscription: {
              unsubscribe: vi.fn()
            }
          }
        };
      }),
      // Helper to trigger auth state change in tests
      _triggerAuthChange: (event: string, newSession: Session | null) => {
        if (authChangeCallback) {
          authChangeCallback(event, newSession);
        }
      }
    },
    from: vi.fn((table: string) => createMockQueryBuilder(table)),
    functions: {
      invoke: vi.fn().mockResolvedValue({ data: {}, error: null })
    },
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() })
    })),
    removeChannel: vi.fn()
  };

  return mockSupabase;
}

// Create mock query builder
interface MockQueryBuilder {
  _table: string;
  _data: unknown;
  _error: unknown;
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  neq: ReturnType<typeof vi.fn>;
  gt: ReturnType<typeof vi.fn>;
  gte: ReturnType<typeof vi.fn>;
  lt: ReturnType<typeof vi.fn>;
  lte: ReturnType<typeof vi.fn>;
  like: ReturnType<typeof vi.fn>;
  ilike: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  contains: ReturnType<typeof vi.fn>;
  containedBy: ReturnType<typeof vi.fn>;
  range: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  offset: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  then: (resolve: (value: { data: unknown; error: unknown }) => void) => void;
  _setMockData: (data: unknown) => MockQueryBuilder;
  _setMockError: (error: unknown) => MockQueryBuilder;
}

function createMockQueryBuilder(table: string): MockQueryBuilder {
  const builder: MockQueryBuilder = {
    _table: table,
    _data: null,
    _error: null,
    
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    like: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    contains: vi.fn().mockReturnThis(),
    containedBy: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    
    // Make the builder awaitable
    then: (resolve: (value: { data: unknown; error: unknown }) => void) => {
      resolve({ data: builder._data, error: builder._error });
    },
    
    // Set mock data
    _setMockData: (data: unknown) => {
      builder._data = data;
      return builder;
    },
    _setMockError: (error: unknown) => {
      builder._error = error;
      return builder;
    }
  };
  
  return builder;
}

// Default mock supabase instance
export const mockSupabase = createMockSupabase();

// Mock the supabase client module
export const supabaseMock = {
  supabase: mockSupabase
};
