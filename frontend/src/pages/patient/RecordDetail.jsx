import { useState } from "react";
import { Badge, Button, Modal } from "react-bootstrap";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import {
  FiCheckCircle,
  FiClock,
  FiDownload,
  FiShare2,
  FiShield,
  FiTrash2,
  FiXCircle,
} from "react-icons/fi";

import {
  EmptyState,
  ErrorState,
  Loader,
  PageHeader,
  RECORD_TYPE_LABELS,
  StatusChip,
  formatBytes,
  formatDate,
  truncateHash,
} from "../../components/common";
import ShareModal from "../../components/ShareModal";
import useApi from "../../hooks/useApi";
import { recordApi } from "../../services";

const EVENT_LABELS = {
  RecordAnchored: "Record anchored on-chain",
  AccessGranted: "Access granted to a doctor",
  AccessRevoked: "Access revoked",
  AccessLogged: "Record opened by a doctor",
  RecordDeactivated: "Record deleted",
};

const RecordDetail = () => {
  const { recordId } = useParams();
  const navigate = useNavigate();

  const [showShare, setShowShare] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verification, setVerification] = useState(null);
  const [downloading, setDownloading] = useState(false);

  const record = useApi(() => recordApi.get(recordId), [recordId]);
  const history = useApi(() => recordApi.history(recordId), [recordId]);
  const access = useApi(() => recordApi.access(recordId), [recordId]);

  if (record.loading) return <Loader label="Loading record..." />;
  if (record.error) return <ErrorState message={record.error} onRetry={record.refetch} />;

  const item = record.data.record;

  const handleDownload = async () => {
    setDownloading(true);

    try {
      const blob = await recordApi.download(recordId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = item.file.originalName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      toast.success("Decrypted and downloaded.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setDownloading(false);
    }
  };

  const handleVerify = async () => {
    setVerifying(true);

    try {
      const data = await recordApi.verify(recordId);
      setVerification(data.report);

      if (data.report.integrityVerified) {
        toast.success("Integrity verified — the file matches its recorded fingerprint.");
      } else {
        toast.error("Integrity check FAILED. This file may have been altered.");
      }
    } catch (error) {
      toast.error(error.message);
    } finally {
      setVerifying(false);
    }
  };

  const handleDelete = async () => {
    try {
      await recordApi.remove(recordId);
      toast.success("Record deleted. Its audit trail is preserved on-chain.");
      navigate("/patient/records");
    } catch (error) {
      toast.error(error.message);
    }
  };

  return (
    <>
      <PageHeader
        title={item.title}
        subtitle={`${RECORD_TYPE_LABELS[item.recordType] || item.recordType} · ${formatDate(item.recordDate)}`}
        actions={
          <>
            <Button size="sm" variant="outline-secondary" onClick={handleVerify} disabled={verifying}>
              <FiShield className="me-1" />
              {verifying ? "Verifying..." : "Verify integrity"}
            </Button>
            <Button size="sm" variant="outline-primary" onClick={() => setShowShare(true)}>
              <FiShare2 className="me-1" />
              Share
            </Button>
            <Button size="sm" onClick={handleDownload} disabled={downloading}>
              <FiDownload className="me-1" />
              {downloading ? "Decrypting..." : "Download"}
            </Button>
            <Button size="sm" variant="outline-danger" onClick={() => setShowDelete(true)}>
              <FiTrash2 />
            </Button>
          </>
        }
      />

      {verification && (
        <div
          className={`alert ${verification.integrityVerified ? "alert-success" : "alert-danger"} d-flex gap-2`}
        >
          {verification.integrityVerified ? <FiCheckCircle className="mt-1" /> : <FiXCircle className="mt-1" />}
          <div className="small">
            <div className="fw-semibold">
              {verification.integrityVerified
                ? "Integrity verified"
                : "Integrity check failed"}
            </div>
            <div>
              Stored fingerprint <code className="bts-mono">{truncateHash(verification.expectedHash)}</code>{" "}
              {verification.integrityVerified ? "matches" : "does NOT match"} the file retrieved from storage.
              {verification.blockchain?.anchored && (
                <>
                  {" "}
                  The blockchain{" "}
                  {verification.blockchain.hashMatchesChain ? (
                    <span className="fw-semibold">confirms</span>
                  ) : (
                    <span className="fw-semibold">disagrees with</span>
                  )}{" "}
                  this fingerprint.
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="row g-3">
        <div className="col-lg-7">
          <div className="bts-card p-4 mb-3">
            <h6 className="fw-bold mb-3">Details</h6>

            {item.description && <p className="text-muted small">{item.description}</p>}

            <dl className="row small mb-0">
              <dt className="col-5 col-sm-4 text-muted fw-normal">File</dt>
              <dd className="col-7 col-sm-8">{item.file.originalName}</dd>

              <dt className="col-5 col-sm-4 text-muted fw-normal">Size</dt>
              <dd className="col-7 col-sm-8">{formatBytes(item.file.size)}</dd>

              <dt className="col-5 col-sm-4 text-muted fw-normal">Uploaded</dt>
              <dd className="col-7 col-sm-8">
                {formatDate(item.createdAt, true)}
                {item.uploadedByRole === "doctor" && (
                  <Badge bg="info" className="ms-2">
                    by a doctor
                  </Badge>
                )}
              </dd>

              <dt className="col-5 col-sm-4 text-muted fw-normal">Status</dt>
              <dd className="col-7 col-sm-8">
                <StatusChip status={item.status} />
              </dd>

              {item.tags?.length > 0 && (
                <>
                  <dt className="col-5 col-sm-4 text-muted fw-normal">Tags</dt>
                  <dd className="col-7 col-sm-8 d-flex flex-wrap gap-1">
                    {item.tags.map((tag) => (
                      <span className="bts-chip bts-chip-muted" key={tag}>
                        {tag}
                      </span>
                    ))}
                  </dd>
                </>
              )}
            </dl>
          </div>

          <div className="bts-card p-4">
            <h6 className="fw-bold mb-3">Cryptographic proof</h6>

            <div className="mb-3">
              <div className="text-muted small">SHA-256 of the original document</div>
              <code className="bts-mono d-block text-break">{item.integrity.fileHash}</code>
            </div>

            <div className="mb-3">
              <div className="text-muted small">IPFS content identifier</div>
              <code className="bts-mono d-block text-break">{item.storage.cid}</code>
              <div className="text-muted" style={{ fontSize: "0.72rem" }}>
                Stored via {item.storage.provider}
              </div>
            </div>

            <div>
              <div className="text-muted small">Blockchain</div>
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <StatusChip status={item.blockchain?.status} />
                {item.blockchain?.onChainId && (
                  <span className="text-muted small">record #{item.blockchain.onChainId}</span>
                )}
              </div>
              {item.blockchain?.txHash && (
                <code className="bts-mono d-block text-break mt-1">{item.blockchain.txHash}</code>
              )}
              {item.blockchain?.lastError && (
                <div className="text-danger small mt-1">{item.blockchain.lastError}</div>
              )}
            </div>
          </div>
        </div>

        <div className="col-lg-5">
          <div className="bts-card p-4 mb-3">
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h6 className="fw-bold mb-0">Who can see this</h6>
              <Button size="sm" variant="outline-primary" onClick={() => setShowShare(true)}>
                Share
              </Button>
            </div>

            {access.loading ? (
              <Loader height={100} label="" />
            ) : access.data?.permissions?.filter((p) => p.live).length ? (
              access.data.permissions
                .filter((permission) => permission.live)
                .map((permission) => (
                  <div
                    key={permission._id}
                    className="d-flex justify-content-between align-items-center py-2 border-bottom"
                    style={{ borderColor: "var(--bts-border)" }}
                  >
                    <div className="min-w-0">
                      <div className="fw-semibold small text-truncate">{permission.doctor?.name}</div>
                      <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                        {permission.doctor?.doctorProfile?.specialization}
                        {permission.expiresAt && ` · until ${formatDate(permission.expiresAt)}`}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline-danger"
                      onClick={async () => {
                        try {
                          await recordApi.revoke(recordId, permission.doctor._id);
                          toast.success("Access revoked.");
                          access.refetch();
                          history.refetch();
                        } catch (error) {
                          toast.error(error.message);
                        }
                      }}
                    >
                      Revoke
                    </Button>
                  </div>
                ))
            ) : (
              <EmptyState
                title="Not shared with anyone"
                description="Only you can read this record."
              />
            )}
          </div>

          <div className="bts-card p-4">
            <h6 className="fw-bold mb-3">Blockchain history</h6>

            {history.loading ? (
              <Loader height={100} label="" />
            ) : !history.data?.history?.events?.length ? (
              <EmptyState icon={<FiClock />} title="No on-chain events yet" />
            ) : (
              <div className="d-flex flex-column gap-3">
                {history.data.history.events.map((event, index) => (
                  <div className="d-flex gap-3" key={`${event.txHash}-${index}`}>
                    <div
                      className="flex-shrink-0 rounded-circle mt-1"
                      style={{
                        width: 9,
                        height: 9,
                        background:
                          event.event === "AccessRevoked"
                            ? "var(--bts-danger)"
                            : event.event === "AccessGranted"
                              ? "var(--bts-info)"
                              : "var(--bts-teal)",
                      }}
                    />
                    <div className="min-w-0">
                      <div className="small fw-semibold">
                        {EVENT_LABELS[event.event] || event.event}
                      </div>
                      <div className="text-muted" style={{ fontSize: "0.74rem" }}>
                        Block {event.blockNumber}
                        {event.timestamp && ` · ${formatDate(event.timestamp, true)}`}
                        {event.custodial === true && " · signed by the platform"}
                      </div>
                      <code className="bts-mono text-muted" style={{ fontSize: "0.68rem" }}>
                        {truncateHash(event.txHash)}
                      </code>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <ShareModal
        show={showShare}
        recordId={recordId}
        onHide={() => setShowShare(false)}
        onShared={() => {
          access.refetch();
          history.refetch();
        }}
      />

      <Modal show={showDelete} onHide={() => setShowDelete(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title className="fs-6">Delete this record?</Modal.Title>
        </Modal.Header>
        <Modal.Body className="small">
          The encrypted file will be unpinned from storage and becomes unrecoverable. The record of
          its existence stays on the blockchain, so the audit trail remains complete.
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" size="sm" onClick={() => setShowDelete(false)}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" onClick={handleDelete}>
            Delete permanently
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default RecordDetail;
