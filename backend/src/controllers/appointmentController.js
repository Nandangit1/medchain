const appointmentService = require("../services/appointmentService");
const catchAsync = require("../utils/catchAsync");
const { sendSuccess } = require("../utils/sendResponse");

exports.requestAppointment = catchAsync(async (req, res) => {
  const appointment = await appointmentService.requestAppointment({
    actor: req.user,
    payload: req.body,
  });

  sendSuccess(res, 201, "Appointment requested successfully.", { appointment });
});

exports.getAppointments = catchAsync(async (req, res) => {
  const result = await appointmentService.listAppointments({ actor: req.user, query: req.query });

  sendSuccess(res, 200, "Appointments fetched successfully.", result);
});

exports.getAppointmentById = catchAsync(async (req, res) => {
  const appointment = await appointmentService.getAppointment({
    actor: req.user,
    appointmentId: req.params.appointmentId,
  });

  sendSuccess(res, 200, "Appointment fetched successfully.", { appointment });
});

exports.confirmAppointment = catchAsync(async (req, res) => {
  const appointment = await appointmentService.confirmAppointment({
    actor: req.user,
    appointmentId: req.params.appointmentId,
  });

  sendSuccess(res, 200, "Appointment confirmed.", { appointment });
});

exports.cancelAppointment = catchAsync(async (req, res) => {
  const appointment = await appointmentService.cancelAppointment({
    actor: req.user,
    appointmentId: req.params.appointmentId,
    reason: req.body.reason,
  });

  sendSuccess(res, 200, "Appointment cancelled.", { appointment });
});

exports.completeAppointment = catchAsync(async (req, res) => {
  const appointment = await appointmentService.completeAppointment({
    actor: req.user,
    appointmentId: req.params.appointmentId,
    doctorNotes: req.body.doctorNotes,
  });

  sendSuccess(res, 200, "Appointment completed.", { appointment });
});

exports.markNoShow = catchAsync(async (req, res) => {
  const appointment = await appointmentService.markNoShow({
    actor: req.user,
    appointmentId: req.params.appointmentId,
  });

  sendSuccess(res, 200, "Appointment marked as a no-show.", { appointment });
});

// --- Video consultation ----------------------------------------------------

exports.joinConsultation = catchAsync(async (req, res) => {
  const consultation = await appointmentService.getJoinDetails({
    actor: req.user,
    appointmentId: req.params.appointmentId,
  });

  sendSuccess(res, 200, "Consultation ready.", { consultation });
});

exports.setRecordingConsent = catchAsync(async (req, res) => {
  const result = await appointmentService.setRecordingConsent({
    actor: req.user,
    appointmentId: req.params.appointmentId,
    consent: req.body.consent,
  });

  sendSuccess(res, 200, "Recording preference saved.", result);
});

exports.endConsultation = catchAsync(async (req, res) => {
  const result = await appointmentService.endConsultation({
    actor: req.user,
    appointmentId: req.params.appointmentId,
  });

  sendSuccess(res, 200, "Consultation ended.", result);
});
