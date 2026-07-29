import { useState } from "react";
import { Button, Modal } from "react-bootstrap";
import { toast } from "react-toastify";
import { FiCheck, FiSearch, FiUserCheck, FiX } from "react-icons/fi";

import {
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonRows,
  StatusChip,
  formatDate,
} from "../../components/common";
import useApi from "../../hooks/useApi";
import { adminApi } from "../../services";

const AdminDoctors = () => {
  const [filters, setFilters] = useState({ verificationStatus: "pending", search: "", page: 1 });
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(null);

  const { data, loading, error, refetch } = useApi(
    () =>
      adminApi.doctors({
        page: filters.page,
        limit: 10,
        ...(filters.verificationStatus && { verificationStatus: filters.verificationStatus }),
        ...(filters.search.length >= 2 && { search: filters.search }),
      }),
    [filters]
  );

  const handleVerify = async (doctor) => {
    setBusy(doctor._id);

    try {
      const result = await adminApi.verifyDoctor(doctor._id);

      toast.success(
        result.onChain && !result.onChain.error
          ? `${doctor.name} verified, and mirrored on-chain.`
          : `${doctor.name} verified.`
      );

      refetch();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const handleReject = async () => {
    if (reason.trim().length < 5) {
      toast.error("Give a reason of at least 5 characters.");
      return;
    }

    try {
      await adminApi.rejectDoctor(rejecting._id, reason.trim());
      toast.success(`${rejecting.name} rejected.`);
      setRejecting(null);
      setReason("");
      refetch();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <>
      <PageHeader
        title="Doctor verification"
        subtitle="Only verified doctors can be granted access to patient records"
      />

      <div className="bts-card p-3 mb-3">
        <div className="row g-2">
          <div className="col-md-8">
            <div className="input-group input-group-sm">
              <span className="input-group-text bg-transparent">
                <FiSearch />
              </span>
              <input
                className="form-control"
                placeholder="Search by name, email, specialization or licence..."
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
              value={filters.verificationStatus}
              onChange={(event) =>
                setFilters((f) => ({ ...f, verificationStatus: event.target.value, page: 1 }))
              }
            >
              <option value="">All doctors</option>
              <option value="pending">Pending review</option>
              <option value="verified">Verified</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
        </div>
      </div>

      <div className="bts-card p-3">
        {loading ? (
          <SkeletonRows rows={5} />
        ) : error ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : data.users.length === 0 ? (
          <EmptyState
            icon={<FiUserCheck />}
            title="No doctors here"
            description="Nothing matches the current filter."
          />
        ) : (
          <>
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead>
                  <tr>
                    <th>Doctor</th>
                    <th>Licence</th>
                    <th>Registered</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((doctor) => (
                    <tr key={doctor._id}>
                      <td>
                        <div className="fw-semibold small">{doctor.name}</div>
                        <div className="text-muted" style={{ fontSize: "0.74rem" }}>
                          {doctor.email} · {doctor.doctorProfile?.specialization}
                        </div>
                      </td>
                      <td className="bts-mono small">
                        {doctor.doctorProfile?.medicalLicenseNumber}
                      </td>
                      <td className="small text-muted">{formatDate(doctor.createdAt)}</td>
                      <td>
                        <StatusChip status={doctor.doctorProfile?.verificationStatus} />
                        {doctor.doctorProfile?.rejectionReason && (
                          <div className="text-muted" style={{ fontSize: "0.72rem" }}>
                            {doctor.doctorProfile.rejectionReason}
                          </div>
                        )}
                      </td>
                      <td className="text-end">
                        <div className="d-flex gap-1 justify-content-end">
                          {doctor.doctorProfile?.verificationStatus !== "verified" && (
                            <Button
                              size="sm"
                              onClick={() => handleVerify(doctor)}
                              disabled={busy === doctor._id}
                            >
                              <FiCheck className="me-1" />
                              {busy === doctor._id ? "Verifying..." : "Verify"}
                            </Button>
                          )}
                          {doctor.doctorProfile?.verificationStatus !== "rejected" && (
                            <Button
                              size="sm"
                              variant="outline-danger"
                              onClick={() => {
                                setRejecting(doctor);
                                setReason("");
                              }}
                            >
                              <FiX />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {data.pagination.totalPages > 1 && (
              <div className="d-flex justify-content-between align-items-center mt-3">
                <small className="text-muted">
                  Page {data.pagination.currentPage} of {data.pagination.totalPages}
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

      <Modal show={Boolean(rejecting)} onHide={() => setRejecting(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title className="fs-6">Reject {rejecting?.name}?</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="small text-muted">
            The doctor will see this reason. They will not be able to receive access to any patient
            record.
          </p>
          <textarea
            rows={3}
            className="form-control"
            placeholder="e.g. Licence number could not be verified with the medical council."
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" size="sm" onClick={() => setRejecting(null)}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" onClick={handleReject}>
            Reject
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default AdminDoctors;
