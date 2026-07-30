import { useState } from "react";
import { FiFileText, FiSearch } from "react-icons/fi";

import {
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonRows,
  StatCard,
  formatDate,
} from "../../components/common";
import useApi from "../../hooks/useApi";
import { adminApi } from "../../services";

const CATEGORY_TONE = {
  auth: "bts-chip-info",
  record: "bts-chip-success",
  access: "bts-chip-warning",
  clinical: "bts-chip-muted",
  admin: "bts-chip-danger",
  appointment: "bts-chip-info",
};

/**
 * Read-only view of the append-only audit trail.
 *
 * There is deliberately no edit or delete control here — the backend exposes
 * no such route. An audit trail an administrator can rewrite proves nothing.
 */
const AdminAuditLog = () => {
  const [filters, setFilters] = useState({ category: "", outcome: "", search: "", page: 1 });

  const { data, loading, error, refetch } = useApi(
    () =>
      adminApi.auditLogs({
        page: filters.page,
        limit: 15,
        sort: "-createdAt",
        ...(filters.category && { category: filters.category }),
        ...(filters.outcome && { outcome: filters.outcome }),
        ...(filters.search.length >= 2 && { search: filters.search }),
      }),
    [filters]
  );

  const summary = useApi(() => adminApi.auditSummary(30), []);

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Append-only record of every consequential action"
        actions={
          <button className="btn btn-sm btn-outline-secondary" onClick={refetch}>
            Refresh
          </button>
        }
      />

      {summary.data?.summary && (
        <div className="row g-3 mb-3">
          <div className="col-6 col-lg-3">
            <StatCard
              label="Events (30 days)"
              value={summary.data.summary.total}
              icon={<FiFileText />}
              tone="teal"
            />
          </div>
          {summary.data.summary.byCategory.slice(0, 3).map((entry) => (
            <div className="col-6 col-lg-3" key={entry.category}>
              <StatCard label={entry.category} value={entry.count} tone="info" />
            </div>
          ))}
        </div>
      )}

      <div className="bts-card p-3 mb-3">
        <div className="row g-2">
          <div className="col-md-6">
            <div className="input-group input-group-sm">
              <span className="input-group-text bg-transparent">
                <FiSearch />
              </span>
              <input
                className="form-control"
                placeholder="Search by actor email or description..."
                value={filters.search}
                onChange={(event) =>
                  setFilters((f) => ({ ...f, search: event.target.value, page: 1 }))
                }
              />
            </div>
          </div>
          <div className="col-md-3">
            <select
              className="form-select form-select-sm"
              value={filters.category}
              onChange={(event) =>
                setFilters((f) => ({ ...f, category: event.target.value, page: 1 }))
              }
            >
              <option value="">All categories</option>
              <option value="auth">Authentication</option>
              <option value="record">Records</option>
              <option value="access">Access control</option>
              <option value="clinical">Clinical</option>
              <option value="admin">Administration</option>
              <option value="appointment">Appointments</option>
            </select>
          </div>
          <div className="col-md-3">
            <select
              className="form-select form-select-sm"
              value={filters.outcome}
              onChange={(event) =>
                setFilters((f) => ({ ...f, outcome: event.target.value, page: 1 }))
              }
            >
              <option value="">All outcomes</option>
              <option value="success">Success</option>
              <option value="failure">Failure</option>
            </select>
          </div>
        </div>
      </div>

      <div className="bts-card p-3">
        {loading ? (
          <SkeletonRows rows={8} />
        ) : error ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : data.entries.length === 0 ? (
          <EmptyState icon={<FiFileText />} title="No audit entries match those filters" />
        ) : (
          <>
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Actor</th>
                    <th>Action</th>
                    <th>Description</th>
                    <th>IP</th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((entry) => (
                    <tr key={entry._id}>
                      <td className="small text-muted" style={{ whiteSpace: "nowrap" }}>
                        {formatDate(entry.createdAt, true)}
                      </td>
                      <td className="small">
                        {/* Role and email as they were AT THE TIME, not resolved now. */}
                        <div className="fw-semibold">{entry.actorEmail ?? "—"}</div>
                        <div className="text-muted text-capitalize" style={{ fontSize: "0.72rem" }}>
                          {entry.actorRole ?? "anonymous"}
                        </div>
                      </td>
                      <td>
                        <span className={`bts-chip ${CATEGORY_TONE[entry.category] ?? "bts-chip-muted"}`}>
                          {entry.action}
                        </span>
                        {entry.outcome === "failure" && (
                          <span className="bts-chip bts-chip-danger ms-1">failed</span>
                        )}
                      </td>
                      <td className="small text-muted" style={{ maxWidth: 320 }}>
                        {entry.description}
                      </td>
                      <td className="bts-mono text-muted" style={{ fontSize: "0.7rem" }}>
                        {entry.ipAddress ?? "—"}
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
                  {data.pagination.totalItems} entries
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

export default AdminAuditLog;
