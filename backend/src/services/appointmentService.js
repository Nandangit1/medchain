const crypto = require("crypto");

const { env } = require("../config/env");
const { DOCTOR_VERIFICATION_STATUS, ROLES } = require("../constants/roles");
const { APPOINTMENT_MODES, APPOINTMENT_STATUS } = require("../models/Appointment");
const appointmentRepository = require("../repositories/appointmentRepository");
const userRepository = require("../repositories/userRepository");
const AppError = require("../utils/AppError");
const { buildPagination, buildPaginationMeta } = require("../utils/pagination");

/**
 * Appointment Service — Module 6b.
 *
 * The status lifecycle is enforced here rather than left to the client:
 *
 *   requested ──▶ confirmed ──▶ completed
 *       │             │
 *       └─────────────┴──▶ cancelled | no_show
 *
 * Any other move is rejected. Without this a client could mark an appointment
 * completed before it was ever confirmed, or reopen a cancelled slot.
 */
const ALLOWED_TRANSITIONS = Object.freeze({
  [APPOINTMENT_STATUS.REQUESTED]: [APPOINTMENT_STATUS.CONFIRMED, APPOINTMENT_STATUS.CANCELLED],
  [APPOINTMENT_STATUS.CONFIRMED]: [
    APPOINTMENT_STATUS.COMPLETED,
    APPOINTMENT_STATUS.CANCELLED,
    APPOINTMENT_STATUS.NO_SHOW,
  ],
  [APPOINTMENT_STATUS.COMPLETED]: [],
  [APPOINTMENT_STATUS.CANCELLED]: [],
  [APPOINTMENT_STATUS.NO_SHOW]: [],
});

const assertTransition = (from, to) => {
  if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
    throw new AppError(`An appointment cannot move from "${from}" to "${to}".`, 400);
  }
};

const loadParticipantAppointment = async (appointmentId, actor) => {
  const appointment = await appointmentRepository.findById(appointmentId);

  if (!appointment) {
    throw new AppError("Appointment not found.", 404);
  }

  const isPatient = String(appointment.patient?._id ?? appointment.patient) === String(actor._id);
  const isDoctor = String(appointment.doctor?._id ?? appointment.doctor) === String(actor._id);

  if (!isPatient && !isDoctor && actor.role !== ROLES.ADMIN) {
    throw new AppError("You do not have permission to access this appointment.", 403);
  }

  return { appointment, isPatient, isDoctor };
};

/** Patient requests a slot with a verified doctor. */
const requestAppointment = async ({ actor, payload }) => {
  const doctor = await userRepository.findActiveById(payload.doctorId);

  if (!doctor || doctor.role !== ROLES.DOCTOR) {
    throw new AppError("Doctor not found.", 404);
  }

  if (doctor.doctorProfile?.verificationStatus !== DOCTOR_VERIFICATION_STATUS.VERIFIED) {
    throw new AppError("Appointments can only be booked with a verified doctor.", 400);
  }

  if (new Date(payload.scheduledFor) <= new Date()) {
    throw new AppError("The appointment time must be in the future.", 400);
  }

  try {
    const appointment = await appointmentRepository.create({
      patient: actor._id,
      doctor: doctor._id,
      scheduledFor: payload.scheduledFor,
      durationMinutes: payload.durationMinutes,
      mode: payload.mode,
      reason: payload.reason,
    });

    return appointment.toClientObject();
  } catch (error) {
    // Surfaces the partial unique index as a clear conflict rather than a 500.
    if (error.code === 11000) {
      throw new AppError("That time slot is already booked with this doctor.", 409);
    }

    throw error;
  }
};

