import { io } from 'socket.io-client';
import { API_BASE_URL } from './api';

export function createRunSocket() {
  return io(API_BASE_URL || window.location.origin, {
    autoConnect: false,
    transports: ['websocket', 'polling'],
  });
}
