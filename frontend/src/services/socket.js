import { io } from 'socket.io-client';
import { API_BASE_URL, api, getAccessToken, notifyUnauthorized } from './api';

const sockets = new Set();
const AUTH_ERROR_CODES = new Set([
  'AUTH_REQUIRED',
  'TOKEN_EXPIRED',
  'INVALID_TOKEN',
  'USER_UNAVAILABLE',
]);

async function reauthenticateSocket(socket, error) {
  if (!AUTH_ERROR_CODES.has(error?.data?.code ?? error?.code) || !sockets.has(socket)) return;
  try {
    await api.refresh();
    if (!sockets.has(socket)) return;
    socket.auth = { token: getAccessToken() };
    if (!socket.connected) socket.connect();
  } catch {
    notifyUnauthorized();
  }
}

export function createRunSocket() {
  const socket = io(API_BASE_URL || window.location.origin, {
    autoConnect: false,
    transports: ['websocket', 'polling'],
    auth: { token: getAccessToken() },
  });
  sockets.add(socket);
  const handleAuthenticationError = (error) => void reauthenticateSocket(socket, error);
  socket.on('connect_error', handleAuthenticationError);
  socket.on('auth:error', handleAuthenticationError);
  return socket;
}

export function releaseRunSocket(socket) {
  socket.disconnect();
  sockets.delete(socket);
}

export function disconnectRunSockets() {
  for (const socket of sockets) socket.disconnect();
  sockets.clear();
}
