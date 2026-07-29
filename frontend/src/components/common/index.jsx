import { Component } from "react";
import { Alert, Button, Spinner } from "react-bootstrap";
import { FiAlertTriangle, FiInbox, FiRefreshCw } from "react-icons/fi";

/** Full-height centred spinner, used while a route's data loads. */
export const Loader = ({ label = "Loading...", height = 220 }) => (
  <div
    className="d-flex flex-column align-items-center justify-content-center text-muted gap-2"
    style={{ minHeight: height }}
  >
    <Spinner animation="border" style={{ color: "var(--bts-teal)" }} />
    <small>{label}</small>
  </div>
);

/** Shimmer placeholders that mirror the shape of the content being loaded. */
export const SkeletonRows = ({ rows = 5, height = 44 }) => (
  <div className="d-flex flex-column gap-2">
    {Array.from({ length: rows }).map((_, index) => (
      <div key={index} className="bts-skeleton" style={{ height }} />
    ))}
  </div>
);

export const SkeletonCards = ({ count = 4, height = 96 }) => (
  <div className="row g-3">
    {Array.from({ length: count }).map((_, index) => (
      <div className="col-6 col-lg-3" key={index}>
        <div className="bts-skeleton" style={{ height }} />
      </div>
    ))}
  </div>
);

export const EmptyState = ({ icon = <FiInbox />, title, description, action }) => (
  <div className="text-center py-5 px-3">
    <div className="mb-3" style={{ fontSize: "2.4rem", color: "var(--bts-text-muted)" }}>
      {icon}
    </div>
    <h6 className="mb-1">{title}</h6>
    {description && <p className="text-muted small mb-3">{description}</p>}
    {action}
  </div>
);

export const ErrorState = ({ message, onRetry }) => (
  <Alert variant="danger" className="d-flex align-items-start gap-2">
    <FiAlertTriangle className="mt-1 flex-shrink-0" />
    <div className="flex-grow-1">
      <div className="fw-semibold">Something went wrong</div>
      <div className="small">{message}</div>
    </div>
    {onRetry && (
      <Button size="sm" variant="outline-danger" onClick={onRetry}>
        <FiRefreshCw className="me-1" />
        Retry
      </Button>
    )}
  </Alert>
);

export const PageHeader = ({ title, subtitle, actions }) => (
  <div className="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-4">
    <div>
      <h4 className="mb-1 fw-bold">{title}</h4>
      {subtitle && <p className="text-muted mb-0 small">{subtitle}</p>}
    </div>
    {actions && <div className="d-flex gap-2 flex-wrap">{actions}</div>}
  </div>
);

export const StatCard = ({ label, value, icon, tone = "info", hint }) => {
  const tones = {
    success: "rgba(22,163,74,0.12)",
    warning: "rgba(217,119,6,0.12)",
    danger: "rgba(220,38,38,0.12)",
    info: "rgba(2,132,199,0.12)",
    teal: "rgba(15,118,110,0.12)",
  };

  const colors = {
    success: "var(--bts-success)",
    warning: "var(--bts-warning)",
    danger: "var(--bts-danger)",
    info: "var(--bts-info)",
    teal: "var(--bts-teal)",
  };

  return (
    <div className="bts-card bts-stat h-100 d-flex align-items-center gap-3">
      {icon && (
        <div
          className="bts-stat-icon"
          style={{ background: tones[tone], color: colors[tone] }}
          aria-hidden="true"
        >
          {icon}
        </div>
      )}
      <div className="min-w-0">
        <div className="bts-stat-value">{value}</div>
        <div className="bts-stat-label">{label}</div>
        {hint && <div className="text-muted small mt-1">{hint}</div>}
      </div>
    </div>
  );
};

/** Maps a status string onto a coloured chip. */
export const StatusChip = ({ status }) => {
  const map = {
    confirmed: ["success", "On-chain"],
    pending: ["warning", "Pending"],
    failed: ["danger", "Failed"],
    verified: ["success", "Verified"],
    rejected: ["danger", "Rejected"],
    active: ["success", "Active"],
    archived: ["muted", "Archived"],
    requested: ["info", "Requested"],
    completed: ["success", "Completed"],
    cancelled: ["muted", "Cancelled"],
    no_show: ["danger", "No show"],
  };

  const [tone, label] = map[status] || ["muted", status ?? "Unknown"];

  return <span className={`bts-chip bts-chip-${tone}`}>{label}</span>;
};

/**
 * Catches render-time errors so one broken component cannot blank the whole
 * application. Class component because React exposes no hook equivalent.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Uncaught UI error:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="container py-5" style={{ maxWidth: 620 }}>
          <div className="bts-card p-4 text-center">
            <div className="mb-3" style={{ fontSize: "2.5rem", color: "var(--bts-danger)" }}>
              <FiAlertTriangle />
            </div>
            <h5>This page hit an unexpected error</h5>
            <p className="text-muted small mb-4">{this.state.error.message}</p>
            <Button onClick={() => window.location.assign("/")}>Return to safety</Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/** Formats a byte count for display. */
export const formatBytes = (bytes) => {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

export const formatDate = (value, withTime = false) => {
  if (!value) return "—";
  const date = new Date(value);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
};

/** Shortens a hash or address for display without losing recognisability. */
export const truncateHash = (value, lead = 10, tail = 8) => {
  if (!value) return "—";
  return value.length <= lead + tail ? value : `${value.slice(0, lead)}...${value.slice(-tail)}`;
};

export const RECORD_TYPE_LABELS = {
  lab_report: "Lab report",
  prescription: "Prescription",
  diagnosis: "Diagnosis",
  imaging: "Imaging",
  discharge_summary: "Discharge summary",
  vaccination: "Vaccination",
  insurance: "Insurance",
  other: "Other",
};
