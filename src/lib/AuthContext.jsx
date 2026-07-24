import React, { createContext, useState, useContext, useEffect } from 'react';
import { getDeviceId } from '@/lib/electronBridge';

const SESSION_KEY = 'knull_activation_session_v1';
const API_BASE = import.meta.env.VITE_TRIGGER_API_BASE || '';
const DEFAULT_WS_URL = import.meta.env.VITE_TRIGGER_WS_URL || '';
const ALLOW_LOCAL_MOCK = String(import.meta.env.VITE_ALLOW_LOCAL_ACTIVATION || '').toLowerCase() === 'true';
const FORCE_ACTIVATION = String(import.meta.env.VITE_FORCE_ACTIVATION || '').toLowerCase() === 'true';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [authSession, setAuthSession] = useState(null);

  const saveSession = (session) => {
    if (!session) {
      localStorage.removeItem(SESSION_KEY);
      return;
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  };

  const loadSession = () => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && parsed.access_token ? parsed : null;
    } catch {
      return null;
    }
  };

  const buildSession = (payload, fallbackWsUrl = '') => {
    const expiresIn = Number(payload?.expires_in || payload?.expiresIn || 900);
    const expiresAt = Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 900) * 1000;
    return {
      access_token: payload?.access_token || payload?.accessToken || '',
      refresh_token: payload?.refresh_token || payload?.refreshToken || '',
      user_id: payload?.user_id || payload?.userId || 'local-user',
      key_id: payload?.key_id || payload?.keyId || null,
      ws_url: payload?.ws_url || payload?.wsUrl || fallbackWsUrl || DEFAULT_WS_URL || '',
      expires_at: payload?.expires_at || payload?.expiresAt || expiresAt,
    };
  };

  useEffect(() => {
    checkAppState();
  }, []);

  const checkAppState = async () => {
    if (FORCE_ACTIVATION) {
      saveSession(null);
      setAuthSession(null);
      setUser(null);
      setIsAuthenticated(false);
      setIsLoadingAuth(false);
      return;
    }

    const existing = loadSession();
    if (existing) {
      setAuthSession(existing);
      setUser({ id: existing.user_id, key_id: existing.key_id });
      setIsAuthenticated(true);
    } else {
      setAuthSession(null);
      setUser(null);
      setIsAuthenticated(false);
    }
    setIsLoadingAuth(false);
  };

  const activateWithKey = async (key) => {
    const trimmed = String(key || '').trim();
    if (!trimmed) return { ok: false, error: 'Activation key is required.' };

    setAuthError(null);

    let deviceId = 'unknown-device';
    try {
      const value = await getDeviceId();
      deviceId = typeof value === 'string' ? value : (value?.id || value?.deviceId || 'unknown-device');
    } catch {
      deviceId = 'unknown-device';
    }

    // Optional local fallback for development only.
    if (!API_BASE && ALLOW_LOCAL_MOCK) {
      const localSession = buildSession({
        access_token: `local-${Date.now()}`,
        refresh_token: `local-refresh-${Date.now()}`,
        user_id: `local-${deviceId}`,
        key_id: trimmed.slice(-6),
        expires_in: 3600,
      }, DEFAULT_WS_URL);
      setAuthSession(localSession);
      setUser({ id: localSession.user_id, key_id: localSession.key_id });
      setIsAuthenticated(true);
      saveSession(localSession);
      return { ok: true, local: true };
    }

    if (!API_BASE) {
      const message = 'Activation server not configured. Set VITE_TRIGGER_API_BASE.';
      setAuthError(message);
      return { ok: false, error: message };
    }

    try {
      const response = await fetch(`${API_BASE.replace(/\/$/, '')}/v1/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: trimmed,
          device_id: deviceId,
          app_version: import.meta.env.VITE_APP_VERSION || 'dev',
        }),
      });

      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = json?.error || json?.message || `Activation failed (${response.status})`;
        setAuthError(message);
        return { ok: false, error: message };
      }

      const session = buildSession(json, DEFAULT_WS_URL);
      if (!session.access_token) {
        const message = 'Activation response missing access token.';
        setAuthError(message);
        return { ok: false, error: message };
      }

      setAuthSession(session);
      setUser({ id: session.user_id, key_id: session.key_id });
      setIsAuthenticated(true);
      saveSession(session);
      return { ok: true };
    } catch (error) {
      const message = error?.message || 'Could not reach activation server.';
      setAuthError(message);
      return { ok: false, error: message };
    }
  };

  const refreshSession = async () => {
    const current = loadSession();
    if (!current?.refresh_token || !API_BASE) return current;

    try {
      const response = await fetch(`${API_BASE.replace(/\/$/, '')}/v1/token/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: current.refresh_token }),
      });

      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        logout();
        return null;
      }

      const next = buildSession({ ...current, ...json }, current.ws_url || DEFAULT_WS_URL);
      setAuthSession(next);
      setUser({ id: next.user_id, key_id: next.key_id });
      saveSession(next);
      return next;
    } catch {
      return current;
    }
  };

  const getValidAccessToken = async () => {
    const current = loadSession();
    if (!current?.access_token) return '';
    const expiresAt = Number(current.expires_at || 0);
    const mustRefresh = Number.isFinite(expiresAt) && expiresAt > 0 && (Date.now() + 30000 >= expiresAt);
    if (!mustRefresh) return current.access_token;
    const refreshed = await refreshSession();
    return refreshed?.access_token || '';
  };

  const logout = () => {
    setAuthSession(null);
    setUser(null);
    setIsAuthenticated(false);
    saveSession(null);
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      isAuthenticated, 
      isLoadingAuth,
      authError,
      authSession,
      logout,
      activateWithKey,
      refreshSession,
      getValidAccessToken,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};