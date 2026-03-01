import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Sentry from '@sentry/react';
import App from './App';
import { ToastProvider } from './components/Toast';
import { ThemeProvider } from './hooks/useTheme';
import { AuthProvider } from './hooks/useAuth';
import './index.css';

// ── Sentry error monitoring ────────────────────────────────
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
    ],
    tracesSampleRate: import.meta.env.PROD ? 0.2 : 1.0,
    replaysSessionSampleRate: 0,     // Only record replays on error
    replaysOnErrorSampleRate: 1.0,
    // Don't send PII
    sendDefaultPii: false,
  });
}

// Create React Query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
      refetchOnWindowFocus: false
    }
  }
});

// Note: Service Worker registration is handled by vite-plugin-pwa with registerType: 'autoUpdate'
// Manual registration removed to avoid conflicts

// Listen for SW update messages — reload the page to pick up the new deployment
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'SW_UPDATED') {
      // Clear React Query cache before reload so stale data doesn't persist
      queryClient.clear();
      window.location.reload();
    }
  });
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found');

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<p className="p-8 text-center text-red-600">Something went wrong. Please refresh the page.</p>}>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <ThemeProvider>
              <ToastProvider>
                <App />
              </ToastProvider>
            </ThemeProvider>
          </AuthProvider>
        </QueryClientProvider>
      </BrowserRouter>
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);

// Dismiss splash screen after React has mounted
requestAnimationFrame(() => {
  const splash = document.getElementById('splash-screen');
  if (splash) {
    // Small delay so the first paint is visible
    setTimeout(() => {
      splash.classList.add('hide');
      splash.addEventListener('transitionend', () => splash.remove(), { once: true });
    }, 600);
  }
});