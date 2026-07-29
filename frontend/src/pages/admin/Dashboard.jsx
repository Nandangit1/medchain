import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Link } from "react-router-dom";
import { FiActivity, FiShield, FiUserCheck, FiUsers } from "react-icons/fi";

import {
  ErrorState,
  PageHeader,
  SkeletonCards,
  StatCard,
  formatDate,
} from "../../components/common";
import useApi from "../../hooks/useApi";
import { adminApi, healthApi } from "../../services";

const ROLE_COLORS = { patient: "#0f766e", doctor: "#0ea5e9", admin: "#8b5cf6" };

const AdminDashboard = () => {
  /**
   * The API has no dedicated analytics endpoint yet, so the totals are derived
   * from paginated queries: `totalItems` gives the count without transferring
   * the rows themselves (limit: 1).
   */
  const stats = useApi(async () => {
    const [patients, doctors, admins, pending, verified, recentDoctors] = await Promise.all([
      adminApi.users({ role: "patient", limit: 1 }),
      adminApi.users({ role: "doctor", limit: 1 }),
      adminApi.users({ role: "admin", limit: 1 }),
      adminApi.doctors({ verificationStatus: "pending", limit: 5 }),
      adminApi.doctors({ verificationStatus: "verified", limit: 1 }),
      adminApi.doctors({ limit: 5 }),
    ]);

    return {
      patients: patients.pagination.totalItems,
      doctors: doctors.pagination.totalItems,
      admins: admins.pagination.totalItems,
      pendingList: pending.users,
      pendingCount: pending.pagination.totalItems,
      verifiedCount: verified.pagination.totalItems,
      recentDoctors: recentDoctors.users,
    };
  }, []);

  const health = useApi(() => healthApi.get(), []);

  if (stats.loading) {
    return (
      <>
        <PageHeader title="Admin dashboard" />
        <SkeletonCards />
      </>
    );
  }

  if (stats.error) return <ErrorState message={stats.error} onRetry={stats.refetch} />;

  const chartData = [
    { role: "Patients", count: stats.data.patients, key: "patient" },
    { role: "Doctors", count: stats.data.doctors, key: "doctor" },
    { role: "Admins", count: stats.data.admins, key: "admin" },
  ];

  return (
    <>
      <PageHeader title="Admin dashboard" subtitle="Platform overview and pending actions" />

      <div className="row g-3 mb-4">
        <div className="col-6 col-lg-3">
          <StatCard label="Patients" value={stats.data.patients} icon={<FiUsers />} tone="teal" />
        </div>
        <div className="col-6 col-lg-3">
          <StatCard label="Doctors" value={stats.data.doctors} icon={<FiUserCheck />} tone="info" />
        </div>
        <div className="col-6 col-lg-3">
          <StatCard
            label="Awaiting verification"
            value={stats.data.pendingCount}
            icon={<FiActivity />}
            tone={stats.data.pendingCount > 0 ? "warning" : "success"}
          />
        </div>
        <div className="col-6 col-lg-3">
          <StatCard
            label="Records on-chain"
            value={health.data?.blockchain?.recordCount ?? "—"}
            icon={<FiShield />}
            tone="success"
            hint={health.data?.blockchain?.connected ? "Chain reachable" : "Chain offline"}
          />
        </div>
      </div>

      <div className="row g-3">
        <div className="col-lg-6">
          <div className="bts-card p-3 h-100">
            <h6 className="fw-bold mb-3">Users by role</h6>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--bts-border)" vertical={false} />
                <XAxis dataKey="role" tick={{ fill: "var(--bts-text-muted)", fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fill: "var(--bts-text-muted)", fontSize: 12 }} />
                <Tooltip
                  cursor={{ fill: "var(--bts-surface-2)" }}
                  contentStyle={{
                    background: "var(--bts-surface)",
                    border: "1px solid var(--bts-border)",
                    borderRadius: 10,
                    color: "var(--bts-text)",
                  }}
                />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {chartData.map((entry) => (
                    <Cell key={entry.key} fill={ROLE_COLORS[entry.key]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="col-lg-6">
          <div className="bts-card p-3 h-100">
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h6 className="fw-bold mb-0">Verification queue</h6>
              <Link to="/admin/doctors" className="small">
                Manage
              </Link>
            </div>

            {stats.data.pendingList.length === 0 ? (
              <div className="text-center text-muted py-4 small">
                Nothing waiting. All doctors have been reviewed.
              </div>
            ) : (
              stats.data.pendingList.map((doctor) => (
                <div
                  key={doctor._id}
                  className="d-flex justify-content-between align-items-center py-2 border-bottom"
                  style={{ borderColor: "var(--bts-border)" }}
                >
                  <div className="min-w-0">
                    <div className="fw-semibold small text-truncate">{doctor.name}</div>
                    <div className="text-muted" style={{ fontSize: "0.74rem" }}>
                      {doctor.doctorProfile?.specialization} ·{" "}
                      {doctor.doctorProfile?.medicalLicenseNumber}
                    </div>
                  </div>
                  <small className="text-muted flex-shrink-0">{formatDate(doctor.createdAt)}</small>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default AdminDashboard;
