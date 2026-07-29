import { useState } from "react";
import { Button } from "react-bootstrap";
import { useParams } from "react-router-dom";
import { toast } from "react-toastify";
import { FiDownload, FiPlus, FiShield } from "react-icons/fi";

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
import useApi from "../../hooks/useApi";
import { doctorApi, recordApi } from "../../services";

const DoctorRecordDetail = () => {
  const { recordId } = useParams();
  const [downloading, setDownloading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    summary: "",
    details: "",
    icdCode: "",
    severity: "moderate",
  });

  const record = useApi(() => recordApi.get(recordId), [recordId]);
  const diagnoses = useApi(() => doctorApi.recordDiagnoses(recordId), [recordId]);

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

      toast.success("Decrypted. This access has been recorded on-chain.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setDownloading(false);
    }
  };

  const handleDiagnose = async (event) => {
    event.preventDefault();
    setSubmitting(true);

    try {
      await doctorApi.createDiagnosis(recordId, {
        summary: form.summary,
        ...(form.details && { details: form.details }),
        ...(form.icdCode && { icdCode: form.icdCode }),
        severity: form.severity,
      });

      toast.success("Diagnosis recorded.");
      setForm({ summary: "", details: "", icdCode: "", severity: "moderate" });
      setShowForm(false);
      diagnoses.refetch();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader
        title={item.title}
        subtitle={`${item.patient?.name ?? "Patient"} · ${RECORD_TYPE_LABELS[item.recordType] || item.recordType}`}
        actions={
          <>
            <Button size="sm" variant="outline-primary" onClick={() => setShowForm((open) => !open)}>
              <FiPlus className="me-1" />
              Add diagnosis
            </Button>
            <Button size="sm" onClick={handleDownload} disabled={downloading}>
              <FiDownload className="me-1" />
              {downloading ? "Decrypting..." : "Download"}
            </Button>
          </>
        }
      />

      <div className="row g-3">
        <div className="col-lg-7">
          {showForm && (
            <form onSubmit={handleDiagnose} className="bts-card p-4 mb-3">
              <h6 className="fw-bold mb-3">New diagnosis</h6>

              <div className="mb-3">
                <label className="form-label small fw-semibold">Summary *</label>
                <input
                  required
                  minLength={5}
                  maxLength={300}
                  className="form-control"
                  placeholder="e.g. Mild iron deficiency anaemia"
                  value={form.summary}
                  onChange={(event) => setForm({ ...form, summary: event.target.value })}
                />
              </div>

              <div className="row g-2 mb-3">
                <div className="col-sm-6">
                  <label className="form-label small fw-semibold">ICD-10 code</label>
                  <input
                    className="form-control"
                    placeholder="E11.9"
                    value={form.icdCode}
                    onChange={(event) => setForm({ ...form, icdCode: event.target.value })}
                  />
                </div>
                <div className="col-sm-6">
                  <label className="form-label small fw-semibold">Severity</label>
                  <select
                    className="form-select"
                    value={form.severity}
                    onChange={(event) => setForm({ ...form, severity: event.target.value })}
                  >
                    <option value="low">Low</option>
                    <option value="moderate">Moderate</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
              </div>

              <div className="mb-3">
                <label className="form-label small fw-semibold">Clinical notes</label>
                <textarea
                  rows={4}
                  maxLength={4000}
                  className="form-control"
                  value={form.details}
                  onChange={(event) => setForm({ ...form, details: event.target.value })}
                />
              </div>

              <div className="d-flex gap-2">
                <Button type="submit" size="sm" disabled={submitting}>
                  {submitting ? "Saving..." : "Save diagnosis"}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}

          <div className="bts-card p-4">
            <h6 className="fw-bold mb-3">Diagnoses on this record</h6>

            {diagnoses.loading ? (
              <Loader height={120} label="" />
            ) : !diagnoses.data?.diagnoses?.length ? (
              <EmptyState title="No diagnoses yet" description="Add your clinical opinion above." />
            ) : (
              diagnoses.data.diagnoses.map((diagnosis) => (
                <div
                  key={diagnosis._id}
                  className="py-3 border-bottom"
                  style={{ borderColor: "var(--bts-border)" }}
                >
                  <div className="d-flex justify-content-between gap-2 flex-wrap">
                    <div className="fw-semibold small">{diagnosis.summary}</div>
                    <div className="d-flex gap-1">
                      {diagnosis.icdCode && (
                        <span className="bts-chip bts-chip-muted">{diagnosis.icdCode}</span>
                      )}
                      <span
                        className={`bts-chip ${
                          diagnosis.severity === "critical" || diagnosis.severity === "high"
                            ? "bts-chip-danger"
                            : "bts-chip-info"
                        }`}
                      >
                        {diagnosis.severity}
                      </span>
                    </div>
                  </div>
                  {diagnosis.details && (
                    <p className="text-muted small mt-2 mb-1">{diagnosis.details}</p>
                  )}
                  <div className="text-muted" style={{ fontSize: "0.74rem" }}>
                    {diagnosis.doctor?.name} · {formatDate(diagnosis.createdAt, true)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="col-lg-5">
          <div className="bts-card p-4 mb-3">
            <h6 className="fw-bold mb-3">Record details</h6>

            {item.description && <p className="text-muted small">{item.description}</p>}

            <dl className="row small mb-0">
              <dt className="col-5 text-muted fw-normal">File</dt>
              <dd className="col-7">{item.file.originalName}</dd>
              <dt className="col-5 text-muted fw-normal">Size</dt>
              <dd className="col-7">{formatBytes(item.file.size)}</dd>
              <dt className="col-5 text-muted fw-normal">Record date</dt>
              <dd className="col-7">{formatDate(item.recordDate)}</dd>
              <dt className="col-5 text-muted fw-normal">Uploaded</dt>
              <dd className="col-7">{formatDate(item.createdAt, true)}</dd>
            </dl>
          </div>

          <div className="bts-card p-4">
            <h6 className="fw-bold mb-3">
              <FiShield className="me-1" />
              Provenance
            </h6>

            <div className="mb-2">
              <div className="text-muted small">Document fingerprint</div>
              <code className="bts-mono d-block text-break">{item.integrity.fileHash}</code>
            </div>

            <div className="mb-2">
              <div className="text-muted small">IPFS address</div>
              <code className="bts-mono d-block text-break">{item.storage.cid}</code>
            </div>

            <div className="d-flex align-items-center gap-2">
              <StatusChip status={item.blockchain?.status} />
              {item.blockchain?.onChainId && (
                <span className="text-muted small">record #{item.blockchain.onChainId}</span>
              )}
            </div>

            {item.blockchain?.txHash && (
              <code className="bts-mono d-block text-break mt-1 text-muted" style={{ fontSize: "0.7rem" }}>
                {truncateHash(item.blockchain.txHash, 16, 12)}
              </code>
            )}

            <div className="alert alert-info small mt-3 mb-0">
              Opening this file is recorded on-chain against your account.
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default DoctorRecordDetail;
