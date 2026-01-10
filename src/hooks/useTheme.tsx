/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

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

  // Utility to update manifest and meta theme-color
  const updateThemeColors = (theme: Theme) => {
    // Update manifest
    const manifestEl = document.querySelector('link[rel="manifest"]');
    if (manifestEl) {
      fetch(manifestEl.getAttribute('href') || '/manifest.webmanifest')
        .then(res => res.json())
        .then(manifest => {
          manifest.background_color = theme === 'dark' ? '#18181b' : '#ffffff';
          manifest.theme_color = theme === 'dark' ? '#18181b' : '#ffffff';
          const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          manifestEl.setAttribute('href', url);
        });
    }
    // Update meta theme-color
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', theme === 'dark' ? '#18181b' : '#4F46E5');
    }
  };

  useEffect(() => {
    // Apply theme to document
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    // Save to localStorage
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    // Update manifest and meta theme-color
    updateThemeColors(theme);
  }, [theme]);

  const toggleTheme = () => {
    setThemeState(prev => prev === 'light' ? 'dark' : 'light');
  };

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
  };

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
