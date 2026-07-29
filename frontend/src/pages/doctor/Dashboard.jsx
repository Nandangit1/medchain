import { Link } from "react-router-dom";
import { FiActivity, FiAlertTriangle, FiFileText, FiUsers } from "react-icons/fi";

import {
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonCards,
  StatCard,
  formatDate,
} from "../../components/common";
import useApi from "../../hooks/useApi";
import useAuth from "../../hooks/useAuth";
import { doctorApi } from "../../services";

const DoctorDashboard = () => {
  const { user } = useAuth();
  const verified = user?.doctorProfile?.verificationStatus === "verified";

  const { data, loading, error, refetch } = useApi(() => doctorApi.dashboard(), [], {
    immediate: verified,
  });

  /**
   * An unverified doctor cannot call any doctor route, so the dashboard is
   * replaced with an explanation rather than a wall of 403 errors.
   */
  if (!verified) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <div className="bts-card p-5 text-center">
          <div className="mb-3" style={{ fontSize: "2.4rem", color: "var(--bts-warning)" }}>
            <FiAlertTriangle />
          </div>
          <h5 className="fw-bold">Your credentials are being reviewed</h5>
          <p className="text-muted small mb-0" style={{ maxWidth: 460, margin: "0 auto" }}>
            {user?.doctorProfile?.verificationStatus === "rejected"
              ? `Your verification was declined. Reason: ${user.doctorProfile.rejectionReason || "not provided"}.`
              : "An administrator must verify your medical licence before patients can share records with you. You will get access as soon as that is done."}
          </p>
        </div>
      </>
    );
  }

  if (loading) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <SkeletonCards count={3} />
      </>
    );
  }

  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const { totalPatients, sharedRecords, totalDiagnoses, recentDiagnoses, recentPatients } =
    data.dashboard;

  return (
    <>
      <PageHeader title="Dashboard" subtitle={`Welcome back, Dr. ${user.name.split(" ").slice(-1)}`} />

      <div className="row g-3 mb-4">
        <div className="col-md-4">
          <StatCard label="Patients" value={totalPatients} icon={<FiUsers />} tone="teal" />
        </div>
        <div className="col-md-4">
          <StatCard label="Shared records" value={sharedRecords} icon={<FiFileText />} tone="info" />
        </div>
        <div className="col-md-4">
          <StatCard label="Diagnoses recorded" value={totalDiagnoses} icon={<FiActivity />} tone="success" />
        </div>
      </div>

      <div className="row g-3">
        <div className="col-lg-6">
          <div className="bts-card p-3 h-100">
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h6 className="fw-bold mb-0">Recent patients</h6>
              <Link to="/doctor/patients" className="small">
                View all
              </Link>
            </div>

            {recentPatients.length === 0 ? (
              <EmptyState
                icon={<FiUsers />}
                title="No patients yet"
                description="Patients appear here once they share a record with you."
              />
            ) : (
              recentPatients.map((entry) => (
                <div
                  key={entry.patient._id}
                  className="d-flex justify-content-between align-items-center py-2 border-bottom"
                  style={{ borderColor: "var(--bts-border)" }}
                >
                  <div>
                    <div className="fw-semibold small">{entry.patient.name}</div>
                    <div className="text-muted" style={{ fontSize: "0.74rem" }}>
                      {entry.sharedRecords} record(s) shared
                    </div>
                  </div>
                  <small className="text-muted">{formatDate(entry.lastSharedAt)}</small>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="col-lg-6">
          <div className="bts-card p-3 h-100">
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h6 className="fw-bold mb-0">Recent diagnoses</h6>
              <Link to="/doctor/diagnoses" className="small">
                View all
              </Link>
            </div>

            {recentDiagnoses.length === 0 ? (
              <EmptyState icon={<FiActivity />} title="No diagnoses recorded yet" />
            ) : (
              recentDiagnoses.map((diagnosis) => (
                <div
                  key={diagnosis._id}
                  className="py-2 border-bottom"
                  style={{ borderColor: "var(--bts-border)" }}
                >
                  <div className="d-flex justify-content-between gap-2">
                    <div className="fw-semibold small">{diagnosis.summary}</div>
                    {diagnosis.icdCode && (
                      <span className="bts-chip bts-chip-muted">{diagnosis.icdCode}</span>
                    )}
                  </div>
                  <div className="text-muted" style={{ fontSize: "0.74rem" }}>
                    {diagnosis.patient?.name} · {formatDate(diagnosis.createdAt)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default DoctorDashboard;
