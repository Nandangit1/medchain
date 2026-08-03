const express = require("express");

const appointmentController = require("../controllers/appointmentController");
const { ROLES } = require("../constants/roles");
const { authorize, protect } = require("../middlewares/authMiddleware");
const validateRequest = require("../middlewares/validateRequest");
const {
  appointmentIdRules,
  cancelRules,
  completeRules,
  listAppointmentRules,
  recordingConsentRules,
  requestAppointmentRules,
} = require("../validators/appointmentValidators");

const router = express.Router();

router.use(protect);

router.post(
  "/",
  authorize(ROLES.PATIENT),
  requestAppointmentRules,
  validateRequest,
  appointmentController.requestAppointment
);

// Both parties list their own appointments; the service applies the scope.
router.get("/", listAppointmentRules, validateRequest, appointmentController.getAppointments);

router.get(
  "/:appointmentId",
  appointmentIdRules,
  validateRequest,
  appointmentController.getAppointmentById
);

router.patch(
  "/:appointmentId/confirm",
  authorize(ROLES.DOCTOR),
  appointmentIdRules,
  validateRequest,
  appointmentController.confirmAppointment
);

// Either party may cancel.
router.patch(
  "/:appointmentId/cancel",
  cancelRules,
  validateRequest,
  appointmentController.cancelAppointment
);

router.patch(
  "/:appointmentId/complete",
  authorize(ROLES.DOCTOR),
  completeRules,
  validateRequest,
  appointmentController.completeAppointment
);

router.patch(
  "/:appointmentId/no-show",
  authorize(ROLES.DOCTOR),
  appointmentIdRules,
  validateRequest,
  appointmentController.markNoShow
);

/**
 * Video consultation. No `authorize(...)` here on purpose -- participation, not
 * role, decides who may join, and the service checks that both parties are the
 * ones named on the appointment.
 */
router.get(
  "/:appointmentId/join",
  appointmentIdRules,
  validateRequest,
  appointmentController.joinConsultation
);

router.patch(
  "/:appointmentId/recording-consent",
  authorize(ROLES.PATIENT),
  recordingConsentRules,
  validateRequest,
  appointmentController.setRecordingConsent
);

router.patch(
  "/:appointmentId/end-call",
  authorize(ROLES.DOCTOR),
  appointmentIdRules,
  validateRequest,
  appointmentController.endConsultation
);

module.exports = router;
