import { toast } from "react-toastify";

import AppointmentList from "../../components/AppointmentList";
import { PageHeader } from "../../components/common";
import useApi from "../../hooks/useApi";
import { appointmentApi } from "../../services";

const DoctorAppointments = () => {
  const state = useApi(() => appointmentApi.list({ limit: 50 }), []);

  const handleAction = async (action, appointment) => {
    try {
      if (action === "confirm") {
        await appointmentApi.confirm(appointment._id);
        toast.success("Appointment confirmed.");
      }

      if (action === "complete") {
        const notes = window.prompt("Consultation notes (optional):") ?? "";
        await appointmentApi.complete(appointment._id, notes);
        toast.success("Appointment completed.");
      }

      if (action === "cancel") {
        const reason = window.prompt("Reason for cancelling (optional):") ?? "";
        await appointmentApi.cancel(appointment._id, reason);
        toast.success("Appointment cancelled.");
      }

      if (action === "noShow") {
        await appointmentApi.noShow(appointment._id);
        toast.success("Marked as a no-show.");
      }

      state.refetch();
    } catch (error) {
      toast.error(error.message);
    }
  };

  return (
    <>
      <PageHeader title="Appointments" subtitle="Consultation requests and your schedule" />

      <div className="bts-card p-3">
        <AppointmentList state={state} perspective="doctor" onAction={handleAction} />
      </div>
    </>
  );
};

export default DoctorAppointments;
