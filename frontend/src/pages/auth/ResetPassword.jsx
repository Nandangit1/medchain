import { useState } from "react";
import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import { FiLock } from "react-icons/fi";
import * as yup from "yup";

import AuthLayout from "../../components/layout/AuthLayout";
import PasswordInput from "../../components/PasswordInput";
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

  if (!token) {
    return (
      <AuthLayout
        title="This link is incomplete"
        subtitle="The reset link is missing its token."
      >
        <Link to="/forgot-password" className="btn btn-primary w-100">
          Request a new link
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Set a new password"
      subtitle="Choosing a new password signs you out of every other device."
      footer={
        <span className="text-muted small">
          Remembered it? <Link to="/login">Sign in</Link>
        </span>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <PasswordInput
          className="mb-3"
          id="newPassword"
          label="New password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          autoFocus
          showStrength
          error={errors.newPassword?.message}
          {...register("newPassword")}
        />

        <PasswordInput
          className="mb-4"
          id="newPasswordConfirm"
          label="Confirm new password"
          autoComplete="new-password"
          placeholder="Re-enter your new password"
          error={errors.newPasswordConfirm?.message}
          {...register("newPasswordConfirm")}
        />

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
    </AuthLayout>
  );
};

export default ResetPassword;
