import { useEffect, useState } from 'react';

function initialTheme() {
  try {
    const saved = localStorage.getItem('loadlab-theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* Storage may be disabled; the in-memory preference still works. */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
export function useTheme() {
  const [theme, setTheme] = useState(initialTheme);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
    try {
      localStorage.setItem('loadlab-theme', theme);
    } catch {
      /* Persistence is optional in private or restricted browsers. */
    }
  }, [theme]);
  return { theme, toggleTheme: () => setTheme((value) => (value === 'dark' ? 'light' : 'dark')) };
}