const listAppointments = async ({ actor, query }) => {
  const pagination = buildPagination(query);
  const filter = {};

  if (actor.role === ROLES.PATIENT) {
    filter.patient = actor._id;
  } else if (actor.role === ROLES.DOCTOR) {
    filter.doctor = actor._id;
  }

  if (query.status) {
    filter.status = query.status;
  }

  if (query.upcoming === "true") {
    filter.scheduledFor = { $gte: new Date() };
  }

  const { appointments, totalItems } = await appointmentRepository.paginate(
    filter,
    pagination,
    query.upcoming === "true" ? { scheduledFor: 1 } : { scheduledFor: -1 }
  );

  return {
    appointments: appointments.map((appointment) => appointment.toClientObject()),
    pagination: buildPaginationMeta(totalItems, pagination),
  };
};

const getAppointment = async ({ actor, appointmentId }) => {
  const { appointment } = await loadParticipantAppointment(appointmentId, actor);
  return appointment.toClientObject();
};

/** Doctor accepts a requested slot. */
const confirmAppointment = async ({ actor, appointmentId }) => {
  const { appointment, isDoctor } = await loadParticipantAppointment(appointmentId, actor);

  if (!isDoctor) {
    throw new AppError("Only the assigned doctor can confirm an appointment.", 403);
  }

  assertTransition(appointment.status, APPOINTMENT_STATUS.CONFIRMED);

  const updated = await appointmentRepository.updateById(appointmentId, {
    status: APPOINTMENT_STATUS.CONFIRMED,
    confirmedAt: new Date(),
  });

  return updated.toClientObject();
};

/** Either party may cancel, up until the appointment is completed. */
const cancelAppointment = async ({ actor, appointmentId, reason }) => {
  const { appointment } = await loadParticipantAppointment(appointmentId, actor);

  assertTransition(appointment.status, APPOINTMENT_STATUS.CANCELLED);

  const updated = await appointmentRepository.updateById(appointmentId, {
    status: APPOINTMENT_STATUS.CANCELLED,
    cancellationReason: reason,
    cancelledBy: actor._id,
  });

  return updated.toClientObject();
};

const completeAppointment = async ({ actor, appointmentId, doctorNotes }) => {
  const { appointment, isDoctor } = await loadParticipantAppointment(appointmentId, actor);

  if (!isDoctor) {
    throw new AppError("Only the assigned doctor can complete an appointment.", 403);
  }

  assertTransition(appointment.status, APPOINTMENT_STATUS.COMPLETED);

  const updated = await appointmentRepository.updateById(appointmentId, {
    status: APPOINTMENT_STATUS.COMPLETED,
    completedAt: new Date(),
    doctorNotes,
  });

  return updated.toClientObject();
};

const markNoShow = async ({ actor, appointmentId }) => {
  const { appointment, isDoctor } = await loadParticipantAppointment(appointmentId, actor);

  if (!isDoctor) {
    throw new AppError("Only the assigned doctor can mark a no-show.", 403);
  }

  assertTransition(appointment.status, APPOINTMENT_STATUS.NO_SHOW);

  const updated = await appointmentRepository.updateById(appointmentId, {
    status: APPOINTMENT_STATUS.NO_SHOW,
  });

  return updated.toClientObject();
};

/**
 * Issues the details needed to join the video consultation.
 *
 * Three rules decide whether a join is allowed, and all three live here rather
 * than in the client:
 *
 *   1. Only the two participants may join. An admin can see that a video
 *      appointment exists but is never given the room -- the same principle as
 *      administrators being able to read record metadata but never a file.
 *   2. The appointment must be confirmed. A room for a slot the doctor has not
 *      accepted is a way to reach a clinician uninvited.
 *   3. The room opens shortly before the slot and closes after it. An
 *      indefinitely live room is a standing back door into a private call.
 */
const JOIN_OPENS_MINUTES_BEFORE = 10;
const JOIN_CLOSES_MINUTES_AFTER = 30;

