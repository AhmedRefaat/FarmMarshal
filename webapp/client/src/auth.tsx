/**
 * auth.tsx — session context for the SPA.
 * Stores {token, user} in localStorage so refreshes keep you logged in,
 * and exposes login()/logout() used by the Login page and header.
 */

import React, {
  createContext,
  useContext,
  useMemo,
  useState,
} from 'react';
import type { User } from './types';
import { api } from './api';

interface AuthValue {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthValue>(null as any);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Restore persisted session on first render (survives page reloads).
  const [user, setUser] = useState<User | null>(() => {
    const raw = localStorage.getItem('farmmarshal_user');
    return raw ? (JSON.parse(raw) as User) : null;
  });

  async function login(email: string, password: string) {
    const { token, user } = await api.login(email, password);
    localStorage.setItem('farmmarshal_token', token); // used by api.ts
    localStorage.setItem('farmmarshal_user', JSON.stringify(user));
    setUser(user);
  }

  function logout() {
    localStorage.removeItem('farmmarshal_token');
    localStorage.removeItem('farmmarshal_user');
    setUser(null);
  }

  const value = useMemo(() => ({ user, login, logout }), [user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Hook: `const { user, logout } = useAuth()` from any component. */
export const useAuth = () => useContext(AuthContext);
