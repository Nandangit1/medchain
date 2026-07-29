import { createContext, useCallback, useEffect, useMemo, useState } from "react";

import { authApi } from "../services";
import { getStoredToken, setStoredToken } from "../services/apiClient";

export const AuthContext = createContext(null);

export const ROLES = Object.freeze({
  PATIENT: "patient",
  DOCTOR: "doctor",
  ADMIN: "admin",
});

/**
 * Holds the authenticated user for the whole tree.
 *
 * On mount, a stored token is re-validated against /auth/me rather than
 * trusted: the token may have expired, or the account may have been
 * deactivated by an admin since the last visit. `initialising` stays true
 * until that check settles, so protected routes never flash the login page
 * for a user who is in fact signed in.
 */
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [initialising, setInitialising] = useState(true);

  useEffect(() => {
    const restore = async () => {
      if (!getStoredToken()) {
        setInitialising(false);
        return;
      }

      try {
        const data = await authApi.me();
        setUser(data.user);
      } catch {
        // The interceptor has already cleared an invalid token.
        setStoredToken(null);
        setUser(null);
      } finally {
        setInitialising(false);
      }
    };

    restore();
  }, []);

  const login = useCallback(async (credentials) => {
    const data = await authApi.login(credentials);
    setStoredToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (payload) => {
    const data = await authApi.register(payload);
    setStoredToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    setStoredToken(null);
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const data = await authApi.me();
    setUser(data.user);
    return data.user;
  }, []);

  const value = useMemo(
    () => ({
      user,
      initialising,
      isAuthenticated: Boolean(user),
      role: user?.role ?? null,
      isVerifiedDoctor:
        user?.role === ROLES.DOCTOR && user?.doctorProfile?.verificationStatus === "verified",
      login,
      register,
      logout,
      refreshUser,
      setUser,
    }),
    [user, initialising, login, register, logout, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
