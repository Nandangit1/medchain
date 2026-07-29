const { body, param, query } = require("express-validator");

const { APPOINTMENT_MODES, APPOINTMENT_STATUS } = require("../models/Appointment");

const appointmentId = () =>
  param("appointmentId").isMongoId().withMessage("Appointment id must be a valid MongoDB id.");

exports.requestAppointmentRules = [
  body("doctorId").isMongoId().withMessage("doctorId must be a valid MongoDB id."),
  body("scheduledFor")
    .isISO8601()
    .withMessage("scheduledFor must be a valid ISO 8601 date.")
    .custom((value) => {
      if (new Date(value) <= new Date()) {
        throw new Error("scheduledFor must be in the future.");
      }
      return true;
    }),
  body("durationMinutes")
    .optional()
    .isInt({ min: 5, max: 240 })
    .withMessage("Duration must be between 5 and 240 minutes."),
  body("mode")
    .optional()
    .isIn(Object.values(APPOINTMENT_MODES))
    .withMessage(`Mode must be one of: ${Object.values(APPOINTMENT_MODES).join(", ")}.`),
  body("reason")
    .trim()
    .isLength({ min: 5, max: 500 })
    .withMessage("Reason must contain 5 to 500 characters."),
];

exports.listAppointmentRules = [
  query("page").optional().isInt({ min: 1 }).withMessage("Page must be a positive integer."),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("Limit must be between 1 and 100."),
  query("status")
    .optional()
    .isIn(Object.values(APPOINTMENT_STATUS))
    .withMessage("Invalid appointment status filter."),
  query("upcoming").optional().isBoolean().withMessage("upcoming must be true or false."),
];

exports.appointmentIdRules = [appointmentId()];

exports.cancelRules = [
  appointmentId(),
  body("reason")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 300 })
    .withMessage("Cancellation reason cannot exceed 300 characters."),
];

exports.completeRules = [
  appointmentId(),
  body("doctorNotes")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 4000 })
    .withMessage("Doctor notes cannot exceed 4000 characters."),
];
