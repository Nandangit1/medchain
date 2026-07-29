import { useState } from "react";
import { Button, Modal } from "react-bootstrap";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { FiUpload, FiUsers } from "react-icons/fi";

import {
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonRows,
  formatDate,
} from "../../components/common";
import useApi from "../../hooks/useApi";
import { doctorApi } from "../../services";

const DoctorPatients = () => {
  const { data, loading, error, refetch } = useApi(() => doctorApi.patients(), []);

  const [target, setTarget] = useState(null);
  const [file, setFile] = useState(null);
  const [form, setForm] = useState({ title: "", description: "" });
  const [submitting, setSubmitting] = useState(false);

  const handleUpload = async (event) => {
    event.preventDefault();

    if (!file) {
      toast.error("Choose a prescription file.");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", form.title);
    if (form.description) formData.append("description", form.description);

    setSubmitting(true);

    try {
      await doctorApi.uploadPrescription(target.patient._id, formData);
      toast.success("Prescription uploaded, encrypted and anchored.");
      setTarget(null);
      setFile(null);
      setForm({ title: "", description: "" });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader title="My patients" subtitle="Patients who have shared records with you" />

      <div className="bts-card p-3">
        {loading ? (
          <SkeletonRows rows={4} />
        ) : error ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : data.patients.length === 0 ? (
          <EmptyState
            icon={<FiUsers />}
            title="No patients yet"
            description="A patient appears here as soon as they grant you access to a record."
          />
        ) : (
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Shared records</th>
                  <th>Last shared</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.patients.map((entry) => (
                  <tr key={entry.patient._id}>
                    <td>
                      <div className="fw-semibold small">{entry.patient.name}</div>
                      <div className="text-muted" style={{ fontSize: "0.74rem" }}>
                        {entry.patient.email}
                        {entry.patient.patientProfile?.bloodGroup &&
                          ` · ${entry.patient.patientProfile.bloodGroup}`}
                      </div>
                    </td>
                    <td>
                      <span className="bts-chip bts-chip-info">{entry.sharedRecords}</span>
                    </td>
                    <td className="small text-muted">{formatDate(entry.lastSharedAt)}</td>
                    <td className="text-end">
                      <div className="d-flex gap-1 justify-content-end">
                        <Link to="/doctor/records" className="btn btn-sm btn-outline-secondary">
                          Records
                        </Link>
                        <Button
                          size="sm"
                          variant="outline-primary"
                          onClick={() => {
                            setTarget(entry);
                            setForm({ title: "", description: "" });
                          }}
                        >
                          <FiUpload className="me-1" />
                          Prescribe
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal show={Boolean(target)} onHide={() => setTarget(null)} centered>
        <form onSubmit={handleUpload}>
          <Modal.Header closeButton>
            <Modal.Title className="fs-6">
              Prescription for {target?.patient?.name}
            </Modal.Title>
          </Modal.Header>

          <Modal.Body>
            <div className="mb-3">
              <label className="form-label small fw-semibold">Prescription file *</label>
              <input
                required
                type="file"
                className="form-control"
                accept="application/pdf,image/png,image/jpeg,text/plain"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              <div className="form-text">PDF, PNG, JPEG or TXT. Max 10 MB.</div>
            </div>

            <div className="mb-3">
              <label className="form-label small fw-semibold">Title *</label>
              <input
                required
                minLength={3}
                maxLength={140}
                className="form-control"
                placeholder="e.g. Ferrous sulphate 200mg"
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
            </div>

            <div>
              <label className="form-label small fw-semibold">Instructions</label>
              <textarea
                rows={3}
                maxLength={1000}
                className="form-control"
                placeholder="Dosage and duration..."
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
              />
            </div>

            <div className="alert alert-info small mt-3 mb-0">
              This goes through the same pipeline as any other record: encrypted, pinned to IPFS and
              anchored on-chain. It becomes part of the patient's own chart.
            </div>
          </Modal.Body>

          <Modal.Footer>
            <Button variant="secondary" size="sm" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={submitting}>
              {submitting ? "Uploading..." : "Upload prescription"}
            </Button>
          </Modal.Footer>
        </form>
      </Modal>
    </>
  );
};

export default DoctorPatients;
