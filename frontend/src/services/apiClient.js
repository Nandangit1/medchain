import axios from "axios";

/**
 * Single Axios instance for the whole application.
 *
 * The access token is held in memory and mirrored to localStorage so a page
 * refresh does not log the user out. localStorage is readable by any script on
 * the origin, which is the accepted trade-off for a Bearer-token design; the
 * httpOnly-cookie alternative is recorded as an open decision in PROJECT_TODO.
 */
const TOKEN_KEY = "bts.token";

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:5000/api/v1",
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

apiClient.interceptors.request.use((config) => {
  const token = getStoredToken();

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

/**
 * Normalises every failure into a plain Error carrying the backend's message,
 * so components never have to dig through the Axios error shape.
 *
 * A 401 clears the session and bounces to /login — but only if the user was
 * actually logged in, otherwise a failed login attempt would trigger a
 * redirect loop on the login page itself.
 */
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const message =
      error.response?.data?.message ||
      (error.code === "ECONNABORTED"
        ? "The server took too long to respond."
        : "Unable to reach the server. Is the API running?");

    if (status === 401 && getStoredToken()) {
      setStoredToken(null);

      if (!window.location.pathname.startsWith("/login")) {
        window.location.assign("/login?expired=1");
      }
    }

    const normalized = new Error(message);
    normalized.status = status;
    normalized.details = error.response?.data;

    return Promise.reject(normalized);
  }
);

/** Unwraps the API's { status, message, data } envelope. */
export const unwrap = (response) => response.data?.data ?? null;

export default apiClient;
