import { Navigate, useLocation } from "react-router-dom";

import { Loader } from "../components/common";
import useAuth from "../hooks/useAuth";

/** Where each role belongs when they land somewhere they should not be. */
export const homeForRole = (role) =>
  ({ patient: "/patient", doctor: "/doctor", admin: "/admin" })[role] || "/";

/**
 * Gate for authenticated routes.
 *
 * This is a convenience layer, not a security boundary — the API enforces
 * authorisation on every request. Its job is to avoid showing a user a screen
 * that would only fill with 403s.
 */
const ProtectedRoute = ({ allow, children }) => {
  const { isAuthenticated, initialising, role } = useAuth();
  const location = useLocation();

  // Wait for the session check, otherwise a refresh flashes the login page.
  if (initialising) {
    return <Loader label="Checking your session..." height="100vh" />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allow && !allow.includes(role)) {
    return <Navigate to={homeForRole(role)} replace />;
  }

  return children;
};

export default ProtectedRoute;
