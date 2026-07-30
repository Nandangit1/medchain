import { useState } from "react";
import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { FiArrowLeft, FiCheckCircle, FiMail } from "react-icons/fi";
import * as yup from "yup";

import AuthLayout from "../../components/layout/AuthLayout";
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

  if (sent) {
    return (
      <AuthLayout
        title="Check your inbox"
        subtitle="If an account exists for that address, we have sent a link to reset your password. It expires in 30 minutes."
      >
        <div className="alert alert-success d-flex gap-2 align-items-start">
          <FiCheckCircle className="mt-1 flex-shrink-0" />
          <span>Request received. The link can only be used once.</span>
        </div>

        {devLink && (
          <div className="alert alert-warning">
            <div className="fw-semibold mb-1">Development mode</div>
            No mail server is configured, so here is the link:
            <a className="d-block text-break mt-1" href={devLink}>
              {devLink}
            </a>
          </div>
        )}

        <Link to="/login" className="btn btn-outline-primary w-100">
          <FiArrowLeft className="me-2" />
          Back to sign in
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Forgot your password?"
      subtitle="Enter your email and we will send you a link to set a new one."
      footer={
        <Link to="/login" className="small">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="mb-4">
          <label className="form-label" htmlFor="fpEmail">
            Email address
          </label>
          <input
            id="fpEmail"
            type="email"
            autoComplete="email"
            autoFocus
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
    </AuthLayout>
  );
};

export default ForgotPassword;
