import { useEffect, useState } from "react";
import { Button, Modal } from "react-bootstrap";
import { toast } from "react-toastify";
import { FiSearch, FiUserCheck } from "react-icons/fi";

import { EmptyState, Loader } from "./common";
import { doctorApi, recordApi } from "../services";

/**
 * Grants a verified doctor time-limited access to one record.
 *
 * Only verified doctors are listed, because the contract itself refuses a
 * grant to an unverified one — offering them here would produce a confusing
 * failure at submit time.
 */
const ShareModal = ({ show, recordId, onHide, onShared }) => {
  const [search, setSearch] = useState("");
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [expiresAt, setExpiresAt] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!show) return undefined;

    // Debounced so a search does not fire a request per keystroke.
    const timer = setTimeout(async () => {
      setLoading(true);

      try {
        const data = await doctorApi.directory({
          limit: 20,
          ...(search.trim().length >= 2 && { search: search.trim() }),
        });
        setDoctors(data.doctors);
      } catch (error) {
        toast.error(error.message);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [search, show]);

  useEffect(() => {
    if (!show) {
      setSelected(null);
      setExpiresAt("");
      setNote("");
      setSearch("");
    }
  }, [show]);

  const handleShare = async () => {
    if (!selected) {
      toast.error("Choose a doctor first.");
      return;
    }

    setSubmitting(true);

    try {
      await recordApi.share(recordId, {
        doctorId: selected._id,
        ...(expiresAt && { expiresAt: new Date(expiresAt).toISOString() }),
        ...(note && { note }),
      });

      toast.success(`Access granted to ${selected.name}.`);
      onShared?.();
      onHide();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal show={show} onHide={onHide} centered size="lg">
      <Modal.Header closeButton>
        <Modal.Title className="fs-6">Share this record</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        <div className="input-group input-group-sm mb-3">
          <span className="input-group-text bg-transparent">
            <FiSearch />
          </span>
          <input
            className="form-control"
            placeholder="Search verified doctors by name, specialization or hospital..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div style={{ maxHeight: 260, overflowY: "auto" }} className="mb-3">
          {loading ? (
            <Loader height={140} label="" />
          ) : doctors.length === 0 ? (
            <EmptyState
              icon={<FiUserCheck />}
              title="No verified doctors found"
              description="Only doctors an administrator has verified can receive access."
            />
          ) : (
            doctors.map((doctor) => {
              const isSelected = selected?._id === doctor._id;

              return (
                <button
                  type="button"
                  key={doctor._id}
                  onClick={() => setSelected(doctor)}
                  className="w-100 text-start border rounded-3 p-2 mb-2 d-flex align-items-center gap-3"
                  style={{
                    background: isSelected ? "var(--bts-teal-light)" : "transparent",
                    borderColor: isSelected ? "var(--bts-teal)" : "var(--bts-border)",
                    color: "var(--bts-text)",
                  }}
                >
                  <span
                    className="bts-avatar"
                    style={{ width: 34, height: 34, fontSize: "0.75rem" }}
                  >
                    {doctor.name
                      .split(" ")
                      .map((part) => part[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="d-block fw-semibold small">{doctor.name}</span>
                    <span className="d-block text-muted" style={{ fontSize: "0.75rem" }}>
                      {doctor.doctorProfile?.specialization}
                      {doctor.doctorProfile?.hospitalName && ` · ${doctor.doctorProfile.hospitalName}`}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="row g-2">
          <div className="col-sm-6">
            <label className="form-label small fw-semibold">Access expires (optional)</label>
            <input
              type="date"
              className="form-control form-control-sm"
              min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)}
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
            <div className="form-text" style={{ fontSize: "0.72rem" }}>
              Leave blank for open-ended access. You can revoke at any time.
            </div>
          </div>
          <div className="col-sm-6">
            <label className="form-label small fw-semibold">Note (optional)</label>
            <input
              className="form-control form-control-sm"
              placeholder="e.g. Second opinion"
              maxLength={300}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
        </div>

        <div className="alert alert-info small mt-3 mb-0">
          This grant is written to the blockchain, so both the sharing and any future revocation
          are permanently auditable.
        </div>
      </Modal.Body>

      <Modal.Footer>
        <Button variant="secondary" size="sm" onClick={onHide}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleShare} disabled={submitting || !selected}>
          {submitting ? "Granting access..." : "Grant access"}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default ShareModal;
