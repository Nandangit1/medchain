const { AUDIT_ACTIONS } = require("../constants/audit");
const { NOTIFICATION_TYPES } = require("../constants/notifications");
const Diagnosis = require("../models/Diagnosis");
const VitalSign = require("../models/VitalSign");
const appointmentRepository = require("../repositories/appointmentRepository");
const auditService = require("../services/auditService");
const notificationService = require("../services/notificationService");
const scribeService = require("../services/scribeService");
const AppError = require("../utils/AppError");
const catchAsync = require("../utils/catchAsync");
const { sendSuccess } = require("../utils/sendResponse");

/**
 * Ambient scribe and vitals.
 *
 * Drafting and signing are deliberately two endpoints. A draft is something
 * nobody has agreed to; signing is what turns it into a medical record.
 * Collapsing them into one call would put an unreviewed AI note into a
 * patient's chart, which is precisely what this design exists to prevent.
 */

const loadDoctorAppointment = async (appointmentId, actor) => {
  const appointment = await appointmentRepository.findById(appointmentId);

  if (!appointment) {
    throw new AppError("Appointment not found.", 404);
  }

  // Role is not enough: it must be *this* patient's treating doctor.
  if (String(appointment.doctor?._id ?? appointment.doctor) !== String(actor._id)) {
    throw new AppError("Only the treating doctor can use the scribe for this consultation.", 403);
  }

  return appointment;
};

/** Step one: draft. Nothing reaches the patient's record here. */
exports.draftNote = catchAsync(async (req, res) => {
  const appointment = await loadDoctorAppointment(req.params.appointmentId, req.user);

  const draft = await scribeService.draftFromTranscript({
    transcript: req.body.transcript,
    context: appointment.reason ? `Reason for visit: ${appointment.reason}` : undefined,
  });

  await auditService.record({
    action: AUDIT_ACTIONS.SCRIBE_DRAFTED,
    actor: req.user,
    description: `Scribe drafted a note for appointment ${appointment._id} (${draft.driver} driver)`,
    req,
  });

  sendSuccess(res, 200, "Draft note ready for your review.", { draft });
});

/**
 * Step two: sign. The doctor sends back the note they reviewed, which may
 * differ from the draft -- that is the point. What is stored is the
 * clinician's text, never the model's output passed straight through.
 */
exports.signNote = catchAsync(async (req, res) => {
  const appointment = await loadDoctorAppointment(req.params.appointmentId, req.user);
  const { summary, details, icdCode, severity, followUpAt, transcriptHash } = req.body;

  const diagnosis = await Diagnosis.create({
    patient: appointment.patient?._id ?? appointment.patient,
    doctor: req.user._id,
    summary,
    details,
    icdCode: icdCode || undefined,
    severity: severity && severity !== "unspecified" ? severity : undefined,
    followUpAt: followUpAt || undefined,
  });

  /**
   * The transcript hash lands on the appointment, not the diagnosis: it
   * attests to the conversation, not to the clinician's conclusion. Anyone
   * holding the transcript can recompute it and show the signed note belongs
   * to that consultation and no other.
   */
  await appointmentRepository.updateById(appointment._id, {
    doctorNotes: details,
    "meeting.transcriptHash": transcriptHash,
  });

  await auditService.record({
    action: AUDIT_ACTIONS.SCRIBE_SIGNED,
    actor: req.user,
    targetUser: appointment.patient,
    description: `Signed a consultation note for appointment ${appointment._id}`,
    req,
  });

  await notificationService.push({
    user: appointment.patient?._id ?? appointment.patient,
    type: NOTIFICATION_TYPES.DIAGNOSIS_ADDED,
    title: "Your consultation note is ready",
    message: `${req.user.name} signed the note from your consultation.`,
    link: "/patient/records",
    email: true,
  });

  sendSuccess(res, 201, "Consultation note signed.", { diagnosis });
});

// --- Vitals ----------------------------------------------------------------

exports.recordVital = catchAsync(async (req, res) => {
  const vital = await VitalSign.create({
    patient: req.user._id,
    type: req.body.type,
    value: req.body.value,
    secondaryValue: req.body.secondaryValue,
    unit: req.body.unit,
    source: req.body.source || "manual",
    measuredAt: req.body.measuredAt || new Date(),
  });

  sendSuccess(res, 201, "Reading recorded.", { vital: vital.toClientObject() });
});

exports.listVitals = catchAsync(async (req, res) => {
  const filter = { patient: req.user._id };

  if (req.query.type) {
    filter.type = req.query.type;
  }

  if (req.query.since) {
    filter.measuredAt = { $gte: new Date(req.query.since) };
  }

  const vitals = await VitalSign.find(filter)
    .sort({ measuredAt: -1 })
    // Capped: a wearable syncing every few seconds would otherwise return a
    // year of samples in one response.
    .limit(Math.min(Number(req.query.limit) || 200, 1000))
    .exec();

  sendSuccess(res, 200, "Your readings.", {
    vitals: vitals.map((vital) => vital.toClientObject()),
  });
});
