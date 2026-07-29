import { Link } from "react-router-dom";
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { FiAlertCircle, FiFileText, FiHardDrive, FiShield, FiUpload } from "react-icons/fi";

import {
  EmptyState,
  ErrorState,
  PageHeader,
  RECORD_TYPE_LABELS,
  SkeletonCards,
  StatCard,
  StatusChip,
  formatBytes,
  formatDate,
} from "../../components/common";
import useApi from "../../hooks/useApi";
import { patientApi } from "../../services";

/**
 * Categorical palette. Chosen to stay distinguishable in both themes and for
 * the most common forms of colour vision deficiency.
 */
const CHART_COLORS = ["#0f766e", "#0ea5e9", "#8b5cf6", "#f59e0b", "#ef4444", "#10b981", "#ec4899", "#64748b"];

const PatientDashboard = () => {
  const { data, loading, error, refetch } = useApi(() => patientApi.dashboard(), []);

  if (loading) {
    return (
      <>
        <PageHeader title="Dashboard" subtitle="Your health records at a glance" />
        <SkeletonCards />
      </>
    );
  }

  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const { records, recordsByType, activeGrants, recentRecords } = data.dashboard;

  const pieData = recordsByType.map((entry) => ({
    name: RECORD_TYPE_LABELS[entry.recordType] || entry.recordType,
    value: entry.count,
  }));

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Your health records at a glance"
        actions={
          <Link to="/patient/upload" className="btn btn-primary btn-sm">
            <FiUpload className="me-1" />
            Upload report
          </Link>
        }
      />

      <div className="row g-3 mb-4">
        <div className="col-6 col-lg-3">
          <StatCard label="Total records" value={records.total} icon={<FiFileText />} tone="teal" />
        </div>
        <div className="col-6 col-lg-3">
          <StatCard
            label="Anchored on-chain"
            value={records.anchored}
            icon={<FiShield />}
            tone="success"
            hint={records.pending > 0 ? `${records.pending} pending` : undefined}
          />
        </div>
        <div className="col-6 col-lg-3">
          <StatCard label="Doctors with access" value={activeGrants} icon={<FiAlertCircle />} tone="info" />
        </div>
        <div className="col-6 col-lg-3">
          <StatCard
            label="Storage used"
            value={formatBytes(records.storageBytes)}
            icon={<FiHardDrive />}
            tone="warning"
          />
        </div>
      </div>

      {records.failed > 0 && (
        <div className="alert alert-warning d-flex align-items-center gap-2 small">
          <FiAlertCircle />
          {records.failed} record(s) could not be anchored on-chain. Your files are safe and
          encrypted — anchoring can be retried by an administrator.
        </div>
      )}

      <div className="row g-3">
        <div className="col-lg-5">
          <div className="bts-card p-3 h-100">
            <h6 className="fw-bold mb-3">Records by type</h6>
            {pieData.length === 0 ? (
              <EmptyState title="No records yet" description="Upload your first report to see a breakdown." />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                    {pieData.map((entry, index) => (
                      <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "var(--bts-surface)",
                      border: "1px solid var(--bts-border)",
                      borderRadius: 10,
                      color: "var(--bts-text)",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: "0.78rem" }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="col-lg-7">
          <div className="bts-card p-3 h-100">
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h6 className="fw-bold mb-0">Recent uploads</h6>
              <Link to="/patient/records" className="small">
                View all
              </Link>
            </div>

            {recentRecords.length === 0 ? (
              <EmptyState
                title="Nothing uploaded yet"
                description="Your encrypted reports will appear here."
                action={
                  <Link to="/patient/upload" className="btn btn-sm btn-primary">
                    Upload a report
                  </Link>
                }
              />
            ) : (
              <div className="table-responsive">
                <table className="table table-hover align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Type</th>
                      <th>Date</th>
                      <th>Chain</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentRecords.map((record) => (
                      <tr key={record._id}>
                        <td>
                          <Link to={`/patient/records/${record._id}`} className="fw-semibold">
                            {record.title}
                          </Link>
                        </td>
                        <td className="small text-muted">
                          {RECORD_TYPE_LABELS[record.recordType] || record.recordType}
                        </td>
                        <td className="small text-muted">{formatDate(record.recordDate)}</td>
                        <td>
                          <StatusChip status={record.blockchain?.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default PatientDashboard;
