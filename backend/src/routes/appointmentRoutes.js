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

module.exports = router;
