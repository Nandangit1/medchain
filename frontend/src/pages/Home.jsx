import { Link } from "react-router-dom";
import {
  FiActivity,
  FiCheck,
  FiCpu,
  FiDatabase,
  FiEyeOff,
  FiLock,
  FiShield,
  FiUserCheck,
} from "react-icons/fi";

const FEATURES = [
  {
    icon: <FiLock />,
    title: "Encrypted before it leaves",
    text: "Each report is sealed with AES-256-GCM under a key unique to that file. Plaintext never touches disk or storage.",
  },
  {
    icon: <FiDatabase />,
    title: "Stored on IPFS",
    text: "Files live on distributed storage addressed by their cryptographic digest, so the same document always resolves to the same identifier.",
  },
  {
    icon: <FiCpu />,
    title: "Anchored on Ethereum",
    text: "Only the fingerprint and storage address reach the chain — enough to prove integrity, nothing that could leak.",
  },
  {
    icon: <FiUserCheck />,
    title: "The patient decides",
    text: "A doctor sees a record only after an explicit grant, and revoking it takes effect immediately.",
  },
];

const PIPELINE = [
  { step: "SHA-256 taken over the original document", detail: "Its permanent identity" },
  { step: "Encrypted with a fresh per-file key", detail: "AES-256-GCM" },
  { step: "Ciphertext pinned to IPFS", detail: "Returns a content identifier" },
  { step: "Fingerprint + address written on-chain", detail: "Tamper-evident forever" },
];

