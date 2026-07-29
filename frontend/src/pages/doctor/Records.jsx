import { Link } from "react-router-dom";
import { FiFileText } from "react-icons/fi";

import {
  EmptyState,
  ErrorState,
  PageHeader,
  RECORD_TYPE_LABELS,
  SkeletonRows,
  StatusChip,
  formatDate,
} from "../../components/common";
import useApi from "../../hooks/useApi";
import { doctorApi } from "../../services";

/**
 * Records currently shared with this doctor. The list is scoped server-side by
 * live access grant, so a revoked record disappears on the next load.
 */
const DoctorRecords = () => {
  const { data, loading, error, refetch } = useApi(() => doctorApi.records({ limit: 50 }), []);

  return (
    <>
      <PageHeader title="Shared records" subtitle="Records patients have granted you access to" />

      <div className="bts-card p-3">
        {loading ? (
          <SkeletonRows rows={5} />
        ) : error ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : data.records.length === 0 ? (
          <EmptyState
            icon={<FiFileText />}
            title="Nothing shared with you yet"
            description="When a patient grants you access to a record, it appears here."
          />
        ) : (
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Record</th>
                  <th>Patient</th>
                  <th>Type</th>
                  <th>Date</th>
                  <th>Chain</th>
                </tr>
              </thead>
              <tbody>
                {data.records.map((record) => (
                  <tr key={record._id}>
                    <td>
                      <Link to={`/doctor/records/${record._id}`} className="fw-semibold">
                        {record.title}
                      </Link>
                      <div className="text-muted small text-truncate" style={{ maxWidth: 280 }}>
                        {record.description}
                      </div>
                    </td>
                    <td className="small">{record.patient?.name ?? "—"}</td>
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
    </>
  );
};

export default DoctorRecords;
