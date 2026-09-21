/* ---------------------------------------------------------------------------
   Auth state, shared across the app.

   Wraps `authService` so components get `{ user, loading, signIn, signUp,
   signOut }` without knowing whether the provider behind it is Cognito or the
   local mock.
   --------------------------------------------------------------------------- */

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import * as auth from '../services/authService.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore the session on first paint (Cognito reads its refresh token here).
  useEffect(() => {
    let cancelled = false;
    auth
      .getCurrentUser()
      .then((current) => {
        if (!cancelled) setUser(current);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (email, password) => {
    await auth.login(email, password);
    const current = await auth.getCurrentUser();
    setUser(current);
    return current;
  }, []);

  const signUp = useCallback((email, password, name) => auth.register(email, password, name), []);

  const signOut = useCallback(async () => {
    await auth.logout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, signIn, signUp, signOut, authMode: auth.authMode }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- hook must live next to the context it reads
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>.');
  return ctx;
}
