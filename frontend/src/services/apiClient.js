import axios from "axios";

/**
 * Single Axios instance for the whole application.
 *
 * TOKEN MODEL (matches the backend's tokenService):
 *
 *   Access token   short-lived JWT, sent as a Bearer header. Mirrored to
 *                  localStorage so a page refresh does not sign the user out.
 *   Refresh token  httpOnly, SameSite=Strict cookie. JavaScript cannot read
 *                  it, so it is never touched by this file — the browser
 *                  attaches it automatically to /auth/refresh because
 *                  withCredentials is set.
 *
 * localStorage is readable by any script on the origin, which is why the
 * long-lived credential is deliberately NOT kept there. An XSS payload can
 * steal at most a token that expires shortly.
 */
const TOKEN_KEY = "bts.token";

/**
 * Same-origin by default.
 *
 * The fallback used to be http://localhost:5000/api/v1, which is wrong
 * everywhere except one developer's machine — and it fails silently, because
 * the value is baked in at BUILD time. A hosted build with no VITE_API_URL
 * produced a bundle that told every visitor's browser to call its own
 * localhost, so the site loaded perfectly and then reported "Unable to reach
 * the server" on the first request.
 *
 * A relative "/api/v1" is right for both real deployments: the single-server
 * production mode serves the API and the app on one origin, and the Vite dev
 * server proxies /api to the backend. Neither needs a host baked in, and a
 * missing env var now degrades to the correct behaviour instead of a broken one.
 */
const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api/v1",
  withCredentials: true,
  timeout: 30000,
});

export const getStoredToken = () => localStorage.getItem(TOKEN_KEY);

export const setStoredToken = (token) => {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
};

/** Lets AuthContext react to a session that could not be recovered. */
let onSessionLost = null;
export const setSessionLostHandler = (handler) => {
  onSessionLost = handler;
};

apiClient.interceptors.request.use((config) => {
  const token = getStoredToken();

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

/**
 * SINGLE-FLIGHT REFRESH.
 *
 * When a token expires, every in-flight request fails with 401 at roughly the
 * same moment. Refreshing once per failure would fire N parallel calls to
 * /auth/refresh — and because the backend ROTATES the refresh token and treats
 * reuse as a compromise, the second call would present an already-spent token
 * and get every session revoked. That would turn an ordinary expiry into a
 * forced sign-out.
 *
 * So the first 401 starts a refresh and the rest await that same promise.
 */
let refreshPromise = null;

const refreshSession = () => {
  if (!refreshPromise) {
    refreshPromise = apiClient
      .post("/auth/refresh", null, { skipAuthRefresh: true })
      .then((response) => {
        const token = response.data?.data?.token;
        if (!token) throw new Error("Refresh returned no token.");
        setStoredToken(token);
        return token;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
};

const normalizeError = (error) => {
  const message =
    error.response?.data?.message ||
    (error.code === "ECONNABORTED"
      ? "The server took too long to respond."
      : "Unable to reach the server. Is the API running?");

  const normalized = new Error(message);
  normalized.status = error.response?.status;
  normalized.details = error.response?.data;
  return normalized;
};

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { config, response } = error;
    const status = response?.status;

    /**
     * Retry exactly once, and never for the refresh call itself or for
     * requests made while signed out — otherwise a failed login would try to
     * refresh a session that never existed.
     */
    const canRetry =
      status === 401 && config && !config.skipAuthRefresh && !config.__retried && getStoredToken();

    if (canRetry) {
      config.__retried = true;

      try {
        const token = await refreshSession();
        config.headers.Authorization = `Bearer ${token}`;
        return apiClient(config);
      } catch {
        setStoredToken(null);
        onSessionLost?.();

        if (!window.location.pathname.startsWith("/login")) {
          window.location.assign("/login?expired=1");
        }

        return Promise.reject(normalizeError(error));
      }
    }

    // A 401 with no recoverable session: clear and bounce.
    if (status === 401 && getStoredToken() && config?.skipAuthRefresh) {
      setStoredToken(null);
      onSessionLost?.();
    }

    return Promise.reject(normalizeError(error));
  }
);

/** Unwraps the API's { status, message, data } envelope. */
export const unwrap = (response) => response.data?.data ?? null;

export default apiClient;
