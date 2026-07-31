/**
 * Notification categories.
 *
 * Kept in constants rather than on the model so that controllers and services
 * can reference a type without importing a Mongoose model — the layering rule
 * is that only repositories touch models.
 */
const NOTIFICATION_TYPES = Object.freeze({
  RECORD_SHARED: "record_shared",
  ACCESS_REVOKED: "access_revoked",
  RECORD_VIEWED: "record_viewed",
  PRESCRIPTION_ADDED: "prescription_added",
  DIAGNOSIS_ADDED: "diagnosis_added",
  DOCTOR_VERIFIED: "doctor_verified",
  DOCTOR_REJECTED: "doctor_rejected",
  APPOINTMENT_REQUESTED: "appointment_requested",
  APPOINTMENT_CONFIRMED: "appointment_confirmed",
  APPOINTMENT_CANCELLED: "appointment_cancelled",
  APPOINTMENT_COMPLETED: "appointment_completed",
  SYSTEM: "system",
});

module.exports = { NOTIFICATION_TYPES };
