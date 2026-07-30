import { useState } from "react";
import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import { FiLock, FiShield } from "react-icons/fi";
import * as yup from "yup";

import useAuth from "../../hooks/useAuth";
import { authApi } from "../../services";
import { setStoredToken } from "../../services/apiClient";
import { homeForRole } from "../../routes/ProtectedRoute";

/** Mirrors the backend password policy. */
const schema = yup.object({
  newPassword: yup
    .string()
    .required("Password is required.")
    .min(8, "Use at least 8 characters.")
    .matches(/[a-z]/, "Include a lowercase letter.")
    .matches(/[A-Z]/, "Include an uppercase letter.")
    .matches(/[0-9]/, "Include a number.")
    .matches(/[^A-Za-z0-9]/, "Include a special character."),
  newPasswordConfirm: yup
    .string()
    .required("Confirm your password.")
    .oneOf([yup.ref("newPassword")], "Passwords do not match."),
});

const ResetPassword = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const [submitting, setSubmitting] = useState(false);

  const token = params.get("token");

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: yupResolver(schema) });

  const onSubmit = async (values) => {
    setSubmitting(true);

    try {
      /**
       * A successful reset signs the user straight in — the backend returns a
       * fresh token pair, having revoked every previous session.
       */
      const data = await authApi.resetPassword({ token, ...values });

      setStoredToken(data.token);
      setUser(data.user);

      toast.success("Password reset. You are now signed in.");
      navigate(homeForRole(data.user.role), { replace: true });
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
          {!token ? (
            <>
              <h5 className="fw-bold mb-1">This link is incomplete</h5>
              <p className="text-muted small mb-4">
                The reset link is missing its token. Request a new one.
              </p>
              <Link to="/forgot-password" className="btn btn-primary w-100">
                Request a new link
              </Link>
            </>
          ) : (
            <>
              <h5 className="fw-bold mb-1">Set a new password</h5>
              <p className="text-muted small mb-4">
                Choosing a new password signs you out of every other device.
              </p>

              <form onSubmit={handleSubmit(onSubmit)} noValidate>
                <div className="mb-3">
                  <label className="form-label small fw-semibold">New password</label>
                  <input
                    type="password"
                    autoComplete="new-password"
                    className={`form-control ${errors.newPassword ? "is-invalid" : ""}`}
                    {...register("newPassword")}
                  />
                  {errors.newPassword && (
                    <div className="invalid-feedback">{errors.newPassword.message}</div>
                  )}
                </div>

                <div className="mb-4">
                  <label className="form-label small fw-semibold">Confirm new password</label>
                  <input
                    type="password"
                    autoComplete="new-password"
                    className={`form-control ${errors.newPasswordConfirm ? "is-invalid" : ""}`}
                    {...register("newPasswordConfirm")}
                  />
                  {errors.newPasswordConfirm && (
                    <div className="invalid-feedback">{errors.newPasswordConfirm.message}</div>
                  )}
                </div>

                <button type="submit" className="btn btn-primary w-100" disabled={submitting}>
                  {submitting ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" />
                      Resetting...
                    </>
                  ) : (
                    <>
                      <FiLock className="me-2" />
                      Reset password
                    </>
                  )}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