const getJoinDetails = async ({ actor, appointmentId }) => {
  const { appointment, isPatient, isDoctor } = await loadParticipantAppointment(appointmentId, actor);

  if (!isPatient && !isDoctor) {
    throw new AppError("Only the patient and the doctor can join this consultation.", 403);
  }

  if (appointment.mode !== APPOINTMENT_MODES.VIDEO) {
    throw new AppError("This appointment is not a video consultation.", 400);
  }

  if (appointment.status !== APPOINTMENT_STATUS.CONFIRMED) {
    throw new AppError(
      `This consultation is ${appointment.status}. Only a confirmed appointment can be joined.`,
      409
    );
  }

  const scheduledFor = new Date(appointment.scheduledFor);
  const opensAt = new Date(scheduledFor.getTime() - JOIN_OPENS_MINUTES_BEFORE * 60_000);
  const closesAt = new Date(
    scheduledFor.getTime() + (appointment.durationMinutes + JOIN_CLOSES_MINUTES_AFTER) * 60_000
  );
  const now = new Date();

  if (now < opensAt) {
    throw new AppError(
      `This consultation opens at ${opensAt.toISOString()}, ${JOIN_OPENS_MINUTES_BEFORE} minutes before the scheduled time.`,
      425
    );
  }

  if (now > closesAt) {
    throw new AppError("This consultation has ended.", 410);
  }

  // Minted on first join and reused thereafter, so both participants converge
  // on one room without either side having to be "first".
  const stored = await appointmentRepository.findByIdWithMeeting(appointmentId);
  let roomId = stored?.meeting?.roomId;

  if (!roomId) {
    roomId = `medchain-${crypto.randomBytes(18).toString("base64url")}`;
    await appointmentRepository.updateById(appointmentId, {
      "meeting.roomId": roomId,
      "meeting.startedAt": now,
    });
  }

  await appointmentRepository.incrementParticipants(appointmentId);

  const counterpart = isPatient ? appointment.doctor : appointment.patient;

  return {
    roomId,
    // Sent to the client so the host is configured in exactly one place.
    domain: env.JITSI_DOMAIN,
    // The client passes these to Jitsi so neither participant has to type a
    // display name into a third-party prompt.
    displayName: actor.name,
    email: actor.email,
    role: isDoctor ? "doctor" : "patient",
    // The doctor is the host: they admit from the waiting room and end the call.
    isHost: isDoctor,
    counterpartName: counterpart?.name ?? null,
    scheduledFor: appointment.scheduledFor,
    durationMinutes: appointment.durationMinutes,
    opensAt,
    closesAt,
    recordingConsent: Boolean(stored?.meeting?.recordingConsent),
  };
};

/**
 * Recording is opt-in and recorded as a fact. Only the patient can give it --
 * it is their consultation being captured.
 */
const setRecordingConsent = async ({ actor, appointmentId, consent }) => {
  const { isPatient } = await loadParticipantAppointment(appointmentId, actor);

  if (!isPatient) {
    throw new AppError("Only the patient can consent to the consultation being recorded.", 403);
  }

  const updated = await appointmentRepository.updateById(appointmentId, {
    "meeting.recordingConsent": Boolean(consent),
  });

  return { recordingConsent: Boolean(updated.meeting?.recordingConsent) };
};

/** Called when a participant leaves, so the record shows when the call ended. */
const endConsultation = async ({ actor, appointmentId }) => {
  const { isDoctor } = await loadParticipantAppointment(appointmentId, actor);

  if (!isDoctor) {
    throw new AppError("Only the doctor can end the consultation.", 403);
  }

  const updated = await appointmentRepository.updateById(appointmentId, {
    "meeting.endedAt": new Date(),
  });

  return { endedAt: updated.meeting?.endedAt ?? null };
};

module.exports = {
  JOIN_CLOSES_MINUTES_AFTER,
  JOIN_OPENS_MINUTES_BEFORE,
  cancelAppointment,
  completeAppointment,
  confirmAppointment,
  endConsultation,
  getAppointment,
  getJoinDetails,
  listAppointments,
  markNoShow,
  requestAppointment,
  setRecordingConsent,
};
