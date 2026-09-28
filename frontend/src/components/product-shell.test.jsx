// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppFooter, AuthFooter } from './app-footer';
import { RouteTitle } from './route-title';
import { ThemeControl } from './theme-control';
import { ThemeProvider } from '../hooks/use-theme';

let systemDark;
let themeListeners;

function installMatchMedia(matches = false) {
  systemDark = matches;
  themeListeners = new Set();
  window.matchMedia = vi.fn(() => ({
    get matches() {
      return systemDark;
    },
    addEventListener: (_event, listener) => themeListeners.add(listener),
    removeEventListener: (_event, listener) => themeListeners.delete(listener),
    addListener: (listener) => themeListeners.add(listener),
    removeListener: (listener) => themeListeners.delete(listener),
  }));
}

function changeSystemTheme(matches) {
  systemDark = matches;
  for (const listener of themeListeners) listener({ matches });
}

afterEach(() => cleanup());
beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  document.documentElement.removeAttribute('data-theme');
  installMatchMedia(false);
});

describe('global product shell', () => {
  it('uses system theme by default and reacts to operating-system changes', async () => {
    installMatchMedia(true);
    render(
      <ThemeProvider>
        <ThemeControl />
      </ThemeProvider>,
    );
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem('loadlab-theme')).toBeNull();
    expect(screen.queryByRole('option', { name: 'System' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Light' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Dark' })).not.toBeInTheDocument();
    act(() => changeSystemTheme(false));
    expect(document.documentElement).not.toHaveClass('dark');
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument();
  });

  it('uses system light on first use', () => {
    render(
      <ThemeProvider>
        <ThemeControl />
      </ThemeProvider>,
    );
    expect(document.documentElement).not.toHaveClass('dark');
    expect(localStorage.getItem('loadlab-theme')).toBeNull();
  });

  it('persists explicit preference across navigation and remounting', async () => {
    const view = render(
      <ThemeProvider>
        <MemoryRouter initialEntries={['/login']}>
          <ThemeControl />
          <Link to="/workspace">Continue</Link>
          <Routes>
            <Route path="/login" element={<p>Sign in route</p>} />
            <Route path="/workspace" element={<p>Workspace route</p>} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(document.documentElement).toHaveClass('dark');
    await userEvent.click(screen.getByRole('link', { name: 'Continue' }));
    expect(await screen.findByText('Workspace route')).toBeInTheDocument();
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem('loadlab-theme')).toBe('dark');
    view.unmount();
    render(
      <ThemeProvider>
        <ThemeControl />
      </ThemeProvider>,
    );
    expect(document.documentElement).toHaveClass('dark');
    act(() => changeSystemTheme(true));
    expect(document.documentElement).toHaveClass('dark');
    await userEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement).not.toHaveClass('dark');
    expect(localStorage.getItem('loadlab-theme')).toBe('light');
    await userEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem('loadlab-theme')).toBe('dark');
  });

  it.each([
    ['/login', 'LoadLab · Sign In'],
    ['/register', 'LoadLab · Create Account'],
    ['/', 'LoadLab · Overview'],
    ['/plans', 'LoadLab · Test Plans'],
    ['/targets', 'LoadLab · Verified Targets'],
    ['/history', 'LoadLab · Run History'],
    ['/compare', 'LoadLab · Compare Runs'],
    ['/runs/123', 'LoadLab · Run Details'],
    ['/runs/123/live', 'LoadLab · Live Run'],
    ['/missing', 'LoadLab · Not Found'],
  ])('sets the title for %s', async (path, title) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <RouteTitle />
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.title).toBe(title));
  });

  it('renders the accessible product footer link', () => {
    render(<AppFooter />);
    expect(screen.getByText('© 2026 LoadLab. All rights reserved.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '@itsabhay1' })).toHaveAttribute(
      'href',
      'https://github.com/itsabhay1',
    );
    expect(screen.getByRole('link', { name: '@itsabhay1' })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
  });

  it('renders the compact auth attribution without the application footer copy', () => {
    render(<AuthFooter />);
    expect(screen.getByText('© 2026 LoadLab')).toBeInTheDocument();
    expect(screen.getByText('Built by Abhay Agrawal')).toBeInTheDocument();
    expect(screen.queryByText(/All rights reserved/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '@itsabhay1' })).toHaveAttribute(
      'href',
      'https://github.com/itsabhay1',
    );
    expect(screen.getByRole('link', { name: '@itsabhay1' })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
  });
});
