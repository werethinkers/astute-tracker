import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ user: null, unread: 0, ready: false });
  const refresh = useCallback(async () => {
    try {
      const d = await api.get('/me');
      setState({ user: d.user, unread: d.unread, ready: true });
    } catch {
      setState({ user: null, unread: 0, ready: true });
    }
  }, []);
  useEffect(() => {
    refresh();
    const out = () => setState({ user: null, unread: 0, ready: true });
    window.addEventListener('awt:signed-out', out);
    const t = setInterval(() => document.visibilityState === 'visible' && refresh(), 60000);
    // Sign-ins finished elsewhere (Google redirect, another tab) and sign-outs update the screen.
    const stop = api.onAuthChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') refresh();
    });
    return () => {
      window.removeEventListener('awt:signed-out', out);
      clearInterval(t);
      stop();
    };
  }, [refresh]);
  const logout = async () => {
    await api.post('/auth/logout').catch(() => {});
    setState({ user: null, unread: 0, ready: true });
  };
  return <AuthCtx.Provider value={{ ...state, refresh, logout, isAdmin: state.user?.role === 'admin' }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
