import { useState } from "react";
import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { FiArrowRight, FiBriefcase, FiUser } from "react-icons/fi";
import * as yup from "yup";

import AuthLayout from "../../components/layout/AuthLayout";
import PasswordInput from "../../components/PasswordInput";
import useAuth from "../../hooks/useAuth";
import { homeForRole } from "../../routes/ProtectedRoute";

/**
 * Mirrors the backend password policy exactly. Validating here is a courtesy —
 * the API re-checks every rule regardless.
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

const ROLE_OPTIONS = [
  { value: "patient", label: "Patient", icon: <FiUser />, hint: "Own and share your records" },
  { value: "doctor", label: "Doctor", icon: <FiBriefcase />, hint: "Requires verification" },
];

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
          ? "Account created. An administrator must verify your credentials before patients can share records with you."
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
    <AuthLayout
      title="Create your account"
      subtitle="Takes under a minute."
      footer={
        <span className="text-muted small">
          Already registered? <Link to="/login">Sign in</Link>
        </span>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="mb-3">
          <label className="form-label">I am a</label>
          <div className="d-flex gap-2">
            {ROLE_OPTIONS.map((option) => {
              const selected = role === option.value;

              return (
                <label
                  key={option.value}
                  className="flex-fill text-center p-2 rounded-3"
                  style={{
                    cursor: "pointer",
                    border: `1.5px solid ${selected ? "var(--bts-teal)" : "var(--bts-border-strong)"}`,
                    background: selected ? "var(--bts-teal-50)" : "transparent",
                    transition: "all 0.15s ease",
                  }}
                >
                  <input type="radio" value={option.value} className="d-none" {...register("role")} />
                  <span
                    className="d-block mb-1"
                    style={{ color: selected ? "var(--bts-teal)" : "var(--bts-text-muted)" }}
                  >
                    {option.icon}
                  </span>
                  <span className="d-block fw-semibold" style={{ fontSize: "0.85rem" }}>
                    {option.label}
                  </span>
                  <span className="d-block text-muted" style={{ fontSize: "0.7rem" }}>
                    {option.hint}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="mb-3">
          <label className="form-label" htmlFor="name">
            Full name
          </label>
          <input
            id="name"
            autoComplete="name"
            className={`form-control ${errors.name ? "is-invalid" : ""}`}
            placeholder="Jane Doe"
            {...register("name")}
          />
          {errors.name && <div className="invalid-feedback">{errors.name.message}</div>}
        </div>

        <div className="mb-3">
          <label className="form-label" htmlFor="regEmail">
            Email address
          </label>
          <input
            id="regEmail"
            type="email"
            autoComplete="email"
            className={`form-control ${errors.email ? "is-invalid" : ""}`}
            placeholder="you@example.com"
            {...register("email")}
          />
          {errors.email && <div className="invalid-feedback">{errors.email.message}</div>}
        </div>

        {role === "doctor" && (
          <div className="row g-2 mb-3">
            <div className="col-sm-6">
              <label className="form-label">Specialization</label>
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
              <label className="form-label">Medical licence no.</label>
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

        <PasswordInput
          className="mb-3"
          id="regPassword"
          label="Password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          showStrength
          error={errors.password?.message}
          hint="Needs upper and lower case, a number and a special character."
          {...register("password")}
        />

        <PasswordInput
          className="mb-4"
          id="confirmPassword"
          label="Confirm password"
          autoComplete="new-password"
          placeholder="Re-enter your password"
          error={errors.confirmPassword?.message}
          {...register("confirmPassword")}
        />

        <button type="submit" className="btn btn-primary w-100" disabled={submitting}>
          {submitting ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" />
              Creating account...
            </>
          ) : (
            <>
              Create account
              <FiArrowRight className="ms-2" />
            </>
          )}
        </button>
      </form>
    </AuthLayout>
  );
};

export default Register;
