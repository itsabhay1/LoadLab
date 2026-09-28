// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map(),
  socket: {
    on: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    connected: false,
    auth: undefined,
  },
  io: vi.fn(),
  refresh: vi.fn(),
  getAccessToken: vi.fn(),
  notifyUnauthorized: vi.fn(),
}));

vi.mock('socket.io-client', () => ({ io: mocks.io }));
vi.mock('./api', () => ({
  API_BASE_URL: '',
  api: { refresh: mocks.refresh },
  getAccessToken: mocks.getAccessToken,
  notifyUnauthorized: mocks.notifyUnauthorized,
}));

const { createRunSocket, releaseRunSocket } = await import('./socket');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.handlers.clear();
  mocks.socket.connected = false;
  mocks.socket.auth = undefined;
  mocks.socket.on.mockImplementation((event, handler) => {
    mocks.handlers.set(event, handler);
    return mocks.socket;
  });
  mocks.io.mockImplementation((_url, options) => {
    mocks.socket.auth = options.auth;
    return mocks.socket;
  });
  mocks.getAccessToken.mockReturnValue('initial-access');
  mocks.refresh.mockResolvedValue({ accessToken: 'fresh-access' });
});

describe('authenticated run socket', () => {
  it('refreshes and reconnects with the latest access token after expiry', async () => {
    const socket = createRunSocket();
    expect(socket.auth).toEqual({ token: 'initial-access' });
    mocks.getAccessToken.mockReturnValue('fresh-access');

    mocks.handlers.get('auth:error')({ code: 'TOKEN_EXPIRED' });
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(socket.auth).toEqual({ token: 'fresh-access' });
    expect(socket.connect).toHaveBeenCalledTimes(1);
    expect(mocks.notifyUnauthorized).not.toHaveBeenCalled();
    releaseRunSocket(socket);
  });

  it('reports an unavailable refresh session and leaves the socket disconnected', async () => {
    mocks.refresh.mockRejectedValue(new Error('no session'));
    const socket = createRunSocket();
    mocks.handlers.get('connect_error')({ data: { code: 'INVALID_TOKEN' } });
    await vi.waitFor(() => expect(mocks.notifyUnauthorized).toHaveBeenCalledTimes(1));
    expect(socket.connect).not.toHaveBeenCalled();
    releaseRunSocket(socket);
  });
});
