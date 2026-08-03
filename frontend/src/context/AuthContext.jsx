import { createContext, useCallback, useEffect, useMemo, useState } from "react";

import { authApi } from "../services";
import { getStoredToken, setSessionLostHandler, setStoredToken } from "../services/apiClient";

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

  /**
   * Returns either the signed-in user, or a challenge the caller must answer.
   *
   * When a second factor is enrolled the server withholds the session and
   * returns a short-lived challenge token instead, so this cannot simply assume
   * `data.token` exists.
   */
  const login = useCallback(async (credentials) => {
    const data = await authApi.login(credentials);

    if (data.mfaRequired) {
      return { mfaRequired: true, challengeToken: data.challengeToken };
    }

    setStoredToken(data.token);
    setUser(data.user);
    return { user: data.user };
  }, []);

  /** Second leg of an MFA sign-in: exchanges the challenge for a session. */
  const verifyMfa = useCallback(async ({ challengeToken, code }) => {
    const data = await authApi.mfaVerify({ challengeToken, code });
    setStoredToken(data.token);
    setUser(data.user);
    return { user: data.user, backupCodesRemaining: data.backupCodesRemaining };
  }, []);

  const register = useCallback(async (payload) => {
    const data = await authApi.register(payload);
    setStoredToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  /**
   * Tells the server to revoke the refresh token before clearing local state.
   * Without this the httpOnly cookie would stay valid and a later /refresh
   * could resurrect the session.
   */
  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Signing out locally must succeed even if the server is unreachable.
    }

    setStoredToken(null);
    setUser(null);
  }, []);

  // Lets the Axios layer drop the user when a refresh cannot be recovered.
  useEffect(() => {
    setSessionLostHandler(() => setUser(null));
    return () => setSessionLostHandler(null);
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
      verifyMfa,
      register,
      logout,
      refreshUser,
      setUser,
    }),
    [user, initialising, login, verifyMfa, register, logout, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
