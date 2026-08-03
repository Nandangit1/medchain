/**
 * Auditable actions.
 *
 * Every entry here is something a regulator, an examiner or a patient could
 * reasonably ask "who did this, and when?" about. Ordinary reads are not
 * audited — logging every list request produces noise that buries the events
 * that matter — but reading a *clinical file* is, because that is exactly the
 * access a patient has a right to review.
 */
const AUDIT_ACTIONS = Object.freeze({
  USER_REGISTERED: "user.registered",
  USER_LOGIN: "user.login",
  USER_LOGIN_FAILED: "user.login_failed",
  USER_LOGOUT: "user.logout",
  USER_PASSWORD_CHANGED: "user.password_changed",
  USER_PASSWORD_RESET_REQUESTED: "user.password_reset_requested",
  USER_PASSWORD_RESET_COMPLETED: "user.password_reset_completed",
  USER_PROFILE_UPDATED: "user.profile_updated",
  USER_STATUS_CHANGED: "user.status_changed",
  USER_MFA_ENABLED: "user.mfa_enabled",
  USER_MFA_DISABLED: "user.mfa_disabled",
  USER_MFA_FAILED: "user.mfa_failed",
  USER_MFA_BACKUP_CODE_USED: "user.mfa_backup_code_used",
  ABHA_LINKED: "user.abha_linked",
  ABHA_UNLINKED: "user.abha_unlinked",
  DATA_EXPORTED: "user.data_exported",
  DATA_ERASED: "user.data_erased",
  ATTRIBUTE_COMMITTED: "proof.attribute_committed",
  PROOF_ISSUED: "proof.issued",
  SCRIBE_DRAFTED: "scribe.drafted",
  SCRIBE_SIGNED: "scribe.signed",

  DOCTOR_VERIFIED: "doctor.verified",
  DOCTOR_REJECTED: "doctor.rejected",

  RECORD_UPLOADED: "record.uploaded",
  RECORD_VIEWED: "record.viewed",
  RECORD_DOWNLOADED: "record.downloaded",
  RECORD_UPDATED: "record.updated",
  RECORD_DELETED: "record.deleted",
  RECORD_INTEGRITY_VERIFIED: "record.integrity_verified",

  ACCESS_GRANTED: "access.granted",
  ACCESS_REVOKED: "access.revoked",

  DIAGNOSIS_CREATED: "diagnosis.created",
  PRESCRIPTION_UPLOADED: "prescription.uploaded",

  APPOINTMENT_REQUESTED: "appointment.requested",
  APPOINTMENT_CONFIRMED: "appointment.confirmed",
  APPOINTMENT_CANCELLED: "appointment.cancelled",
  APPOINTMENT_COMPLETED: "appointment.completed",
});

const AUDIT_OUTCOMES = Object.freeze({
  SUCCESS: "success",
  FAILURE: "failure",
});

/** Groups actions for the admin audit viewer's filter. */
const AUDIT_CATEGORIES = Object.freeze({
  AUTH: "auth",
  RECORD: "record",
  ACCESS: "access",
  CLINICAL: "clinical",
  ADMIN: "admin",
  APPOINTMENT: "appointment",
});

const categoryOf = (action) => {
  if (action.startsWith("user.")) return AUDIT_CATEGORIES.AUTH;
  if (action.startsWith("record.")) return AUDIT_CATEGORIES.RECORD;
  if (action.startsWith("access.")) return AUDIT_CATEGORIES.ACCESS;
  if (action.startsWith("doctor.")) return AUDIT_CATEGORIES.ADMIN;
  if (action.startsWith("appointment.")) return AUDIT_CATEGORIES.APPOINTMENT;
  return AUDIT_CATEGORIES.CLINICAL;
};

module.exports = { AUDIT_ACTIONS, AUDIT_CATEGORIES, AUDIT_OUTCOMES, categoryOf };
