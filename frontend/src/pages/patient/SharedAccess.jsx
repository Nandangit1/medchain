import { toast } from "react-toastify";
import { Link } from "react-router-dom";
import { Button } from "react-bootstrap";
import { FiShield } from "react-icons/fi";

import {
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonRows,
  formatDate,
  truncateHash,
} from "../../components/common";
import useApi from "../../hooks/useApi";
import { patientApi, recordApi } from "../../services";

/**
 * Every grant the patient has ever issued, live or revoked.
 *
 * Revoked rows are shown deliberately: the point of the audit trail is that
 * withdrawing access leaves a record, rather than making history disappear.
 */
const SharedAccess = () => {
  const { data, loading, error, refetch } = useApi(() => patientApi.grants({ limit: 50 }), []);
  const wallet = useApi(() => patientApi.wallet(), []);

  const handleRevoke = async (permission) => {
    try {
      await recordApi.revoke(permission.record._id, permission.doctor._id);
      toast.success("Access revoked. The doctor can no longer open this record.");
      refetch();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <>
      <PageHeader title="Shared access" subtitle="Who can read your records, and who used to" />

      {wallet.data?.wallet?.address && (
        <div className="bts-card p-3 mb-3 d-flex flex-wrap justify-content-between align-items-center gap-2">
          <div>
            <div className="text-muted small">Your on-chain identity</div>
            <code className="bts-mono">{truncateHash(wallet.data.wallet.address, 14, 10)}</code>
          </div>
          <span className="bts-chip bts-chip-muted">
            {wallet.data.wallet.linked ? "Linked wallet" : "Managed for you"}
          </span>
        </div>
      )}

      <div className="bts-card p-3">
        {loading ? (
          <SkeletonRows rows={5} />
        ) : error ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : data.permissions.length === 0 ? (
          <EmptyState
            icon={<FiShield />}
            title="You have not shared anything"
            description="Open a record and choose Share to grant a doctor access."
            action={
              <Link to="/patient/records" className="btn btn-sm btn-primary">
                Go to my records
              </Link>
            }
          />
        ) : (
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Doctor</th>
                  <th>Record</th>
                  <th>Granted</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.permissions.map((permission) => (
                  <tr key={permission._id}>
                    <td>
                      <div className="fw-semibold small">{permission.doctor?.name ?? "Unknown"}</div>
                      <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                        {permission.doctor?.doctorProfile?.specialization}
                      </div>
                    </td>
                    <td className="small">
                      {permission.record ? (
                        <Link to={`/patient/records/${permission.record._id}`}>
                          {permission.record.title}
                        </Link>
                      ) : (
                        <span className="text-muted">Deleted record</span>
                      )}
                    </td>
                    <td className="small text-muted">{formatDate(permission.grantedAt)}</td>
                    <td className="small text-muted">
                      {permission.expiresAt ? formatDate(permission.expiresAt) : "No expiry"}
                    </td>
                    <td>
                      {permission.live ? (
                        <span className="bts-chip bts-chip-success">Active</span>
                      ) : permission.revokedAt ? (
                        <span className="bts-chip bts-chip-danger">Revoked</span>
                      ) : (
                        <span className="bts-chip bts-chip-muted">Expired</span>
                      )}
                    </td>
                    <td className="text-end">
                      {permission.live && permission.record && (
                        <Button
                          size="sm"
                          variant="outline-danger"
                          onClick={() => handleRevoke(permission)}
                        >
                          Revoke
                        </Button>
                      )}
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

export default SharedAccess;
