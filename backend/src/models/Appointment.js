const mongoose = require("mongoose");

const APPOINTMENT_STATUS = Object.freeze({
  REQUESTED: "requested",
  CONFIRMED: "confirmed",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  NO_SHOW: "no_show",
});

const APPOINTMENT_MODES = Object.freeze({
  VIDEO: "video",
  IN_PERSON: "in_person",
  PHONE: "phone",
});

/**
 * A consultation slot between a patient and a doctor.
 *
 * Purely off-chain: an appointment is scheduling data, not a medical record,
 * and nothing about it belongs on a public ledger.
 */
const appointmentSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    scheduledFor: {
      type: Date,
      required: [true, "An appointment needs a scheduled time."],
      index: true,
    },
    durationMinutes: {
      type: Number,
      default: 30,
      min: [5, "An appointment must last at least 5 minutes."],
      max: [240, "An appointment cannot exceed 4 hours."],
    },
    mode: {
      type: String,
      enum: Object.values(APPOINTMENT_MODES),
      default: APPOINTMENT_MODES.VIDEO,
    },
    status: {
      type: String,
      enum: Object.values(APPOINTMENT_STATUS),
      default: APPOINTMENT_STATUS.REQUESTED,
      index: true,
    },
    reason: {
      type: String,
      required: [true, "A reason for the consultation is required."],
      trim: true,
      minlength: [5, "Reason must contain at least 5 characters."],
      maxlength: [500, "Reason cannot exceed 500 characters."],
    },
    /** Written by the doctor after the consultation. */
    doctorNotes: { type: String, trim: true, maxlength: 4000 },
    /**
     * Video consultation state, populated only for `mode: "video"`.
     *
     * `roomId` is a random opaque identifier, never the appointment id: the
     * room name is what a Jitsi URL exposes, and a guessable one would let an
     * outsider walk into a consultation. It is minted on first join and then
     * reused, so both participants land in the same room.
     */
    meeting: {
      roomId: { type: String, trim: true, select: false },
      startedAt: Date,
      endedAt: Date,
      // Recording is off unless the patient agrees in the waiting room. Stored
      // because "did the patient consent?" is a question that gets asked later.
      recordingConsent: { type: Boolean, default: false },
      participantsJoined: { type: Number, default: 0, min: 0 },
      /**
       * SHA-256 of the consultation transcript the signed note was drafted
       * from. Stored here rather than on the Diagnosis because it attests to
       * the conversation, not to the clinician's conclusion: anyone holding
       * the transcript can recompute it and show the note belongs to this
       * consultation and no other. The transcript itself is never stored.
       */
      transcriptHash: { type: String, trim: true, lowercase: true },
    },
    cancellationReason: { type: String, trim: true, maxlength: 300 },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    confirmedAt: Date,
    completedAt: Date,
  },
  { timestamps: true }
);

/**
 * Prevents double-booking: a doctor cannot hold two live appointments at the
 * same instant. Cancelled and completed slots are excluded so the time can be
 * reused.
 */
appointmentSchema.index(
  { doctor: 1, scheduledFor: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: [APPOINTMENT_STATUS.REQUESTED, APPOINTMENT_STATUS.CONFIRMED] },
    },
  }
);
appointmentSchema.index({ patient: 1, scheduledFor: -1 });

appointmentSchema.methods.toClientObject = function toClientObject() {
  const appointment = this.toObject();
  delete appointment.__v;
  return appointment;
};

const Appointment = mongoose.model("Appointment", appointmentSchema);

module.exports = Appointment;
module.exports.APPOINTMENT_STATUS = APPOINTMENT_STATUS;
module.exports.APPOINTMENT_MODES = APPOINTMENT_MODES;
