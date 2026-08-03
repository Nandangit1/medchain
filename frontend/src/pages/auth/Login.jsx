import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import { FiArrowRight } from "react-icons/fi";
import * as yup from "yup";

import AuthLayout from "../../components/layout/AuthLayout";
import PasswordInput from "../../components/PasswordInput";
import useAuth from "../../hooks/useAuth";
import { homeForRole } from "../../routes/ProtectedRoute";

const schema = yup.object({
  email: yup.string().required("Email is required.").email("Enter a valid email address."),
  password: yup.string().required("Password is required."),
});

const Login = () => {
  const { login, verifyMfa, isAuthenticated, role } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [submitting, setSubmitting] = useState(false);
  // Set only between a correct password and a correct second factor.
  const [challengeToken, setChallengeToken] = useState(null);
  const [code, setCode] = useState("");

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
      const result = await login(values);

      // The password was right, but the account has a second factor. Swap the
      // form for the code prompt rather than navigating anywhere.
      if (result.mfaRequired) {
        setChallengeToken(result.challengeToken);
        return;
      }

      toast.success(`Welcome back, ${result.user.name.split(" ")[0]}.`);
      navigate(homeForRole(result.user.role), { replace: true });
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const onVerify = async (event) => {
    event.preventDefault();
    setSubmitting(true);

    try {
      const { user, backupCodesRemaining } = await verifyMfa({ challengeToken, code });

      if (backupCodesRemaining !== undefined && backupCodesRemaining <= 2) {
        toast.warn(`Only ${backupCodesRemaining} backup codes left. Generate more in Security.`);
      }

      toast.success(`Welcome back, ${user.name.split(" ")[0]}.`);
      navigate(homeForRole(user.role), { replace: true });
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (challengeToken) {
    return (
      <AuthLayout
        title="Two-factor verification"
        subtitle="Enter the 6-digit code from your authenticator app."
      >
        <form onSubmit={onVerify} noValidate>
          <div className="mb-3">
            <label className="form-label" htmlFor="mfa-code">
              Authentication code
            </label>
            <input
              id="mfa-code"
              className="form-control text-center"
              style={{ letterSpacing: 8, fontSize: "1.3rem" }}
              placeholder="000000"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              value={code}
              onChange={(event) => setCode(event.target.value.trim())}
            />
            <div className="form-text">
              Lost your phone? Enter one of your backup codes instead.
            </div>
          </div>

          <button className="btn btn-primary w-100" type="submit" disabled={submitting}>
            {submitting ? "Verifying..." : "Verify"}
            <FiArrowRight className="ms-2" />
          </button>

          <button
            type="button"
            className="btn btn-link w-100 mt-2"
            onClick={() => {
              setChallengeToken(null);
              setCode("");
            }}
          >
            Back to sign in
          </button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Access your secure health records."
      footer={
        <span className="text-muted small">
          No account yet? <Link to="/register">Create one</Link>
        </span>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="mb-3">
          <label className="form-label" htmlFor="email">
            Email address
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            className={`form-control ${errors.email ? "is-invalid" : ""}`}
            placeholder="you@example.com"
            {...register("email")}
          />
          {errors.email && <div className="invalid-feedback">{errors.email.message}</div>}
        </div>

        <PasswordInput
          className="mb-4"
          id="password"
          label="Password"
          autoComplete="current-password"
          placeholder="Enter your password"
          error={errors.password?.message}
          labelAction={
            <Link to="/forgot-password" style={{ fontSize: "0.775rem" }}>
              Forgot password?
            </Link>
          }
          {...register("password")}
        />

        <button type="submit" className="btn btn-primary w-100" disabled={submitting}>
          {submitting ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" />
              Signing in...
            </>
          ) : (
            <>
              Sign in
              <FiArrowRight className="ms-2" />
            </>
          )}
        </button>
      </form>
    </AuthLayout>
  );
};

export default Login;
