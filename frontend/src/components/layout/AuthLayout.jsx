import { Link } from "react-router-dom";
import { FiCpu, FiLock, FiShield, FiUserCheck } from "react-icons/fi";

const POINTS = [
  {
    icon: <FiLock />,
    title: "Encrypted before storage",
    text: "Every report is sealed with a key unique to that file. Plaintext never touches disk.",
  },
  {
    icon: <FiCpu />,
    title: "Anchored on Ethereum",
    text: "Only a fingerprint reaches the chain — enough to prove integrity, nothing that leaks.",
  },
  {
    icon: <FiUserCheck />,
    title: "You decide who reads it",
    text: "Doctors see a record only after you grant access. Revoking takes effect immediately.",
  },
];

/**
 * Split-panel shell for the authentication screens.
 *
 * The brand panel is hidden below the lg breakpoint rather than stacked — on a
 * phone, marketing copy above a sign-in form just pushes the fields off-screen.
 */
const AuthLayout = ({ title, subtitle, children, footer }) => (
  <div className="bts-auth">
    <aside className="bts-auth-aside d-none d-lg-flex">
      <Link
        to="/"
        className="d-inline-flex align-items-center gap-2 fw-bold text-white text-decoration-none"
        style={{ fontSize: "1.1rem", position: "relative", zIndex: 1 }}
      >
        <span className="bts-brand-mark">
          <FiShield />
        </span>
        MedChain
      </Link>

      <div style={{ position: "relative", zIndex: 1 }}>
        <h2 className="mb-3">Medical records that can prove they are untampered.</h2>
        <p className="lead mb-4" style={{ fontSize: "0.98rem" }}>
          A telemedicine platform built so that neither we nor anyone else can quietly alter your
          health history.
        </p>

        {POINTS.map((point) => (
          <div className="bts-auth-point" key={point.title}>
            <span className="bts-auth-point-icon">{point.icon}</span>
            <span>
              <span className="d-block fw-semibold" style={{ fontSize: "0.9rem" }}>
                {point.title}
              </span>
              <span
                className="d-block"
                style={{ fontSize: "0.825rem", color: "rgba(255,255,255,0.72)" }}
              >
                {point.text}
              </span>
            </span>
          </div>
        ))}
      </div>

      <p
        className="mb-0"
        style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.55)", position: "relative", zIndex: 1 }}
      >
        © {new Date().getFullYear()} MedChain · Secure Telemedicine Platform
      </p>
    </aside>

    <main className="bts-auth-main">
      <div className="bts-auth-form bts-fade-in">
        {/* Brand repeats here for the mobile layout, where the aside is hidden. */}
        <Link
          to="/"
          className="d-inline-flex d-lg-none align-items-center gap-2 fw-bold mb-4 text-decoration-none"
          style={{ color: "var(--bts-text)", fontSize: "1.05rem" }}
        >
          <span className="bts-brand-mark">
            <FiShield />
          </span>
          MedChain
        </Link>

        <h1 className="h4 fw-bold mb-1">{title}</h1>
        {subtitle && (
          <p className="text-muted mb-4" style={{ fontSize: "0.875rem" }}>
            {subtitle}
          </p>
        )}

        {children}

        {footer && <div className="text-center mt-4">{footer}</div>}
      </div>
    </main>
  </div>
);

export default AuthLayout;
