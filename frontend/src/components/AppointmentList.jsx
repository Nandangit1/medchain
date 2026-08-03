import { Button } from "react-bootstrap";
import { useNavigate } from "react-router-dom";
import { FiCalendar, FiVideo } from "react-icons/fi";

import { EmptyState, ErrorState, SkeletonRows, StatusChip, formatDate } from "./common";

const MODE_LABELS = { video: "Video call", in_person: "In person", phone: "Phone" };

/**
 * Shared appointment table for both portals. `perspective` decides whose name
 * is shown in the counterpart column and which actions are offered — the
 * server enforces the same rules regardless.
 */
const AppointmentList = ({ state, perspective, onAction }) => {
  const { data, loading, error, refetch } = state;
  const navigate = useNavigate();

  if (loading) return <SkeletonRows rows={4} />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  if (!data?.appointments?.length) {
    return (
      <EmptyState
        icon={<FiCalendar />}
        title="No appointments"
        description={
          perspective === "patient"
            ? "Book a consultation with a verified doctor."
            : "Requests from patients will appear here."
        }
      />
    );
  }

  return (
    <div className="table-responsive">
      <table className="table table-hover align-middle mb-0">
        <thead>
          <tr>
            <th>{perspective === "patient" ? "Doctor" : "Patient"}</th>
            <th>When</th>
            <th>Mode</th>
            <th>Reason</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.appointments.map((appointment) => {
            const counterpart =
              perspective === "patient" ? appointment.doctor : appointment.patient;

            return (
              <tr key={appointment._id}>
                <td>
                  <div className="fw-semibold small">{counterpart?.name ?? "Unknown"}</div>
                  <div className="text-muted" style={{ fontSize: "0.74rem" }}>
                    {counterpart?.doctorProfile?.specialization || counterpart?.email}
                  </div>
                </td>
                <td className="small">{formatDate(appointment.scheduledFor, true)}</td>
                <td className="small text-muted">
                  {MODE_LABELS[appointment.mode] || appointment.mode}
                  <div style={{ fontSize: "0.74rem" }}>{appointment.durationMinutes} min</div>
                </td>
                <td className="small text-muted" style={{ maxWidth: 220 }}>
                  <div className="text-truncate">{appointment.reason}</div>
                </td>
                <td>
                  <StatusChip status={appointment.status} />
                </td>
                <td className="text-end">
                  <div className="d-flex gap-1 justify-content-end flex-wrap">
                    {/*
                      Offered for any confirmed video appointment. The join
                      window is enforced server-side, so an early click gets a
                      clear "opens at ..." message rather than a dead room.
                    */}
                    {appointment.mode === "video" && appointment.status === "confirmed" && (
                      <Button
                        size="sm"
                        variant="success"
                        onClick={() => navigate(`/consultation/${appointment._id}`)}
                      >
                        <FiVideo className="me-1" />
                        Join
                      </Button>
                    )}
                    {perspective === "doctor" && appointment.status === "requested" && (
                      <Button size="sm" onClick={() => onAction("confirm", appointment)}>
                        Confirm
                      </Button>
                    )}
                    {perspective === "doctor" && appointment.status === "confirmed" && (
                      <>
                        <Button size="sm" onClick={() => onAction("complete", appointment)}>
                          Complete
                        </Button>
                        <Button
                          size="sm"
                          variant="outline-secondary"
                          onClick={() => onAction("noShow", appointment)}
                        >
                          No show
                        </Button>
                      </>
                    )}
                    {["requested", "confirmed"].includes(appointment.status) && (
                      <Button
                        size="sm"
                        variant="outline-danger"
                        onClick={() => onAction("cancel", appointment)}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default AppointmentList;
