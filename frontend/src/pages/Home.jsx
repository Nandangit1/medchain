import { Link } from "react-router-dom";
import { FiCheckCircle, FiCpu, FiDatabase, FiLock, FiShield, FiUserCheck } from "react-icons/fi";

const FEATURES = [
  {
    icon: <FiLock />,
    title: "Encrypted before it leaves",
    text: "Every report is sealed with AES-256-GCM using a key unique to that file. Plaintext never touches disk or storage.",
  },
  {
    icon: <FiDatabase />,
    title: "Stored on IPFS",
    text: "Files live on distributed storage addressed by their content, so the same document always resolves to the same identifier.",
  },
  {
    icon: <FiCpu />,
    title: "Anchored on Ethereum",
    text: "Only the fingerprint and storage address go on-chain — never the document. Enough to prove integrity, nothing that leaks.",
  },
  {
    icon: <FiUserCheck />,
    title: "The patient decides",
    text: "Doctors see a record only after an explicit grant, and revocation takes effect immediately.",
  },
];

const Home = () => (
  <div>
    <nav className="navbar navbar-expand-lg" style={{ background: "var(--bts-surface)", borderBottom: "1px solid var(--bts-border)" }}>
      <div className="container">
        <Link className="navbar-brand d-flex align-items-center gap-2 fw-bold" to="/">
          <span className="bts-brand-mark">
            <FiShield />
          </span>
          MedChain
        </Link>
        <div className="d-flex gap-2">
          <Link to="/login" className="btn btn-outline-primary btn-sm">
            Sign in
          </Link>
          <Link to="/register" className="btn btn-primary btn-sm">
            Create account
          </Link>
        </div>
      </div>
    </nav>

    <header className="bts-hero">
      <div className="container">
        <div className="row align-items-center g-5">
          <div className="col-lg-7">
            <span className="badge bg-light text-dark mb-3">Blockchain-secured health records</span>
            <h1 className="display-5 mb-3">Your medical history, provably untampered.</h1>
            <p className="lead mb-4 opacity-90">
              A telemedicine platform where reports are encrypted before storage, distributed over
              IPFS, and fingerprinted on Ethereum — so integrity can be verified by anyone, and read
              access by no one you did not choose.
            </p>
            <div className="d-flex flex-wrap gap-2">
              <Link to="/register" className="btn btn-light btn-lg fw-semibold">
                Get started
              </Link>
              <Link to="/login" className="btn btn-outline-light btn-lg">
                Sign in
              </Link>
            </div>
          </div>

          <div className="col-lg-5">
            <div className="bts-card p-4" style={{ color: "var(--bts-text)" }}>
              <div className="fw-semibold mb-3">How a report is secured</div>
              {[
                "SHA-256 taken over the original document",
                "Encrypted with a fresh per-file key",
                "Ciphertext pinned to IPFS",
                "Hash + address written on-chain",
              ].map((step, index) => (
                <div className="d-flex gap-3 mb-3" key={step}>
                  <div
                    className="flex-shrink-0 rounded-circle d-grid"
                    style={{
                      width: 26,
                      height: 26,
                      background: "var(--bts-teal)",
                      color: "#fff",
                      placeItems: "center",
                      fontSize: "0.75rem",
                      fontWeight: 700,
                    }}
                  >
                    {index + 1}
                  </div>
                  <div className="small">{step}</div>
                </div>
              ))}
              <div className="d-flex align-items-center gap-2 small text-success mt-1">
                <FiCheckCircle />
                Verifiable years later, independently of us.
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>

    <section className="py-5">
      <div className="container">
        <div className="text-center mb-5">
          <h2 className="fw-bold">Built on four guarantees</h2>
          <p className="text-muted">Each one enforced in code, not in policy.</p>
        </div>

        <div className="row g-4">
          {FEATURES.map((feature) => (
            <div className="col-md-6 col-lg-3" key={feature.title}>
              <div className="bts-card p-4 h-100">
                <div className="bts-feature-icon">{feature.icon}</div>
                <h6 className="fw-bold">{feature.title}</h6>
                <p className="text-muted small mb-0">{feature.text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>

    <section className="py-5" style={{ background: "var(--bts-surface)" }}>
      <div className="container">
        <div className="row g-4 align-items-center">
          <div className="col-lg-6">
            <h3 className="fw-bold mb-3">What never goes on the blockchain</h3>
            <p className="text-muted">
              Blockchain data is permanent and world-readable, which makes it the worst possible
              place for clinical content. We store only what is needed to make the system provable.
            </p>
            <div className="row g-3 mt-2">
              <div className="col-sm-6">
                <div className="fw-semibold text-success mb-2">On-chain</div>
                <ul className="small text-muted ps-3 mb-0">
                  <li>Document fingerprint</li>
                  <li>Storage address</li>
                  <li>Access grants &amp; revocations</li>
                </ul>
              </div>
              <div className="col-sm-6">
                <div className="fw-semibold text-danger mb-2">Never on-chain</div>
                <ul className="small text-muted ps-3 mb-0">
                  <li>The document itself</li>
                  <li>Names and contact details</li>
                  <li>Diagnoses and prescriptions</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="col-lg-6">
            <div className="bts-card p-4">
              <div className="bts-mono small text-muted">
                <div>report.pdf</div>
                <div className="my-1">↓ sha256(plaintext)</div>
                <div className="my-1">↓ AES-256-GCM, random per-file key</div>
                <div className="my-1">↓ IPFS pin → CID</div>
                <div className="my-1">↓ hash + CID → Ethereum</div>
                <div className="text-success mt-2">✓ tamper-evident, end to end</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <footer className="py-4 text-center text-muted small" style={{ borderTop: "1px solid var(--bts-border)" }}>
      <div className="container">
        MedChain — Blockchain-Based Secure Telemedicine System · BE Final Year Project
      </div>
    </footer>
  </div>
);

export default Home;
