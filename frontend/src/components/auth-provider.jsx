import { useCallback, useEffect, useMemo, useState } from 'react';
import { AuthContext } from '../context/auth-context';
import { api, setAccessToken, setUnauthorizedHandler } from '../services/api';
import { disconnectRunSockets } from '../services/socket';

export function AuthProvider({ children }) {
  const [user, setUser] = useState();
  const [loading, setLoading] = useState(true);
  const [sessionMessage, setSessionMessage] = useState();

  const clearSession = useCallback((message) => {
    setAccessToken(undefined);
    disconnectRunSockets();
    setUser(undefined);
    setLoading(false);
    setSessionMessage(message);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => clearSession('Your session expired. Please sign in again.'));
    return () => setUnauthorizedHandler(undefined);
  }, [clearSession]);

  useEffect(() => {
    let active = true;
    api
      .refresh()
      .then((response) => {
        if (!active) return;
        setAccessToken(response.accessToken);
        setUser(response.user);
      })
      .catch(() => {
        if (active) clearSession(undefined);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [clearSession]);

  const acceptAuthentication = useCallback((response) => {
    setAccessToken(response.accessToken);
    setUser(response.user);
    setSessionMessage(undefined);
    return response.user;
  }, []);

  const login = useCallback(
    async (credentials) => acceptAuthentication(await api.login(credentials)),
    [acceptAuthentication],
  );
  const register = useCallback(
    async (credentials) => acceptAuthentication(await api.register(credentials)),
    [acceptAuthentication],
  );
  const googleLogin = useCallback(
    async (credential) => acceptAuthentication(await api.googleLogin(credential)),
    [acceptAuthentication],
  );
  const refreshUser = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.me();
      setUser(response.user);
      return response.user;
    } finally {
      setLoading(false);
    }
  }, []);
  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      clearSession(undefined);
    }
  }, [clearSession]);

  const value = useMemo(
    () => ({
      user,
      loading,
      sessionMessage,
      login,
      register,
      googleLogin,
      logout,
      refreshUser,
    }),
    [user, loading, sessionMessage, login, register, googleLogin, logout, refreshUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
