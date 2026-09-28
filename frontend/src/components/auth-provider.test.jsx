// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../context/auth-context';
import { AuthProvider } from './auth-provider';

const mocks = vi.hoisted(() => ({
  api: {
    login: vi.fn(),
    register: vi.fn(),
    googleLogin: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
    me: vi.fn(),
  },
  setAccessToken: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
  disconnectRunSockets: vi.fn(),
}));

vi.mock('../services/api', () => ({
  api: mocks.api,
  setAccessToken: mocks.setAccessToken,
  setUnauthorizedHandler: mocks.setUnauthorizedHandler,
}));
vi.mock('../services/socket', () => ({
  disconnectRunSockets: mocks.disconnectRunSockets,
}));

const user = { id: '507f1f77bcf86cd799439010', name: 'Ada Lovelace', email: 'ada@example.com' };

function Probe() {
  const auth = useAuth();
  if (auth.loading) return <span>Restoring session</span>;
  return (
    <div>
      <span>{auth.user?.email ?? 'Signed out'}</span>
      <button type="button" onClick={() => auth.login({ email: user.email, password: 'Secret1A' })}>
        Sign in
      </button>
      <button type="button" onClick={auth.logout}>
        Sign out
      </button>
    </div>
  );
}

function renderProvider() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.api.refresh.mockRejectedValue(new Error('No refresh session'));
  mocks.api.logout.mockResolvedValue();
});

afterEach(cleanup);

describe('AuthProvider', () => {
  it('keeps successful authentication in memory without using browser storage', async () => {
    const storageSet = vi.spyOn(Storage.prototype, 'setItem');
    const storageGet = vi.spyOn(Storage.prototype, 'getItem');
    mocks.api.login.mockResolvedValue({ accessToken: 'signed-jwt', user });
    renderProvider();
    expect(screen.getByText('Restoring session')).toBeInTheDocument();
    await screen.findByText('Signed out');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(user.email)).toBeInTheDocument();
    expect(mocks.setAccessToken).toHaveBeenCalledWith('signed-jwt');
    expect(storageSet).not.toHaveBeenCalled();
    expect(storageGet).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('Signed out')).toBeInTheDocument();
    expect(mocks.api.logout).toHaveBeenCalledTimes(1);
    expect(mocks.setAccessToken).toHaveBeenLastCalledWith(undefined);
    expect(mocks.disconnectRunSockets).toHaveBeenCalled();
  });

  it('restores authentication from the HttpOnly refresh session before rendering content', async () => {
    mocks.api.refresh.mockResolvedValue({ accessToken: 'restored-jwt', user });
    renderProvider();
    expect(screen.getByText('Restoring session')).toBeInTheDocument();
    expect(await screen.findByText(user.email)).toBeInTheDocument();
    expect(mocks.api.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.setAccessToken).toHaveBeenCalledWith('restored-jwt');
  });

  it('treats a missing refresh session as a normal signed-out state', async () => {
    renderProvider();
    await waitFor(() => expect(screen.getByText('Signed out')).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mocks.setAccessToken).toHaveBeenCalledWith(undefined);
    expect(mocks.disconnectRunSockets).toHaveBeenCalled();
  });
});
