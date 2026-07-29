import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import { FiLogIn, FiShield } from "react-icons/fi";
import * as yup from "yup";

import useAuth from "../../hooks/useAuth";
import { homeForRole } from "../../routes/ProtectedRoute";

const schema = yup.object({
  email: yup.string().required("Email is required.").email("Enter a valid email address."),
  password: yup.string().required("Password is required."),
});

const Login = () => {
  const { login, isAuthenticated, role } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: yupResolver(schema) });

  useEffect(() => {
    if (params.get("expired")) {
      toast.info("Your session expired. Please sign in again.");
    }
  }, [params]);

  useEffect(() => {
    if (isAuthenticated) {
      navigate(homeForRole(role), { replace: true });
    }
  }, [isAuthenticated, role, navigate]);

  const onSubmit = async (values) => {
    setSubmitting(true);

    try {
      const user = await login(values);
      toast.success(`Welcome back, ${user.name.split(" ")[0]}.`);
      navigate(homeForRole(user.role), { replace: true });
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="d-flex align-items-center justify-content-center min-vh-100 p-3">
      <div className="w-100" style={{ maxWidth: 420 }}>
        <div className="text-center mb-4">
          <Link to="/" className="d-inline-flex align-items-center gap-2 fw-bold fs-5 text-decoration-none">
            <span className="bts-brand-mark">
              <FiShield />
            </span>
            MedChain
          </Link>
        </div>

        <div className="bts-card p-4 bts-fade-in">
          <h5 className="fw-bold mb-1">Sign in</h5>
          <p className="text-muted small mb-4">Access your secure health records.</p>

          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="mb-3">
              <label className="form-label small fw-semibold" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                className={`form-control ${errors.email ? "is-invalid" : ""}`}
                placeholder="you@example.com"
                {...register("email")}
              />
              {errors.email && <div className="invalid-feedback">{errors.email.message}</div>}
            </div>

            <div className="mb-4">
              <label className="form-label small fw-semibold" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                className={`form-control ${errors.password ? "is-invalid" : ""}`}
                placeholder="••••••••"
                {...register("password")}
              />
              {errors.password && <div className="invalid-feedback">{errors.password.message}</div>}
            </div>

            <button type="submit" className="btn btn-primary w-100" disabled={submitting}>
              {submitting ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" />
                  Signing in...
                </>
              ) : (
                <>
                  <FiLogIn className="me-2" />
                  Sign in
                </>
              )}
            </button>
          </form>

          <p className="text-center text-muted small mt-4 mb-0">
            No account yet? <Link to="/register">Create one</Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
