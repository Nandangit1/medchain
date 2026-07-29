import { useState } from "react";
import { Button } from "react-bootstrap";
import { toast } from "react-toastify";
import { FiSearch, FiUsers } from "react-icons/fi";

import {
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonRows,
  formatDate,
} from "../../components/common";
import useApi from "../../hooks/useApi";
import useAuth from "../../hooks/useAuth";
import { adminApi } from "../../services";

const AdminUsers = () => {
  const { user: currentUser } = useAuth();
  const [filters, setFilters] = useState({ role: "", search: "", page: 1 });
  const [busy, setBusy] = useState(null);

  const { data, loading, error, refetch } = useApi(
    () =>
      adminApi.users({
        page: filters.page,
        limit: 10,
        ...(filters.role && { role: filters.role }),
        ...(filters.search.length >= 2 && { search: filters.search }),
      }),
    [filters]
  );

  const toggleStatus = async (target) => {
    setBusy(target._id);

    try {
      await adminApi.setUserStatus(target._id, !target.isActive);
      toast.success(target.isActive ? "Account deactivated." : "Account reactivated.");
      refetch();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader title="Manage users" subtitle="Patients, doctors and administrators" />

      <div className="bts-card p-3 mb-3">
        <div className="row g-2">
          <div className="col-md-8">
            <div className="input-group input-group-sm">
              <span className="input-group-text bg-transparent">
                <FiSearch />
              </span>
              <input
                className="form-control"
                placeholder="Search by name, email or phone..."
                value={filters.search}
                onChange={(event) =>
                  setFilters((f) => ({ ...f, search: event.target.value, page: 1 }))
                }
              />
            </div>
          </div>
          <div className="col-md-4">
            <select
              className="form-select form-select-sm"
              value={filters.role}
              onChange={(event) => setFilters((f) => ({ ...f, role: event.target.value, page: 1 }))}
            >
              <option value="">All roles</option>
              <option value="patient">Patients</option>
              <option value="doctor">Doctors</option>
              <option value="admin">Administrators</option>
            </select>
          </div>
        </div>
      </div>

      <div className="bts-card p-3">
        {loading ? (
          <SkeletonRows rows={6} />
        ) : error ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : data.users.length === 0 ? (
          <EmptyState icon={<FiUsers />} title="No users found" />
        ) : (
          <>
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th>Joined</th>
                    <th>Last login</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((item) => {
                    const isSelf = item._id === currentUser?._id;

                    return (
                      <tr key={item._id}>
                        <td>
                          <div className="fw-semibold small">
                            {item.name}
                            {isSelf && <span className="bts-chip bts-chip-muted ms-2">You</span>}
                          </div>
                          <div className="text-muted" style={{ fontSize: "0.74rem" }}>
                            {item.email}
                          </div>
                        </td>
                        <td>
                          <span className="bts-chip bts-chip-info text-capitalize">{item.role}</span>
                        </td>
                        <td className="small text-muted">{formatDate(item.createdAt)}</td>
                        <td className="small text-muted">
                          {item.lastLoginAt ? formatDate(item.lastLoginAt, true) : "Never"}
                        </td>
                        <td>
                          <span
                            className={`bts-chip ${item.isActive ? "bts-chip-success" : "bts-chip-danger"}`}
                          >
                            {item.isActive ? "Active" : "Deactivated"}
                          </span>
                        </td>
                        <td className="text-end">
                          {/* The API also refuses this, but hiding it avoids an avoidable error. */}
                          {!isSelf && (
                            <Button
                              size="sm"
                              variant={item.isActive ? "outline-danger" : "outline-success"}
                              disabled={busy === item._id}
                              onClick={() => toggleStatus(item)}
                            >
                              {item.isActive ? "Deactivate" : "Reactivate"}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {data.pagination.totalPages > 1 && (
              <div className="d-flex justify-content-between align-items-center mt-3">
                <small className="text-muted">
                  Page {data.pagination.currentPage} of {data.pagination.totalPages} ·{" "}
                  {data.pagination.totalItems} user(s)
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

export default AdminUsers;