const Home = () => (
  <div>
    <nav className="navbar navbar-expand-lg bts-nav-public py-2">
      <div className="container">
        <Link className="navbar-brand d-flex align-items-center gap-2 fw-bold" to="/">
          <span className="bts-brand-mark">
            <FiShield />
          </span>
          <span style={{ color: "var(--bts-text)", letterSpacing: "-0.02em" }}>MedChain</span>
        </Link>

        <div className="d-flex gap-2 align-items-center">
          <Link to="/login" className="btn btn-outline-secondary btn-sm">
            Sign in
          </Link>
          <Link to="/register" className="btn btn-primary btn-sm">
            Get started
          </Link>
        </div>
      </div>
    </nav>

    <header className="bts-hero">
      <div className="container">
        <div className="row align-items-center g-5">
          <div className="col-lg-7">
            <span className="bts-eyebrow">
              <FiShield size={13} />
              Blockchain-secured health records
            </span>

            <h1 className="mb-3">Your medical history, provably untampered.</h1>

            <p className="lead mb-4" style={{ maxWidth: 560 }}>
              A telemedicine platform where reports are encrypted before storage, distributed over
              IPFS, and fingerprinted on Ethereum — so integrity can be verified by anyone, and read
              access by no one you did not choose.
            </p>

            <div className="d-flex flex-wrap gap-2 mb-4">
              <Link to="/register" className="btn btn-light btn-lg fw-semibold">
                Create an account
              </Link>
              <Link to="/login" className="btn btn-outline-light btn-lg">
                Sign in
              </Link>
            </div>

            <div className="d-flex flex-wrap gap-4" style={{ fontSize: "0.82rem" }}>
              {["AES-256-GCM", "IPFS", "Ethereum", "144 automated tests"].map((item) => (
                <span
                  key={item}
                  className="d-flex align-items-center gap-2"
                  style={{ color: "rgba(255,255,255,0.78)" }}
                >
                  <FiCheck style={{ color: "#5eead4" }} />
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div className="col-lg-5">
            <div className="bts-card p-4" style={{ color: "var(--bts-text)" }}>
              <div className="d-flex align-items-center gap-2 mb-3">
                <FiActivity style={{ color: "var(--bts-teal)" }} />
                <span className="fw-semibold" style={{ fontSize: "0.92rem" }}>
                  How a report is secured
                </span>
              </div>

              {PIPELINE.map((item, index) => (
                <div className="d-flex gap-3 mb-3" key={item.step}>
                  <span className="bts-step-num">{index + 1}</span>
                  <span className="min-w-0">
                    <span className="d-block" style={{ fontSize: "0.85rem", fontWeight: 500 }}>
                      {item.step}
                    </span>
                    <span className="d-block text-muted" style={{ fontSize: "0.75rem" }}>
                      {item.detail}
                    </span>
                  </span>
                </div>
              ))}

              <div
                className="d-flex align-items-center gap-2 pt-3 mt-1"
                style={{
                  borderTop: "1px solid var(--bts-border)",
                  color: "var(--bts-success)",
                  fontSize: "0.8rem",
                  fontWeight: 600,
                }}
              >
                <FiCheck />
                Verifiable years later, independently of us.
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>

    <section className="bts-section">
      <div className="container">
        <div className="text-center mb-5">
          <h2 className="mb-2">Built on four guarantees</h2>
          <p className="text-muted mb-0">Each one enforced in code, not in policy.</p>
        </div>

        <div className="row g-4">
          {FEATURES.map((feature) => (
            <div className="col-md-6 col-lg-3" key={feature.title}>
              <div className="bts-card bts-card-hover p-4 h-100">
                <div className="bts-feature-icon">{feature.icon}</div>
                <h6 className="fw-bold mb-2">{feature.title}</h6>
                <p className="text-muted mb-0" style={{ fontSize: "0.83rem" }}>
                  {feature.text}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>

    <section className="bts-section bts-section-alt">
      <div className="container">
        <div className="row g-5 align-items-center">
          <div className="col-lg-6">
            <span
              className="d-inline-flex align-items-center gap-2 mb-3"
              style={{ color: "var(--bts-teal)", fontSize: "0.78rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}
            >
              <FiEyeOff size={13} />
              Privacy by construction
            </span>

            <h2 className="mb-3">What never goes on the blockchain</h2>
            <p className="text-muted">
              Blockchain data is permanent and world-readable, which makes it the worst possible
              place for clinical content. We store only what is needed to make the system provable.
            </p>

            <div className="row g-4 mt-3">
              <div className="col-sm-6">
                <div
                  className="fw-bold mb-2 d-flex align-items-center gap-2"
                  style={{ color: "var(--bts-success)", fontSize: "0.85rem" }}
                >
                  <FiCheck /> On-chain
                </div>
                <ul className="text-muted ps-3 mb-0" style={{ fontSize: "0.83rem" }}>
                  <li>Document fingerprint</li>
                  <li>Storage address</li>
                  <li>Access grants &amp; revocations</li>
                </ul>
              </div>
              <div className="col-sm-6">
                <div
                  className="fw-bold mb-2 d-flex align-items-center gap-2"
                  style={{ color: "var(--bts-danger)", fontSize: "0.85rem" }}
                >
                  <FiEyeOff /> Never on-chain
                </div>
                <ul className="text-muted ps-3 mb-0" style={{ fontSize: "0.83rem" }}>
                  <li>The document itself</li>
                  <li>Names and contact details</li>
                  <li>Diagnoses and prescriptions</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="col-lg-6">
            <div className="bts-card p-4">
              <div className="bts-mono" style={{ lineHeight: 2, color: "var(--bts-text-secondary)" }}>
                <div style={{ color: "var(--bts-text)" }}>report.pdf</div>
                <div>↓ sha256(plaintext)</div>
                <div>↓ AES-256-GCM, random per-file key</div>
                <div>↓ IPFS pin → CID</div>
                <div>↓ hash + CID → Ethereum</div>
                <div className="mt-2" style={{ color: "var(--bts-success)", fontWeight: 600 }}>
                  ✓ tamper-evident, end to end
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section className="bts-section">
      <div className="container">
        <div
          className="bts-card p-5 text-center"
          style={{
            background: "linear-gradient(150deg, var(--bts-teal-900) 0%, #0b4257 100%)",
            border: "none",
          }}
        >
          <h2 className="mb-3" style={{ color: "#fff" }}>
            Take ownership of your records
          </h2>
          <p className="mb-4 mx-auto" style={{ color: "rgba(255,255,255,0.8)", maxWidth: 520 }}>
            Create an account in under a minute. Patients start immediately; doctors are verified by
            an administrator before any record can be shared with them.
          </p>
          <Link to="/register" className="btn btn-light btn-lg fw-semibold">
            Get started
          </Link>
        </div>
      </div>
    </section>

    <footer style={{ borderTop: "1px solid var(--bts-border)" }}>
      <div className="container py-5">
        <div className="row g-4">
          <div className="col-lg-4">
            <div className="d-flex align-items-center gap-2 fw-bold mb-2">
              <span className="bts-brand-mark">
                <FiShield />
              </span>
              <span style={{ letterSpacing: "-0.02em" }}>MedChain</span>
            </div>
            <p className="text-muted mb-0" style={{ fontSize: "0.82rem", maxWidth: 300 }}>
              Secure telemedicine with encrypted storage, distributed hosting and
              blockchain-verified integrity.
            </p>
          </div>

          <div className="col-6 col-lg-2">
            <div className="fw-semibold mb-2" style={{ fontSize: "0.82rem" }}>
              Platform
            </div>
            <ul className="list-unstyled mb-0" style={{ fontSize: "0.82rem" }}>
              <li className="mb-1">
                <Link to="/register" className="text-muted">
                  Create account
                </Link>
              </li>
              <li className="mb-1">
                <Link to="/login" className="text-muted">
                  Sign in
                </Link>
              </li>
            </ul>
          </div>

          <div className="col-6 col-lg-3">
            <div className="fw-semibold mb-2" style={{ fontSize: "0.82rem" }}>
              Security
            </div>
            <ul className="list-unstyled text-muted mb-0" style={{ fontSize: "0.82rem" }}>
              <li className="mb-1">AES-256-GCM encryption</li>
              <li className="mb-1">IPFS distributed storage</li>
              <li className="mb-1">Ethereum integrity anchoring</li>
            </ul>
          </div>

          <div className="col-lg-3">
            <div className="fw-semibold mb-2" style={{ fontSize: "0.82rem" }}>
              Your data
            </div>
            <ul className="list-unstyled text-muted mb-0" style={{ fontSize: "0.82rem" }}>
              <li className="mb-1">Patient-controlled access</li>
              <li className="mb-1">Immediate revocation</li>
              <li className="mb-1">Full audit trail</li>
            </ul>
          </div>
        </div>

        <div
          className="d-flex flex-wrap justify-content-between gap-2 pt-4 mt-4 text-muted"
          style={{ borderTop: "1px solid var(--bts-border)", fontSize: "0.78rem" }}
        >
          <span>© {new Date().getFullYear()} MedChain. All rights reserved.</span>
          <span>Secure Telemedicine Platform</span>
        </div>
      </div>
    </footer>
  </div>
);

export default Home;
