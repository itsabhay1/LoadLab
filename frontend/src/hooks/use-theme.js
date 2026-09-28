import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';

const STORAGE_KEY = 'loadlab-theme';
const SYSTEM_QUERY = '(prefers-color-scheme: dark)';
const ThemeContext = createContext(undefined);

function savedPreference() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
    if (saved !== null) localStorage.removeItem(STORAGE_KEY);
    return undefined;
  } catch {
    return undefined;
  }
}

function systemPrefersDark() {
  return window.matchMedia?.(SYSTEM_QUERY).matches ?? false;
}

function applyResolvedTheme(theme, preference) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
  document.documentElement.dataset.theme = preference ?? 'system';
}

export function ThemeProvider({ children }) {
  const [preference, setPreference] = useState(savedPreference);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  const resolvedTheme = preference ?? (systemDark ? 'dark' : 'light');

  useLayoutEffect(() => {
    applyResolvedTheme(resolvedTheme, preference);
    if (preference) {
      try {
        localStorage.setItem(STORAGE_KEY, preference);
      } catch {
        // Theme still works for the current tab when storage is unavailable.
      }
    }
  }, [preference, resolvedTheme]);

  useEffect(() => {
    if (preference) return undefined;
    const media = window.matchMedia?.(SYSTEM_QUERY);
    if (!media) return undefined;
    const update = (event) => setSystemDark(event.matches);
    if (media.addEventListener) media.addEventListener('change', update);
    else media.addListener?.(update);
    return () => {
      if (media.removeEventListener) media.removeEventListener('change', update);
      else media.removeListener?.(update);
    };
  }, [preference]);

  const toggleTheme = useCallback(
    () => setPreference(resolvedTheme === 'dark' ? 'light' : 'dark'),
    [resolvedTheme],
  );

  const value = useMemo(
    () => ({ preference, resolvedTheme, toggleTheme }),
    [preference, resolvedTheme, toggleTheme],
  );
  return createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used within ThemeProvider.');
  return value;
}
