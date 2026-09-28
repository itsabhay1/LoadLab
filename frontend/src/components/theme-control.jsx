import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../hooks/use-theme';

export function ThemeControl({ className = '' }) {
  const { resolvedTheme, toggleTheme } = useTheme();
  const dark = resolvedTheme === 'dark';
  const label = dark ? 'Switch to light theme' : 'Switch to dark theme';
  return (
    <button
      type="button"
      className={`theme-control ${className}`.trim()}
      aria-label={label}
      title={label}
      onClick={toggleTheme}
    >
      {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </button>
  );
}
