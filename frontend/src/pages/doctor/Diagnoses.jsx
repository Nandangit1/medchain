import { Link } from "react-router-dom";
import { FiActivity } from "react-icons/fi";

import {
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonRows,
  formatDate,
} from "../../components/common";
import useApi from "../../hooks/useApi";
import { doctorApi } from "../../services";

const SEVERITY_TONE = {
  low: "bts-chip-muted",
  moderate: "bts-chip-info",
  high: "bts-chip-warning",
  critical: "bts-chip-danger",
};

const DoctorDiagnoses = () => {
  const { data, loading, error, refetch } = useApi(() => doctorApi.diagnoses({ limit: 50 }), []);

  return (
    <>
      <PageHeader title="Diagnoses" subtitle="Every clinical opinion you have recorded" />

      <div className="bts-card p-3">
        {loading ? (
          <SkeletonRows rows={5} />
        ) : error ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : data.diagnoses.length === 0 ? (
          <EmptyState
            icon={<FiActivity />}
            title="No diagnoses recorded"
            description="Open a shared record to add your first diagnosis."
            action={
              <Link to="/doctor/records" className="btn btn-sm btn-primary">
                View shared records
              </Link>
            }
          />
        ) : (
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Summary</th>
                  <th>Patient</th>
                  <th>Record</th>
                  <th>ICD</th>
                  <th>Severity</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {data.diagnoses.map((diagnosis) => (
                  <tr key={diagnosis._id}>
                    <td>
                      <div className="fw-semibold small">{diagnosis.summary}</div>
                      {diagnosis.details && (
                        <div className="text-muted small text-truncate" style={{ maxWidth: 280 }}>
                          {diagnosis.details}
                        </div>
                      )}
                    </td>
                    <td className="small">{diagnosis.patient?.name ?? "—"}</td>
                    <td className="small">
                      {diagnosis.record ? (
                        <Link to={`/doctor/records/${diagnosis.record._id}`}>
                          {diagnosis.record.title}
                        </Link>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td>
                      {diagnosis.icdCode ? (
                        <span className="bts-chip bts-chip-muted">{diagnosis.icdCode}</span>
                      ) : (
                        <span className="text-muted small">—</span>
                      )}
                    </td>
                    <td>
                      <span className={`bts-chip ${SEVERITY_TONE[diagnosis.severity]}`}>
                        {diagnosis.severity}
                      </span>
                    </td>
                    <td className="small text-muted">{formatDate(diagnosis.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
};

export default DoctorDiagnoses;
