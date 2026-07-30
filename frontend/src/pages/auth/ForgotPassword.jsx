import { useState } from "react";
import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { FiArrowLeft, FiMail, FiShield } from "react-icons/fi";
import * as yup from "yup";

import { authApi } from "../../services";

const schema = yup.object({
  email: yup.string().required("Email is required.").email("Enter a valid email address."),
});

const ForgotPassword = () => {
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: yupResolver(schema) });

  const onSubmit = async (values) => {
    setSubmitting(true);

    try {
      const data = await authApi.forgotPassword(values.email);

      /**
       * The backend returns the same message whether or not the address is
       * registered, so this screen cannot be used to discover who has an
       * account. In development it also returns the link, since no mail
       * transport is configured.
       */
      setSent(true);
      if (data?.resetUrl) setDevLink(data.resetUrl);
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
          {sent ? (
            <>
              <h5 className="fw-bold mb-1">Check your inbox</h5>
              <p className="text-muted small mb-3">
                If an account exists for that address, we have sent a link to reset your password.
                It expires in 30 minutes.
              </p>

              {devLink && (
                <div className="alert alert-warning small">
                  <div className="fw-semibold mb-1">Development mode</div>
                  No mail server is configured, so here is the link:
                  <a className="d-block text-break mt-1" href={devLink}>
                    {devLink}
                  </a>
                </div>
              )}

              <Link to="/login" className="btn btn-outline-primary w-100">
                <FiArrowLeft className="me-1" />
                Back to sign in
              </Link>
            </>
          ) : (
            <>
              <h5 className="fw-bold mb-1">Forgot your password?</h5>
              <p className="text-muted small mb-4">
                Enter your email and we will send you a link to set a new one.
              </p>

              <form onSubmit={handleSubmit(onSubmit)} noValidate>
                <div className="mb-4">
                  <label className="form-label small fw-semibold" htmlFor="fpEmail">
                    Email
                  </label>
                  <input
                    id="fpEmail"
                    type="email"
                    autoComplete="email"
                    className={`form-control ${errors.email ? "is-invalid" : ""}`}
                    placeholder="you@example.com"
                    {...register("email")}
                  />
                  {errors.email && <div className="invalid-feedback">{errors.email.message}</div>}
                </div>

                <button type="submit" className="btn btn-primary w-100" disabled={submitting}>
                  {submitting ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <FiMail className="me-2" />
                      Send reset link
                    </>
                  )}
                </button>
              </form>

              <p className="text-center text-muted small mt-4 mb-0">
                <Link to="/login">Back to sign in</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
