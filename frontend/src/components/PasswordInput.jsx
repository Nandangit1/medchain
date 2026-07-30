import { forwardRef, useId, useMemo, useState } from "react";
import { FiEye, FiEyeOff } from "react-icons/fi";

/**
 * Password field with a visibility toggle.
 *
 * `forwardRef` is required because React Hook Form's `register()` returns a
 * `ref` alongside the change handlers — without forwarding it, RHF cannot
 * register the field and validation silently never fires.
 *
 * The toggle button is deliberately `tabIndex={-1}` so keyboard users tab from
 * the password field straight to the submit button rather than into a control
 * that only changes presentation.
 */

/**
 * Scores a password 0-4 using the same signals the backend enforces, plus
 * length. This is UI feedback only — the server re-validates every rule.
 */
const scorePassword = (value) => {
  if (!value) return 0;

  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/[0-9]/.test(value) && /[^A-Za-z0-9]/.test(value)) score += 1;

  return Math.min(score, 4);
};

const STRENGTH = [
  { label: "", color: "transparent" },
  { label: "Weak", color: "var(--bts-danger)" },
  { label: "Fair", color: "var(--bts-warning)" },
  { label: "Good", color: "var(--bts-info)" },
  { label: "Strong", color: "var(--bts-success)" },
];

const PasswordInput = forwardRef(
  (
    {
      label,
      error,
      hint,
      showStrength = false,
      value,
      onChange,
      className = "",
      labelAction,
      id: providedId,
      ...inputProps
    },
    ref
  ) => {
    const [visible, setVisible] = useState(false);
    const [internalValue, setInternalValue] = useState("");
    const generatedId = useId();
    const id = providedId || generatedId;

    /**
     * Works both controlled (Profile passes value/onChange) and uncontrolled
     * (RHF register spreads onChange but no value), so the strength meter has
     * something to read either way.
     */
    const currentValue = value !== undefined ? value : internalValue;
    const score = useMemo(
      () => (showStrength ? scorePassword(currentValue) : 0),
      [showStrength, currentValue]
    );

    const handleChange = (event) => {
      if (value === undefined) {
        setInternalValue(event.target.value);
      }
      onChange?.(event);
    };

    return (
      <div className={className}>
        {label && (
          <div className="d-flex justify-content-between align-items-center mb-1">
            <label className="form-label small fw-semibold mb-0" htmlFor={id}>
              {label}
            </label>
            {labelAction}
          </div>
        )}

        <div className="bts-password">
          <input
            {...inputProps}
            ref={ref}
            id={id}
            type={visible ? "text" : "password"}
            value={value}
            onChange={handleChange}
            className={`form-control ${error ? "is-invalid" : ""}`}
          />

          <button
            type="button"
            className="bts-password-toggle"
            onClick={() => setVisible((current) => !current)}
            aria-label={visible ? "Hide password" : "Show password"}
            aria-pressed={visible}
            title={visible ? "Hide password" : "Show password"}
            tabIndex={-1}
          >
            {visible ? <FiEyeOff /> : <FiEye />}
          </button>
        </div>

        {showStrength && currentValue && (
          <div className="bts-strength mt-2" aria-live="polite">
            <div className="bts-strength-track">
              {[1, 2, 3, 4].map((step) => (
                <span
                  key={step}
                  className="bts-strength-bar"
                  style={{ background: step <= score ? STRENGTH[score].color : "var(--bts-border)" }}
                />
              ))}
            </div>
            <span className="bts-strength-label" style={{ color: STRENGTH[score].color }}>
              {STRENGTH[score].label}
            </span>
          </div>
        )}

        {error && <div className="invalid-feedback d-block">{error}</div>}
        {!error && hint && <div className="form-text">{hint}</div>}
      </div>
    );
  }
);

PasswordInput.displayName = "PasswordInput";

export default PasswordInput;
