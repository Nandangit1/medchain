import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { FiArrowLeft, FiLock, FiMail, FiRefreshCw } from "react-icons/fi";
import * as yup from "yup";

import AuthLayout from "../../components/layout/AuthLayout";
import PasswordInput from "../../components/PasswordInput";
import useAuth from "../../hooks/useAuth";
import { authApi } from "../../services";
import { setStoredToken } from "../../services/apiClient";
import { homeForRole } from "../../routes/ProtectedRoute";

const RESEND_SECONDS = 60;

const emailSchema = yup.object({
  email: yup.string().required("Email is required.").email("Enter a valid email address."),
});

/** Mirrors the backend password policy. */
const resetSchema = yup.object({
  otp: yup
    .string()
    .required("Enter the code from your email.")
    .matches(/^\d{6}$/, "The code is 6 digits."),
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

/**
 * Two steps on one page: ask for the email, then take the 6-digit code it
 * received plus the new password. The server answers step one identically
 * whether or not the address has an account, so this screen cannot be used to
 * find out who is registered.
 */
const ForgotPassword = () => {
  const navigate = useNavigate();
  const { setUser } = useAuth();

  const [email, setEmail] = useState(null);
  const [devOtp, setDevOtp] = useState(null);
  const [expiresIn, setExpiresIn] = useState(10);
  const [cooldown, setCooldown] = useState(0);
  const [sending, setSending] = useState(false);
  const [resetting, setResetting] = useState(false);

  const emailForm = useForm({ resolver: yupResolver(emailSchema) });
  const resetForm = useForm({ resolver: yupResolver(resetSchema) });

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const sendCode = async (address) => {
    setSending(true);

    try {
      const data = await authApi.forgotPassword(address);
      setEmail(address);
      setExpiresIn(data?.expiresInMinutes ?? 10);
      // Only ever present in development, where no mail server may exist.
      setDevOtp(data?.devOtp ?? null);
      setCooldown(RESEND_SECONDS);
      toast.success("If that address has an account, a code is on its way.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSending(false);
    }
  };

  const onReset = async (values) => {
    setResetting(true);

    try {
      const data = await authApi.resetPassword({ email, ...values });

      // Accounts with two-factor go back through the normal sign-in.
      if (!data?.token) {
        toast.success("Password reset. Sign in with your new password and authenticator code.");
        navigate("/login", { replace: true });
        return;
      }

      setStoredToken(data.token);
      setUser(data.user);
      toast.success("Password reset. You are now signed in.");
      navigate(homeForRole(data.user.role), { replace: true });
    } catch (error) {
      toast.error(error.message);
    } finally {
      setResetting(false);
    }
  };

  if (!email) {
    return (
      <AuthLayout
        title="Forgot your password?"
        subtitle="Enter your account email. We will send a 6-digit verification code to it."
        footer={
          <Link to="/login" className="small">
            Back to sign in
          </Link>
        }
      >
        <form onSubmit={emailForm.handleSubmit((values) => sendCode(values.email))} noValidate>
          <div className="mb-4">
            <label className="form-label" htmlFor="fpEmail">
              Email address
            </label>
            <input
              id="fpEmail"
              type="email"
              autoComplete="email"
              autoFocus
              className={`form-control ${emailForm.formState.errors.email ? "is-invalid" : ""}`}
              placeholder="you@gmail.com"
              {...emailForm.register("email")}
            />
            {emailForm.formState.errors.email && (
              <div className="invalid-feedback">{emailForm.formState.errors.email.message}</div>
            )}
          </div>

          <button type="submit" className="btn btn-primary w-100" disabled={sending}>
            {sending ? (
              <>
                <span className="spinner-border spinner-border-sm me-2" />
                Sending...
              </>
            ) : (
              <>
                <FiMail className="me-2" />
                Send verification code
              </>
            )}
          </button>
        </form>
      </AuthLayout>
    );
  }

  const { errors } = resetForm.formState;

  return (
    <AuthLayout
      title="Enter your code"
      subtitle={`We sent a 6-digit code to ${email}. It expires in ${expiresIn} minutes. Check your spam folder if it is not in your inbox.`}
      footer={
        <button
          type="button"
          className="btn btn-link btn-sm p-0"
          onClick={() => {
            setEmail(null);
            setDevOtp(null);
            resetForm.reset();
          }}
        >
          <FiArrowLeft className="me-1" />
          Use a different email
        </button>
      }
    >
      {devOtp && (
        <div className="alert alert-warning small">
          <div className="fw-semibold mb-1">Development mode</div>
          Mail may not be configured here, so the code is shown:{" "}
          <code className="fs-6">{devOtp}</code>
        </div>
      )}

      <form onSubmit={resetForm.handleSubmit(onReset)} noValidate>
        <div className="mb-3">
          <label className="form-label" htmlFor="fpOtp">
            Verification code
          </label>
          <input
            id="fpOtp"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            autoFocus
            className={`form-control text-center fs-4 bts-mono ${errors.otp ? "is-invalid" : ""}`}
            style={{ letterSpacing: "0.5em" }}
            placeholder="••••••"
            {...resetForm.register("otp", { setValueAs: (value) => String(value).replace(/\s/g, "") })}
          />
          {errors.otp && <div className="invalid-feedback">{errors.otp.message}</div>}
        </div>

        <PasswordInput
          className="mb-3"
          id="newPassword"
          label="New password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          showStrength
          error={errors.newPassword?.message}
          {...resetForm.register("newPassword")}
        />

        <PasswordInput
          className="mb-4"
          id="newPasswordConfirm"
          label="Confirm new password"
          autoComplete="new-password"
          placeholder="Re-enter your new password"
          error={errors.newPasswordConfirm?.message}
          {...resetForm.register("newPasswordConfirm")}
        />

        <button type="submit" className="btn btn-primary w-100 mb-2" disabled={resetting}>
          {resetting ? (
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

        <button
          type="button"
          className="btn btn-outline-secondary w-100"
          disabled={sending || cooldown > 0}
          onClick={() => sendCode(email)}
        >
          <FiRefreshCw className="me-2" />
          {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
        </button>
      </form>
    </AuthLayout>
  );
};

export default ForgotPassword;
