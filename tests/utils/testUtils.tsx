/* eslint-disable react-refresh/only-export-components */
// Test Utilities and Wrapper Components
import { ReactNode } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../src/components/Toast';
import { vi, expect } from 'vitest';

// Create a test query client with disabled retries and caching
export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

interface WrapperProps {
  children: ReactNode;
}

// All providers wrapper
export function AllProviders({ children }: WrapperProps) {
  const queryClient = createTestQueryClient();
  
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ToastProvider>
          {children}
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

// Memory router wrapper for controlled navigation testing
export function createMemoryRouterWrapper(initialEntries: string[] = ['/']) {
  return function MemoryRouterWrapper({ children }: WrapperProps) {
    const queryClient = createTestQueryClient();
    
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <ToastProvider>
            {children}
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  };
}

// Query client only wrapper (for hook testing)
export function QueryWrapper({ children }: WrapperProps) {
  const queryClient = createTestQueryClient();
  
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}

// Custom render with all providers
export function renderWithProviders(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  return render(ui, { wrapper: AllProviders, ...options });
}

// Custom render with memory router
export function renderWithMemoryRouter(
  ui: React.ReactElement,
  { initialEntries = ['/'], ...options }: Omit<RenderOptions, 'wrapper'> & { initialEntries?: string[] } = {}
) {
  return render(ui, {
    wrapper: createMemoryRouterWrapper(initialEntries),
    ...options,
  });
}

// Wait for loading states to resolve
export function waitForLoadingToFinish() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Create mock event
export function createMockEvent(overrides = {}) {
  return {
    preventDefault: () => {},
    stopPropagation: () => {},
    target: { value: '' },
    ...overrides,
  };
}

// Simulate online/offline status
export function setOnlineStatus(online: boolean) {
  Object.defineProperty(navigator, 'onLine', {
    value: online,
    writable: true,
    configurable: true,
  });
  
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

// Mock local storage
export function mockLocalStorage() {
  const store: Record<string, string> = {};
  
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach(key => delete store[key]); },
    get length() { return Object.keys(store).length; },
    key: (index: number) => Object.keys(store)[index] || null,
  };
}

// Date helpers for testing
export function createMockDate(dateString: string) {
  return new Date(dateString);
}

export function mockDateNow(dateString: string) {
  const mockDate = new Date(dateString);
  vi.spyOn(global, 'Date').mockImplementation(() => mockDate as unknown as string);
}

// Type guard helpers
export function isError(value: unknown): value is Error {
  return value instanceof Error;
}

// Assertion helpers
export function expectToBeInDocument(element: HTMLElement | null) {
  expect(element).toBeInTheDocument();
}

export function expectNotToBeInDocument(element: HTMLElement | null) {
  expect(element).not.toBeInTheDocument();
}
