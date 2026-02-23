/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

const THEME_STORAGE_KEY = 'canteen_theme';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    // Check localStorage first
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (savedTheme === 'light' || savedTheme === 'dark') {
      return savedTheme;
    }
    // Check system preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  });

  // Track blob URL for cleanup
  const blobUrlRef = useRef('');

  useEffect(() => {
    // Apply theme to document — reuse the global helper from index.html
    // so splash screen, status bar, and CSS vars all update in one place
    if (typeof (window as any).__applyTheme === 'function') {
      (window as any).__applyTheme(theme);
    } else {
      // Fallback if helper isn't available
      const root = document.documentElement;
      if (theme === 'dark') {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
      const metaTheme = document.querySelector('meta[name="theme-color"]');
      if (metaTheme) {
        metaTheme.setAttribute('content', theme === 'dark' ? '#111827' : '#F9FAFB');
      }
    }
    // Save to localStorage
    localStorage.setItem(THEME_STORAGE_KEY, theme);

    // Update manifest dynamically
    // Revoke previous blob URL to prevent memory leak
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = '';
    }
    const manifestEl = document.querySelector('link[rel="manifest"]');
    if (manifestEl) {
      fetch(manifestEl.getAttribute('href') || '/manifest.webmanifest')
        .then(res => res.json())
        .then(manifest => {
          const bg = theme === 'dark' ? '#111827' : '#F9FAFB';
          manifest.background_color = bg;
          manifest.theme_color = bg;
          const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          blobUrlRef.current = url;
          manifestEl.setAttribute('href', url);
        });
    }
  }, [theme]);

  const toggleTheme = () => {
    setThemeState(prev => prev === 'light' ? 'dark' : 'light');
  };

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
  };

  // Sync with OS-level theme changes
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      // Only auto-switch if user hasn't set an explicit preference
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (!saved) {
        setThemeState(e.matches ? 'dark' : 'light');
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}
