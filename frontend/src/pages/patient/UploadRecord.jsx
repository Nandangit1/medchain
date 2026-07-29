import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { FiFile, FiLock, FiUploadCloud, FiX } from "react-icons/fi";
import * as yup from "yup";

import { PageHeader, RECORD_TYPE_LABELS, formatBytes } from "../../components/common";
import { recordApi } from "../../services";

/** Mirrors the backend allow-list; the API re-checks and rejects anything else. */
const ACCEPTED = {
  "application/pdf": "PDF",
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/webp": "WebP",
  "image/tiff": "TIFF",
  "application/dicom": "DICOM",
  "text/plain": "TXT",
};

const MAX_MB = 10;

const schema = yup.object({
  title: yup.string().required("Title is required.").min(3, "Too short.").max(140),
  recordType: yup.string().required("Choose a record type."),
  description: yup.string().max(1000, "Description is too long."),
  recordDate: yup.string(),
  tags: yup.string(),
});

const UploadRecord = () => {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: yupResolver(schema),
    defaultValues: { recordType: "lab_report", recordDate: new Date().toISOString().slice(0, 10) },
  });

  /** Validates type and size locally so the user is not made to wait for a 415. */
  const acceptFile = (candidate) => {
    if (!candidate) return;

    if (!ACCEPTED[candidate.type]) {
      toast.error(`Unsupported file type. Allowed: ${Object.values(ACCEPTED).join(", ")}.`);
      return;
    }

    if (candidate.size > MAX_MB * 1024 * 1024) {
      toast.error(`File is too large. Maximum size is ${MAX_MB} MB.`);
      return;
    }

    setFile(candidate);
  };

  const onSubmit = async (values) => {
    if (!file) {
      toast.error("Choose a file to upload.");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", values.title);
    formData.append("recordType", values.recordType);
    if (values.description) formData.append("description", values.description);
    if (values.recordDate) formData.append("recordDate", new Date(values.recordDate).toISOString());
    if (values.tags) formData.append("tags", values.tags);

    setSubmitting(true);
    setProgress(0);

    try {
      const data = await recordApi.upload(formData, setProgress);

      toast.success(
        data.record.blockchain?.status === "confirmed"
          ? "Uploaded, encrypted and anchored on-chain."
          : "Uploaded and encrypted. Blockchain anchoring is pending."
      );

      navigate(`/patient/records/${data.record._id}`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSubmitting(false);
      setProgress(0);
    }
  };

  return (
    <>
      <PageHeader title="Upload a report" subtitle="Encrypted on our server before it reaches storage" />

      <div className="row g-3">
        <div className="col-lg-7">
          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="bts-card p-4 mb-3">
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  acceptFile(event.dataTransfer.files?.[0]);
                }}
                onClick={() => inputRef.current?.click()}
                className="text-center p-4 rounded-3"
                style={{
                  border: `2px dashed ${dragging ? "var(--bts-teal)" : "var(--bts-border)"}`,
                  background: dragging ? "var(--bts-teal-light)" : "var(--bts-surface-2)",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                <input
                  ref={inputRef}
                  type="file"
                  className="d-none"
                  accept={Object.keys(ACCEPTED).join(",")}
                  onChange={(event) => acceptFile(event.target.files?.[0])}
                />

                {file ? (
                  <div className="d-flex align-items-center justify-content-between gap-3 text-start">
                    <div className="d-flex align-items-center gap-3 min-w-0">
                      <FiFile size={26} style={{ color: "var(--bts-teal)" }} />
                      <div className="min-w-0">
                        <div className="fw-semibold text-truncate">{file.name}</div>
                        <div className="text-muted small">
                          {formatBytes(file.size)} · {ACCEPTED[file.type]}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-danger"
                      onClick={(event) => {
                        event.stopPropagation();
                        setFile(null);
                      }}
                    >
                      <FiX />
                    </button>
                  </div>
                ) : (
                  <>
                    <FiUploadCloud size={36} style={{ color: "var(--bts-text-muted)" }} />
                    <div className="fw-semibold mt-2">Drop your report here</div>
                    <div className="text-muted small">
                      or click to browse · max {MAX_MB} MB · {Object.values(ACCEPTED).join(", ")}
                    </div>
                  </>
                )}
              </div>

              {submitting && progress > 0 && (
                <div className="progress mt-3" style={{ height: 6 }}>
                  <div className="progress-bar" style={{ width: `${progress}%` }} />
                </div>
              )}
            </div>

            <div className="bts-card p-4">
              <div className="mb-3">
                <label className="form-label small fw-semibold">Title *</label>
                <input
                  className={`form-control ${errors.title ? "is-invalid" : ""}`}
                  placeholder="e.g. Complete Blood Count"
                  {...register("title")}
                />
                {errors.title && <div className="invalid-feedback">{errors.title.message}</div>}
              </div>

              <div className="row g-2 mb-3">
                <div className="col-sm-6">
                  <label className="form-label small fw-semibold">Record type *</label>
                  <select className="form-select" {...register("recordType")}>
                    {Object.entries(RECORD_TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-sm-6">
                  <label className="form-label small fw-semibold">Date of record</label>
                  <input
                    type="date"
                    max={new Date().toISOString().slice(0, 10)}
                    className="form-control"
                    {...register("recordDate")}
                  />
                </div>
              </div>

              <div className="mb-3">
                <label className="form-label small fw-semibold">Description</label>
                <textarea
                  rows={3}
                  className={`form-control ${errors.description ? "is-invalid" : ""}`}
                  placeholder="Any context a doctor should know..."
                  {...register("description")}
                />
                {errors.description && (
                  <div className="invalid-feedback">{errors.description.message}</div>
                )}
              </div>

              <div className="mb-4">
                <label className="form-label small fw-semibold">Tags</label>
                <input
                  className="form-control"
                  placeholder="blood, routine, 2026"
                  {...register("tags")}
                />
                <div className="form-text">Comma separated, up to 10.</div>
              </div>

              <button type="submit" className="btn btn-primary w-100" disabled={submitting || !file}>
                {submitting ? (
                  <>
                    <span className="spinner-border spinner-border-sm me-2" />
                    Encrypting and uploading...
                  </>
                ) : (
                  <>
                    <FiLock className="me-2" />
                    Encrypt and upload
                  </>
                )}
              </button>
            </div>
          </form>
        </div>

        <div className="col-lg-5">
          <div className="bts-card p-4">
            <h6 className="fw-bold mb-3">What happens to this file</h6>
            {[
              ["We fingerprint it", "A SHA-256 digest of the original document becomes its permanent identity."],
              ["We encrypt it", "AES-256-GCM with a key generated for this file alone."],
              ["We store it", "The ciphertext goes to IPFS. The plaintext never touches disk."],
              ["We anchor it", "The fingerprint and storage address are written on-chain."],
            ].map(([title, text], index) => (
              <div className="d-flex gap-3 mb-3" key={title}>
                <div
                  className="flex-shrink-0 rounded-circle"
                  style={{
                    width: 24,
                    height: 24,
                    background: "var(--bts-teal)",
                    color: "#fff",
                    display: "grid",
                    placeItems: "center",
                    fontSize: "0.7rem",
                    fontWeight: 700,
                  }}
                >
                  {index + 1}
                </div>
                <div>
                  <div className="fw-semibold small">{title}</div>
                  <div className="text-muted small">{text}</div>
                </div>
              </div>
            ))}

            <div className="alert alert-info small mb-0 mt-3">
              No doctor can see this file until you explicitly share it.
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default UploadRecord;
