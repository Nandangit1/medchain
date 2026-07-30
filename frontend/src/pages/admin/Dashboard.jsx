import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Link } from "react-router-dom";
import { FiAlertTriangle, FiFileText, FiShield, FiUserCheck, FiUsers } from "react-icons/fi";

import {
  ErrorState,
  PageHeader,
  RECORD_TYPE_LABELS,
  SkeletonCards,
  StatCard,
  formatBytes,
} from "../../components/common";
import useApi from "../../hooks/useApi";
import { adminApi } from "../../services";

const ROLE_COLORS = { patients: "#0f766e", doctors: "#0ea5e9", admins: "#8b5cf6" };

const tooltipStyle = {
  background: "var(--bts-surface)",
  border: "1px solid var(--bts-border)",
  borderRadius: 10,
  color: "var(--bts-text)",
  fontSize: "0.8rem",
};

/**
 * Reads a single aggregated endpoint rather than deriving totals from several
 * paginated list calls, so the dashboard cost stays flat as the platform grows.
 */
const AdminDashboard = () => {
  const { data, loading, error, refetch } = useApi(() => adminApi.stats(), []);

  if (loading) {
    return (
      <>
        <PageHeader title="Admin dashboard" />
        <SkeletonCards />
      </>
    );
  }

  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const { users, doctors, records, activeGrants } = data.stats;

  const roleData = [
    { role: "Patients", count: users.patients, key: "patients" },
    { role: "Doctors", count: users.doctors, key: "doctors" },
    { role: "Admins", count: users.admins, key: "admins" },
  ];

  const trendData = records.uploadsByDay.map((entry) => ({
    date: entry.date.slice(5),
    uploads: entry.count,
  }));

  return (
    <>
      <PageHeader
        title="Admin dashboard"
        subtitle="Platform overview and pending actions"
        actions={
          <button className="btn btn-sm btn-outline-secondary" onClick={refetch}>
            Refresh
          </button>
        }
      />

      <div className="row g-3 mb-4">
        <div className="col-6 col-lg-3">
          <StatCard
            label="Total users"
            value={users.total}
            icon={<FiUsers />}
            tone="teal"
            hint={`${users.patients} patients · ${users.doctors} doctors`}
          />
        </div>
        <div className="col-6 col-lg-3">
          <StatCard
            label="Awaiting verification"
            value={doctors.pending}
            icon={<FiUserCheck />}
            tone={doctors.pending > 0 ? "warning" : "success"}
            hint={`${doctors.verified} verified`}
          />
        </div>
        <div className="col-6 col-lg-3">
          <StatCard
            label="Records"
            value={records.total}
            icon={<FiFileText />}
            tone="info"
            hint={formatBytes(records.storageBytes)}
          />
        </div>
        <div className="col-6 col-lg-3">
          <StatCard
            label="Anchored on-chain"
            value={records.anchored}
            icon={<FiShield />}
            tone="success"
            hint={`${activeGrants} active grants`}
          />
        </div>
      </div>

      {records.failed > 0 && (
        <div className="alert alert-warning d-flex align-items-center gap-2 small">
          <FiAlertTriangle />
          {records.failed} record(s) failed to anchor on-chain. Files are safe and encrypted — run{" "}
          <code className="mx-1">npm run backfill:anchors</code> to retry.
          <Link to="/admin/blockchain" className="ms-auto">
            View transactions
          </Link>
        </div>
      )}

      <div className="row g-3 mb-3">
        <div className="col-lg-5">
          <div className="bts-card p-3 h-100">
            <h6 className="fw-bold mb-3">Users by role</h6>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={roleData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--bts-border)" vertical={false} />
                <XAxis dataKey="role" tick={{ fill: "var(--bts-text-muted)", fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fill: "var(--bts-text-muted)", fontSize: 12 }} />
                <Tooltip cursor={{ fill: "var(--bts-surface-2)" }} contentStyle={tooltipStyle} />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {roleData.map((entry) => (
                    <Cell key={entry.key} fill={ROLE_COLORS[entry.key]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="col-lg-7">
          <div className="bts-card p-3 h-100">
            <h6 className="fw-bold mb-3">Uploads over the last 14 days</h6>
            {trendData.length === 0 ? (
              <div className="text-center text-muted py-5 small">No uploads in this window.</div>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--bts-border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: "var(--bts-text-muted)", fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fill: "var(--bts-text-muted)", fontSize: 12 }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Line
                    type="monotone"
                    dataKey="uploads"
                    stroke="var(--bts-teal)"
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <div className="row g-3">
        <div className="col-lg-6">
          <div className="bts-card p-3 h-100">
            <h6 className="fw-bold mb-3">Records by type</h6>
            {records.byType.length === 0 ? (
              <div className="text-center text-muted py-4 small">No records yet.</div>
            ) : (
              records.byType.map((entry) => {
                const percent = Math.round((entry.count / records.total) * 100);

                return (
                  <div key={entry.recordType} className="mb-2">
                    <div className="d-flex justify-content-between small">
                      <span>{RECORD_TYPE_LABELS[entry.recordType] ?? entry.recordType}</span>
                      <span className="text-muted">
                        {entry.count} ({percent}%)
                      </span>
                    </div>
                    <div className="progress" style={{ height: 6 }}>
                      <div
                        className="progress-bar"
                        style={{ width: `${percent}%`, background: "var(--bts-teal)" }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="col-lg-6">
          <div className="bts-card p-3 h-100">
            <h6 className="fw-bold mb-3">Quick actions</h6>

            <div className="d-flex flex-column gap-2">
              <Link to="/admin/doctors" className="btn btn-outline-primary btn-sm text-start">
                <FiUserCheck className="me-2" />
                Review verification queue
                {doctors.pending > 0 && (
                  <span className="bts-chip bts-chip-warning ms-2">{doctors.pending}</span>
                )}
              </Link>
              <Link to="/admin/users" className="btn btn-outline-secondary btn-sm text-start">
                <FiUsers className="me-2" />
                Manage users
              </Link>
              <Link to="/admin/audit" className="btn btn-outline-secondary btn-sm text-start">
                <FiFileText className="me-2" />
                Inspect audit log
              </Link>
              <Link to="/admin/blockchain" className="btn btn-outline-secondary btn-sm text-start">
                <FiShield className="me-2" />
                Blockchain transactions
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default AdminDashboard;
