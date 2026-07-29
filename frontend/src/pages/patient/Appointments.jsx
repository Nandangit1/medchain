import { useEffect, useState } from "react";
import { Button, Modal } from "react-bootstrap";
import { toast } from "react-toastify";
import { FiPlus } from "react-icons/fi";

import AppointmentList from "../../components/AppointmentList";
import { PageHeader } from "../../components/common";
import useApi from "../../hooks/useApi";
import { appointmentApi, doctorApi } from "../../services";

const PatientAppointments = () => {
  const [showBook, setShowBook] = useState(false);
  const [doctors, setDoctors] = useState([]);
  const [form, setForm] = useState({ doctorId: "", scheduledFor: "", mode: "video", reason: "" });
  const [submitting, setSubmitting] = useState(false);

  const state = useApi(() => appointmentApi.list({ limit: 50 }), []);

  useEffect(() => {
    if (!showBook) return;

    doctorApi
      .directory({ limit: 50 })
      .then((data) => setDoctors(data.doctors))
      .catch((error) => toast.error(error.message));
  }, [showBook]);

  const handleAction = async (action, appointment) => {
    try {
      if (action === "cancel") {
        const reason = window.prompt("Reason for cancelling (optional):") ?? "";
        await appointmentApi.cancel(appointment._id, reason);
        toast.success("Appointment cancelled.");
      }
      state.refetch();
    } catch (error) {
      toast.error(error.message);
    }
  };

  const handleBook = async (event) => {
    event.preventDefault();
    setSubmitting(true);

    try {
      await appointmentApi.request({
        doctorId: form.doctorId,
        scheduledFor: new Date(form.scheduledFor).toISOString(),
        mode: form.mode,
        reason: form.reason,
      });

      toast.success("Appointment requested. The doctor will confirm it.");
      setShowBook(false);
      setForm({ doctorId: "", scheduledFor: "", mode: "video", reason: "" });
      state.refetch();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Datetime-local needs a local-time string, not an ISO/UTC one.
  const minDateTime = new Date(Date.now() + 3600_000 - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);

  return (
    <>
      <PageHeader
        title="Appointments"
        subtitle="Consultations with verified doctors"
        actions={
          <Button size="sm" onClick={() => setShowBook(true)}>
            <FiPlus className="me-1" />
            Book appointment
          </Button>
        }
      />

      <div className="bts-card p-3">
        <AppointmentList state={state} perspective="patient" onAction={handleAction} />
      </div>

      <Modal show={showBook} onHide={() => setShowBook(false)} centered>
        <form onSubmit={handleBook}>
          <Modal.Header closeButton>
            <Modal.Title className="fs-6">Book an appointment</Modal.Title>
          </Modal.Header>

          <Modal.Body>
            <div className="mb-3">
              <label className="form-label small fw-semibold">Doctor *</label>
              <select
                required
                className="form-select"
                value={form.doctorId}
                onChange={(event) => setForm({ ...form, doctorId: event.target.value })}
              >
                <option value="">Choose a verified doctor...</option>
                {doctors.map((doctor) => (
                  <option key={doctor._id} value={doctor._id}>
                    {doctor.name} — {doctor.doctorProfile?.specialization}
                  </option>
                ))}
              </select>
            </div>

            <div className="row g-2 mb-3">
              <div className="col-sm-7">
                <label className="form-label small fw-semibold">Date and time *</label>
                <input
                  required
                  type="datetime-local"
                  className="form-control"
                  min={minDateTime}
                  value={form.scheduledFor}
                  onChange={(event) => setForm({ ...form, scheduledFor: event.target.value })}
                />
              </div>
              <div className="col-sm-5">
                <label className="form-label small fw-semibold">Mode</label>
                <select
                  className="form-select"
                  value={form.mode}
                  onChange={(event) => setForm({ ...form, mode: event.target.value })}
                >
                  <option value="video">Video call</option>
                  <option value="in_person">In person</option>
                  <option value="phone">Phone</option>
                </select>
              </div>
            </div>

            <div>
              <label className="form-label small fw-semibold">Reason *</label>
              <textarea
                required
                rows={3}
                minLength={5}
                maxLength={500}
                className="form-control"
                placeholder="Briefly describe why you need this consultation..."
                value={form.reason}
                onChange={(event) => setForm({ ...form, reason: event.target.value })}
              />
            </div>
          </Modal.Body>

          <Modal.Footer>
            <Button variant="secondary" size="sm" onClick={() => setShowBook(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={submitting}>
              {submitting ? "Requesting..." : "Request appointment"}
            </Button>
          </Modal.Footer>
        </form>
      </Modal>
    </>
  );
};

export default PatientAppointments;
