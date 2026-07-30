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
