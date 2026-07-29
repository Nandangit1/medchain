import { useState } from "react";
import { Link } from "react-router-dom";
import { FiFileText, FiSearch, FiUpload } from "react-icons/fi";

import {
  EmptyState,
  ErrorState,
  PageHeader,
  RECORD_TYPE_LABELS,
  SkeletonRows,
  StatusChip,
  formatBytes,
  formatDate,
} from "../../components/common";
import useApi from "../../hooks/useApi";
import { recordApi } from "../../services";

const PatientRecords = () => {
  const [filters, setFilters] = useState({ search: "", recordType: "", page: 1 });

  const { data, loading, error, refetch } = useApi(
    () =>
      recordApi.list({
        page: filters.page,
        limit: 10,
        // The API rejects a search shorter than 2 characters.
        ...(filters.search.length >= 2 && { search: filters.search }),
        ...(filters.recordType && { recordType: filters.recordType }),
      }),
    [filters]
  );

  const update = (patch) => setFilters((current) => ({ ...current, page: 1, ...patch }));

  return (
    <>
      <PageHeader
        title="My records"
        subtitle="Every document is encrypted before storage"
        actions={
          <Link to="/patient/upload" className="btn btn-primary btn-sm">
            <FiUpload className="me-1" />
            Upload
          </Link>
        }
      />

      <div className="bts-card p-3 mb-3">
        <div className="row g-2">
          <div className="col-md-7">
            <div className="input-group input-group-sm">
              <span className="input-group-text bg-transparent">
                <FiSearch />
              </span>
              <input
                className="form-control"
                placeholder="Search by title, description or tag..."
                value={filters.search}
                onChange={(event) => update({ search: event.target.value })}
              />
            </div>
          </div>
          <div className="col-md-5">
            <select
              className="form-select form-select-sm"
              value={filters.recordType}
              onChange={(event) => update({ recordType: event.target.value })}
            >
              <option value="">All record types</option>
              {Object.entries(RECORD_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="bts-card p-3">
        {loading ? (
          <SkeletonRows rows={6} />
        ) : error ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : data.records.length === 0 ? (
          <EmptyState
            icon={<FiFileText />}
            title="No records found"
            description={
              filters.search || filters.recordType
                ? "Try clearing your filters."
                : "Upload your first medical report to get started."
            }
            action={
              <Link to="/patient/upload" className="btn btn-sm btn-primary">
                Upload a report
              </Link>
            }
          />
        ) : (
          <>
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Type</th>
                    <th>Date</th>
                    <th>Size</th>
                    <th>Chain</th>
                  </tr>
                </thead>
                <tbody>
                  {data.records.map((record) => (
                    <tr key={record._id}>
                      <td>
                        <Link to={`/patient/records/${record._id}`} className="fw-semibold">
                          {record.title}
                        </Link>
                        {record.uploadedByRole === "doctor" && (
                          <span className="bts-chip bts-chip-info ms-2">From doctor</span>
                        )}
                        <div className="text-muted small text-truncate" style={{ maxWidth: 340 }}>
                          {record.description}
                        </div>
                      </td>
                      <td className="small">{RECORD_TYPE_LABELS[record.recordType] || record.recordType}</td>
                      <td className="small text-muted">{formatDate(record.recordDate)}</td>
                      <td className="small text-muted">{formatBytes(record.file?.size)}</td>
                      <td>
                        <StatusChip status={record.blockchain?.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {data.pagination.totalPages > 1 && (
              <div className="d-flex justify-content-between align-items-center mt-3">
                <small className="text-muted">
                  Page {data.pagination.currentPage} of {data.pagination.totalPages} ·{" "}
                  {data.pagination.totalItems} record(s)
                </small>
                <div className="btn-group btn-group-sm">
                  <button
                    className="btn btn-outline-secondary"
                    disabled={!data.pagination.hasPreviousPage}
                    onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
                  >
                    Previous
                  </button>
                  <button
                    className="btn btn-outline-secondary"
                    disabled={!data.pagination.hasNextPage}
                    onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
};

export default PatientRecords;
