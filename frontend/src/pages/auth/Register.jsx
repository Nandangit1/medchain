import { useState } from "react";
import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { FiShield, FiUserPlus } from "react-icons/fi";
import * as yup from "yup";

import useAuth from "../../hooks/useAuth";
import { homeForRole } from "../../routes/ProtectedRoute";

/**
 * Mirrors the backend's password policy exactly. Validating client-side is a
 * convenience only — the API re-checks every rule.
 */
const schema = yup.object({
  name: yup.string().required("Name is required.").min(2, "Name is too short.").max(80),
  email: yup.string().required("Email is required.").email("Enter a valid email address."),
  password: yup
    .string()
    .required("Password is required.")
    .min(8, "Use at least 8 characters.")
    .matches(/[a-z]/, "Include a lowercase letter.")
    .matches(/[A-Z]/, "Include an uppercase letter.")
    .matches(/[0-9]/, "Include a number.")
    .matches(/[^A-Za-z0-9]/, "Include a special character."),
  confirmPassword: yup
    .string()
    .required("Confirm your password.")
    .oneOf([yup.ref("password")], "Passwords do not match."),
  role: yup.string().oneOf(["patient", "doctor"]).required(),
  specialization: yup.string().when("role", {
    is: "doctor",
    then: (s) => s.required("Specialization is required.").min(2).max(100),
    otherwise: (s) => s.strip(),
  }),
  medicalLicenseNumber: yup.string().when("role", {
    is: "doctor",
    then: (s) => s.required("License number is required.").min(3).max(60),
    otherwise: (s) => s.strip(),
  }),
});

const Register = () => {
  const { register: registerUser } = useAuth();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm({ resolver: yupResolver(schema), defaultValues: { role: "patient" } });

  const role = watch("role");

  const onSubmit = async (values) => {
    setSubmitting(true);

    const payload = {
      name: values.name,
      email: values.email,
      password: values.password,
      role: values.role,
      ...(values.role === "doctor" && {
        doctorProfile: {
          specialization: values.specialization,
          medicalLicenseNumber: values.medicalLicenseNumber,
        },
      }),
    };

    try {
      const user = await registerUser(payload);

      toast.success(
        user.role === "doctor"
          ? "Account created. An administrator must verify your credentials before you can access patient records."
          : "Account created successfully."
      );

      navigate(homeForRole(user.role), { replace: true });
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="d-flex align-items-center justify-content-center min-vh-100 p-3">
      <div className="w-100" style={{ maxWidth: 520 }}>
        <div className="text-center mb-4">
          <Link to="/" className="d-inline-flex align-items-center gap-2 fw-bold fs-5 text-decoration-none">
            <span className="bts-brand-mark">
              <FiShield />
            </span>
            MedChain
          </Link>
        </div>

        <div className="bts-card p-4 bts-fade-in">
          <h5 className="fw-bold mb-1">Create your account</h5>
          <p className="text-muted small mb-4">Takes under a minute.</p>

          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="mb-3">
              <label className="form-label small fw-semibold">I am a</label>
              <div className="d-flex gap-2">
                {["patient", "doctor"].map((option) => (
                  <label
                    key={option}
                    className={`flex-fill text-center border rounded-3 p-2 text-capitalize ${
                      role === option ? "border-primary" : ""
                    }`}
                    style={{
                      cursor: "pointer",
                      background: role === option ? "var(--bts-teal-light)" : "transparent",
                      borderColor: "var(--bts-border)",
                    }}
                  >
                    <input type="radio" value={option} className="d-none" {...register("role")} />
                    {option}
                  </label>
                ))}
              </div>
            </div>

            <div className="mb-3">
              <label className="form-label small fw-semibold" htmlFor="name">
                Full name
              </label>
              <input
                id="name"
                className={`form-control ${errors.name ? "is-invalid" : ""}`}
                {...register("name")}
              />
              {errors.name && <div className="invalid-feedback">{errors.name.message}</div>}
            </div>

            <div className="mb-3">
              <label className="form-label small fw-semibold" htmlFor="regEmail">
                Email
              </label>
              <input
                id="regEmail"
                type="email"
                className={`form-control ${errors.email ? "is-invalid" : ""}`}
                {...register("email")}
              />
              {errors.email && <div className="invalid-feedback">{errors.email.message}</div>}
            </div>

            {role === "doctor" && (
              <div className="row g-2 mb-3">
                <div className="col-sm-6">
                  <label className="form-label small fw-semibold">Specialization</label>
                  <input
                    className={`form-control ${errors.specialization ? "is-invalid" : ""}`}
                    placeholder="Cardiology"
                    {...register("specialization")}
                  />
                  {errors.specialization && (
                    <div className="invalid-feedback">{errors.specialization.message}</div>
                  )}
                </div>
                <div className="col-sm-6">
                  <label className="form-label small fw-semibold">Medical license no.</label>
                  <input
                    className={`form-control ${errors.medicalLicenseNumber ? "is-invalid" : ""}`}
                    placeholder="MCI-123456"
                    {...register("medicalLicenseNumber")}
                  />
                  {errors.medicalLicenseNumber && (
                    <div className="invalid-feedback">{errors.medicalLicenseNumber.message}</div>
                  )}
                </div>
              </div>
            )}

            <div className="row g-2 mb-4">
              <div className="col-sm-6">
                <label className="form-label small fw-semibold">Password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  className={`form-control ${errors.password ? "is-invalid" : ""}`}
                  {...register("password")}
                />
                {errors.password && <div className="invalid-feedback">{errors.password.message}</div>}
              </div>
              <div className="col-sm-6">
                <label className="form-label small fw-semibold">Confirm password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  className={`form-control ${errors.confirmPassword ? "is-invalid" : ""}`}
                  {...register("confirmPassword")}
                />
                {errors.confirmPassword && (
                  <div className="invalid-feedback">{errors.confirmPassword.message}</div>
                )}
              </div>
            </div>

            <button type="submit" className="btn btn-primary w-100" disabled={submitting}>
              {submitting ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" />
                  Creating account...
                </>
              ) : (
                <>
                  <FiUserPlus className="me-2" />
                  Create account
                </>
              )}
            </button>
          </form>

          <p className="text-center text-muted small mt-4 mb-0">
            Already registered? <Link to="/login">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Register;
