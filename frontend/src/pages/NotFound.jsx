import { Link } from "react-router-dom";
import { FiCompass } from "react-icons/fi";

import useAuth from "../hooks/useAuth";
import { homeForRole } from "../routes/ProtectedRoute";

const NotFound = () => {
  const { isAuthenticated, role } = useAuth();

  return (
    <div className="container py-5 text-center" style={{ maxWidth: 520 }}>
      <div className="bts-card p-5">
        <div className="mb-3" style={{ fontSize: "2.6rem", color: "var(--bts-text-muted)" }}>
          <FiCompass />
        </div>
        <h4 className="fw-bold">Page not found</h4>
        <p className="text-muted small mb-4">
          That address does not exist, or you no longer have access to it.
        </p>
        <Link className="btn btn-primary" to={isAuthenticated ? homeForRole(role) : "/"}>
          Back to safety
        </Link>
      </div>
    </div>
  );
};

export default NotFound;
